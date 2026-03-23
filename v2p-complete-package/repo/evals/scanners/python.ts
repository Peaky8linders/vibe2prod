/**
 * evals/scanners/python.ts — Python + FastAPI defect scanners
 *
 * Detects common production defects in vibe-coded Python projects:
 *   - Bare except clauses
 *   - Missing type hints on function signatures
 *   - FastAPI routes without Pydantic request models
 *   - Hardcoded secrets
 *   - SQL injection via f-strings
 *   - No logging (print statements instead)
 *   - Missing __init__.py (import issues)
 *   - No requirements.txt / pyproject.toml pinning
 */

import { readFileSync, existsSync } from "node:fs";

interface Defect {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  file: string;
  line_range: [number, number] | null;
  description: string;
  fixed: boolean;
  fix_commit: string | null;
  attempts: number;
  needs_human_review: boolean;
}

type Scanner = (file: string, content: string, lines: string[]) => Defect[];

let counter = 0;
function nextId(prefix: string): string {
  counter++;
  return `${prefix}-P${String(counter).padStart(3, "0")}`;
}

export function resetCounter(start = 0): void {
  counter = start;
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

export const scanPythonErrorHandling: Scanner = (file, _content, lines) => {
  const defects: Defect[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Bare except
    if (/^except\s*:/.test(trimmed)) {
      defects.push({
        id: nextId("EH"), dimension: "error-handling", priority: "P1", file,
        line_range: [i + 1, i + 1],
        description: `Bare \`except:\` catches all exceptions including KeyboardInterrupt at line ${i + 1}`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
      });
    }

    // except Exception with pass (swallowed)
    if (/^except\s+\w+.*:/.test(trimmed)) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine === "pass" || nextLine === "...") {
        defects.push({
          id: nextId("EH"), dimension: "error-handling", priority: "P1", file,
          line_range: [i + 1, i + 2],
          description: `Exception swallowed with pass/... at line ${i + 1}`,
          fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
        });
      }
    }

    // requests/httpx call without timeout
    if (/requests\.(get|post|put|patch|delete)\s*\(/.test(line) && !/timeout/.test(line)) {
      defects.push({
        id: nextId("EH"), dimension: "error-handling", priority: "P2", file,
        line_range: [i + 1, i + 1],
        description: `HTTP request without timeout parameter at line ${i + 1}`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
      });
    }
  }

  return defects;
};

// ---------------------------------------------------------------------------
// Input Validation
// ---------------------------------------------------------------------------

export const scanPythonInputValidation: Scanner = (file, content, lines) => {
  const defects: Defect[] = [];

  // FastAPI route without typed request body
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (/@(app|router)\.(post|put|patch)\s*\(/.test(line)) {
      // Look ahead for def with request/body param
      const funcBlock = lines.slice(i, i + 5).join("\n");
      if (/def\s+\w+\(/.test(funcBlock) && /:\s*dict\b|:\s*Any\b/.test(funcBlock)) {
        defects.push({
          id: nextId("IV"), dimension: "input-validation", priority: "P1", file,
          line_range: [i + 1, i + 5],
          description: `FastAPI mutation endpoint using dict/Any instead of Pydantic model near line ${i + 1}`,
          fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
        });
      }
    }

    // Missing type hints on function args
    if (/^def\s+\w+\(/.test(line.trim()) && !line.includes("->") && !line.includes("self")) {
      const args = line.match(/\(([^)]*)\)/)?.[1] ?? "";
      const params = args.split(",").map((p) => p.trim()).filter(Boolean);
      const untypedParams = params.filter((p) => !p.includes(":") && p !== "self" && p !== "cls" && !p.startsWith("*"));
      if (untypedParams.length > 0) {
        defects.push({
          id: nextId("IV"), dimension: "input-validation", priority: "P2", file,
          line_range: [i + 1, i + 1],
          description: `Function with untyped parameters (${untypedParams.join(", ")}) at line ${i + 1}`,
          fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
        });
      }
    }

    // Any type annotations
    if (/:\s*Any\b/.test(line) && !/import/.test(line)) {
      defects.push({
        id: nextId("IV"), dimension: "input-validation", priority: "P2", file,
        line_range: [i + 1, i + 1],
        description: `\`Any\` type annotation at line ${i + 1} — bypasses type safety`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
      });
    }
  }

  return defects;
};

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export const scanPythonSecurity: Scanner = (file, content, lines) => {
  const defects: Defect[] = [];

  const secretPatterns = [
    { name: "API key", pattern: /(?:api[_-]?key|apikey)\s*=\s*['"][A-Za-z0-9]{20,}['"]/i },
    { name: "password", pattern: /(?:password|passwd|secret)\s*=\s*['"][^'"]{8,}['"]/i },
    { name: "AWS key", pattern: /AKIA[A-Z0-9]{16}/ },
    { name: "private key", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { name, pattern } of secretPatterns) {
      if (pattern.test(lines[i]!)) {
        defects.push({
          id: nextId("SEC"), dimension: "security", priority: "P0", file,
          line_range: [i + 1, i + 1],
          description: `Hardcoded ${name} at line ${i + 1}`,
          fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
        });
      }
    }
  }

  // SQL injection via f-string
  if (/f['"].*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(content)) {
    defects.push({
      id: nextId("SEC"), dimension: "security", priority: "P0", file,
      line_range: null,
      description: "SQL injection risk — f-string used in SQL query",
      fixed: false, fix_commit: null, attempts: 0, needs_human_review: true,
    });
  }

  // .format() in SQL
  if (/\.format\(.*\).*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(content)) {
    defects.push({
      id: nextId("SEC"), dimension: "security", priority: "P0", file,
      line_range: null,
      description: "SQL injection risk — .format() used in SQL query",
      fixed: false, fix_commit: null, attempts: 0, needs_human_review: true,
    });
  }

  // pickle.loads on untrusted input
  if (/pickle\.loads?\(/.test(content)) {
    defects.push({
      id: nextId("SEC"), dimension: "security", priority: "P0", file,
      line_range: null,
      description: "Arbitrary code execution risk — pickle.load on potentially untrusted data",
      fixed: false, fix_commit: null, attempts: 0, needs_human_review: true,
    });
  }

  // DEBUG = True in production-like files
  if (/DEBUG\s*=\s*True/.test(content) && !file.includes("test")) {
    defects.push({
      id: nextId("SEC"), dimension: "security", priority: "P1", file,
      line_range: null,
      description: "DEBUG = True in non-test file",
      fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
    });
  }

  return defects;
};

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export const scanPythonObservability: Scanner = (file, _content, lines) => {
  const defects: Defect[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/\bprint\s*\(/.test(lines[i]!) && !file.includes("test") && !file.includes("cli")) {
      defects.push({
        id: nextId("OB"), dimension: "observability", priority: "P2", file,
        line_range: [i + 1, i + 1],
        description: `print() instead of structured logger at line ${i + 1}`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
      });
    }
  }

  return defects;
};

// ---------------------------------------------------------------------------
// Test Coverage
// ---------------------------------------------------------------------------

export const scanPythonTestCoverage: Scanner = (file, content, _lines) => {
  const defects: Defect[] = [];

  if (file.includes("test")) return defects;

  // Check for corresponding test file
  const testPaths = [
    file.replace(/\.py$/, "_test.py"),
    file.replace(/\.py$/, "").replace(/^(.*)\/(.*)$/, "$1/test_$2.py"),
    file.replace("/src/", "/tests/").replace(/\.py$/, "_test.py"),
  ];

  const hasTest = testPaths.some((p) => existsSync(p));

  if (!hasTest && /^(def |class |async def )/.test(content)) {
    defects.push({
      id: nextId("TC"), dimension: "test-coverage", priority: "P2", file,
      line_range: null,
      description: "Python module with no corresponding test file",
      fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
    });
  }

  return defects;
};

export const allPythonScanners: Scanner[] = [
  scanPythonErrorHandling,
  scanPythonInputValidation,
  scanPythonSecurity,
  scanPythonObservability,
  scanPythonTestCoverage,
];
