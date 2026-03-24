/**
 * subtract/scanner.ts — Via Negativa: Hardening by Subtraction
 *
 * Scans for attack surface that should be REMOVED, not defended.
 * Four sub-scanners (Tier 1 — static analysis, no runtime data needed):
 *
 *   1. Unused dependencies — installed but never imported
 *   2. Unreferenced endpoints — route definitions with no test/internal references
 *   3. Overly broad config — CORS *, permissive CSP, debug middleware
 *   4. Unnecessary exposure — unused env vars, debug code, verbose errors
 *
 * Usage:
 *   npx tsx subtract/scanner.ts                    # scan target/
 *   npx tsx subtract/scanner.ts --output report    # scan + print report
 *   npx tsx subtract/scanner.ts --merge            # merge findings into taxonomy
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { glob } from "glob";
import { resolve, basename } from "node:path";

// ---------------------------------------------------------------------------
// Types (matches extended Defect schema from scan-defects.ts)
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

interface SubtractFinding {
  type: "unused-dep" | "unreferenced-endpoint" | "broad-config" | "unnecessary-exposure";
  priority: "P0" | "P1" | "P2" | "P3";
  file: string;
  line_range: [number, number] | null;
  description: string;
  removal_action: string;
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let counter = 0;
function nextId(): string {
  counter++;
  return `SUB-${String(counter).padStart(3, "0")}`;
}

const SCAN_TIMESTAMP = new Date().toISOString();

// ---------------------------------------------------------------------------
// Sub-scanner 1: Unused Dependencies
// ---------------------------------------------------------------------------

async function scanUnusedDeps(targetDir: string): Promise<SubtractFinding[]> {
  const findings: SubtractFinding[] = [];

  const pkgPath = resolve(targetDir, "package.json");
  if (!existsSync(pkgPath)) return findings;

  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
    dependencies?: Record<string, string>;
  };

  if (!pkg.dependencies) return findings;

  // Get all source files
  const sourceFiles = await glob(`${targetDir}/**/*.{ts,tsx,js,jsx}`, {
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  });

  const allSource = sourceFiles.map((f) => readFileSync(f, "utf-8")).join("\n");

  for (const dep of Object.keys(pkg.dependencies)) {
    // Check if the dependency is imported anywhere in source
    // Handles: import ... from 'dep', require('dep'), import('dep')
    const depName = dep.startsWith("@") ? dep : dep.split("/")[0]!;
    const importPattern = new RegExp(
      `(?:from\\s+['"]${escapeRegex(depName)}|require\\s*\\(\\s*['"]${escapeRegex(depName)}|import\\s*\\(\\s*['"]${escapeRegex(depName)})`,
    );

    if (!importPattern.test(allSource)) {
      findings.push({
        type: "unused-dep",
        priority: "P2",
        file: pkgPath,
        line_range: null,
        description: `Dependency "${dep}" is installed but never imported in source code`,
        removal_action: `Remove from package.json: npm uninstall ${dep}`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Sub-scanner 2: Unreferenced Endpoints
// ---------------------------------------------------------------------------

async function scanUnreferencedEndpoints(targetDir: string): Promise<SubtractFinding[]> {
  const findings: SubtractFinding[] = [];

  const sourceFiles = await glob(`${targetDir}/**/*.{ts,tsx,js,jsx}`, {
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  // Phase 1: Collect all route definitions
  interface RouteDef {
    method: string;
    path: string;
    file: string;
    line: number;
  }

  const routes: RouteDef[] = [];
  const routePattern = /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/g;

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      let match: RegExpExecArray | null;
      const lineRoutePattern = new RegExp(routePattern.source, "g");
      while ((match = lineRoutePattern.exec(lines[i]!)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2]!,
          file,
          line: i + 1,
        });
      }
    }
  }

  if (routes.length === 0) return findings;

  // Phase 2: Collect all test files and check which routes are tested
  const testFiles = await glob(`${targetDir}/**/*.{test,spec}.{ts,tsx,js,jsx}`, {
    ignore: ["**/node_modules/**"],
  });

  const testContent = testFiles.map((f) => readFileSync(f, "utf-8")).join("\n");

  for (const route of routes) {
    // Check if the route path appears in any test file
    const pathInTests = testContent.includes(route.path);

    // Check if route path is referenced from other source files (not its own definition)
    const otherSources = sourceFiles
      .filter((f) => f !== route.file)
      .map((f) => readFileSync(f, "utf-8"))
      .join("\n");
    const pathInSource = otherSources.includes(route.path);

    if (!pathInTests && !pathInSource) {
      findings.push({
        type: "unreferenced-endpoint",
        priority: "P2",
        file: route.file,
        line_range: [route.line, route.line],
        description: `${route.method} ${route.path} has no test coverage and no internal references`,
        removal_action: `Consider removing or adding tests for ${route.method} ${route.path}`,
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Sub-scanner 3: Overly Broad Configuration
// ---------------------------------------------------------------------------

async function scanBroadConfig(targetDir: string): Promise<SubtractFinding[]> {
  const findings: SubtractFinding[] = [];

  const sourceFiles = await glob(`${targetDir}/**/*.{ts,tsx,js,jsx}`, {
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // CORS with no restrictions: cors() or cors({origin: '*'}) or cors({origin: true})
      if (/cors\(\s*\)/.test(line) || /origin\s*:\s*(?:true|'\*'|"\*")/.test(line)) {
        findings.push({
          type: "broad-config",
          priority: "P1",
          file,
          line_range: [i + 1, i + 1],
          description: "CORS allows all origins — restrict to specific domains",
          removal_action: "Replace cors() with cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') })",
        });
      }

      // Debug middleware in non-dev code
      if (/morgan\s*\(\s*['"]dev['"]|errorHandler\s*\(\s*\{.*showStack|app\.use\s*\(.*stackTrace/.test(line)) {
        findings.push({
          type: "broad-config",
          priority: "P2",
          file,
          line_range: [i + 1, i + 1],
          description: "Debug/development middleware detected — remove for production",
          removal_action: "Wrap in NODE_ENV check or remove entirely",
        });
      }

      // Wildcard permissions/grants
      if (/\*\.\*|GRANT\s+ALL|permissions?\s*:\s*\[?\s*['"]?\*/i.test(line)) {
        findings.push({
          type: "broad-config",
          priority: "P1",
          file,
          line_range: [i + 1, i + 1],
          description: "Wildcard permission grant — restrict to minimum required",
          removal_action: "Replace wildcard with explicit permission list",
        });
      }

      // Verbose error responses (stack traces to client)
      if (/res\.\w+\(.*(?:stack|err\.message|error\.message)/.test(line) && !/test|spec/.test(file)) {
        findings.push({
          type: "broad-config",
          priority: "P1",
          file,
          line_range: [i + 1, i + 1],
          description: "Error details (stack/message) exposed in API response",
          removal_action: "Return generic error message; log details server-side only",
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Sub-scanner 4: Unnecessary Exposure
// ---------------------------------------------------------------------------

async function scanUnnecessaryExposure(targetDir: string): Promise<SubtractFinding[]> {
  const findings: SubtractFinding[] = [];

  const sourceFiles = await glob(`${targetDir}/**/*.{ts,tsx,js,jsx}`, {
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  const allContent = sourceFiles.map((f) => ({
    file: f,
    content: readFileSync(f, "utf-8"),
    lines: readFileSync(f, "utf-8").split("\n"),
  }));

  const joinedContent = allContent.map((f) => f.content).join("\n");

  // Check .env files for unused variables
  const envFiles = await glob(`${targetDir}/.env*`, { ignore: ["**/node_modules/**"] });
  for (const envFile of envFiles) {
    const envContent = readFileSync(envFile, "utf-8");
    const envVars = envContent.split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => l.split("=")[0]!.trim())
      .filter(Boolean);

    for (const varName of envVars) {
      // Check if the env var is referenced in source
      if (!joinedContent.includes(varName)) {
        findings.push({
          type: "unnecessary-exposure",
          priority: "P2",
          file: envFile,
          line_range: null,
          description: `Environment variable "${varName}" is defined but never referenced in source`,
          removal_action: `Remove ${varName} from ${basename(envFile)}`,
        });
      }
    }
  }

  // Check for debug code patterns in production source
  for (const { file, lines } of allContent) {
    if (/test|spec|__tests__/.test(file)) continue;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;

      // TODO/FIXME/HACK comments indicating incomplete code
      if (/\/\/\s*(TODO|FIXME|HACK|XXX)\b/i.test(line)) {
        findings.push({
          type: "unnecessary-exposure",
          priority: "P3",
          file,
          line_range: [i + 1, i + 1],
          description: `Debug marker in production code: ${line.trim().slice(0, 80)}`,
          removal_action: "Resolve the TODO/FIXME or remove the comment",
        });
      }

      // Health endpoints that leak internal details
      if (/(?:uptime|memoryUsage|cpuUsage|process\.\w+|os\.\w+)/.test(line) &&
          /health|status|info/.test(file)) {
        findings.push({
          type: "unnecessary-exposure",
          priority: "P2",
          file,
          line_range: [i + 1, i + 1],
          description: "Health/status endpoint exposes internal system details",
          removal_action: "Return only {status: 'ok'} — no memory, uptime, or process info",
        });
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const mergeIntoTaxonomy = process.argv.includes("--merge");

  // Determine target directory
  const targetDir = existsSync("target/demo-app") ? "target/demo-app" :
                    existsSync("target") ? "target" : ".";

  console.log(`\x1b[35m[subtract]\x1b[0m Scanning ${targetDir} for attack surface to remove...\n`);

  // Run all sub-scanners
  const [unusedDeps, unreferencedEndpoints, broadConfig, unnecessaryExposure] = await Promise.all([
    scanUnusedDeps(targetDir),
    scanUnreferencedEndpoints(targetDir),
    scanBroadConfig(targetDir),
    scanUnnecessaryExposure(targetDir),
  ]);

  const allFindings = [...unusedDeps, ...unreferencedEndpoints, ...broadConfig, ...unnecessaryExposure];

  if (allFindings.length === 0) {
    console.log("\x1b[32m[subtract]\x1b[0m No subtraction opportunities found. Attack surface is minimal.\n");
    return;
  }

  // Convert findings to defects
  const defects: Defect[] = allFindings.map((f) => ({
    id: nextId(),
    dimension: "subtraction",
    priority: f.priority,
    file: f.file,
    line_range: f.line_range,
    description: `[${f.type}] ${f.description}`,
    fixed: false,
    fix_commit: null,
    attempts: 0,
    needs_human_review: f.priority === "P3",
    source: "subtract" as const,
    discovered_at: SCAN_TIMESTAMP,
  }));

  // Report
  console.log(`\x1b[35m[subtract]\x1b[0m Found ${allFindings.length} subtraction opportunities:\n`);

  const byType: Record<string, SubtractFinding[]> = {};
  for (const f of allFindings) {
    (byType[f.type] ??= []).push(f);
  }

  for (const [type, items] of Object.entries(byType)) {
    console.log(`  ${type}: ${items.length} findings`);
    for (const item of items.slice(0, 5)) {
      const priority = item.priority === "P0" ? "\x1b[31m" :
                       item.priority === "P1" ? "\x1b[33m" :
                       "\x1b[2m";
      console.log(`    ${priority}[${item.priority}]\x1b[0m ${item.description}`);
      console.log(`         \x1b[2mAction: ${item.removal_action}\x1b[0m`);
    }
    if (items.length > 5) {
      console.log(`    ... and ${items.length - 5} more`);
    }
  }

  // Merge into existing taxonomy if requested
  if (mergeIntoTaxonomy) {
    const taxPath = "evals/defect-taxonomy.json";
    if (existsSync(taxPath)) {
      const taxonomy = JSON.parse(readFileSync(taxPath, "utf-8")) as {
        dimensions: Record<string, { defects: Defect[] }>;
        total_defects: number;
      };

      // Ensure subtraction dimension exists
      if (!taxonomy.dimensions["subtraction"]) {
        taxonomy.dimensions["subtraction"] = { defects: [] };
      }

      // Add new defects (avoid duplicates by description)
      const existingDescriptions = new Set(
        taxonomy.dimensions["subtraction"]!.defects.map((d) => d.description),
      );

      let added = 0;
      for (const defect of defects) {
        if (!existingDescriptions.has(defect.description)) {
          taxonomy.dimensions["subtraction"]!.defects.push(defect);
          added++;
        }
      }

      taxonomy.total_defects = Object.values(taxonomy.dimensions)
        .reduce((sum, dim) => sum + dim.defects.length, 0);

      writeFileSync(taxPath, JSON.stringify(taxonomy, null, 2));
      console.log(`\n\x1b[32m[subtract]\x1b[0m Merged ${added} new findings into ${taxPath}`);
    } else {
      console.log(`\n\x1b[33m[subtract]\x1b[0m No taxonomy file found at ${taxPath}. Run v2p scan first.`);
    }
  } else {
    // Write standalone report
    const reportPath = "logs/subtract-findings.json";
    writeFileSync(reportPath, JSON.stringify({ findings: allFindings, defects, timestamp: SCAN_TIMESTAMP }, null, 2));
    console.log(`\n\x1b[35m[subtract]\x1b[0m Findings written to ${reportPath}`);
    console.log(`\x1b[2mTo merge into taxonomy: v2p subtract --merge\x1b[0m`);
  }
}

main().catch(console.error);
