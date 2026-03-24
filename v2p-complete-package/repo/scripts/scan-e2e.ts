/**
 * scripts/scan-e2e.ts — End-to-end file-by-file scanner with actionable output
 *
 * Scans every file in the target project individually, tracks per-file state,
 * generates a comprehensive report with:
 *   1. Per-file findings with severity and line references
 *   2. Actionable fix prompts (copy-paste into Claude Code / Codex)
 *   3. Per-file readiness scores and maturity levels
 *   4. Prioritized remediation plan
 *
 * Designed to take a vibe-coded project from prototype to production-ready.
 *
 * Usage:
 *   npx tsx scripts/scan-e2e.ts                        # scan target/
 *   npx tsx scripts/scan-e2e.ts --path ../my-app       # scan external project
 *   npx tsx scripts/scan-e2e.ts --report               # scan + generate report
 *   npx tsx scripts/scan-e2e.ts --prompts              # generate fix prompts only
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { glob } from "glob";
import { resolve, relative, extname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileDefect {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  line: number | null;
  description: string;
  fix_hint: string;
  code_snippet?: string;
}

interface FileReport {
  path: string;
  relative_path: string;
  language: "typescript" | "javascript" | "python" | "other";
  size_bytes: number;
  line_count: number;
  content_hash: string;
  scanned_at: string;
  defects: FileDefect[];
  maturity: "unscanned" | "critical" | "needs-work" | "mostly-clean" | "hardened";
  readiness_score: number;
  risk_level: "high" | "medium" | "low";
  fix_prompt: string;
}

interface ScanResult {
  project_path: string;
  scan_timestamp: string;
  files_scanned: number;
  total_defects: number;
  files: FileReport[];
  summary: {
    by_maturity: Record<string, number>;
    by_priority: Record<string, number>;
    by_dimension: Record<string, number>;
    by_language: Record<string, number>;
    overall_readiness: number;
    critical_files: string[];
    clean_files: string[];
  };
  remediation_plan: RemediationStep[];
  actionable_skills: ActionableSkill[];
}

interface RemediationStep {
  order: number;
  priority: "P0" | "P1" | "P2" | "P3";
  file: string;
  defect_count: number;
  description: string;
  estimated_effort: string;
  prompt: string;
}

interface ActionableSkill {
  name: string;
  description: string;
  dimension: string;
  files_affected: string[];
  prompt: string;
}

// ---------------------------------------------------------------------------
// ID Generation
// ---------------------------------------------------------------------------

let defectCounter = 0;
function nextId(prefix: string): string {
  defectCounter++;
  return `${prefix}-${String(defectCounter).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// File-Level Scanners
// ---------------------------------------------------------------------------

function scanFileForDefects(filePath: string, content: string, lines: string[], lang: "typescript" | "javascript" | "python" | "other"): FileDefect[] {
  const defects: FileDefect[] = [];

  if (lang === "python") {
    defects.push(...scanPythonFile(filePath, content, lines));
  } else if (lang === "typescript" || lang === "javascript") {
    defects.push(...scanTsJsFile(filePath, content, lines));
  }

  return defects;
}

function scanTsJsFile(_filePath: string, content: string, lines: string[]): FileDefect[] {
  const defects: FileDefect[] = [];
  const isTestFile = /\.test\.|\.spec\.|__tests__/.test(_filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // --- SECURITY (P0) ---

    // Hardcoded secrets (skip test files — test passwords are expected)
    if (!isTestFile) {
      const secretPatterns = [
        { name: "API key", pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/i },
        { name: "password", pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i },
        { name: "AWS key", pattern: /AKIA[A-Z0-9]{16}/ },
        { name: "private key", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
        { name: "GitHub token", pattern: /ghp_[A-Za-z0-9]{36}/ },
        { name: "JWT secret hardcoded", pattern: /(?:jwt[_-]?secret|JWT_SECRET)\s*[:=]\s*['"][^'"]+['"]/i },
      ];

      for (const { name, pattern } of secretPatterns) {
        if (pattern.test(line)) {
          defects.push({
            id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum,
            description: `Hardcoded ${name}`,
            fix_hint: `Move to environment variable. Use process.env.${name.toUpperCase().replace(/\s+/g, "_")} with validation.`,
            code_snippet: line.trim().slice(0, 80),
          });
        }
      }
    }

    // SQL injection — only flag if the line looks like it's constructing a SQL query
    // Precision guard: require db/query/sql context to avoid false positives on template literals
    if (!isTestFile) {
      const looksLikeSql = /(?:query|execute|sql|db\.|pool\.|client\.|cursor\.)/.test(line) ||
                           /(?:query|execute|sql|db\.|pool\.|client\.)/.test(lines.slice(Math.max(0, i - 2), i + 2).join(" "));
      if (looksLikeSql && (
        /\$\{[^}]+\}.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(line) ||
        /['"].*\+.*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(line)
      )) {
        defects.push({
          id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum,
          description: "SQL injection — string interpolation in query",
          fix_hint: "Use parameterized queries: db.query('SELECT * FROM t WHERE id = $1', [id])",
          code_snippet: line.trim().slice(0, 80),
        });
      }
    }

    // --- SECURITY (P1) ---

    // CORS wildcard
    if (/cors\(\s*\)/.test(line) || /origin\s*:\s*(?:true|'\*'|"\*")/.test(line)) {
      defects.push({
        id: nextId("SEC"), dimension: "security", priority: "P1", line: lineNum,
        description: "CORS allows all origins",
        fix_hint: "Restrict: cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') })",
      });
    }

    // Missing auth on route handler
    // Precision guard: only flag if this is clearly a data-access endpoint, not public routes
    if (/(?:app|router)\.(get|post|put|patch|delete)\s*\(/.test(line) && !isTestFile) {
      const handlerBlock = lines.slice(i, Math.min(i + 8, lines.length)).join(" ");
      const routePath = line.match(/['"]([^'"]+)['"]/)?.[1] ?? "";
      const isPublicRoute = /health|status|public|register|login|signup|docs|swagger|favicon|robots/.test(routePath);
      const hasAuth = /requireAuth|authenticate|isAuthenticated|passport\.|auth\w*Middleware|verifyToken|checkAuth/.test(handlerBlock);

      if (!hasAuth && !isPublicRoute) {
        defects.push({
          id: nextId("SEC"), dimension: "security", priority: "P1", line: lineNum,
          description: `Endpoint ${routePath || "(unknown)"} may lack authentication middleware`,
          fix_hint: "Add requireAuth middleware: router.get('/path', requireAuth, handler)",
        });
      }
    }

    // --- ERROR HANDLING ---

    // External call without try-catch
    // Precision guard: only flag actual call sites, not imports, comments, or type definitions
    if (/\bfetch\s*\(|\baxios\.\w+\(|\bhttp\.\w+\(/.test(line) && !isTestFile) {
      const isComment = /^\s*\/\//.test(line) || /^\s*\*/.test(line);
      const isImport = /^\s*import\b/.test(line);
      if (!isComment && !isImport) {
        const context = lines.slice(Math.max(0, i - 10), i).join("\n");
        if (!/\btry\s*\{/.test(context)) {
          defects.push({
            id: nextId("EH"), dimension: "error-handling", priority: "P1", line: lineNum,
            description: "External call without try/catch",
            fix_hint: "Wrap in try/catch with error logging and appropriate error response.",
          });
        }
      }
    }

    // Empty catch block
    if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(line)) {
      defects.push({
        id: nextId("EH"), dimension: "error-handling", priority: "P1", line: lineNum,
        description: "Empty catch block — error swallowed silently",
        fix_hint: "Log the error: catch (err) { logger.error('Context', { error: err.message }); throw err; }",
      });
    }

    // No timeout on fetch
    if (/\bfetch\s*\(/.test(line) && !/timeout|signal|AbortController/.test(lines.slice(i, i + 5).join("\n"))) {
      defects.push({
        id: nextId("EH"), dimension: "error-handling", priority: "P2", line: lineNum,
        description: "fetch() without timeout — may hang indefinitely",
        fix_hint: "Add AbortController: const ctrl = new AbortController(); setTimeout(() => ctrl.abort(), 5000); fetch(url, { signal: ctrl.signal })",
      });
    }

    // --- INPUT VALIDATION ---

    // API handler without validation
    // Precision guard: only flag POST/PUT/PATCH that use req.body, not middleware-only routes
    if (/(?:app|router)\.(post|put|patch)\s*\(/.test(line) && !isTestFile) {
      const handlerBlock = lines.slice(i, Math.min(i + 20, lines.length)).join("\n");
      const usesBody = /req\.body|request\.body/.test(handlerBlock);
      const hasValidation = /z\.\w+|validate|schema|parse|safeParse|Joi\.|yup\.|\.parse\(req\.body\)/.test(handlerBlock);

      if (usesBody && !hasValidation) {
        defects.push({
          id: nextId("IV"), dimension: "input-validation", priority: "P1", line: lineNum,
          description: "Mutation endpoint reads req.body without schema validation",
          fix_hint: "Add Zod schema: const schema = z.object({ ... }); const data = schema.parse(req.body);",
        });
      }
    }

    // any type
    if (/:\s*any\b|as\s+any\b/.test(line) && !/\/\//.test(line.split(/:\s*any|as\s+any/)[0]!) && !isTestFile) {
      defects.push({
        id: nextId("IV"), dimension: "input-validation", priority: "P2", line: lineNum,
        description: "`any` type bypasses type safety",
        fix_hint: "Replace with specific type or use `unknown` with type guards.",
      });
    }

    // --- OBSERVABILITY ---

    if (/\bconsole\.(log|debug|info)\b/.test(line) && !isTestFile) {
      defects.push({
        id: nextId("OB"), dimension: "observability", priority: "P2", line: lineNum,
        description: "console.log in production code",
        fix_hint: "Replace with structured logger: logger.info('message', { key: value })",
      });
    }

    // --- DATA INTEGRITY ---

    // Missing transaction for multi-step DB operations
    if (/await\s+(?:db|pool|client)\.query/.test(line)) {
      const blockAhead = lines.slice(i, Math.min(i + 10, lines.length)).join("\n");
      const queryCount = (blockAhead.match(/\.query/g) || []).length;
      if (queryCount >= 2 && !/BEGIN|transaction|COMMIT/.test(blockAhead)) {
        defects.push({
          id: nextId("DI"), dimension: "data-integrity", priority: "P1", line: lineNum,
          description: "Multiple DB queries without transaction — partial writes possible",
          fix_hint: "Wrap in transaction: const client = await pool.connect(); try { await client.query('BEGIN'); ... await client.query('COMMIT'); } catch { await client.query('ROLLBACK'); }",
        });
      }
    }
  }

  // File-level checks

  // Missing error handler in Express file
  if (/(?:app|router)\.(get|post|put|patch|delete)/.test(content) &&
      !/logger|log\.\w+|winston|pino|bunyan/.test(content) && !isTestFile) {
    defects.push({
      id: nextId("OB"), dimension: "observability", priority: "P1", line: null,
      description: "API handler file with no structured logging",
      fix_hint: "Add a structured logger (pino or winston) and log on entry/exit/error for each handler.",
    });
  }

  // Verbose error responses
  if (/res\.\w+\(.*(?:err\.stack|error\.stack|\.stack)/.test(content) && !isTestFile) {
    defects.push({
      id: nextId("SEC"), dimension: "security", priority: "P1", line: null,
      description: "Stack trace exposed in API response",
      fix_hint: "Return generic error: res.status(500).json({ error: 'Internal server error' }). Log details server-side.",
    });
  }

  return defects;
}

function scanPythonFile(_filePath: string, _content: string, lines: string[]): FileDefect[] {
  const defects: FileDefect[] = [];
  const isPyTestFile = /test_|_test\.py|tests[/\\]|conftest\.py/.test(_filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lineNum = i + 1;

    // Bare except (flag even in tests — bad practice everywhere)
    if (/^\s*except\s*:/.test(line)) {
      defects.push({
        id: nextId("EH"), dimension: "error-handling", priority: "P1", line: lineNum,
        description: "Bare except clause catches all exceptions including SystemExit",
        fix_hint: "Use specific exception: except (ValueError, KeyError) as e:",
      });
    }

    // f-string in SQL — skip in test files (test fixtures contain SQL examples)
    if (!isPyTestFile && /f['"].*(?:SELECT|INSERT|UPDATE|DELETE|WHERE)/i.test(line)) {
      // Extra precision: require db/cursor/execute context
      const context = lines.slice(Math.max(0, i - 3), i + 3).join(" ");
      if (/cursor|execute|query|db\.|session\.|connection/.test(context)) {
        defects.push({
          id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum,
          description: "SQL injection via f-string interpolation",
          fix_hint: "Use parameterized query: cursor.execute('SELECT * FROM t WHERE id = %s', (id,))",
        });
      }
    }

    // Hardcoded secrets — skip in test files (test fixtures contain dummy secrets)
    if (!isPyTestFile &&
        /(?:SECRET|PASSWORD|API_KEY|TOKEN)\s*=\s*['"][^'"]+['"]/i.test(line) &&
        !/os\.environ|getenv|settings\.|config\.|environ\.get/.test(line)) {
      defects.push({
        id: nextId("SEC"), dimension: "security", priority: "P0", line: lineNum,
        description: "Hardcoded secret in Python source",
        fix_hint: "Use: os.environ.get('SECRET_NAME') or settings from env file.",
      });
    }

    // No type hints on function — only flag in production code, not tests/conftest
    if (!isPyTestFile && /^\s*def\s+\w+\(/.test(line) && !/->/.test(line) && !/test_|__/.test(line)) {
      defects.push({
        id: nextId("IV"), dimension: "input-validation", priority: "P3", line: lineNum,
        description: "Function missing return type hint",
        fix_hint: "Add type hint: def func(param: str) -> dict:",
      });
    }

    // FastAPI route without Pydantic
    if (/@(?:app|router)\.(get|post|put|patch|delete)/.test(line)) {
      const handlerBlock = lines.slice(i, Math.min(i + 10, lines.length)).join("\n");
      if (!/BaseModel|Depends|Body\(|Query\(/.test(handlerBlock) && /post|put|patch/.test(line)) {
        defects.push({
          id: nextId("IV"), dimension: "input-validation", priority: "P1", line: lineNum,
          description: "FastAPI mutation endpoint without Pydantic model",
          fix_hint: "Add request model: class CreateItem(BaseModel): name: str",
        });
      }
    }
  }

  return defects;
}

// ---------------------------------------------------------------------------
// Per-File Scoring & Maturity
// ---------------------------------------------------------------------------

function computeFileReadiness(defects: FileDefect[]): { score: number; maturity: FileReport["maturity"]; risk: FileReport["risk_level"] } {
  if (defects.length === 0) return { score: 1.0, maturity: "hardened", risk: "low" };

  const weights: Record<string, number> = { P0: 4, P1: 2, P2: 1, P3: 0.5 };
  const totalWeight = defects.reduce((sum, d) => sum + (weights[d.priority] ?? 1), 0);
  const maxPossible = defects.length * 4; // If all were P0
  const score = Math.max(0, 1 - (totalWeight / Math.max(maxPossible, 1)));

  const hasP0 = defects.some((d) => d.priority === "P0");
  const hasP1 = defects.some((d) => d.priority === "P1");

  let maturity: FileReport["maturity"];
  if (hasP0) maturity = "critical";
  else if (hasP1 || defects.length > 5) maturity = "needs-work";
  else if (defects.length > 0) maturity = "mostly-clean";
  else maturity = "hardened";

  const risk: FileReport["risk_level"] = hasP0 ? "high" : hasP1 ? "medium" : "low";

  return { score: Math.round(score * 1000) / 1000, maturity, risk };
}

// ---------------------------------------------------------------------------
// Fix Prompt Generation
// ---------------------------------------------------------------------------

function generateFileFixPrompt(file: FileReport): string {
  if (file.defects.length === 0) return "";

  const p0s = file.defects.filter((d) => d.priority === "P0");
  const p1s = file.defects.filter((d) => d.priority === "P1");
  const others = file.defects.filter((d) => d.priority !== "P0" && d.priority !== "P1");

  let prompt = `Fix the following production readiness issues in ${file.relative_path}:\n\n`;

  if (p0s.length > 0) {
    prompt += `CRITICAL (must fix before deploy):\n`;
    for (const d of p0s) {
      prompt += `- Line ${d.line ?? "?"}: ${d.description}\n  Fix: ${d.fix_hint}\n`;
    }
    prompt += "\n";
  }

  if (p1s.length > 0) {
    prompt += `HIGH PRIORITY:\n`;
    for (const d of p1s) {
      prompt += `- Line ${d.line ?? "?"}: ${d.description}\n  Fix: ${d.fix_hint}\n`;
    }
    prompt += "\n";
  }

  if (others.length > 0) {
    prompt += `SHOULD FIX:\n`;
    for (const d of others) {
      prompt += `- Line ${d.line ?? "?"}: ${d.description}\n  Fix: ${d.fix_hint}\n`;
    }
    prompt += "\n";
  }

  prompt += `Rules:\n`;
  prompt += `- Make the smallest change that fixes each issue\n`;
  prompt += `- Do not change existing API contracts\n`;
  prompt += `- Ensure all existing tests still pass\n`;
  prompt += `- One commit per defect fixed\n`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Actionable Skills Generation
// ---------------------------------------------------------------------------

function generateActionableSkills(files: FileReport[]): ActionableSkill[] {
  const skills: ActionableSkill[] = [];

  // Group defects by dimension across all files
  const byDimension = new Map<string, { files: Set<string>; defects: FileDefect[] }>();
  for (const file of files) {
    for (const defect of file.defects) {
      if (!byDimension.has(defect.dimension)) {
        byDimension.set(defect.dimension, { files: new Set(), defects: [] });
      }
      const group = byDimension.get(defect.dimension)!;
      group.files.add(file.relative_path);
      group.defects.push(defect);
    }
  }

  for (const [dimension, group] of byDimension) {
    const fileList = Array.from(group.files);

    let prompt = "";
    let description = "";

    switch (dimension) {
      case "security":
        description = `Fix ${group.defects.length} security issues across ${fileList.length} files`;
        prompt = `You are a security hardening agent. Fix ALL security defects in the following files. Priority order: P0 (secrets, injection) first, then P1 (CORS, auth, error exposure).\n\nFiles to fix:\n${fileList.map((f) => `- ${f}`).join("\n")}\n\nFor each file:\n1. Remove all hardcoded secrets → move to environment variables with validation\n2. Replace string-concatenated SQL with parameterized queries\n3. Restrict CORS to specific origins\n4. Add auth middleware to unprotected endpoints\n5. Sanitize error responses (no stack traces to client)\n\nCommit each fix individually: fix(security): <defect-id> — <description>`;
        break;

      case "error-handling":
        description = `Add error handling to ${group.defects.length} unprotected code paths in ${fileList.length} files`;
        prompt = `You are an error handling specialist. Add proper error handling to ALL external calls in these files:\n\n${fileList.map((f) => `- ${f}`).join("\n")}\n\nFor each file:\n1. Wrap every fetch/axios/http call in try/catch\n2. Add timeouts (5s default) via AbortController\n3. Replace empty catch blocks with proper error logging\n4. Use typed errors (not bare Error)\n5. Ensure errors propagate meaningfully (not swallowed)\n\nCommit each fix individually: fix(error-handling): <defect-id> — <description>`;
        break;

      case "input-validation":
        description = `Add input validation to ${group.defects.length} endpoints in ${fileList.length} files`;
        prompt = `You are an input validation specialist. Add runtime schema validation to ALL API endpoints in these files:\n\n${fileList.map((f) => `- ${f}`).join("\n")}\n\nFor each endpoint:\n1. Define a Zod schema for the request body/params\n2. Use safeParse() and return 400 with error details on failure\n3. Replace \`any\` types with proper TypeScript types\n4. Validate query parameters and URL params too\n\nCommit each fix individually: fix(input-validation): <defect-id> — <description>`;
        break;

      case "observability":
        description = `Replace ${group.defects.length} console.log calls with structured logging in ${fileList.length} files`;
        prompt = `You are an observability specialist. Replace ALL console.log/debug/info calls with structured logging:\n\n${fileList.map((f) => `- ${f}`).join("\n")}\n\nFor each file:\n1. Import a structured logger (pino or winston)\n2. Replace console.log with logger.info/error/warn\n3. Add request context (requestId, userId) to log entries\n4. Log on entry/exit/error for each API handler\n5. Never log PII (passwords, tokens, SSN)\n\nCommit each fix individually: fix(observability): <defect-id> — <description>`;
        break;

      case "data-integrity":
        description = `Fix ${group.defects.length} data integrity issues in ${fileList.length} files`;
        prompt = `You are a data integrity specialist. Fix ALL data integrity issues in these files:\n\n${fileList.map((f) => `- ${f}`).join("\n")}\n\nFor each file:\n1. Wrap multi-query operations in database transactions\n2. Add proper constraint checks before writes\n3. Validate data consistency on reads\n\nCommit each fix individually: fix(data-integrity): <defect-id> — <description>`;
        break;

      default:
        description = `Fix ${group.defects.length} ${dimension} issues in ${fileList.length} files`;
        prompt = `Fix all ${dimension} defects in:\n${fileList.map((f) => `- ${f}`).join("\n")}`;
    }

    skills.push({
      name: `fix-${dimension}`,
      description,
      dimension,
      files_affected: fileList,
      prompt,
    });
  }

  return skills;
}

// ---------------------------------------------------------------------------
// Remediation Plan Generation
// ---------------------------------------------------------------------------

function generateRemediationPlan(files: FileReport[]): RemediationStep[] {
  const steps: RemediationStep[] = [];

  // Sort files: P0 files first, then by defect count descending
  const sortedFiles = files
    .filter((f) => f.defects.length > 0)
    .sort((a, b) => {
      const aP0 = a.defects.filter((d) => d.priority === "P0").length;
      const bP0 = b.defects.filter((d) => d.priority === "P0").length;
      if (aP0 !== bP0) return bP0 - aP0;
      return b.defects.length - a.defects.length;
    });

  let order = 0;
  for (const file of sortedFiles) {
    order++;
    const p0s = file.defects.filter((d) => d.priority === "P0");
    const priority = p0s.length > 0 ? "P0" : file.defects.some((d) => d.priority === "P1") ? "P1" : "P2";

    const effort = file.defects.length <= 2 ? "~15 min" :
                   file.defects.length <= 5 ? "~30 min" :
                   file.defects.length <= 10 ? "~1 hour" : "~2 hours";

    steps.push({
      order,
      priority: priority as RemediationStep["priority"],
      file: file.relative_path,
      defect_count: file.defects.length,
      description: `Fix ${file.defects.length} defects (${p0s.length} critical)`,
      estimated_effort: effort,
      prompt: file.fix_prompt,
    });
  }

  return steps;
}

// ---------------------------------------------------------------------------
// Report Generation (Markdown + HTML)
// ---------------------------------------------------------------------------

function generateMarkdownReport(result: ScanResult): string {
  let md = `# V2P Production Readiness Scan Report\n\n`;
  md += `**Project:** ${result.project_path}\n`;
  md += `**Scanned:** ${result.scan_timestamp}\n`;
  md += `**Files:** ${result.files_scanned}\n`;
  md += `**Defects:** ${result.total_defects}\n`;
  md += `**Overall Readiness:** ${(result.summary.overall_readiness * 100).toFixed(1)}%\n\n`;

  // Maturity breakdown
  md += `## File Maturity\n\n`;
  md += `| Status | Count |\n|---|---|\n`;
  for (const [status, count] of Object.entries(result.summary.by_maturity)) {
    const emoji = status === "hardened" ? "🟢" : status === "mostly-clean" ? "🟡" : status === "needs-work" ? "🟠" : "🔴";
    md += `| ${emoji} ${status} | ${count} |\n`;
  }

  // Priority breakdown
  md += `\n## Defects by Priority\n\n`;
  md += `| Priority | Count | Meaning |\n|---|---|---|\n`;
  md += `| P0 | ${result.summary.by_priority["P0"] ?? 0} | Blocks deploy |\n`;
  md += `| P1 | ${result.summary.by_priority["P1"] ?? 0} | Must fix |\n`;
  md += `| P2 | ${result.summary.by_priority["P2"] ?? 0} | Should fix |\n`;
  md += `| P3 | ${result.summary.by_priority["P3"] ?? 0} | Nice to have |\n`;

  // Critical files
  if (result.summary.critical_files.length > 0) {
    md += `\n## Critical Files (P0 defects)\n\n`;
    for (const f of result.summary.critical_files) {
      const file = result.files.find((r) => r.relative_path === f);
      if (!file) continue;
      const p0s = file.defects.filter((d) => d.priority === "P0");
      md += `### ${f}\n`;
      for (const d of p0s) {
        md += `- **Line ${d.line ?? "?"}**: ${d.description}\n  - Fix: ${d.fix_hint}\n`;
      }
      md += "\n";
    }
  }

  // Remediation plan
  md += `## Remediation Plan\n\n`;
  md += `| # | Priority | File | Defects | Effort |\n|---|---|---|---|---|\n`;
  for (const step of result.remediation_plan.slice(0, 20)) {
    md += `| ${step.order} | ${step.priority} | ${step.file} | ${step.defect_count} | ${step.estimated_effort} |\n`;
  }

  // Actionable skills
  md += `\n## Actionable Fix Prompts\n\n`;
  md += `Copy these into Claude Code, Codex, or similar to auto-fix each dimension:\n\n`;
  for (const skill of result.actionable_skills) {
    md += `### ${skill.name}\n`;
    md += `${skill.description}\n\n`;
    md += `\`\`\`\n${skill.prompt}\n\`\`\`\n\n`;
  }

  // Per-file details
  md += `## Per-File Details\n\n`;
  for (const file of result.files.filter((f) => f.defects.length > 0).slice(0, 30)) {
    const maturityEmoji = file.maturity === "critical" ? "🔴" : file.maturity === "needs-work" ? "🟠" : "🟡";
    md += `### ${maturityEmoji} ${file.relative_path}\n`;
    md += `Score: ${(file.readiness_score * 100).toFixed(0)}% | Defects: ${file.defects.length} | Risk: ${file.risk_level}\n\n`;
    for (const d of file.defects) {
      md += `- **[${d.priority}]** Line ${d.line ?? "?"}: ${d.description}\n`;
    }
    md += "\n";
  }

  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pathIdx = args.indexOf("--path");
  const targetPath = pathIdx >= 0 ? resolve(args[pathIdx + 1]!) :
    existsSync("target/demo-app") ? resolve("target/demo-app") :
    existsSync("target") ? resolve("target") : resolve(".");

  const generateReport = args.includes("--report") || !args.includes("--prompts");

  console.log(`\x1b[36m[v2p-scan]\x1b[0m Scanning ${targetPath} file by file...\n`);

  // Discover source files, then filter out third-party and generated code
  // Note: glob ignore patterns can fail on Windows backslash paths, so we post-filter
  const tsFilesRaw = await glob(`${targetPath}/**/*.{ts,tsx,js,jsx}`, {
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
  });
  const pyFilesRaw = await glob(`${targetPath}/**/*.py`, {
    ignore: ["**/node_modules/**", "**/venv/**", "**/.git/**", "**/__pycache__/**"],
  });

  // Post-filter: exclude third-party, generated, and vendored code
  const excludePatterns = [
    /[/\\]node_modules[/\\]/,
    /[/\\]dist[/\\]/,
    /[/\\]build[/\\]/,
    /[/\\]\.git[/\\]/,
    /[/\\]venv[/\\]/,
    /[/\\]\.venv[/\\]/,
    /[/\\]__pycache__[/\\]/,
    /[/\\]vendor[/\\]/,
    /[/\\]\.next[/\\]/,
    /[/\\]\.nuxt[/\\]/,
    /[/\\]coverage[/\\]/,
    /[/\\]\.cache[/\\]/,
    /[/\\]site-packages[/\\]/,
    /[/\\]\.eggs[/\\]/,
    /\.egg-info[/\\]/,
    /\.min\.js$/,
    /\.bundle\.js$/,
    /\.generated\./,
  ];

  function isExcluded(filePath: string): boolean {
    return excludePatterns.some((p) => p.test(filePath));
  }

  const tsFiles = tsFilesRaw.filter((f) => !isExcluded(f));
  const pyFiles = pyFilesRaw.filter((f) => !isExcluded(f));
  const allFiles = [...tsFiles, ...pyFiles];

  if (allFiles.length === 0) {
    console.log("No source files found. Provide --path or ensure target/ exists.");
    process.exit(1);
  }

  console.log(`\x1b[36m[v2p-scan]\x1b[0m Found ${allFiles.length} files (${tsFiles.length} TS/JS, ${pyFiles.length} Python)\n`);

  // Scan each file
  const fileReports: FileReport[] = [];

  for (const filePath of allFiles) {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const ext = extname(filePath).toLowerCase();
    const lang: FileReport["language"] = ext === ".py" ? "python" :
      ext === ".ts" || ext === ".tsx" ? "typescript" :
      ext === ".js" || ext === ".jsx" ? "javascript" : "other";

    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const defects = scanFileForDefects(filePath, content, lines, lang);
    const { score, maturity, risk } = computeFileReadiness(defects);
    const relativePath = relative(targetPath, filePath);

    const fixPrompt = generateFileFixPrompt({
      relative_path: relativePath,
      defects,
    } as FileReport);

    fileReports.push({
      path: filePath,
      relative_path: relativePath,
      language: lang,
      size_bytes: Buffer.byteLength(content),
      line_count: lines.length,
      content_hash: hash,
      scanned_at: new Date().toISOString(),
      defects,
      maturity,
      readiness_score: score,
      risk_level: risk,
      fix_prompt: fixPrompt,
    });

    // Progress indicator
    const defectStr = defects.length > 0 ? `\x1b[33m${defects.length} defects\x1b[0m` : `\x1b[32mclean\x1b[0m`;
    const p0Count = defects.filter((d) => d.priority === "P0").length;
    const p0Str = p0Count > 0 ? ` \x1b[31m(${p0Count} P0!)\x1b[0m` : "";
    console.log(`  ${relativePath.padEnd(50)} ${defectStr}${p0Str}`);
  }

  // Build summary
  const allDefects = fileReports.flatMap((f) => f.defects);
  const byMaturity: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  const byDimension: Record<string, number> = {};
  const byLanguage: Record<string, number> = {};

  for (const file of fileReports) {
    byMaturity[file.maturity] = (byMaturity[file.maturity] ?? 0) + 1;
    byLanguage[file.language] = (byLanguage[file.language] ?? 0) + 1;
  }
  for (const d of allDefects) {
    byPriority[d.priority] = (byPriority[d.priority] ?? 0) + 1;
    byDimension[d.dimension] = (byDimension[d.dimension] ?? 0) + 1;
  }

  const overallReadiness = fileReports.length > 0
    ? fileReports.reduce((sum, f) => sum + f.readiness_score, 0) / fileReports.length
    : 1;

  const skills = generateActionableSkills(fileReports);
  const plan = generateRemediationPlan(fileReports);

  const result: ScanResult = {
    project_path: targetPath,
    scan_timestamp: new Date().toISOString(),
    files_scanned: fileReports.length,
    total_defects: allDefects.length,
    files: fileReports,
    summary: {
      by_maturity: byMaturity,
      by_priority: byPriority,
      by_dimension: byDimension,
      by_language: byLanguage,
      overall_readiness: Math.round(overallReadiness * 1000) / 1000,
      critical_files: fileReports.filter((f) => f.maturity === "critical").map((f) => f.relative_path),
      clean_files: fileReports.filter((f) => f.maturity === "hardened").map((f) => f.relative_path),
    },
    remediation_plan: plan,
    actionable_skills: skills,
  };

  // Console summary
  console.log(`\n\x1b[36m[v2p-scan]\x1b[0m Scan complete\n`);
  console.log(`  Files scanned:    ${result.files_scanned}`);
  console.log(`  Total defects:    ${result.total_defects}`);
  console.log(`  P0 (critical):    \x1b[31m${byPriority["P0"] ?? 0}\x1b[0m`);
  console.log(`  P1 (must fix):    \x1b[33m${byPriority["P1"] ?? 0}\x1b[0m`);
  console.log(`  P2 (should fix):  ${byPriority["P2"] ?? 0}`);
  console.log(`  Overall readiness: ${(overallReadiness * 100).toFixed(1)}%`);
  console.log(`  Critical files:   ${result.summary.critical_files.length}`);
  console.log(`  Clean files:      ${result.summary.clean_files.length}`);

  if (result.actionable_skills.length > 0) {
    console.log(`\n\x1b[36m[v2p-scan]\x1b[0m Generated ${result.actionable_skills.length} actionable fix skills`);
  }

  // Write outputs
  mkdirSync("reports", { recursive: true });

  // JSON result (machine-readable)
  writeFileSync("reports/scan-e2e-result.json", JSON.stringify(result, null, 2));

  // Markdown report (human-readable + copy-paste prompts)
  if (generateReport) {
    const md = generateMarkdownReport(result);
    writeFileSync("reports/scan-e2e-report.md", md);
    console.log(`\n\x1b[32m[v2p-scan]\x1b[0m Reports written:`);
    console.log(`  reports/scan-e2e-result.json (machine-readable)`);
    console.log(`  reports/scan-e2e-report.md   (human-readable + fix prompts)`);
  }

  // Individual fix prompts (one file per dimension)
  if (args.includes("--prompts")) {
    mkdirSync("reports/prompts", { recursive: true });
    for (const skill of result.actionable_skills) {
      writeFileSync(`reports/prompts/${skill.name}.md`, `# ${skill.name}\n\n${skill.description}\n\n${skill.prompt}\n`);
    }
    console.log(`\n\x1b[32m[v2p-scan]\x1b[0m Fix prompts written to reports/prompts/`);
  }

  // Exit with error if P0s found
  if ((byPriority["P0"] ?? 0) > 0) {
    console.log(`\n\x1b[31m[v2p-scan]\x1b[0m BLOCKED: ${byPriority["P0"]} P0 defects must be fixed before deploy\n`);
    process.exit(1);
  }
}

main().catch(console.error);
