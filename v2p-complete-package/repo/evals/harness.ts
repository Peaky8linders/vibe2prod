/**
 * evals/harness.ts — Orchestrates all eval levels
 *
 * READ-ONLY TO AGENT. This file must not be modified by the hardening agent.
 * Integrity is verified via SHA-256 hash on every run.
 *
 * Returns structured JSON:
 * {
 *   l1: { passed: boolean, failures: string[] },
 *   l2: { passed: boolean, pass_rate: number, results: JudgeResult[] },
 *   behavioral: { preserved: boolean, regressions: string[] },
 *   security: { passed: boolean, findings: string[] },
 *   readiness_score: number,
 *   baseline_score: number,
 *   timestamp: string,
 *   commit: string
 * }
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { runL1Assertions, type L1Result } from "./l1-assertions.js";
import { runL2Judges, type L2Result } from "./l2-judges.js";
import { runSecurityGates, type SecurityResult } from "./security-gates.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const HarnessResultSchema = z.object({
  l1: z.object({
    passed: z.boolean(),
    failures: z.array(z.string()),
  }),
  l2: z.object({
    passed: z.boolean(),
    pass_rate: z.number(),
    results: z.array(
      z.object({
        defect_id: z.string(),
        judge: z.string(),
        passed: z.boolean(),
        reasoning: z.string(),
      })
    ),
  }),
  behavioral: z.object({
    preserved: z.boolean(),
    regressions: z.array(z.string()),
  }),
  security: z.object({
    passed: z.boolean(),
    findings: z.array(z.string()),
  }),
  readiness_score: z.number(),
  baseline_score: z.number(),
  timestamp: z.string(),
  commit: z.string(),
});

export type HarnessResult = z.infer<typeof HarnessResultSchema>;

// ---------------------------------------------------------------------------
// Integrity Check
// ---------------------------------------------------------------------------

function verifyEvalIntegrity(): void {
  const integrityFile = new URL("../.eval-integrity", import.meta.url);
  if (!existsSync(integrityFile)) {
    console.warn(
      "[harness] No .eval-integrity file found. Run scripts/seal-evals.sh to create one."
    );
    return;
  }

  try {
    const expected = readFileSync(integrityFile, "utf-8").trim();
    const actual = execSync(
      `find evals/ -type f -name '*.ts' -o -name '*.json' | sort | xargs sha256sum | sha256sum`,
      { encoding: "utf-8" }
    ).trim();

    if (actual !== expected) {
      console.error("[harness] INTEGRITY VIOLATION — eval files have been modified.");
      console.error(`  Expected: ${expected}`);
      console.error(`  Actual:   ${actual}`);
      process.exit(1);
    }
  } catch {
    console.warn("[harness] Integrity check skipped (seal not yet generated).");
  }
}

// ---------------------------------------------------------------------------
// Behavioral Preservation
// ---------------------------------------------------------------------------

interface BehavioralResult {
  preserved: boolean;
  regressions: string[];
}

async function checkBehavioralPreservation(): Promise<BehavioralResult> {
  const snapshotPath = new URL("./behavioral-snapshots.json", import.meta.url);

  if (!existsSync(snapshotPath)) {
    console.warn("[harness] No behavioral snapshots found. Skipping behavioral check.");
    return { preserved: true, regressions: [] };
  }

  const snapshots = JSON.parse(readFileSync(snapshotPath, "utf-8")) as Array<{
    id: string;
    command: string;
    expected_stdout_contains?: string[];
    expected_exit_code?: number;
  }>;

  const regressions: string[] = [];

  for (const snap of snapshots) {
    try {
      const result = execSync(snap.command, {
        encoding: "utf-8",
        timeout: 30_000,
        cwd: "target",
      });

      if (snap.expected_exit_code !== undefined && snap.expected_exit_code !== 0) {
        regressions.push(`${snap.id}: expected non-zero exit but command succeeded`);
        continue;
      }

      if (snap.expected_stdout_contains) {
        for (const needle of snap.expected_stdout_contains) {
          if (!result.includes(needle)) {
            regressions.push(`${snap.id}: output missing expected string "${needle}"`);
          }
        }
      }
    } catch (err: unknown) {
      const exitCode =
        err && typeof err === "object" && "status" in err
          ? (err as { status: number }).status
          : 1;

      if (snap.expected_exit_code !== undefined && snap.expected_exit_code === exitCode) {
        continue; // expected failure
      }

      regressions.push(`${snap.id}: command failed with exit code ${exitCode}`);
    }
  }

  return {
    preserved: regressions.length === 0,
    regressions,
  };
}

// ---------------------------------------------------------------------------
// Readiness Score
// ---------------------------------------------------------------------------

function computeReadinessScore(
  l1: L1Result,
  l2: L2Result,
  security: SecurityResult,
  behavioral: BehavioralResult
): number {
  // Weighted composite:
  //   L1 (hard gates):   30% — binary, all-or-nothing
  //   L2 (judge rate):   30% — continuous 0-1
  //   Security:          25% — binary, all-or-nothing
  //   Behavioral:        15% — binary, all-or-nothing
  const l1Score = l1.passed ? 1.0 : 0.0;
  const l2Score = l2.pass_rate;
  const secScore = security.passed ? 1.0 : 0.0;
  const behScore = behavioral.preserved ? 1.0 : 0.0;

  return Math.round((l1Score * 0.3 + l2Score * 0.3 + secScore * 0.25 + behScore * 0.15) * 1000) / 1000;
}

function getBaselineScore(): number {
  const baselinePath = new URL("../.baseline-score", import.meta.url);
  if (existsSync(baselinePath)) {
    return parseFloat(readFileSync(baselinePath, "utf-8").trim());
  }
  return 0;
}

function getCurrentCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "no-git";
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runHarness(): Promise<HarnessResult> {
  verifyEvalIntegrity();

  console.log("[harness] Running L1 assertions...");
  const l1 = await runL1Assertions();

  console.log("[harness] Running security gates...");
  const security = await runSecurityGates();

  console.log("[harness] Running L2 judges...");
  const l2 = await runL2Judges();

  console.log("[harness] Checking behavioral preservation...");
  const behavioral = await checkBehavioralPreservation();

  const readiness_score = computeReadinessScore(l1, l2, security, behavioral);
  const baseline_score = getBaselineScore();

  const result: HarnessResult = {
    l1: { passed: l1.passed, failures: l1.failures },
    l2: { passed: l2.passed, pass_rate: l2.pass_rate, results: l2.results },
    behavioral,
    security: { passed: security.passed, findings: security.findings },
    readiness_score,
    baseline_score,
    timestamp: new Date().toISOString(),
    commit: getCurrentCommit(),
  };

  // Validate our own output
  HarnessResultSchema.parse(result);

  return result;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  runHarness()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.l1.passed && result.l2.passed && result.security.passed && result.behavioral.preserved ? 0 : 1);
    })
    .catch((err) => {
      console.error("[harness] Fatal error:", err);
      process.exit(2);
    });
}
