/**
 * scripts/comply.ts — Compliance Readiness Assessment
 *
 * Runs all scanners (security + compliance + governance) and produces
 * a three-component compliance readiness score with grade.
 *
 * Usage:
 *   npx tsx scripts/comply.ts --path ../my-app
 *   npx tsx scripts/comply.ts --path ../my-app --report
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { appendEvidence, verifyChain } from "../scanners/evidence-scanner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PURPLE = "\x1b[35m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const NC = "\x1b[0m";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScanEEResult {
  files_scanned: number;
  total_defects: number;
  summary: {
    by_priority: Record<string, number>;
    by_dimension: Record<string, number>;
    overall_readiness: number;
  };
  files: Array<{
    relative_path: string;
    defects: Array<{
      id: string;
      dimension: string;
      priority: string;
      description: string;
      regulation?: string;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pathIdx = args.indexOf("--path");
  const targetPath = pathIdx >= 0 ? resolve(args[pathIdx + 1]!) : resolve(ROOT, "target");
  const doReport = args.includes("--report");

  console.log(`\n${PURPLE}${BOLD}  VIBECHECK COMPLIANCE ASSESSMENT${NC}\n`);

  // Step 1: Run the e2e scan (which now includes compliance + governance plugins)
  console.log(`${DIM}  Running full scan with compliance plugins...${NC}\n`);

  const scriptPath = resolve(ROOT, "scripts/scan-e2e.ts");
  const cmd = `npx tsx "${scriptPath}" --path "${targetPath}" --report`;
  spawnSync(cmd, [], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 120_000,
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  const resultPath = resolve(ROOT, "reports", "scan-e2e-result.json");
  if (!existsSync(resultPath)) {
    console.error(`${RED}  Scan failed — no results produced${NC}`);
    process.exit(1);
  }

  const scan: ScanEEResult = JSON.parse(readFileSync(resultPath, "utf-8"));

  // Step 2: Compute compliance readiness score
  const dims = scan.summary.by_dimension;

  // Security dimensions (existing V2P)
  const securityDims = ["security", "error-handling", "input-validation", "observability", "data-integrity"];
  const securityDefects = securityDims.reduce((sum, d) => sum + (dims[d] ?? 0), 0);
  const securityMax = scan.files_scanned * 5; // max possible defects
  const securityScore = Math.round(Math.max(0, 40 * (1 - securityDefects / Math.max(securityMax, 1))));

  // Compliance dimensions (new plugins)
  const complianceDims = ["ai-safety", "human-oversight", "transparency", "audit-logging",
    "data-privacy", "fairness", "documentation", "supply-chain", "monitoring"];
  const complianceDefects = complianceDims.reduce((sum, d) => sum + (dims[d] ?? 0), 0);
  const complianceMax = scan.files_scanned * 3;
  const complianceScore = Math.round(Math.max(0, 30 * (1 - complianceDefects / Math.max(complianceMax, 1))));

  // Evidence score (based on chain existence and integrity)
  const chainResult = verifyChain(resolve(ROOT, "logs", "evidence-chain.jsonl"));
  let evidenceScore = 10; // Base: having any chain at all
  if (chainResult.entries > 0) evidenceScore += 10; // Has history
  if (chainResult.valid) evidenceScore += 10; // Chain integrity verified

  const total = securityScore + complianceScore + evidenceScore;
  const grade = total >= 90 ? "A" : total >= 75 ? "B" : total >= 60 ? "C" : total >= 40 ? "D" : "F";
  const p0Count = scan.summary.by_priority["P0"] ?? 0;

  let verdict: string;
  if (p0Count > 0) verdict = `${RED}BLOCKED — ${p0Count} P0 defects must be fixed${NC}`;
  else if (total >= 75) verdict = `${GREEN}READY — production deployment approved${NC}`;
  else if (total >= 60) verdict = `${YELLOW}CONDITIONAL — fix P1 defects before production${NC}`;
  else verdict = `${RED}NOT READY — significant hardening required${NC}`;

  // Step 3: Display results
  console.log(`  ${"═".repeat(50)}`);
  console.log(`  ${BOLD}COMPLIANCE READINESS REPORT${NC}`);
  console.log(`  ${"═".repeat(50)}`);
  console.log(`  Security Score:     ${securityScore}/40  ${DIM}(hardening dimensions)${NC}`);
  console.log(`  Compliance Score:   ${complianceScore}/30  ${DIM}(AI governance, transparency)${NC}`);
  console.log(`  Evidence Score:     ${evidenceScore}/30  ${DIM}(audit trail completeness)${NC}`);
  console.log(`  ${"─".repeat(50)}`);
  console.log(`  ${BOLD}Total:               ${total}/100${NC}`);
  console.log(`  ${BOLD}Grade:               ${grade}${NC}`);
  console.log(`  Verdict:            ${verdict}`);
  console.log();

  // Show compliance gaps
  const complianceGaps = scan.files.flatMap((f) =>
    f.defects.filter((d) =>
      complianceDims.includes(d.dimension) || ["access-control", "secrets-management", "incident-response"].includes(d.dimension)
    )
  );

  if (complianceGaps.length > 0) {
    console.log(`  ${BOLD}Compliance Gaps:${NC}`);
    // Deduplicate by id
    const seen = new Set<string>();
    const unique = complianceGaps.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });

    for (const gap of unique.slice(0, 10)) {
      const color = gap.priority === "P0" ? RED : gap.priority === "P1" ? YELLOW : DIM;
      const reg = gap.regulation ? ` ${DIM}(${gap.regulation})${NC}` : "";
      console.log(`  ${color}[${gap.priority}]${NC} ${gap.description}${reg}`);
    }
    if (unique.length > 10) {
      console.log(`  ${DIM}  ... and ${unique.length - 10} more${NC}`);
    }
  }

  // Evidence chain status
  console.log(`\n  ${BOLD}Evidence Chain:${NC}`);
  console.log(`  ${chainResult.valid ? GREEN + "✓" : RED + "✗"} ${chainResult.summary}${NC}`);

  // Step 4: Record in evidence chain
  appendEvidence("comply", {
    security_score: securityScore,
    compliance_score: complianceScore,
    evidence_score: evidenceScore,
    total,
    grade,
    p0_count: p0Count,
    files_scanned: scan.files_scanned,
    total_defects: scan.total_defects,
  }, resolve(ROOT, "logs", "evidence-chain.jsonl"));

  // Step 5: Write report if requested
  if (doReport) {
    let md = `# VibeCheck Compliance Readiness Report\n\n`;
    md += `**Project:** ${targetPath}\n`;
    md += `**Date:** ${new Date().toISOString()}\n`;
    md += `**Grade:** ${grade} (${total}/100)\n\n`;
    md += `## Scores\n\n`;
    md += `| Component | Score | Description |\n|---|---|---|\n`;
    md += `| Security | ${securityScore}/40 | Hardening dimensions (security, error-handling, etc.) |\n`;
    md += `| Compliance | ${complianceScore}/30 | AI governance, transparency, human oversight |\n`;
    md += `| Evidence | ${evidenceScore}/30 | Audit trail completeness and integrity |\n`;
    md += `| **Total** | **${total}/100** | **Grade: ${grade}** |\n\n`;

    if (complianceGaps.length > 0) {
      md += `## Compliance Gaps\n\n`;
      const seen2 = new Set<string>();
      for (const gap of complianceGaps) {
        if (seen2.has(gap.id)) continue;
        seen2.add(gap.id);
        md += `- **[${gap.priority}] ${gap.id}:** ${gap.description}`;
        if (gap.regulation) md += ` *(${gap.regulation})*`;
        md += `\n`;
      }
    }

    md += `\n## Evidence Chain\n\n${chainResult.summary}\n`;

    mkdirSync("reports", { recursive: true });
    writeFileSync("reports/compliance-report.md", md);
    console.log(`\n  ${GREEN}Report written to reports/compliance-report.md${NC}`);
  }

  console.log();

  if (p0Count > 0) process.exit(1);
}

main().catch(console.error);
