/**
 * judges/production-accuracy.ts — Track judge decisions vs production outcomes
 *
 * When an eval judge approves a fix that later fails in production,
 * that judge is flagged for recalibration. Uses rate-based thresholds
 * (not absolute counts) to avoid penalizing high-volume accurate judges.
 *
 * Flagging criteria:
 *   - false_positives / total_evaluations > 5% AND total_evaluations >= 10
 *
 * Usage:
 *   npx tsx judges/production-accuracy.ts              # show audit report
 *   npx tsx judges/production-accuracy.ts --flag        # auto-flag failing judges
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FixLog {
  status: string;
  defect_id?: string;
  source?: string;
  approved_by?: string;
  timestamp?: string;
}

interface JudgeRecord {
  judge_id: string;
  total_evaluations: number;
  approved_fixes: number;
  production_failures: number;
  false_positive_rate: number;
  flagged: boolean;
  flag_reason?: string;
  defect_ids_approved: string[];
  defect_ids_failed: string[];
}

interface DefectEntry {
  id: string;
  dimension: string;
  source?: string;
  fixed: boolean;
  fix_commit?: string;
}

// ---------------------------------------------------------------------------
// Judge Tracking
// ---------------------------------------------------------------------------

function buildJudgeRecords(): JudgeRecord[] {
  const fixLogPath = "logs/fixes.jsonl";
  if (!existsSync(fixLogPath)) return [];

  const lines = readFileSync(fixLogPath, "utf-8").trim().split("\n").filter(Boolean);
  const fixes = lines.map((line) => {
    try { return JSON.parse(line) as FixLog; }
    catch { return null; }
  }).filter((f): f is FixLog => f !== null);

  // Build judge → evaluations map
  const judges = new Map<string, JudgeRecord>();

  // Track all committed fixes and their approving judges
  for (const fix of fixes) {
    if (fix.status !== "committed" || !fix.approved_by) continue;

    const judgeId = fix.approved_by;
    if (!judges.has(judgeId)) {
      judges.set(judgeId, {
        judge_id: judgeId,
        total_evaluations: 0,
        approved_fixes: 0,
        production_failures: 0,
        false_positive_rate: 0,
        flagged: false,
        defect_ids_approved: [],
        defect_ids_failed: [],
      });
    }

    const record = judges.get(judgeId)!;
    record.total_evaluations++;
    record.approved_fixes++;
    if (fix.defect_id) {
      record.defect_ids_approved.push(fix.defect_id);
    }
  }

  // Cross-reference with production-discovered defects that match previously "fixed" defects
  const taxPath = "evals/defect-taxonomy.json";
  if (existsSync(taxPath)) {
    const taxonomy = JSON.parse(readFileSync(taxPath, "utf-8")) as {
      dimensions: Record<string, { defects: DefectEntry[] }>;
    };

    // Find judge-failure defects
    const judgeFailures = Object.values(taxonomy.dimensions)
      .flatMap((dim) => dim.defects)
      .filter((d) => d.source === "judge-failure" || d.source === "production");

    // Match production failures back to the judge that approved the original fix
    for (const failure of judgeFailures) {
      // Find which judge approved the original fix for a similar defect
      for (const [_judgeId, record] of judges) {
        // Simple heuristic: if the production failure is in the same dimension
        // as a defect the judge approved, count it as a potential false positive
        const relatedApprovals = record.defect_ids_approved.filter((id) => {
          const dimPrefix = id.split("-")[0];
          const failurePrefix = failure.id.split("-")[0];
          return dimPrefix === failurePrefix;
        });

        if (relatedApprovals.length > 0) {
          record.production_failures++;
          record.defect_ids_failed.push(failure.id);
        }
      }
    }
  }

  // Calculate false positive rates and flag
  for (const record of judges.values()) {
    record.false_positive_rate = record.total_evaluations > 0
      ? Math.round((record.production_failures / record.total_evaluations) * 1000) / 1000
      : 0;

    // Rate-based flagging (not absolute count)
    if (record.false_positive_rate > 0.05 && record.total_evaluations >= 10) {
      record.flagged = true;
      record.flag_reason = `${(record.false_positive_rate * 100).toFixed(1)}% false positive rate (${record.production_failures}/${record.total_evaluations}) exceeds 5% threshold`;
    } else if (record.production_failures >= 3 && record.total_evaluations < 10) {
      record.flagged = true;
      record.flag_reason = `${record.production_failures} false positives on only ${record.total_evaluations} evaluations — insufficient sample but high failure count`;
    }
  }

  return Array.from(judges.values()).sort((a, b) => b.false_positive_rate - a.false_positive_rate);
}

// ---------------------------------------------------------------------------
// Also check L2 judge prompts for dimension coverage
// ---------------------------------------------------------------------------

function getJudgeDimensions(): string[] {
  const promptDir = "evals/l2_judge_prompts";
  if (!existsSync(promptDir)) return [];

  return (readdirSync(promptDir) as string[])
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function displayAudit(records: JudgeRecord[]): void {
  const RED = "\x1b[31m";
  const GREEN = "\x1b[32m";
  const DIM = "\x1b[2m";
  const NC = "\x1b[0m";

  console.log(`\n${GREEN}Judge Accountability Audit${NC}`);
  console.log("═".repeat(70));
  console.log(`  ${"Judge".padEnd(25)} ${"Evals".padEnd(8)} ${"Approved".padEnd(10)} ${"Failures".padEnd(10)} ${"FP Rate".padEnd(10)} Status`);
  console.log("─".repeat(70));

  if (records.length === 0) {
    console.log(`  ${DIM}No judge records found. Fixes need 'approved_by' field in logs.${NC}`);
    console.log(`  ${DIM}This is populated automatically when the fix loop records which judge approved each fix.${NC}`);
  }

  for (const record of records) {
    const statusColor = record.flagged ? RED : GREEN;
    const status = record.flagged ? "⛔ FLAGGED" : "✓ OK";
    const fpDisplay = `${(record.false_positive_rate * 100).toFixed(1)}%`;

    console.log(
      `  ${record.judge_id.padEnd(25)} ${String(record.total_evaluations).padEnd(8)} ${String(record.approved_fixes).padEnd(10)} ${String(record.production_failures).padEnd(10)} ${fpDisplay.padEnd(10)} ${statusColor}${status}${NC}`,
    );

    if (record.flagged && record.flag_reason) {
      console.log(`  ${DIM}  ↳ ${record.flag_reason}${NC}`);
    }
  }

  console.log("═".repeat(70));

  // Summary
  const flagged = records.filter((r) => r.flagged);
  if (flagged.length > 0) {
    console.log(`\n  ${RED}${flagged.length} judge(s) flagged for recalibration${NC}`);
    console.log(`  ${DIM}Review and adjust judge prompts in evals/l2_judge_prompts/${NC}`);
  } else if (records.length > 0) {
    console.log(`\n  ${GREEN}All judges within acceptable false positive rates${NC}`);
  }

  // Show available dimensions
  const dimensions = getJudgeDimensions();
  if (dimensions.length > 0) {
    console.log(`\n  ${DIM}Judge dimensions: ${dimensions.join(", ")}${NC}`);
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const autoFlag = process.argv.includes("--flag");

  const records = buildJudgeRecords();
  displayAudit(records);

  if (autoFlag) {
    const flagged = records.filter((r) => r.flagged);
    if (flagged.length > 0) {
      const reportPath = "logs/judge-audit.json";
      writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        judges_audited: records.length,
        judges_flagged: flagged.length,
        records,
      }, null, 2));
      console.log(`Audit report written to ${reportPath}`);
    }
  }
}

main();
