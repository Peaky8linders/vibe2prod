/**
 * scanners/code-quality-scanner.ts — Code quality and maintainability scanner
 *
 * Detects code smells, complexity issues, missing error handling patterns,
 * type safety gaps, and maintainability concerns.
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface";

function createIdGen() {
  let counter = 0;
  return () => { counter++; return `CQ-${String(counter).padStart(3, "0")}`; };
}

function scan(filePath: string, content: string, language: string): FileDefect[] {
  const nextId = createIdGen();
  const defects: FileDefect[] = [];
  const lines = content.split("\n");
  const isTest = /\.test\.|\.spec\.|__tests__|tests[/\\]|conftest/.test(filePath);
  if (isTest) return defects;

  const isTsJs = language === "typescript" || language === "javascript";
  const isPython = language === "python";

  // --- File-level complexity ---
  if (lines.length > 400) {
    defects.push({ id: nextId(), dimension: "code-quality", priority: "P2", line: null, description: `Large file (${lines.length} lines) — consider splitting`, fix_hint: "Extract related logic into focused modules." });
  }

  // Track function sizes
  let functionStart = -1;
  let braceDepth = 0;
  let functionName = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    if (isTsJs) {
      // --- Large function detection ---
      const funcMatch = line.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(\w+)\s*(?::\s*\w+)?\s*\(.*\)\s*(?::\s*\w+)?\s*\{)/);
      if (funcMatch && functionStart === -1) {
        functionStart = i;
        functionName = funcMatch[1] || funcMatch[2] || funcMatch[3] || "anonymous";
        braceDepth = 0;
      }

      if (functionStart >= 0) {
        for (const ch of line) {
          if (ch === "{") braceDepth++;
          if (ch === "}") braceDepth--;
        }
        if (braceDepth <= 0 && i > functionStart) {
          const funcLength = i - functionStart;
          if (funcLength > 80) {
            defects.push({ id: nextId(), dimension: "code-quality", priority: "P2", line: functionStart + 1, description: `Function '${functionName}' is ${funcLength} lines — hard to maintain`, fix_hint: "Extract sub-functions for distinct responsibilities." });
          }
          functionStart = -1;
        }
      }

      // --- Deeply nested code ---
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      const isCode = line.trim().length > 0 && !/^\s*\/\//.test(line) && !/^\s*\*/.test(line);
      if (isCode && indent >= 24) { // 6+ levels of nesting (4-space indent)
        defects.push({ id: nextId(), dimension: "code-quality", priority: "P2", line: lineNum, description: "Deeply nested code (6+ levels) — reduces readability", fix_hint: "Use early returns, extract functions, or flatten logic." });
      }

      // --- TODO/FIXME/HACK in production ---
      if (/\/\/\s*(?:TODO|FIXME|HACK|XXX|TEMP|TEMPORARY)\b/i.test(line)) {
        defects.push({ id: nextId(), dimension: "code-quality", priority: "P3", line: lineNum, description: "TODO/FIXME comment in production code", fix_hint: "Resolve the issue or track it in your issue tracker." });
      }

      // --- Magic numbers ---
      if (/(?:timeout|delay|retry|max|min|limit|size|count|threshold)\s*[:=]\s*\d{2,}/.test(line) && !/const\s/.test(line) && !/(?:eslint|prettier)/.test(line)) {
        defects.push({ id: nextId(), dimension: "code-quality", priority: "P3", line: lineNum, description: "Magic number in configuration — hard to understand and maintain", fix_hint: "Extract to a named constant with clear purpose." });
      }

      // --- Promise without catch ---
      if (/\.then\s*\(/.test(line) && !/\.catch\s*\(/.test(lines.slice(i, Math.min(i + 5, lines.length)).join(" "))) {
        defects.push({ id: nextId(), dimension: "error-handling", priority: "P2", line: lineNum, description: "Promise chain without .catch() handler", fix_hint: "Add .catch() or use async/await with try/catch." });
      }

      // --- Async function without try/catch ---
      if (/async\s+(?:function|\w+\s*=\s*async)/.test(line) || /async\s*\(/.test(line)) {
        const funcBody = lines.slice(i, Math.min(i + 30, lines.length)).join("\n");
        const hasAwait = /\bawait\b/.test(funcBody);
        const hasTryCatch = /\btry\s*\{/.test(funcBody);
        if (hasAwait && !hasTryCatch && /(?:export|app\.|router\.|handler)/.test(lines.slice(Math.max(0, i - 2), i + 1).join(" "))) {
          defects.push({ id: nextId(), dimension: "error-handling", priority: "P1", line: lineNum, description: "Exported async function without try/catch", fix_hint: "Wrap await calls in try/catch with proper error handling." });
        }
      }

      // --- Non-specific error handling ---
      if (/catch\s*\(\s*(?:e|err|error)\s*\)/.test(line)) {
        const catchBody = lines.slice(i, Math.min(i + 5, lines.length)).join(" ");
        if (/console\.log/.test(catchBody) && !/(?:throw|reject|res\.status|next\(|logger|log\.\w+)/.test(catchBody)) {
          defects.push({ id: nextId(), dimension: "error-handling", priority: "P2", line: lineNum, description: "Error caught but only console.logged — not properly handled", fix_hint: "Use structured logger and consider re-throwing or returning error response." });
        }
      }
    }

    if (isPython) {
      // --- Large function detection ---
      if (/^\s*(?:def |async def )/.test(line)) {
        const funcNameMatch = line.match(/def\s+(\w+)/);
        const currentIndent = (line.match(/^(\s*)/)?.[1] ?? "").length;
        let funcEnd = i + 1;
        while (funcEnd < lines.length) {
          const nextLine = lines[funcEnd]!;
          if (nextLine.trim().length > 0) {
            const nextIndent = (nextLine.match(/^(\s*)/)?.[1] ?? "").length;
            if (nextIndent <= currentIndent) break;
          }
          funcEnd++;
        }
        const funcLength = funcEnd - i;
        if (funcLength > 60) {
          defects.push({ id: nextId(), dimension: "code-quality", priority: "P2", line: lineNum, description: `Function '${funcNameMatch?.[1] ?? "unknown"}' is ${funcLength} lines`, fix_hint: "Extract sub-functions for distinct responsibilities." });
        }
      }

      // --- Bare string concatenation for paths ---
      if (/(?:open|Path)\s*\(.*\+/.test(line) || (!/os\.path\.join/.test(line) && /['"]\/.*['"].*\+/.test(line))) {
        if (/(?:request|input|arg|param|user)/.test(line)) {
          defects.push({ id: nextId(), dimension: "security", priority: "P1", line: lineNum, description: "Path construction with string concatenation and user input", fix_hint: "Use pathlib.Path and validate against base directory." });
        }
      }

      // --- Missing type hints on public functions ---
      if (/^\s*def\s+\w+\s*\([^)]*\)\s*:/.test(line) && !/->/.test(line) && !/^_/.test(line.match(/def\s+(\w+)/)?.[1] ?? "")) {
        defects.push({ id: nextId(), dimension: "code-quality", priority: "P3", line: lineNum, description: "Public function missing return type hint", fix_hint: "Add -> ReturnType annotation for documentation and type checking." });
      }

      // --- TODO/FIXME ---
      if (/#\s*(?:TODO|FIXME|HACK|XXX|TEMP)\b/i.test(line)) {
        defects.push({ id: nextId(), dimension: "code-quality", priority: "P3", line: lineNum, description: "TODO/FIXME comment in production code", fix_hint: "Resolve the issue or track it in your issue tracker." });
      }
    }
  }

  return defects;
}

export const codeQualityScanner: ScannerPlugin = {
  name: "code-quality",
  dimensions: ["code-quality", "error-handling"],
  scan,
};
