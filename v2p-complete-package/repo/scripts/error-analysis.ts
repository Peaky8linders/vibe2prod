/**
 * scripts/error-analysis.ts — Guided error analysis of the hardening loop
 *
 * Reviews reverted fixes from logs/fixes.jsonl, groups by failure reason,
 * and builds a failure mode catalog. Based on Hamel Husain's 7-step
 * error analysis process.
 *
 * Key principle: Let failure categories EMERGE from data review.
 * Never brainstorm categories before reviewing traces.
 *
 * Usage:
 *   npx tsx scripts/error-analysis.ts              # analyze all reverts
 *   npx tsx scripts/error-analysis.ts --detail     # show individual traces
 *   npx tsx scripts/error-analysis.ts --dimension security  # filter
 */

import { readFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FixLogEntry {
  status: "committed" | "reverted" | "crash";
  defect_id?: string;
  reason?: {
    l1?: boolean;
    l2?: boolean;
    behavior?: boolean;
    security?: boolean;
    score?: number;
  };
  baseline?: number;
  new_score?: number;
  delta?: number;
  diff_stat?: string;
  timestamp?: string;
  source?: string;
}

interface FailureCategory {
  name: string;
  description: string;
  count: number;
  defect_ids: string[];
  gate: string;
  examples: FixLogEntry[];
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function categorizeFailure(entry: FixLogEntry): string {
  if (entry.status === "crash") return "eval-crash";

  const reason = entry.reason;
  if (!reason) return "unknown";

  // Determine which gate(s) failed
  const failures: string[] = [];
  if (reason.l1 === false) failures.push("l1");
  if (reason.l2 === false) failures.push("l2");
  if (reason.behavior === false) failures.push("behavioral");
  if (reason.security === false) failures.push("security");

  if (failures.length === 0) {
    // All gates passed but was still reverted — score regression
    return "score-regression";
  }

  if (failures.length > 1) {
    return `multi-gate:${failures.join("+")}`;
  }

  return failures[0]!;
}

function analyzeFixLog(entries: FixLogEntry[], dimensionFilter?: string): {
  categories: FailureCategory[];
  totalAttempts: number;
  totalCommits: number;
  totalReverts: number;
  totalCrashes: number;
  commitRate: number;
} {
  let filtered = entries;
  if (dimensionFilter) {
    filtered = entries.filter((e) => {
      const prefix = e.defect_id?.split("-")[0]?.toLowerCase();
      return prefix === dimensionFilter.toLowerCase() ||
             e.defect_id?.toLowerCase().includes(dimensionFilter.toLowerCase());
    });
  }

  const commits = filtered.filter((e) => e.status === "committed");
  const reverts = filtered.filter((e) => e.status === "reverted");
  const crashes = filtered.filter((e) => e.status === "crash");

  // Categorize reverts
  const categoryMap = new Map<string, FailureCategory>();

  for (const entry of reverts) {
    const category = categorizeFailure(entry);

    if (!categoryMap.has(category)) {
      categoryMap.set(category, {
        name: category,
        description: getCategoryDescription(category),
        count: 0,
        defect_ids: [],
        gate: category,
        examples: [],
      });
    }

    const cat = categoryMap.get(category)!;
    cat.count++;
    if (entry.defect_id) cat.defect_ids.push(entry.defect_id);
    if (cat.examples.length < 3) cat.examples.push(entry);
  }

  // Also categorize crashes
  for (const entry of crashes) {
    if (!categoryMap.has("eval-crash")) {
      categoryMap.set("eval-crash", {
        name: "eval-crash",
        description: "Eval harness crashed during validation",
        count: 0,
        defect_ids: [],
        gate: "harness",
        examples: [],
      });
    }
    const cat = categoryMap.get("eval-crash")!;
    cat.count++;
    if (cat.examples.length < 3) cat.examples.push(entry);
  }

  const categories = Array.from(categoryMap.values())
    .sort((a, b) => b.count - a.count);

  return {
    categories,
    totalAttempts: filtered.length,
    totalCommits: commits.length,
    totalReverts: reverts.length,
    totalCrashes: crashes.length,
    commitRate: filtered.length > 0 ? commits.length / filtered.length : 0,
  };
}

function getCategoryDescription(category: string): string {
  switch (category) {
    case "l1": return "L1 gate failed — tests, types, lint, or secrets check";
    case "l2": return "L2 judge rejected the fix — LLM assessed it as insufficient";
    case "behavioral": return "Behavioral regression — existing functionality broke";
    case "security": return "Security gate failed — new network calls, PII, or auth bypass";
    case "score-regression": return "All gates passed but readiness score decreased";
    case "eval-crash": return "Eval harness crashed — infrastructure issue";
    case "unknown": return "Revert reason not recorded";
    default:
      if (category.startsWith("multi-gate:")) {
        return `Multiple gates failed simultaneously: ${category.replace("multi-gate:", "")}`;
      }
      return category;
  }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function display(
  analysis: ReturnType<typeof analyzeFixLog>,
  showDetail: boolean,
): void {
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const DIM = "\x1b[2m";
  const CYAN = "\x1b[36m";
  const NC = "\x1b[0m";

  console.log(`\n${CYAN}Error Analysis — Hardening Loop Failures${NC}`);
  console.log(`${DIM}Methodology: Hamel Husain, "A Field Guide to Rapidly Improving AI Products"${NC}\n`);

  // Summary
  console.log("Summary:");
  console.log(`  Total attempts:  ${analysis.totalAttempts}`);
  console.log(`  ${GREEN}Committed:${NC}       ${analysis.totalCommits} (${(analysis.commitRate * 100).toFixed(1)}%)`);
  console.log(`  ${RED}Reverted:${NC}        ${analysis.totalReverts}`);
  if (analysis.totalCrashes > 0) {
    console.log(`  ${RED}Crashes:${NC}         ${analysis.totalCrashes}`);
  }

  if (analysis.commitRate < 0.10) {
    console.log(`\n  ${RED}⚠ Commit rate below 10% — defects may need decomposition${NC}`);
  } else if (analysis.commitRate < 0.20) {
    console.log(`\n  ${YELLOW}⚠ Commit rate below 20% — review judge calibration${NC}`);
  }

  if (analysis.categories.length === 0) {
    console.log(`\n  ${GREEN}No failures to analyze.${NC}\n`);
    return;
  }

  // Failure categories (sorted by frequency — most impactful first)
  console.log(`\n${CYAN}Failure Categories${NC} (${analysis.categories.length} categories, sorted by frequency):`);
  console.log("═".repeat(70));

  const totalFailures = analysis.totalReverts + analysis.totalCrashes;

  for (const cat of analysis.categories) {
    const pct = totalFailures > 0 ? ((cat.count / totalFailures) * 100).toFixed(1) : "0";
    const bar = "█".repeat(Math.round(cat.count / totalFailures * 30)).padEnd(30, "░");

    console.log(`\n  ${YELLOW}${cat.name}${NC} — ${cat.count} failures (${pct}%)`);
    console.log(`  ${bar}`);
    console.log(`  ${DIM}${cat.description}${NC}`);

    if (cat.defect_ids.length > 0) {
      const uniqueDefects = [...new Set(cat.defect_ids)];
      console.log(`  ${DIM}Defects: ${uniqueDefects.slice(0, 10).join(", ")}${uniqueDefects.length > 10 ? ` +${uniqueDefects.length - 10} more` : ""}${NC}`);
    }

    if (showDetail && cat.examples.length > 0) {
      console.log(`  ${DIM}Example traces:${NC}`);
      for (const ex of cat.examples) {
        const reason = ex.reason
          ? `L1=${ex.reason.l1} L2=${ex.reason.l2} behavior=${ex.reason.behavior} security=${ex.reason.security}`
          : "no details";
        console.log(`    ${DIM}[${ex.timestamp ?? "?"}] ${ex.defect_id ?? "?"} — ${reason}${NC}`);
      }
    }
  }

  console.log("\n" + "═".repeat(70));

  // Actionable recommendations
  console.log(`\n${CYAN}Recommendations${NC} (fix the most frequent category first):\n`);

  for (const cat of analysis.categories.slice(0, 3)) {
    switch (cat.gate) {
      case "l1":
        console.log(`  ${YELLOW}${cat.name}${NC}: Review L1 failures — are tests flaky? Is the type-checker too strict?`);
        console.log(`    Fix: Check if defects need decomposition into smaller changes.`);
        break;
      case "l2":
        console.log(`  ${YELLOW}${cat.name}${NC}: L2 judge rejections — is the judge too strict or miscalibrated?`);
        console.log(`    Fix: Run vibecheck validate-judges --disagreements to inspect false negatives.`);
        console.log(`    Then adjust judge prompts or add borderline few-shot examples.`);
        break;
      case "behavioral":
        console.log(`  ${YELLOW}${cat.name}${NC}: Behavioral regressions — fixes are breaking existing functionality.`);
        console.log(`    Fix: Decompose defects into smaller, safer changes.`);
        break;
      case "security":
        console.log(`  ${YELLOW}${cat.name}${NC}: Security gate failures — fixes introduce security issues.`);
        console.log(`    Fix: Review if network allowlist or PII patterns need updating.`);
        break;
      case "harness":
        console.log(`  ${YELLOW}${cat.name}${NC}: Eval crashes — infrastructure issue, not a fix quality problem.`);
        console.log(`    Fix: Check harness integrity, Node memory, and test timeouts.`);
        break;
      default:
        if (cat.gate.startsWith("multi-gate:")) {
          console.log(`  ${YELLOW}${cat.name}${NC}: Multiple gates failing — fix is fundamentally wrong approach.`);
          console.log(`    Fix: Rethink the fix strategy for these defects.`);
        }
    }
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const showDetail = process.argv.includes("--detail");
  const dimIdx = process.argv.indexOf("--dimension");
  const dimensionFilter = dimIdx >= 0 ? process.argv[dimIdx + 1] : undefined;

  const logPath = "logs/fixes.jsonl";
  if (!existsSync(logPath)) {
    console.log("No fix history found at logs/fixes.jsonl");
    console.log("Run vibecheck fix or vibecheck run to generate fix attempts first.\n");
    process.exit(0);
  }

  const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  const entries = lines.map((line) => {
    try { return JSON.parse(line) as FixLogEntry; }
    catch { return null; }
  }).filter((e): e is FixLogEntry => e !== null);

  if (entries.length === 0) {
    console.log("Fix log is empty. Run vibecheck fix first.\n");
    process.exit(0);
  }

  const analysis = analyzeFixLog(entries, dimensionFilter);
  display(analysis, showDetail);
}

main();
