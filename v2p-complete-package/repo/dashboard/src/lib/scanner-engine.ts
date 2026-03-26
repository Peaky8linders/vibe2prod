/**
 * lib/scanner-engine.ts — Server-side scanning engine for Next.js API routes
 *
 * Reimplements the core scanning logic from scan-e2e.ts to run inside
 * Next.js API routes without requiring the full CLI toolchain.
 * Uses the same ScannerPlugin interface and scoring logic.
 */

import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { extract } from "tar-stream";

// Specialized scanner plugins (ported from repo scanners/)
import type { ScannerPlugin } from "./scanners/plugin-interface";
import { performanceScanner } from "./scanners/performance-scanner";
import { observabilityScanner } from "./scanners/observability-scanner";
import { apiContractScanner } from "./scanners/api-contract-scanner";
import { complianceScanner } from "./scanners/compliance-scanner";
import { governanceScanner } from "./scanners/governance-scanner";
import { securityScanner } from "./scanners/security-scanner";
import { codeQualityScanner } from "./scanners/code-quality-scanner";

const SCANNER_PLUGINS: ScannerPlugin[] = [
  performanceScanner,
  observabilityScanner,
  apiContractScanner,
  complianceScanner,
  governanceScanner,
  securityScanner,
  codeQualityScanner,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileDefect {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  line: number | null;
  description: string;
  fix_hint: string;
  code_snippet?: string;
}

export interface FileResult {
  path: string;
  defects: number;
  readiness: number;
  maturity: "critical" | "needs-work" | "mostly-clean" | "hardened";
  risk: "high" | "medium" | "low";
}

export interface ScanResult {
  project: string;
  scanned_at: string;
  files_scanned: number;
  total_defects: number;
  overall_readiness: number;
  by_priority: { P0: number; P1: number; P2: number; P3: number };
  by_dimension: Record<string, number>;
  files: FileResult[];
  antifragile: {
    robustness: number;
    chaos_resilience: number;
    production_adaptation: number;
    total: number;
    attacks_adapted: number;
  };
  store_checks: {
    apple: { passed: number; total: number; blocked: string[] };
    google: { passed: number; total: number; blocked: string[] };
  };
}

// ---------------------------------------------------------------------------
// Defect ID Generator
// ---------------------------------------------------------------------------

function createIdGenerator() {
  let counter = 0;
  return (prefix: string) => {
    counter++;
    return `${prefix}-${String(counter).padStart(3, "0")}`;
  };
}

// Module-level reference replaced inside scanFiles per-call
let nextId = createIdGenerator();

// ---------------------------------------------------------------------------
// Per-File Scanner (inline patterns from scan-e2e.ts)
// ---------------------------------------------------------------------------

function scanTsJsFile(filePath: string, content: string, lines: string[]): FileDefect[] {
  const defects: FileDefect[] = [];
  const isTestFile = /\.test\.|\.spec\.|__tests__|dev[-_]server|\.dev\.|mock/.test(filePath);
  const isSecurityTooling = /scanner|dast|chaos|probes?[/\\]|evals[/\\]|sentinel[/\\]/.test(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // --- SECURITY (P0) ---
    if (!isTestFile) {
      const secretPatterns = [
        { name: "API key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/i },
        { name: "password", pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i },
        { name: "AWS key", pattern: /AKIA[A-Z0-9]{16}/ },
        { name: "private key", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
        { name: "GitHub token", pattern: /ghp_[A-Za-z0-9]{36}/ },
        { name: "JWT secret", pattern: /(?:jwt[_-]?secret|JWT_SECRET)\s*[:=]\s*['"][^'"]+['"]/i },
      ];
      for (const { name, pattern } of secretPatterns) {
        if (pattern.test(line)) {
          defects.push({ id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum, description: `Hardcoded ${name}`, fix_hint: `Move to environment variable.`, code_snippet: line.trim().slice(0, 80) });
        }
      }
    }

    // SQL injection
    if (!isTestFile && !isSecurityTooling) {
      const looksLikeSql = /(?:query|execute|sql|db\.|pool\.|client\.)/.test(line);
      if (looksLikeSql && (/\$\{[^}]+\}.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(line) || /['"].*\+.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(line))) {
        defects.push({ id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum, description: "SQL injection — string interpolation in query", fix_hint: "Use parameterized queries." });
      }
    }

    // --- SECURITY (P1) ---
    if (/cors\(\s*\)/.test(line) || /origin\s*:\s*(?:true|'\*'|"\*")/.test(line)) {
      defects.push({ id: nextId("SEC"), dimension: "security", priority: "P1", line: lineNum, description: "CORS allows all origins", fix_hint: "Restrict: cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') })" });
    }

    if (/(?:app|router)\.(get|post|put|patch|delete)\s*\(/.test(line) && !isTestFile) {
      const handlerBlock = lines.slice(i, Math.min(i + 8, lines.length)).join(" ");
      const routePath = line.match(/['"]([^'"]+)['"]/)?.[1] ?? "";
      const isPublicRoute = /health|status|public|register|login|signup|docs|swagger/.test(routePath);
      const hasAuth = /requireAuth|authenticate|isAuthenticated|passport\.|auth\w*Middleware|verifyToken|checkAuth/.test(handlerBlock);
      if (!hasAuth && !isPublicRoute) {
        defects.push({ id: nextId("SEC"), dimension: "security", priority: "P1", line: lineNum, description: `Endpoint ${routePath || "(unknown)"} may lack authentication`, fix_hint: "Add requireAuth middleware." });
      }
    }

    // --- ERROR HANDLING ---
    if (/\bfetch\s*\(|\baxios\.\w+\(|\bhttp\.\w+\(/.test(line) && !isTestFile) {
      const isComment = /^\s*\/\//.test(line);
      if (!isComment) {
        const context = lines.slice(Math.max(0, i - 10), i).join("\n");
        if (!/\btry\s*\{/.test(context)) {
          defects.push({ id: nextId("EH"), dimension: "error-handling", priority: "P1", line: lineNum, description: "External call without try/catch", fix_hint: "Wrap in try/catch with error logging." });
        }
      }
    }

    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      defects.push({ id: nextId("EH"), dimension: "error-handling", priority: "P1", line: lineNum, description: "Empty catch block — error swallowed silently", fix_hint: "Log the error in the catch block." });
    }

    // --- INPUT VALIDATION ---
    if (/(?:app|router)\.(post|put|patch)\s*\(/.test(line) && !isTestFile) {
      const handlerBlock = lines.slice(i, Math.min(i + 20, lines.length)).join("\n");
      const usesBody = /req\.body|request\.body/.test(handlerBlock);
      const hasValidation = /z\.\w+|validate|schema|parse|safeParse|Joi\.|yup\./.test(handlerBlock);
      if (usesBody && !hasValidation) {
        defects.push({ id: nextId("IV"), dimension: "input-validation", priority: "P1", line: lineNum, description: "Mutation endpoint reads req.body without schema validation", fix_hint: "Add Zod schema validation." });
      }
    }

    if (/:\s*any\b|as\s+any\b/.test(line) && !/\/\//.test(line.split(/:\s*any|as\s+any/)[0]!) && !isTestFile) {
      defects.push({ id: nextId("IV"), dimension: "input-validation", priority: "P2", line: lineNum, description: "`any` type bypasses type safety", fix_hint: "Replace with specific type or `unknown`." });
    }

    // --- OBSERVABILITY ---
    const isCli = /cli\.|scripts[/\\]/.test(filePath);
    if (/\bconsole\.(log|debug|info)\b/.test(line) && !isTestFile && !isCli && !isSecurityTooling) {
      defects.push({ id: nextId("OB"), dimension: "observability", priority: "P2", line: lineNum, description: "console.log in production code", fix_hint: "Replace with structured logger (pino, winston)." });
    }

    // --- PERFORMANCE --- (two-pass to avoid ReDoS)
    if (!isTestFile && /(?:for\s*\(|\.(?:forEach|map|flatMap|reduce)\s*\()/.test(line)) {
      const loopBody = lines.slice(i, Math.min(i + 10, lines.length)).join("\n");
      if (/\.(?:query|execute|find|findOne|select|from)\s*\(/.test(loopBody)) {
        defects.push({ id: nextId("PERF"), dimension: "performance", priority: "P0", line: lineNum, description: "N+1 query — database call inside a loop", fix_hint: "Batch queries: collect IDs, use WHERE id IN (...)." });
      }
    }
  }

  // File-level checks
  if (/(?:app|router)\.(get|post|put|patch|delete)/.test(content) && !/logger|log\.\w+|winston|pino|bunyan/.test(content) && !isTestFile) {
    defects.push({ id: nextId("OB"), dimension: "observability", priority: "P1", line: null, description: "API handler file with no structured logging", fix_hint: "Add structured logger." });
  }

  if (/res\.\w+\(.*(?:err\.stack|error\.stack)/.test(content) && !isTestFile) {
    defects.push({ id: nextId("SEC"), dimension: "security", priority: "P1", line: null, description: "Stack trace exposed in API response", fix_hint: "Return generic error message." });
  }

  if (/(?:app|router)\.(post|put|patch|delete)/.test(content) && !/rateLimit|rate[_-]?limit|limiter|throttle/.test(content) && !isTestFile) {
    defects.push({ id: nextId("SEC"), dimension: "security", priority: "P1", line: null, description: "No rate limiting on mutation endpoints", fix_hint: "Add express-rate-limit middleware." });
  }

  return defects;
}

function scanPythonFile(filePath: string, _content: string, lines: string[]): FileDefect[] {
  const defects: FileDefect[] = [];
  const isTest = /test_|_test\.py|tests[/\\]|conftest\.py/.test(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    if (/^\s*except\s*:/.test(line)) {
      defects.push({ id: nextId("EH"), dimension: "error-handling", priority: "P1", line: lineNum, description: "Bare except clause catches all exceptions", fix_hint: "Use specific exception type." });
    }

    if (!isTest && /\b(?:eval|exec)\s*\(/.test(line) && !/^\s*#/.test(line)) {
      defects.push({ id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum, description: "eval()/exec() — arbitrary code execution risk", fix_hint: "Use ast.literal_eval() or safe alternative." });
    }

    if (!isTest && /pickle\.loads?\s*\(/.test(line)) {
      defects.push({ id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum, description: "pickle.load() — deserialization risk", fix_hint: "Use json.loads() instead." });
    }

    if (!isTest && /(?:SECRET|PASSWORD|API_KEY|TOKEN)\s*=\s*['"][^'"]+['"]/i.test(line) && !/os\.environ|getenv|settings\./.test(line)) {
      defects.push({ id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum, description: "Hardcoded secret in Python source", fix_hint: "Use environment variable." });
    }
  }

  return defects;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

function computeFileReadiness(defects: FileDefect[]): { score: number; maturity: FileResult["maturity"]; risk: FileResult["risk"] } {
  if (defects.length === 0) return { score: 1.0, maturity: "hardened", risk: "low" };

  const weights: Record<string, number> = { P0: 4, P1: 2, P2: 1, P3: 0.5 };
  const totalWeight = defects.reduce((sum, d) => sum + (weights[d.priority] ?? 1), 0);
  const maxPossible = defects.length * 4;
  const score = Math.max(0, 1 - (totalWeight / Math.max(maxPossible, 1)));

  const hasP0 = defects.some((d) => d.priority === "P0");
  const hasP1 = defects.some((d) => d.priority === "P1");

  const maturity: FileResult["maturity"] = hasP0 ? "critical" : (hasP1 || defects.length > 5) ? "needs-work" : "mostly-clean";
  const risk: FileResult["risk"] = hasP0 ? "high" : hasP1 ? "medium" : "low";

  return { score: Math.round(score * 1000) / 1000, maturity, risk };
}

// ---------------------------------------------------------------------------
// Main Scan Function
// ---------------------------------------------------------------------------

const LANG_MAP: Record<string, "typescript" | "javascript" | "python" | "other"> = {
  ".ts": "typescript", ".tsx": "typescript",
  ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".py": "python",
};

const SKIP_DIRS = /(?:^|\/)(?:node_modules|\.git|\.next|dist|build|__pycache__|\.venv|venv|\.tox|coverage)(?:\/|$)/;
const SKIP_FILES = /\.test\.|\.spec\.|__tests__|\.min\.|\.map$|\.d\.ts$|package-lock|yarn\.lock/;
const SOURCE_EXTS = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;

export function scanFiles(files: Map<string, string>, projectName: string): ScanResult {
  nextId = createIdGenerator();

  const allDefects: Array<FileDefect & { file: string }> = [];
  const fileResults: FileResult[] = [];
  const byDimension: Record<string, number> = {};
  const byPriority = { P0: 0, P1: 0, P2: 0, P3: 0 };
  let scannedCount = 0;

  for (const [relPath, content] of files) {
    // Determine language
    const ext = relPath.match(/\.[^.]+$/)?.[0] ?? "";
    const lang = LANG_MAP[ext] ?? "other";
    if (lang === "other") continue;
    scannedCount++;

    const lines = content.split("\n");

    // Run built-in scanners
    const defects: FileDefect[] = [];
    if (lang === "python") {
      defects.push(...scanPythonFile(relPath, content, lines));
    } else {
      defects.push(...scanTsJsFile(relPath, content, lines));
    }

    // Run all specialized scanner plugins
    for (const plugin of SCANNER_PLUGINS) {
      try {
        const pluginDefects = plugin.scan(relPath, content, lang);
        defects.push(...pluginDefects);
      } catch (err) {
        console.warn(`[VibeCheck] Scanner plugin "${plugin.name}" failed on ${relPath}:`, err instanceof Error ? err.message : err);
      }
    }

    // Score
    const { score, maturity, risk } = computeFileReadiness(defects);

    fileResults.push({ path: relPath, defects: defects.length, readiness: score, maturity, risk });

    for (const d of defects) {
      allDefects.push({ ...d, file: relPath });
      byDimension[d.dimension] = (byDimension[d.dimension] ?? 0) + 1;
      byPriority[d.priority]++;
    }
  }

  // Sort files by readiness (worst first)
  fileResults.sort((a, b) => a.readiness - b.readiness);

  // Overall readiness
  const totalDefects = allDefects.length;
  const totalWeight = allDefects.reduce((sum, d) => sum + ({ P0: 4, P1: 2, P2: 1, P3: 0.5 }[d.priority] ?? 1), 0);
  const maxWeight = totalDefects * 4;
  let overallReadiness = totalDefects === 0 ? 1.0 : Math.max(0, 1 - (totalWeight / Math.max(maxWeight, 1)));
  if (byPriority.P0 > 0) overallReadiness = Math.min(overallReadiness, 0.5); // P0 cap

  // Compute antifragile score based on scan results
  const robustness = Math.round(overallReadiness * 40);
  const antifragile = {
    robustness,
    chaos_resilience: 0,
    production_adaptation: 0,
    total: robustness,
    attacks_adapted: 0,
  };

  return {
    project: projectName,
    scanned_at: new Date().toISOString(),
    files_scanned: scannedCount,
    total_defects: totalDefects,
    overall_readiness: Math.round(overallReadiness * 100) / 100,
    by_priority: byPriority,
    by_dimension: byDimension,
    files: fileResults.slice(0, 50), // Top 50 files
    antifragile,
    store_checks: {
      apple: { passed: 0, total: 0, blocked: [] },
      google: { passed: 0, total: 0, blocked: [] },
    },
  };
}

// ---------------------------------------------------------------------------
// GitHub Repo Fetcher
// ---------------------------------------------------------------------------

export function parseGitHubUrl(url: string): { owner: string; repo: string; ref: string } | null {
  const match = url.match(/github\.com\/([A-Za-z0-9._-]{1,100})\/([A-Za-z0-9._-]{1,100})(?:\/tree\/([A-Za-z0-9._\/-]{1,200}))?/);
  if (!match) return null;
  const ref = match[3] ?? "HEAD";
  // Reject path traversal attempts
  if (ref.includes("..")) return null;
  return { owner: match[1]!, repo: match[2]!.replace(/\.git$/, ""), ref };
}

export async function fetchAndScanRepo(url: string): Promise<ScanResult> {
  const parsed = parseGitHubUrl(url);
  if (!parsed) throw new Error("Invalid GitHub URL. Expected: https://github.com/owner/repo");

  const { owner, repo, ref } = parsed;

  // Download tarball via GitHub API
  const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball/${ref}`;
  const response = await fetch(tarballUrl, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "VibeCheck-Scanner/1.0" },
    redirect: "follow",
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error(`Repository not found: ${owner}/${repo}. Make sure it's public.`);
    if (response.status === 403) throw new Error("GitHub rate limit exceeded. Try again in a few minutes.");
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  // Read the tarball into memory (with 50MB limit)
  const MAX_SIZE = 50 * 1024 * 1024;
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_SIZE) {
    throw new Error(`Repository too large (${Math.round(arrayBuffer.byteLength / 1024 / 1024)}MB). Max: 50MB.`);
  }

  // Decompress gzip + extract tar
  const MAX_FILES = 500;
  const files = new Map<string, string>();

  await new Promise<void>((resolve, reject) => {
    const extractor = extract();

    extractor.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = [];

      // Strip the top-level directory (GitHub adds owner-repo-sha/)
      const parts = header.name.split("/");
      const relPath = parts.slice(1).join("/");

      // Skip non-source files, path traversal, and enforce limits
      const shouldSkip = !relPath ||
        relPath.includes("..") || // Path traversal protection
        files.size >= MAX_FILES || // File count cap
        header.type !== "file" ||
        SKIP_DIRS.test(relPath) ||
        SKIP_FILES.test(relPath) ||
        !SOURCE_EXTS.test(relPath) ||
        (header.size ?? 0) > 1024 * 1024; // Skip files > 1MB

      if (shouldSkip) {
        stream.on("end", next);
        stream.resume();
        return;
      }

      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        const content = Buffer.concat(chunks).toString("utf-8");
        files.set(relPath, content);
        next();
      });
      stream.on("error", next);
    });

    extractor.on("finish", resolve);
    extractor.on("error", reject);

    const gunzip = createGunzip();
    gunzip.on("error", reject);

    const readable = Readable.from(Buffer.from(arrayBuffer));
    readable.pipe(gunzip).pipe(extractor);
  });

  if (files.size === 0) {
    throw new Error("No scannable source files found in repository.");
  }

  return scanFiles(files, repo);
}
