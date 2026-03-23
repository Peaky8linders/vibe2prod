/**
 * scripts/harden.ts — Zero-config "magic wand" hardening
 *
 * The one-command entry point for vibe coders who don't want to configure anything.
 * Auto-detects framework, runs scan, applies top-priority fixes via LLM, produces
 * a readiness report and badge.
 *
 * Usage:
 *   npx v2p harden                     # harden current directory
 *   npx v2p harden ../my-app           # harden a specific project
 *   npx v2p harden --dry-run           # scan only, don't fix
 *   npx v2p harden --max-fixes 10      # limit number of fix attempts
 *   npx v2p harden --no-report         # skip PDF report generation
 */

import { execSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  cpSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
const C = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  nc: "\x1b[0m",
};

function log(msg: string) { console.log(msg); }
function step(msg: string) { log(`\n${C.cyan}▸${C.nc} ${msg}`); }
function ok(msg: string) { log(`  ${C.green}✓${C.nc} ${msg}`); }
function warn(msg: string) { log(`  ${C.yellow}⚠${C.nc} ${msg}`); }
function fail(msg: string) { log(`  ${C.red}✗${C.nc} ${msg}`); }

// ---------------------------------------------------------------------------
// Framework Detection
// ---------------------------------------------------------------------------

interface DetectedFramework {
  name: string;
  language: "typescript" | "javascript" | "python";
  runtime: string;
  scanGlobs: string[];
  highValuePaths: string[];
  commonDefects: string[];
}

function detectFramework(projectPath: string): DetectedFramework {
  // Check for Node/TS projects
  const pkgPath = resolve(projectPath, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const allDeps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    if (allDeps["next"]) {
      return {
        name: "Next.js",
        language: allDeps["typescript"] ? "typescript" : "javascript",
        runtime: "node",
        scanGlobs: ["src/**/*.{ts,tsx,js,jsx}", "app/**/*.{ts,tsx,js,jsx}", "pages/**/*.{ts,tsx,js,jsx}"],
        highValuePaths: ["app/api/", "pages/api/", "src/app/api/", "middleware.ts"],
        commonDefects: [
          "API routes without input validation",
          "Missing auth on API routes",
          "Server actions with unvalidated input",
          "Environment variables accessed without validation",
          "No rate limiting on API routes",
        ],
      };
    }

    if (allDeps["express"]) {
      return {
        name: "Express",
        language: allDeps["typescript"] ? "typescript" : "javascript",
        runtime: "node",
        scanGlobs: ["src/**/*.{ts,js}", "routes/**/*.{ts,js}", "api/**/*.{ts,js}"],
        highValuePaths: ["src/api/", "src/routes/", "routes/", "src/middleware/"],
        commonDefects: [
          "SQL injection via string interpolation",
          "Missing CORS restrictions",
          "No helmet/security headers",
          "Hardcoded JWT secrets",
          "No input validation on request body",
          "Empty catch blocks swallowing errors",
        ],
      };
    }

    if (allDeps["fastify"]) {
      return {
        name: "Fastify",
        language: allDeps["typescript"] ? "typescript" : "javascript",
        runtime: "node",
        scanGlobs: ["src/**/*.{ts,js}"],
        highValuePaths: ["src/routes/", "src/plugins/"],
        commonDefects: ["Missing schema validation on routes", "No rate limiting"],
      };
    }

    // Generic Node
    return {
      name: "Node.js",
      language: allDeps["typescript"] ? "typescript" : "javascript",
      runtime: "node",
      scanGlobs: ["src/**/*.{ts,tsx,js,jsx}", "lib/**/*.{ts,js}"],
      highValuePaths: ["src/"],
      commonDefects: ["Unhandled promise rejections", "No structured logging"],
    };
  }

  // Check for Python projects
  const pyprojectPath = resolve(projectPath, "pyproject.toml");
  const requirementsPath = resolve(projectPath, "requirements.txt");

  if (existsSync(pyprojectPath) || existsSync(requirementsPath)) {
    const content = existsSync(pyprojectPath)
      ? readFileSync(pyprojectPath, "utf-8")
      : existsSync(requirementsPath)
        ? readFileSync(requirementsPath, "utf-8")
        : "";

    if (/fastapi/i.test(content)) {
      return {
        name: "FastAPI",
        language: "python",
        runtime: "python",
        scanGlobs: ["**/*.py"],
        highValuePaths: ["app/", "src/", "api/", "routers/"],
        commonDefects: [
          "Routes using dict instead of Pydantic models",
          "SQL injection via f-strings",
          "Missing dependency injection for auth",
          "Bare except clauses",
          "DEBUG=True in production config",
        ],
      };
    }

    if (/django/i.test(content)) {
      return {
        name: "Django",
        language: "python",
        runtime: "python",
        scanGlobs: ["**/*.py"],
        highValuePaths: ["views.py", "urls.py", "models.py", "settings.py"],
        commonDefects: ["DEBUG=True", "SECRET_KEY hardcoded", "Missing CSRF protection"],
      };
    }

    if (/flask/i.test(content)) {
      return {
        name: "Flask",
        language: "python",
        runtime: "python",
        scanGlobs: ["**/*.py"],
        highValuePaths: ["app.py", "routes/", "api/"],
        commonDefects: ["No input validation", "SQL injection", "Debug mode enabled"],
      };
    }

    return {
      name: "Python",
      language: "python",
      runtime: "python",
      scanGlobs: ["**/*.py"],
      highValuePaths: ["src/", "app/"],
      commonDefects: ["Bare except", "No type hints", "Hardcoded secrets"],
    };
  }

  // Fallback
  return {
    name: "Unknown",
    language: "javascript",
    runtime: "node",
    scanGlobs: ["**/*.{ts,tsx,js,jsx,py}"],
    highValuePaths: ["src/"],
    commonDefects: [],
  };
}

// ---------------------------------------------------------------------------
// Quick Fix Applicator (LLM-powered)
// ---------------------------------------------------------------------------

interface Defect {
  id: string;
  dimension: string;
  priority: string;
  file: string;
  line_range: [number, number] | null;
  description: string;
  fixed: boolean;
}

async function applyQuickFix(
  defect: Defect,
  projectPath: string
): Promise<{ fixed: boolean; diff: string }> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];

  if (!apiKey) {
    return { fixed: false, diff: "No ANTHROPIC_API_KEY — skipping LLM fix" };
  }

  const filePath = resolve(defect.file);
  if (!existsSync(filePath)) {
    return { fixed: false, diff: `File not found: ${defect.file}` };
  }

  const originalContent = readFileSync(filePath, "utf-8");

  const prompt = `You are a production hardening agent. Fix exactly ONE defect in this file.

DEFECT: ${defect.description}
FILE: ${defect.file}
${defect.line_range ? `LINES: ${defect.line_range[0]}-${defect.line_range[1]}` : ""}

RULES:
- Return ONLY the complete fixed file content. No explanations, no markdown, no backticks.
- Make the MINIMAL change to fix the defect.
- Do NOT change any existing behavior or API contracts.
- Do NOT add new dependencies unless absolutely necessary.
- If the fix requires an import, add it.
- Preserve all existing code that isn't related to the defect.

CURRENT FILE CONTENT:
${originalContent.slice(0, 12000)}`;

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
        max_tokens: 8192,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = (await response.json()) as {
      content: Array<{ type: string; text?: string }>;
    };

    let fixedContent = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    // Strip markdown code fences if present
    fixedContent = fixedContent.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();

    if (!fixedContent || fixedContent.length < 10) {
      return { fixed: false, diff: "LLM returned empty or too-short response" };
    }

    // Sanity check: file shouldn't shrink by more than 50% or grow by more than 200%
    if (fixedContent.length < originalContent.length * 0.5 ||
        fixedContent.length > originalContent.length * 3) {
      return { fixed: false, diff: "LLM output failed size sanity check" };
    }

    writeFileSync(filePath, fixedContent);

    // Generate a simple diff summary
    const origLines = originalContent.split("\n").length;
    const fixedLines = fixedContent.split("\n").length;
    const diff = `${defect.file}: ${origLines} → ${fixedLines} lines`;

    return { fixed: true, diff };
  } catch (err) {
    return { fixed: false, diff: `LLM call failed: ${err}` };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse arguments
  const dryRun = args.includes("--dry-run");
  const noReport = args.includes("--no-report");
  const maxFixesIdx = args.indexOf("--max-fixes");
  const maxFixes = maxFixesIdx >= 0 ? parseInt(args[maxFixesIdx + 1] ?? "20") : 20;
  const projectArg = args.find((a) => !a.startsWith("--"));
  const projectPath = resolve(projectArg ?? ".");

  if (!existsSync(projectPath)) {
    fail(`Path not found: ${projectPath}`);
    process.exit(1);
  }

  // Banner
  log("");
  log(`${C.bold}${C.cyan}  ╔══════════════════════════════════════════╗${C.nc}`);
  log(`${C.bold}${C.cyan}  ║   V2P — Autonomous Production Hardening  ║${C.nc}`);
  log(`${C.bold}${C.cyan}  ╚══════════════════════════════════════════╝${C.nc}`);
  log("");

  // Step 1: Detect framework
  step("Detecting framework...");
  const framework = detectFramework(projectPath);
  ok(`${framework.name} (${framework.language})`);
  if (framework.commonDefects.length > 0) {
    log(`  ${C.dim}Known patterns: ${framework.commonDefects.slice(0, 3).join(", ")}${C.nc}`);
  }

  // Step 2: Copy to target if not already there
  const targetPath = resolve(ROOT, "target");
  const isAlreadyTarget = resolve(projectPath) === targetPath ||
    resolve(projectPath).startsWith(targetPath);

  if (!isAlreadyTarget) {
    step("Copying project to workspace...");
    mkdirSync(targetPath, { recursive: true });

    // Clear existing target (but keep .gitkeep)
    try {
      const entries = readdirSync(targetPath);
      for (const entry of entries) {
        if (entry === ".gitkeep") continue;
        execSync(`rm -rf ${resolve(targetPath, entry)}`);
      }
    } catch { /* empty target dir */ }

    cpSync(projectPath, targetPath, {
      recursive: true,
      filter: (src) =>
        !src.includes("node_modules") &&
        !src.includes(".git/") &&
        !src.includes("__pycache__") &&
        !src.includes("venv") &&
        !src.includes(".venv") &&
        !src.includes("dist/"),
    });
    ok(`Copied to target/`);
  } else {
    ok("Project already in target/");
  }

  // Step 3: Capture behavioral baseline
  step("Capturing behavioral baseline...");
  try {
    execSync("npx tsx scripts/capture-behavior.ts", {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 60_000,
    });
    ok("Baseline captured");
  } catch {
    warn("No test suite found — baseline will be minimal");
  }

  // Step 4: Run defect scan
  step("Scanning for production defects...");
  try {
    const scanOutput = execSync("npx tsx scripts/scan-defects.ts", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 120_000,
    });
    // Extract summary line
    const summaryMatch = scanOutput.match(/Scan complete: (\d+) defects across (\d+) files/);
    if (summaryMatch) {
      ok(`${summaryMatch[1]} defects found across ${summaryMatch[2]} files`);
    } else {
      ok("Scan complete");
    }
  } catch (err: unknown) {
    const stdout = err && typeof err === "object" && "stdout" in err
      ? String((err as { stdout: string }).stdout)
      : "";
    if (stdout.includes("No source files found")) {
      fail("No source files found in project");
      process.exit(1);
    }
    warn("Scan completed with warnings");
  }

  // Step 5: Load taxonomy and prioritize
  const taxPath = resolve(ROOT, "evals/defect-taxonomy.json");
  if (!existsSync(taxPath)) {
    fail("Defect taxonomy not generated");
    process.exit(1);
  }

  const taxonomy = JSON.parse(readFileSync(taxPath, "utf-8"));
  const allDefects: Defect[] = Object.values(taxonomy.dimensions ?? {})
    .flatMap((d: any) => (d as { defects: Defect[] }).defects ?? []);

  const unfixed = allDefects
    .filter((d) => !d.fixed)
    .sort((a, b) => {
      const prio: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
      return (prio[a.priority] ?? 9) - (prio[b.priority] ?? 9);
    });

  const p0Count = unfixed.filter((d) => d.priority === "P0").length;
  const p1Count = unfixed.filter((d) => d.priority === "P1").length;
  const p2Count = unfixed.filter((d) => d.priority === "P2").length;

  log(`\n  ${C.red}${C.bold}${p0Count} P0${C.nc} (blocks launch)  ${C.yellow}${p1Count} P1${C.nc} (must fix)  ${C.dim}${p2Count} P2${C.nc} (should fix)`);

  if (dryRun) {
    step("Dry run — skipping fixes");
    log(`\n  Would attempt to fix top ${Math.min(maxFixes, unfixed.length)} defects.`);
    log(`  Re-run without --dry-run to apply fixes.\n`);

    // Still generate badge and report
  } else if (unfixed.length > 0 && process.env["ANTHROPIC_API_KEY"]) {
    // Step 6: Apply fixes
    const toFix = unfixed.slice(0, maxFixes);
    step(`Applying fixes (${toFix.length} of ${unfixed.length} defects)...`);

    let fixedCount = 0;
    let failedCount = 0;

    for (const defect of toFix) {
      const result = await applyQuickFix(defect, targetPath);
      if (result.fixed) {
        defect.fixed = true;
        fixedCount++;
        log(`  ${C.green}✓${C.nc} ${defect.id}: ${defect.description.slice(0, 60)}`);
      } else {
        failedCount++;
        log(`  ${C.dim}· ${defect.id}: skipped (${result.diff.slice(0, 50)})${C.nc}`);
      }
    }

    ok(`${fixedCount} fixed, ${failedCount} skipped`);

    // Write updated taxonomy
    writeFileSync(taxPath, JSON.stringify(taxonomy, null, 2));
  } else if (!process.env["ANTHROPIC_API_KEY"]) {
    warn("No ANTHROPIC_API_KEY — fix application requires an API key");
    log(`  ${C.dim}Set: export ANTHROPIC_API_KEY=sk-ant-...${C.nc}`);
    log(`  ${C.dim}Then re-run: npx v2p harden${C.nc}`);
  }

  // Step 7: Compute readiness score
  step("Computing readiness score...");
  let scoreOutput = "0";
  try {
    scoreOutput = execSync("npx tsx scripts/readiness-score.ts --detail", {
      cwd: ROOT,
      encoding: "utf-8",
      timeout: 30_000,
    }).trim();
    log(scoreOutput.split("\n").map((l) => `  ${l}`).join("\n"));
  } catch {
    warn("Could not compute score");
  }

  // Extract numeric score for badge
  const scoreMatch = scoreOutput.match(/COMPOSITE\s+(\d+\.\d+)%/);
  const numericScore = scoreMatch ? parseFloat(scoreMatch[1]) : 0;

  // Step 8: Generate badge
  step("Generating readiness badge...");
  try {
    execSync(`npx tsx scripts/generate-badge.ts --score ${numericScore}`, {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 10_000,
    });
    ok("Badge saved to reports/readiness-badge.svg");
  } catch {
    // Badge script might not exist yet — generate inline
    generateBadgeInline(numericScore);
    ok("Badge saved to reports/readiness-badge.svg");
  }

  // Step 9: Generate reports
  if (!noReport) {
    step("Generating launch readiness report...");
    try {
      execSync("npx tsx scripts/generate-report.ts", {
        cwd: ROOT,
        stdio: "pipe",
        timeout: 30_000,
      });
      ok("HTML report saved to reports/");
    } catch {
      warn("HTML report generation failed");
    }

    try {
      execSync("npx tsx scripts/generate-launch-report.ts", {
        cwd: ROOT,
        stdio: "pipe",
        timeout: 60_000,
      });
      ok("PDF launch report saved to reports/");
    } catch {
      warn("PDF report generation failed (reportlab may not be installed)");
    }
  }

  // Final summary
  const totalFixed = allDefects.filter((d) => d.fixed).length;
  const remaining = allDefects.filter((d) => !d.fixed).length;
  const remainingP0 = allDefects.filter((d) => !d.fixed && d.priority === "P0").length;

  log("");
  log(`${C.bold}  ══════════════════════════════════════${C.nc}`);
  log(`${C.bold}  Hardening Complete${C.nc}`);
  log(`${C.bold}  ══════════════════════════════════════${C.nc}`);
  log(`  Framework:    ${framework.name}`);
  log(`  Defects:      ${C.green}${totalFixed} fixed${C.nc}, ${remaining > 0 ? C.yellow : C.green}${remaining} remaining${C.nc}`);
  log(`  Score:        ${numericScore >= 80 ? C.green : numericScore >= 50 ? C.yellow : C.red}${numericScore.toFixed(1)}%${C.nc}`);

  if (remainingP0 > 0) {
    log(`  ${C.red}${C.bold}⛔ ${remainingP0} P0 defects still open — deployment blocked${C.nc}`);
  } else if (remaining === 0) {
    log(`  ${C.green}${C.bold}🚀 All defects resolved — ready to ship${C.nc}`);
  } else {
    log(`  ${C.yellow}Run again or use 'v2p run' for deeper hardening${C.nc}`);
  }

  log("");
  log(`  ${C.dim}Badge:    reports/readiness-badge.svg${C.nc}`);
  if (!noReport) {
    log(`  ${C.dim}Report:   reports/${C.nc}`);
  }
  log("");
}

// ---------------------------------------------------------------------------
// Inline badge generator (fallback)
// ---------------------------------------------------------------------------

function generateBadgeInline(score: number): void {
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#eab308" : "#ef4444";
  const label = "v2p hardened";
  const value = `${score.toFixed(0)}%`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="20" role="img" aria-label="${label}: ${value}">
  <title>${label}: ${value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="160" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="95" height="20" fill="#555"/>
    <rect x="95" width="65" height="20" fill="${color}"/>
    <rect width="160" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text aria-hidden="true" x="47.5" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="47.5" y="14">${label}</text>
    <text aria-hidden="true" x="127.5" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="127.5" y="14">${value}</text>
  </g>
</svg>`;

  mkdirSync(resolve(ROOT, "reports"), { recursive: true });
  writeFileSync(resolve(ROOT, "reports/readiness-badge.svg"), svg);
}

main().catch((err) => {
  console.error(`${C.red}Fatal error:${C.nc}`, err);
  process.exit(1);
});
