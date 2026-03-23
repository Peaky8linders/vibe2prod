/**
 * scripts/validate-judges.ts — Measure precision + recall vs gold labels
 *
 * Validates L2 LLM judges against human-labeled examples.
 * Tracks true positive rate and true negative rate separately
 * (raw agreement is misleading with imbalanced data).
 *
 * Usage:
 *   npx tsx scripts/validate-judges.ts
 *   npx tsx scripts/validate-judges.ts --threshold 0.85
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface GoldLabel {
  defect_id: string;
  file: string;
  file_content: string;
  human_judgment: boolean;
  notes?: string;
}

interface ValidationResult {
  judge_id: string;
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  agreement: number;
  total: number;
}

async function main(): Promise<void> {
  const threshold = parseFloat(
    process.argv.find((a) => a.startsWith("--threshold="))?.split("=")[1] ?? "0.85"
  );

  const goldPath = join(__dirname, "..", "evals", "gold-labels.json");

  if (!existsSync(goldPath)) {
    console.log("No gold labels found at evals/gold-labels.json");
    console.log("\nTo create gold labels:");
    console.log("  1. Review 50+ examples from your codebase");
    console.log("  2. Label each as pass/fail for each judge dimension");
    console.log("  3. Save as evals/gold-labels.json with schema:");
    console.log("     [{ defect_id, file, file_content, human_judgment: bool }]");
    process.exit(0);
  }

  const goldLabels = JSON.parse(readFileSync(goldPath, "utf-8")) as GoldLabel[];
  console.log(`Loaded ${goldLabels.length} gold labels\n`);

  // Group by defect dimension
  const byDimension = new Map<string, GoldLabel[]>();
  for (const label of goldLabels) {
    const dim = label.defect_id.split("-")[0]!;
    if (!byDimension.has(dim)) byDimension.set(dim, []);
    byDimension.get(dim)!.push(label);
  }

  const results: ValidationResult[] = [];

  for (const [dim, labels] of byDimension) {
    let tp = 0, fp = 0, tn = 0, fn = 0;

    // TODO: Run actual L2 judge against each label's file_content
    // For now, this is the scaffold — replace with actual judge calls
    for (const label of labels) {
      // Placeholder: would call l2-judges.ts judge for this dimension
      const judgeResult = true; // Replace with actual judge call

      if (judgeResult && label.human_judgment) tp++;
      else if (judgeResult && !label.human_judgment) fp++;
      else if (!judgeResult && !label.human_judgment) tn++;
      else fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const agreement = labels.length > 0 ? (tp + tn) / labels.length : 0;

    results.push({
      judge_id: dim,
      true_positives: tp,
      false_positives: fp,
      true_negatives: tn,
      false_negatives: fn,
      precision: Math.round(precision * 1000) / 1000,
      recall: Math.round(recall * 1000) / 1000,
      agreement: Math.round(agreement * 1000) / 1000,
      total: labels.length,
    });
  }

  // Report
  console.log("Judge Validation Results");
  console.log("=".repeat(70));
  console.log(
    "  Judge".padEnd(12) +
    "Precision".padEnd(12) +
    "Recall".padEnd(12) +
    "Agreement".padEnd(12) +
    "N".padEnd(6) +
    "Status"
  );
  console.log("-".repeat(70));

  let allPass = true;
  for (const r of results) {
    const passP = r.precision >= threshold;
    const passR = r.recall >= threshold;
    const status = passP && passR ? "✓ PASS" : "✗ FAIL";
    if (!passP || !passR) allPass = false;

    console.log(
      `  ${r.judge_id.padEnd(10)}` +
      `${String(r.precision).padEnd(12)}` +
      `${String(r.recall).padEnd(12)}` +
      `${String(r.agreement).padEnd(12)}` +
      `${String(r.total).padEnd(6)}` +
      status
    );
  }

  console.log("=".repeat(70));
  console.log(`\nThreshold: ${threshold}`);
  console.log(`Overall: ${allPass ? "ALL JUDGES PASS" : "SOME JUDGES NEED RECALIBRATION"}`);

  if (!allPass) {
    console.log("\nTo fix failing judges:");
    console.log("  1. Review false positives/negatives in gold labels");
    console.log("  2. Iterate judge prompts in evals/l2_judge_prompts/");
    console.log("  3. Re-run this validation");
    process.exit(1);
  }
}

main().catch(console.error);
