/**
 * scripts/validate-judges.ts — Validate L2 judges using Hamel Husain's methodology
 *
 * Measures True Positive Rate (TPR) and True Negative Rate (TNR) separately
 * — raw accuracy is misleading on imbalanced data.
 *
 * Features:
 *   - Train/Dev/Test split (10%/45%/45%) with data leakage prevention
 *   - TPR + TNR validation (target: both >90%, minimum >80%)
 *   - Rogan-Gladen bias correction for production estimates
 *   - Bootstrap confidence intervals
 *   - Disagrement inspection for judge improvement
 *
 * Methodology: Hamel Husain, "Using LLM-as-a-Judge: A Complete Guide"
 *
 * Usage:
 *   npx tsx scripts/validate-judges.ts                    # validate all judges
 *   npx tsx scripts/validate-judges.ts --split            # show data split stats
 *   npx tsx scripts/validate-judges.ts --disagreements    # show all disagreements
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoldLabel {
  defect_id: string;
  dimension: string;
  file: string;
  file_content: string;
  human_judgment: boolean;
  notes?: string;
  split?: "train" | "dev" | "test";
}

interface ValidationResult {
  judge_id: string;
  tpr: number;               // True Positive Rate (sensitivity)
  tnr: number;               // True Negative Rate (specificity)
  accuracy: number;           // Raw accuracy (for reference, NOT primary metric)
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  total: number;
  corrected_pass_rate: number | null; // Rogan-Gladen corrected
  ci_lower: number | null;           // 95% CI lower bound
  ci_upper: number | null;           // 95% CI upper bound
  disagreements: Array<{
    defect_id: string;
    human: boolean;
    judge: boolean;
    file: string;
  }>;
}

// ---------------------------------------------------------------------------
// Data Splitting (deterministic, based on defect_id hash)
// ---------------------------------------------------------------------------

function assignSplit(label: GoldLabel): "train" | "dev" | "test" {
  // Deterministic split based on hash of defect_id
  let hash = 0;
  for (let i = 0; i < label.defect_id.length; i++) {
    hash = ((hash << 5) - hash + label.defect_id.charCodeAt(i)) | 0;
  }
  const bucket = Math.abs(hash) % 100;

  if (bucket < 10) return "train";    // 10% — source of few-shot examples
  if (bucket < 55) return "dev";      // 45% — iterative judge refinement
  return "test";                       // 45% — held-out, evaluate once
}

// ---------------------------------------------------------------------------
// Rogan-Gladen Bias Correction
// ---------------------------------------------------------------------------

function roganGladenCorrection(
  observedPassRate: number,
  tpr: number,
  tnr: number,
): number | null {
  const denominator = tpr + tnr - 1;
  if (Math.abs(denominator) < 0.001) return null; // Degenerate case
  return (observedPassRate + tnr - 1) / denominator;
}

// ---------------------------------------------------------------------------
// Bootstrap Confidence Intervals
// ---------------------------------------------------------------------------

function bootstrapCI(
  labels: Array<{ human: boolean; judge: boolean }>,
  tpr: number,
  tnr: number,
  nBootstrap = 1000,
): { lower: number; upper: number } | null {
  if (labels.length < 10) return null;

  const correctedRates: number[] = [];

  for (let b = 0; b < nBootstrap; b++) {
    // Resample with replacement
    const sample: Array<{ human: boolean; judge: boolean }> = [];
    for (let i = 0; i < labels.length; i++) {
      sample.push(labels[Math.floor(Math.random() * labels.length)]!);
    }

    const passRate = sample.filter((s) => s.judge).length / sample.length;
    const corrected = roganGladenCorrection(passRate, tpr, tnr);
    if (corrected !== null) {
      correctedRates.push(Math.max(0, Math.min(1, corrected)));
    }
  }

  if (correctedRates.length === 0) return null;

  correctedRates.sort((a, b) => a - b);
  const lower = correctedRates[Math.floor(correctedRates.length * 0.025)]!;
  const upper = correctedRates[Math.floor(correctedRates.length * 0.975)]!;

  return { lower, upper };
}

// ---------------------------------------------------------------------------
// Heuristic Judge (mirrors l2-judges.ts fallback)
// ---------------------------------------------------------------------------

function heuristicJudge(dimension: string, fileContent: string): boolean {
  const dim = dimension.toLowerCase();

  if (dim.includes("error")) {
    return /try\s*\{/.test(fileContent) && /catch\s*\(/.test(fileContent) &&
           !/catch\s*\(\s*\w+\s*\)\s*\{[\s\n]*\}/.test(fileContent);
  }
  if (dim.includes("validation") || dim.includes("input")) {
    return /z\.(string|number|object|array|boolean)|safeParse|Joi\.|yup\./.test(fileContent);
  }
  if (dim.includes("observ") || dim.includes("log")) {
    return /logger\.\w+|log\.\w+|winston|pino|bunyan/.test(fileContent);
  }
  if (dim.includes("security") || dim.includes("auth")) {
    return /requireAuth|authenticate|authorize|middleware.*auth|jwt|bearer/i.test(fileContent);
  }
  if (dim.includes("subtract")) {
    return true; // Default pass for subtraction — needs context
  }

  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const showDisagreements = process.argv.includes("--disagreements");
  const showSplit = process.argv.includes("--split");

  const goldPath = join(__dirname, "..", "evals", "gold-labels.json");

  if (!existsSync(goldPath)) {
    console.log("No gold labels found at evals/gold-labels.json\n");
    console.log("To create gold labels (Hamel Husain methodology):");
    console.log("  1. Collect 50+ representative code samples from your target");
    console.log("  2. A domain expert labels each as pass/fail per dimension");
    console.log("  3. Include borderline cases — these are most valuable");
    console.log("  4. Save as evals/gold-labels.json:");
    console.log('     { "labels": [{ defect_id, dimension, file, file_content, human_judgment }] }');
    console.log("\n  Labels are auto-split: 10% train (few-shot source), 45% dev, 45% test");
    process.exit(0);
  }

  const goldData = JSON.parse(readFileSync(goldPath, "utf-8")) as {
    labels: GoldLabel[];
  };

  const goldLabels = goldData.labels ?? [];

  if (goldLabels.length === 0) {
    console.log("Gold labels file exists but contains no labels.");
    console.log("Add labeled examples to evals/gold-labels.json");
    process.exit(0);
  }

  // Assign splits
  for (const label of goldLabels) {
    label.split = assignSplit(label);
  }

  console.log(`Loaded ${goldLabels.length} gold labels\n`);

  if (showSplit) {
    const train = goldLabels.filter((l) => l.split === "train");
    const dev = goldLabels.filter((l) => l.split === "dev");
    const test = goldLabels.filter((l) => l.split === "test");
    console.log("Data Split:");
    console.log(`  Train: ${train.length} (${((train.length / goldLabels.length) * 100).toFixed(0)}%) — few-shot example source`);
    console.log(`  Dev:   ${dev.length} (${((dev.length / goldLabels.length) * 100).toFixed(0)}%) — iterative judge refinement`);
    console.log(`  Test:  ${test.length} (${((test.length / goldLabels.length) * 100).toFixed(0)}%) — held-out validation\n`);
  }

  // Use dev split for iterative validation, test for final
  // Default to dev split (use --test for held-out)
  const useTest = process.argv.includes("--test");
  const evalLabels = goldLabels.filter((l) => l.split === (useTest ? "test" : "dev"));

  if (evalLabels.length === 0) {
    console.log(`No labels in ${useTest ? "test" : "dev"} split. Need more labeled examples.`);
    process.exit(0);
  }

  console.log(`Evaluating on ${useTest ? "TEST" : "DEV"} split (${evalLabels.length} labels)\n`);

  // Group by dimension
  const byDimension = new Map<string, GoldLabel[]>();
  for (const label of evalLabels) {
    const dim = label.dimension ?? label.defect_id.split("-")[0]!;
    if (!byDimension.has(dim)) byDimension.set(dim, []);
    byDimension.get(dim)!.push(label);
  }

  const results: ValidationResult[] = [];

  for (const [dim, labels] of byDimension) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    const disagreements: ValidationResult["disagreements"] = [];
    const judgeResults: Array<{ human: boolean; judge: boolean }> = [];

    for (const label of labels) {
      const judgeResult = heuristicJudge(dim, label.file_content);

      judgeResults.push({ human: label.human_judgment, judge: judgeResult });

      if (judgeResult && label.human_judgment) tp++;
      else if (judgeResult && !label.human_judgment) { fp++; disagreements.push({ defect_id: label.defect_id, human: false, judge: true, file: label.file }); }
      else if (!judgeResult && !label.human_judgment) tn++;
      else { fn++; disagreements.push({ defect_id: label.defect_id, human: true, judge: false, file: label.file }); }
    }

    // TPR = TP / (TP + FN) — When human says pass, judge agrees
    const tpr = (tp + fn) > 0 ? tp / (tp + fn) : 1;
    // TNR = TN / (TN + FP) — When human says fail, judge agrees
    const tnr = (tn + fp) > 0 ? tn / (tn + fp) : 1;
    const accuracy = labels.length > 0 ? (tp + tn) / labels.length : 0;

    // Rogan-Gladen bias correction
    const observedPassRate = (tp + fp) / labels.length;
    const corrected = roganGladenCorrection(observedPassRate, tpr, tnr);

    // Bootstrap CI
    const ci = bootstrapCI(judgeResults, tpr, tnr);

    results.push({
      judge_id: dim,
      tpr: Math.round(tpr * 1000) / 1000,
      tnr: Math.round(tnr * 1000) / 1000,
      accuracy: Math.round(accuracy * 1000) / 1000,
      true_positives: tp,
      false_positives: fp,
      true_negatives: tn,
      false_negatives: fn,
      total: labels.length,
      corrected_pass_rate: corrected !== null ? Math.round(corrected * 1000) / 1000 : null,
      ci_lower: ci ? Math.round(ci.lower * 1000) / 1000 : null,
      ci_upper: ci ? Math.round(ci.upper * 1000) / 1000 : null,
      disagreements,
    });
  }

  // Report
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const DIM = "\x1b[2m";
  const NC = "\x1b[0m";

  console.log("Judge Validation Results (Hamel Husain Methodology)");
  console.log("═".repeat(78));
  console.log(
    `  ${"Judge".padEnd(16)}${"TPR".padEnd(8)}${"TNR".padEnd(8)}${"Acc".padEnd(8)}${"TP".padEnd(5)}${"FP".padEnd(5)}${"TN".padEnd(5)}${"FN".padEnd(5)}${"N".padEnd(5)}Status`,
  );
  console.log("─".repeat(78));

  let allPass = true;
  for (const r of results) {
    const tprOk = r.tpr >= 0.80;
    const tnrOk = r.tnr >= 0.80;
    const tprGood = r.tpr >= 0.90;
    const tnrGood = r.tnr >= 0.90;

    const status = tprGood && tnrGood ? `${GREEN}✓ PASS${NC}` :
                   tprOk && tnrOk ? `${YELLOW}⚠ MARGINAL${NC}` :
                   `${RED}✗ FAIL${NC}`;
    if (!tprOk || !tnrOk) allPass = false;

    const tprColor = tprGood ? GREEN : tprOk ? YELLOW : RED;
    const tnrColor = tnrGood ? GREEN : tnrOk ? YELLOW : RED;

    console.log(
      `  ${r.judge_id.padEnd(16)}${tprColor}${String(r.tpr).padEnd(8)}${NC}${tnrColor}${String(r.tnr).padEnd(8)}${NC}${DIM}${String(r.accuracy).padEnd(8)}${NC}${String(r.true_positives).padEnd(5)}${String(r.false_positives).padEnd(5)}${String(r.true_negatives).padEnd(5)}${String(r.false_negatives).padEnd(5)}${String(r.total).padEnd(5)}${status}`,
    );

    if (r.corrected_pass_rate !== null) {
      const ciStr = r.ci_lower !== null && r.ci_upper !== null
        ? ` [${(r.ci_lower * 100).toFixed(1)}%, ${(r.ci_upper * 100).toFixed(1)}%]`
        : "";
      console.log(`  ${DIM}  Rogan-Gladen corrected pass rate: ${(r.corrected_pass_rate * 100).toFixed(1)}%${ciStr}${NC}`);
    }
  }

  console.log("═".repeat(78));
  console.log(`\n  ${DIM}TPR = When human says PASS, judge agrees (target: >90%, min: >80%)${NC}`);
  console.log(`  ${DIM}TNR = When human says FAIL, judge agrees (target: >90%, min: >80%)${NC}`);
  console.log(`  ${DIM}Acc = Raw accuracy (reference only — do NOT use for judge quality)${NC}`);
  console.log(`  ${DIM}Rogan-Gladen = Bias-corrected estimate of true pass rate in production${NC}\n`);

  if (showDisagreements) {
    console.log("Disagreements (inspect each to improve judge prompts):");
    console.log("─".repeat(78));
    for (const r of results) {
      if (r.disagreements.length === 0) continue;
      console.log(`\n  ${r.judge_id}:`);
      for (const d of r.disagreements) {
        const type = d.human && !d.judge ? `${RED}False Negative${NC}` : `${YELLOW}False Positive${NC}`;
        console.log(`    ${type} ${d.defect_id} — ${d.file}`);
        console.log(`      ${DIM}Human: ${d.human ? "PASS" : "FAIL"}, Judge: ${d.judge ? "PASS" : "FAIL"}${NC}`);
      }
    }
  }

  if (!allPass) {
    console.log(`\n  ${RED}Some judges below threshold.${NC} To improve:`);
    console.log("  1. Run with --disagreements to see every mismatch");
    console.log("  2. Review false positives (judge too lenient) → tighten pass_criteria");
    console.log("  3. Review false negatives (judge too strict) → add borderline examples");
    console.log("  4. Re-run validation. Iterate until TPR+TNR both >90%.");
    console.log("  5. Then run with --test for held-out validation (once only).\n");
    process.exit(1);
  } else {
    console.log(`  ${GREEN}All judges pass TPR+TNR validation.${NC}\n`);
  }
}

main().catch(console.error);
