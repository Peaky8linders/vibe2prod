/**
 * scripts/scan-defects.ts — Initial + periodic defect scanning
 *
 * Scans the target/ directory for production readiness defects.
 * Produces a structured defect taxonomy in evals/defect-taxonomy.json.
 *
 * Two modes:
 *   1. Static analysis (pattern-based, fast, no LLM)
 *   2. LLM-assisted (deeper analysis, requires ANTHROPIC_API_KEY)
 *
 * Usage:
 *   npx tsx scripts/scan-defects.ts                    # static only
 *   npx tsx scripts/scan-defects.ts --llm              # static + LLM
 *   npx tsx scripts/scan-defects.ts --output report    # also print report
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { glob } from "glob";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  source: "scan" | "chaos" | "production" | "judge-failure" | "subtract";
  discovered_at: string;
  approved_by_judge?: string;
}

interface DefectTaxonomy {
  dimensions: Record<string, { defects: Defect[] }>;
  scan_timestamp: string;
  total_defects: number;
  files_scanned: number;
}

// ---------------------------------------------------------------------------
// Pattern-based scanners per dimension
// ---------------------------------------------------------------------------

type Scanner = (file: string, content: string, lines: string[]) => Defect[];

let defectCounter = 0;
function nextId(prefix: string): string {
  defectCounter++;
  return `${prefix}-${String(defectCounter).padStart(3, "0")}`;
}

const SCAN_TIMESTAMP = new Date().toISOString();

/** Default fields for scan-discovered defects */
function scanDefaults(): Pick<Defect, "source" | "discovered_at"> {
  return { source: "scan", discovered_at: SCAN_TIMESTAMP };
}

const scanErrorHandling: Scanner = (file, _content, lines) => {
  const defects: Defect[] = [];

  // Unhandled async: fetch/axios without try-catch
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/\bfetch\s*\(|\baxios\.\w+\(|\bhttp\.\w+\(/.test(line)) {
      // Check if inside try block (look back 10 lines)
      const context = lines.slice(Math.max(0, i - 10), i).join("\n");
      if (!/\btry\s*\{/.test(context)) {
        defects.push({
          id: nextId("EH"),
          dimension: "error-handling",
          priority: "P1",
          file,
          line_range: [i + 1, i + 1],
          description: `External call without try/catch at line ${i + 1}`,
          fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
          ...scanDefaults(),
        });
      }
    }

    // Empty catch blocks
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      defects.push({
        id: nextId("EH"),
        dimension: "error-handling",
        priority: "P1",
        file,
        line_range: [i + 1, i + 1],
        description: `Empty catch block — error swallowed at line ${i + 1}`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
          ...scanDefaults(),
      });
    }

    // No timeout on fetch
    if (/\bfetch\s*\(/.test(line) && !/timeout|signal|AbortController/.test(lines.slice(i, i + 5).join("\n"))) {
      defects.push({
        id: nextId("EH"),
        dimension: "error-handling",
        priority: "P2",
        file,
        line_range: [i + 1, i + 1],
        description: `fetch() without timeout/AbortController at line ${i + 1}`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
          ...scanDefaults(),
      });
    }
  }

  return defects;
};

const scanInputValidation: Scanner = (file, content, lines) => {
  const defects: Defect[] = [];

  // API handlers without input validation
  const handlerPattern = /(?:app|router)\.(get|post|put|patch|delete)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = handlerPattern.exec(content)) !== null) {
    const lineNum = content.slice(0, match.index).split("\n").length;
    const handlerBlock = lines.slice(lineNum - 1, lineNum + 20).join("\n");

    if (!/z\.\w+|validate|schema|parse|safeParse|Joi\.|yup\./.test(handlerBlock)) {
      defects.push({
        id: nextId("IV"),
        dimension: "input-validation",
        priority: "P1",
        file,
        line_range: [lineNum, lineNum],
        description: `API handler (${match[1]!.toUpperCase()}) without input validation at line ${lineNum}`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
          ...scanDefaults(),
      });
    }
  }

  // any types
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/:\s*any\b|as\s+any\b/.test(line) && !/\/\//.test(line.split(/:\s*any|as\s+any/)[0]!)) {
      defects.push({
        id: nextId("IV"),
        dimension: "input-validation",
        priority: "P2",
        file,
        line_range: [i + 1, i + 1],
        description: `\`any\` type at line ${i + 1} — bypasses type safety`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
          ...scanDefaults(),
      });
    }
  }

  return defects;
};

const scanSecurity: Scanner = (file, content, lines) => {
  const defects: Defect[] = [];

  // Hardcoded secrets
  const secretPatterns = [
    { name: "API key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/i },
    { name: "password", pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i },
    { name: "AWS key", pattern: /AKIA[A-Z0-9]{16}/ },
    { name: "private key", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
    { name: "GitHub token", pattern: /ghp_[A-Za-z0-9]{36}/ },
    { name: "Anthropic key", pattern: /sk-ant-[A-Za-z0-9-]{32,}/ },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { name, pattern } of secretPatterns) {
      if (pattern.test(lines[i]!)) {
        defects.push({
          id: nextId("SEC"),
          dimension: "security",
          priority: "P0",
          file,
          line_range: [i + 1, i + 1],
          description: `Hardcoded ${name} at line ${i + 1}`,
          fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
          ...scanDefaults(),
        });
      }
    }
  }

  // SQL injection
  if (/\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(content) ||
      /['"].*\+.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(content)) {
    defects.push({
      id: nextId("SEC"),
      dimension: "security",
      priority: "P0",
      file,
      line_range: null,
      description: "Potential SQL injection — string concatenation in query",
      fixed: false, fix_commit: null, attempts: 0, needs_human_review: true,
      ...scanDefaults(),
    });
  }

  // Missing CORS configuration
  if (/cors\(\s*\)/.test(content)) {
    defects.push({
      id: nextId("SEC"),
      dimension: "security",
      priority: "P1",
      file,
      line_range: null,
      description: "CORS configured with no restrictions (allows all origins)",
      fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
      ...scanDefaults(),
    });
  }

  return defects;
};

const scanObservability: Scanner = (file, content, lines) => {
  const defects: Defect[] = [];

  // console.log in production code
  for (let i = 0; i < lines.length; i++) {
    if (/\bconsole\.(log|debug|info|warn|error)\b/.test(lines[i]!) && !/\.test\.|\.spec\./.test(file)) {
      defects.push({
        id: nextId("OB"),
        dimension: "observability",
        priority: "P2",
        file,
        line_range: [i + 1, i + 1],
        description: `console.log instead of structured logger at line ${i + 1}`,
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
          ...scanDefaults(),
      });
    }
  }

  // API handler without request logging
  if (/(?:app|router)\.(get|post|put|patch|delete)/.test(content)) {
    if (!/logger|log\.\w+|winston|pino|bunyan/.test(content)) {
      defects.push({
        id: nextId("OB"),
        dimension: "observability",
        priority: "P1",
        file,
        line_range: null,
        description: "API handler file with no structured logging",
        fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
          ...scanDefaults(),
      });
    }
  }

  return defects;
};

const scanTestCoverage: Scanner = (file, content, _lines) => {
  const defects: Defect[] = [];

  // Check if this source file has a corresponding test file
  if (/\.test\.|\.spec\./.test(file)) return defects;

  const testPatterns = [
    file.replace(/\.ts$/, ".test.ts"),
    file.replace(/\.ts$/, ".spec.ts"),
    file.replace("/src/", "/tests/").replace(/\.ts$/, ".test.ts"),
    file.replace("/src/", "/__tests__/").replace(/\.ts$/, ".test.ts"),
  ];

  const hasTest = testPatterns.some((p) => existsSync(p));

  if (!hasTest && /export\s+(function|class|const)/.test(content)) {
    defects.push({
      id: nextId("TC"),
      dimension: "test-coverage",
      priority: "P2",
      file,
      line_range: null,
      description: "Exported module with no corresponding test file",
      fixed: false, fix_commit: null, attempts: 0, needs_human_review: false,
      ...scanDefaults(),
    });
  }

  return defects;
};

// ---------------------------------------------------------------------------
// LLM-assisted deep scan
// ---------------------------------------------------------------------------

async function llmScanFile(file: string, content: string): Promise<Defect[]> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return [];

  const prompt = `You are a production readiness auditor. Analyze this file for production defects.

File: ${file}
\`\`\`
${content.slice(0, 6000)}
\`\`\`

Return ONLY a JSON array of defects. Each defect:
{"dimension":"error-handling|input-validation|security|observability|data-integrity|test-coverage","priority":"P0|P1|P2","line":number|null,"description":"specific defect description"}

Focus on: missing error handling, unvalidated inputs, hardcoded secrets, SQL injection, missing auth, no logging, race conditions, missing transactions. Return [] if no defects found.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = (await response.json()) as { content: Array<{ type: string; text?: string }> };
    const text = data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Array<{
      dimension: string; priority: string; line: number | null; description: string;
    }>;

    return parsed.map((d) => ({
      id: nextId(d.dimension === "security" ? "SEC" : d.dimension === "error-handling" ? "EH" : d.dimension === "input-validation" ? "IV" : d.dimension === "observability" ? "OB" : "LLM"),
      dimension: d.dimension,
      priority: (d.priority as "P0" | "P1" | "P2" | "P3") ?? "P2",
      file,
      line_range: d.line ? [d.line, d.line] as [number, number] : null,
      description: `[LLM] ${d.description}`,
      fixed: false,
      fix_commit: null,
      attempts: 0,
      needs_human_review: true, // LLM findings always need human triage
      source: "scan" as const,
      discovered_at: SCAN_TIMESTAMP,
    }));
  } catch (err) {
    console.warn(`  LLM scan failed for ${file}:`, err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const useLlm = process.argv.includes("--llm");

  // Scan both TS/JS and Python files
  const tsFiles = await glob("target/**/*.{ts,tsx,js,jsx}", {
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/venv/**", "**/__pycache__/**"],
  });
  const pyFiles = await glob("target/**/*.py", {
    ignore: ["**/node_modules/**", "**/venv/**", "**/.git/**", "**/__pycache__/**"],
  });

  const allFiles = [...tsFiles, ...pyFiles];

  if (allFiles.length === 0) {
    console.log("No source files found in target/. Is your project copied into target/?");
    console.log("  For the demo:  v2p init target/demo-app");
    console.log("  For your app:  v2p init ../your-project");
    process.exit(1);
  }

  console.log(`Scanning ${allFiles.length} files (${tsFiles.length} TS/JS, ${pyFiles.length} Python)${useLlm ? " + LLM deep scan" : ""}...`);

  const allDefects: Defect[] = [];

  // TS/JS scanners
  const tsScanners: Scanner[] = [
    scanErrorHandling,
    scanInputValidation,
    scanSecurity,
    scanObservability,
    scanTestCoverage,
  ];

  for (const file of tsFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");
    for (const scanner of tsScanners) {
      allDefects.push(...scanner(file, content, lines));
    }
  }

  // Python scanners (dynamic import)
  if (pyFiles.length > 0) {
    try {
      const { allPythonScanners, resetCounter } = await import("../evals/scanners/python.js");
      resetCounter(defectCounter);
      for (const file of pyFiles) {
        const content = readFileSync(file, "utf-8");
        const lines = content.split("\n");
        for (const scanner of allPythonScanners) {
          const pyDefects = scanner(file, content, lines) as unknown as Array<Record<string, unknown>>;
          allDefects.push(...pyDefects.map((d) => ({
            ...(d as Omit<Defect, "source" | "discovered_at">),
            source: "scan" as const,
            discovered_at: SCAN_TIMESTAMP,
          })));
        }
      }
    } catch {
      console.warn("  Python scanners not available — scanning TS/JS only");
    }
  }

  // LLM deep scan
  if (useLlm) {
    console.log("\nRunning LLM deep scan...");
    // Only scan high-value files (API routes, services, config)
    const highValuePatterns = /\/(api|routes|services|controllers|middleware|config|models)\//;
    const highValueFiles = allFiles.filter((f) => highValuePatterns.test(f));
    console.log(`  ${highValueFiles.length} high-value files selected for LLM scan`);

    for (const file of highValueFiles) {
      const content = readFileSync(file, "utf-8");
      const llmDefects = await llmScanFile(file, content);
      if (llmDefects.length > 0) {
        console.log(`  ${file}: ${llmDefects.length} LLM findings`);
      }
      allDefects.push(...llmDefects);
    }
  }

  // Deduplicate: same file + same line + same dimension = likely duplicate
  const seen = new Set<string>();
  const dedupedDefects = allDefects.filter((d) => {
    const key = `${d.file}:${d.line_range?.[0] ?? "null"}:${d.dimension}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Group by dimension
  const dimensions: Record<string, { defects: Defect[] }> = {
    security: { defects: [] },
    "data-integrity": { defects: [] },
    "error-handling": { defects: [] },
    "input-validation": { defects: [] },
    observability: { defects: [] },
    "test-coverage": { defects: [] },
    subtraction: { defects: [] },
  };

  for (const defect of dedupedDefects) {
    const dim = dimensions[defect.dimension];
    if (dim) {
      dim.defects.push(defect);
    }
  }

  // Sort by priority within each dimension
  const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  for (const dim of Object.values(dimensions)) {
    dim.defects.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9));
  }

  const taxonomy: DefectTaxonomy = {
    dimensions,
    scan_timestamp: new Date().toISOString(),
    total_defects: dedupedDefects.length,
    files_scanned: allFiles.length,
  };

  writeFileSync("evals/defect-taxonomy.json", JSON.stringify(taxonomy, null, 2));

  // Report
  console.log(`\nScan complete: ${dedupedDefects.length} defects across ${allFiles.length} files\n`);

  for (const [name, dim] of Object.entries(dimensions)) {
    if (dim.defects.length > 0) {
      const p0 = dim.defects.filter((d) => d.priority === "P0").length;
      const p1 = dim.defects.filter((d) => d.priority === "P1").length;
      const p2 = dim.defects.filter((d) => d.priority === "P2").length;
      console.log(`  ${name}: ${dim.defects.length} defects (P0:${p0} P1:${p1} P2:${p2})`);
    }
  }

  const needsReview = dedupedDefects.filter((d) => d.needs_human_review).length;
  if (needsReview > 0) {
    console.log(`\n  ⚠  ${needsReview} defects flagged for human review`);
  }

  console.log(`\nTaxonomy written to evals/defect-taxonomy.json`);
  console.log("Next: review and adjust priorities, then run: v2p run security --hours 4");
}

main().catch(console.error);
