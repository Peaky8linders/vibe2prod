/**
 * integrations/migrationforge.ts — Post-migration hardening bridge
 *
 * Reads MigrationForge pipeline state and modules, then runs V2P scanning
 * against migrated code. Feeds results back as trust score inputs.
 *
 * Usage:
 *   npx tsx integrations/migrationforge.ts --path /path/to/mf-project
 *   npx tsx integrations/migrationforge.ts --path /path/to/mf-project --module auth
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// MigrationForge Types (mirrors api/models/schemas.py)
// ---------------------------------------------------------------------------

interface MFPipelineState {
  phase: string;
  gates: Record<string, { status: string; approved_at?: string }>;
  current_wave: number;
  modules: Record<string, MFModuleState>;
}

interface MFModuleState {
  status: string;
  migration_strategy?: string;
  migration_risk?: string;
  wave?: number;
}

interface MFTrustInput {
  migratability_score: number;
  security_score: number;
  review_gate_score: number;
  vc_readiness_score?: number;
  vc_chaos_resilience?: number;
  vc_defect_count?: number;
}

// ---------------------------------------------------------------------------
// V2P Scan Result Types
// ---------------------------------------------------------------------------

interface V2PScanResult {
  files_scanned: number;
  total_defects: number;
  summary: {
    by_priority: Record<string, number>;
    by_dimension: Record<string, number>;
    overall_readiness: number;
    critical_files: string[];
  };
  files: Array<{
    relative_path: string;
    defects: Array<{
      priority: string;
      dimension: string;
      description: string;
      line: number | null;
      fix_hint: string;
    }>;
    readiness_score: number;
    maturity: string;
  }>;
  actionable_skills: Array<{
    name: string;
    description: string;
    prompt: string;
  }>;
}

// ---------------------------------------------------------------------------
// Integration Logic
// ---------------------------------------------------------------------------

function readMFState(mfPath: string): MFPipelineState | null {
  const statePath = join(mfPath, "migration", "pipeline_state.json");
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as MFPipelineState;
  } catch {
    process.stderr.write(`[vibecheck] Warning: could not parse ${statePath}\n`);
    return null;
  }
}

/** Find migrated module directories — used when scanning specific modules */
export function findMigratedCode(mfPath: string, moduleFilter?: string): string[] {
  // MigrationForge outputs migrated code to migration/modules/<module-name>/
  const modulesDir = join(mfPath, "migration", "modules");
  const paths: string[] = [];

  if (existsSync(modulesDir)) {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    for (const entry of readdirSync(modulesDir)) {
      if (moduleFilter && entry !== moduleFilter) continue;
      const entryPath = join(modulesDir, entry);
      if (statSync(entryPath).isDirectory()) {
        paths.push(entryPath);
      }
    }
  }

  // Also scan the main project source (api/, pipeline/, etc.)
  if (!moduleFilter) {
    for (const dir of ["api", "pipeline", "security", "evaluation", "observability"]) {
      const dirPath = join(mfPath, dir);
      if (existsSync(dirPath)) paths.push(dirPath);
    }
  }

  return paths;
}

function runV2PScan(targetPath: string): V2PScanResult | null {
  const vcRoot = resolve(__dirname, "..");
  const scriptPath = resolve(vcRoot, "scripts/scan-e2e.ts");
  // Use array-form spawn to prevent command injection (no shell: true)
  const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
  const spawnResult = spawnSync(npxCmd, [
    "tsx", scriptPath, "--path", targetPath, "--report",
  ], {
    cwd: vcRoot,
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  if (spawnResult.stdout) {
    process.stderr.write(spawnResult.stdout);
  }
  if (spawnResult.stderr) {
    process.stderr.write(spawnResult.stderr);
  }

  // scan-e2e.ts writes to CWD/reports/, and we run from vcRoot
  const reportPath = resolve(vcRoot, "reports", "scan-e2e-result.json");
  if (!existsSync(reportPath)) return null;

  return JSON.parse(readFileSync(reportPath, "utf-8")) as V2PScanResult;
}

function computeEnhancedTrustScore(
  mfState: MFPipelineState,
  scanResult: V2PScanResult,
): {
  composite: number;
  components: MFTrustInput;
  grade: string;
  verdict: string;
} {
  // MF components (from pipeline state)
  const totalGates = Object.keys(mfState.gates).length || 2;
  const approvedGates = Object.values(mfState.gates).filter((g) => g.status === "approved").length;
  const reviewGateScore = totalGates > 0 ? (approvedGates / totalGates) * 100 : 50;

  // V2P components
  const vcReadiness = scanResult.summary.overall_readiness * 100;
  const p0Count = scanResult.summary.by_priority["P0"] ?? 0;
  const p1Count = scanResult.summary.by_priority["P1"] ?? 0;

  // Security deductions (same formula as MF trust_score.py)
  const securityDeductions = p0Count * 25 + p1Count * 15;
  const securityScore = Math.max(0, 100 - securityDeductions);

  const components: MFTrustInput = {
    migratability_score: vcReadiness, // Use V2P readiness as migratability proxy
    security_score: securityScore,
    review_gate_score: reviewGateScore,
    vc_readiness_score: vcReadiness,
    vc_defect_count: scanResult.total_defects,
  };

  // Enhanced composite: MF gates (30%) + V2P readiness (40%) + Security (30%)
  const composite = Math.round(
    reviewGateScore * 0.3 +
    vcReadiness * 0.4 +
    securityScore * 0.3,
  );

  // Grade thresholds (same as MF grader.py)
  const grade = composite >= 90 ? "A" : composite >= 75 ? "B" : composite >= 60 ? "C" : composite >= 40 ? "D" : "F";

  let verdict: string;
  if (p0Count > 0) verdict = "BLOCKED — P0 defects must be fixed before production";
  else if (composite >= 75) verdict = "READY — production deployment approved";
  else if (composite >= 60) verdict = "CONDITIONAL — fix P1 defects before production";
  else verdict = "NOT READY — significant hardening required";

  return { composite, components, grade, verdict };
}

// ---------------------------------------------------------------------------
// Report Generation
// ---------------------------------------------------------------------------

function generateIntegrationReport(
  mfPath: string,
  mfState: MFPipelineState | null,
  scanResult: V2PScanResult,
  trustScore: ReturnType<typeof computeEnhancedTrustScore> | null,
): string {
  let md = `# V2P × MigrationForge — Post-Migration Hardening Report\n\n`;
  md += `**Project:** ${mfPath}\n`;
  md += `**Scan Date:** ${new Date().toISOString()}\n`;

  if (mfState) {
    md += `**Migration Phase:** ${mfState.phase}\n`;
    md += `**Current Wave:** ${mfState.current_wave}\n`;
  }

  md += `\n## Trust Score\n\n`;

  if (trustScore) {
    const gradeEmoji = trustScore.grade === "A" ? "🟢" : trustScore.grade === "B" ? "🟡" : trustScore.grade === "C" ? "🟠" : "🔴";
    md += `| Metric | Score |\n|---|---|\n`;
    md += `| ${gradeEmoji} **Grade** | **${trustScore.grade}** (${trustScore.composite}/100) |\n`;
    md += `| Verdict | ${trustScore.verdict} |\n`;
    md += `| VibeCheck Readiness | ${trustScore.components.vc_readiness_score?.toFixed(1)}% |\n`;
    md += `| Security | ${trustScore.components.security_score}/100 |\n`;
    md += `| Review Gates | ${trustScore.components.review_gate_score.toFixed(0)}% |\n`;
    md += `| Total Defects | ${trustScore.components.vc_defect_count} |\n`;
  }

  md += `\n## Scan Summary\n\n`;
  md += `- Files scanned: ${scanResult.files_scanned}\n`;
  md += `- Total defects: ${scanResult.total_defects}\n`;
  md += `- P0 (critical): ${scanResult.summary.by_priority["P0"] ?? 0}\n`;
  md += `- P1 (must fix): ${scanResult.summary.by_priority["P1"] ?? 0}\n`;
  md += `- P2 (should fix): ${scanResult.summary.by_priority["P2"] ?? 0}\n`;
  md += `- Overall readiness: ${(scanResult.summary.overall_readiness * 100).toFixed(1)}%\n`;

  if (mfState) {
    md += `\n## Module Status\n\n`;
    md += `| Module | Migration Status | Wave |\n|---|---|---|\n`;
    for (const [name, mod] of Object.entries(mfState.modules)) {
      md += `| ${name} | ${mod.status} | ${mod.wave ?? "-"} |\n`;
    }
  }

  // Defects by dimension
  md += `\n## Defects by Dimension\n\n`;
  md += `| Dimension | Count |\n|---|---|\n`;
  for (const [dim, count] of Object.entries(scanResult.summary.by_dimension)) {
    md += `| ${dim} | ${count} |\n`;
  }

  // Critical files
  if (scanResult.summary.critical_files.length > 0) {
    md += `\n## Critical Files\n\n`;
    for (const f of scanResult.summary.critical_files) {
      md += `- ${f}\n`;
    }
  }

  // Actionable skills
  if (scanResult.actionable_skills.length > 0) {
    md += `\n## Actionable Fix Prompts\n\n`;
    md += `Copy these into Claude Code or Codex to auto-fix:\n\n`;
    for (const skill of scanResult.actionable_skills) {
      md += `### ${skill.name}\n${skill.description}\n\n\`\`\`\n${skill.prompt}\n\`\`\`\n\n`;
    }
  }

  return md;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pathIdx = args.indexOf("--path");
  const mfPath = pathIdx >= 0 ? resolve(args[pathIdx + 1]!) : resolve(".");
  // --module filter reserved for per-module scanning (future use)

  console.log(`\x1b[35m[vibecheck×mf]\x1b[0m Post-migration hardening scan\n`);

  // Read MF state if available
  const mfState = readMFState(mfPath);
  if (mfState) {
    console.log(`  Migration phase: ${mfState.phase}`);
    console.log(`  Current wave: ${mfState.current_wave}`);
    console.log(`  Modules: ${Object.keys(mfState.modules).length}`);
  } else {
    console.log(`  No MigrationForge state found — scanning as standalone project`);
  }

  // Run V2P scan
  console.log(`\n\x1b[35m[vibecheck×mf]\x1b[0m Running production readiness scan...\n`);
  const scanResult = runV2PScan(mfPath);

  if (!scanResult) {
    console.error(`\x1b[31m[vibecheck×mf]\x1b[0m Scan failed — no results produced`);
    process.exit(1);
  }

  // Compute enhanced trust score
  let trustScore: ReturnType<typeof computeEnhancedTrustScore> | null = null;
  if (mfState) {
    trustScore = computeEnhancedTrustScore(mfState, scanResult);
    console.log(`\x1b[35m[vibecheck×mf]\x1b[0m Enhanced Trust Score: ${trustScore.grade} (${trustScore.composite}/100)`);
    console.log(`  ${trustScore.verdict}`);
  }

  // Generate report
  const report = generateIntegrationReport(mfPath, mfState, scanResult, trustScore);

  mkdirSync("reports", { recursive: true });
  const reportPath = "reports/vibecheck-migrationforge-report.md";
  writeFileSync(reportPath, report);
  console.log(`\n\x1b[32m[vibecheck×mf]\x1b[0m Report written to ${reportPath}`);

  // Summary
  console.log(`\n\x1b[35m[vibecheck×mf]\x1b[0m Results:`);
  console.log(`  Files: ${scanResult.files_scanned}`);
  console.log(`  Defects: ${scanResult.total_defects} (${scanResult.summary.by_priority["P0"] ?? 0} P0, ${scanResult.summary.by_priority["P1"] ?? 0} P1)`);
  console.log(`  Readiness: ${(scanResult.summary.overall_readiness * 100).toFixed(1)}%`);
  console.log(`  Skills generated: ${scanResult.actionable_skills.length}`);

  if ((scanResult.summary.by_priority["P0"] ?? 0) > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
