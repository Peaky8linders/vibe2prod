/**
 * scripts/capture-behavior.ts — Snapshot existing prototype behavior
 *
 * Run this BEFORE any hardening begins. Captures the prototype's current
 * behavior as a set of contracts that all subsequent fixes must preserve.
 *
 * Strategies:
 *   1. Auto-detect test commands and capture their output
 *   2. Auto-detect API endpoints and snapshot responses (if server can be started)
 *   3. Manual entries from behavioral-snapshots.json
 *
 * Usage:
 *   npx tsx scripts/capture-behavior.ts
 *   npx tsx scripts/capture-behavior.ts --with-server  # also start server and snapshot APIs
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

interface BehavioralSnapshot {
  id: string;
  type: "command" | "api" | "manual";
  description: string;
  command: string;
  expected_exit_code?: number;
  expected_stdout_contains?: string[];
  captured_at: string;
}

async function main(): Promise<void> {
  const snapshots: BehavioralSnapshot[] = [];
  let snapId = 0;
  const nextId = () => `BEH-${String(++snapId).padStart(3, "0")}`;

  console.log("Capturing behavioral baseline for target/...\n");

  // 1. Check if test suite exists and capture its passing state
  const packageJsonPath = "target/package.json";
  if (existsSync(packageJsonPath)) {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      scripts?: Record<string, string>;
    };

    if (pkg.scripts?.["test"]) {
      console.log("  Found test script — capturing baseline test pass...");

      try {
        execSync("npm test", { cwd: "target", timeout: 120_000, encoding: "utf-8" });
        snapshots.push({
          id: nextId(),
          type: "command",
          description: "Existing test suite passes",
          command: "npm test",
          expected_exit_code: 0,
          captured_at: new Date().toISOString(),
        });
        console.log("    ✓ Tests pass — captured as behavioral contract");
      } catch {
        console.log("    ⚠ Tests fail — skipping (cannot use as baseline)");
      }
    }

    // Type check
    if (pkg.scripts?.["typecheck"] || pkg.scripts?.["type-check"]) {
      const cmd = pkg.scripts["typecheck"] ? "npm run typecheck" : "npm run type-check";
      try {
        execSync(cmd, { cwd: "target", timeout: 60_000, encoding: "utf-8" });
        snapshots.push({
          id: nextId(),
          type: "command",
          description: "TypeScript compilation succeeds",
          command: cmd,
          expected_exit_code: 0,
          captured_at: new Date().toISOString(),
        });
        console.log("    ✓ Type check passes — captured");
      } catch {
        console.log("    ⚠ Type check fails — skipping");
      }
    }

    // Build
    if (pkg.scripts?.["build"]) {
      try {
        execSync("npm run build", { cwd: "target", timeout: 120_000, encoding: "utf-8" });
        snapshots.push({
          id: nextId(),
          type: "command",
          description: "Build succeeds",
          command: "npm run build",
          expected_exit_code: 0,
          captured_at: new Date().toISOString(),
        });
        console.log("    ✓ Build succeeds — captured");
      } catch {
        console.log("    ⚠ Build fails — skipping");
      }
    }

    // Lint
    if (pkg.scripts?.["lint"]) {
      try {
        execSync("npm run lint", { cwd: "target", timeout: 60_000, encoding: "utf-8" });
        snapshots.push({
          id: nextId(),
          type: "command",
          description: "Lint passes",
          command: "npm run lint",
          expected_exit_code: 0,
          captured_at: new Date().toISOString(),
        });
        console.log("    ✓ Lint passes — captured");
      } catch {
        console.log("    ⚠ Lint fails — skipping");
      }
    }
  }

  // 2. Load any existing manual snapshots
  const existingPath = "evals/behavioral-snapshots.json";
  if (existsSync(existingPath)) {
    const existing = JSON.parse(readFileSync(existingPath, "utf-8")) as {
      snapshots?: BehavioralSnapshot[];
    };
    if (existing.snapshots && existing.snapshots.length > 0) {
      console.log(`\n  Preserving ${existing.snapshots.length} existing manual snapshots`);
      snapshots.push(...existing.snapshots);
    }
  }

  // 3. Write output
  const output = {
    _comment: "Behavioral snapshots — captured before hardening. Each is a regression gate.",
    captured_at: new Date().toISOString(),
    snapshots,
  };

  writeFileSync(existingPath, JSON.stringify(output, null, 2));

  console.log(`\nCaptured ${snapshots.length} behavioral contracts → evals/behavioral-snapshots.json`);
  console.log("\nNext steps:");
  console.log("  1. Review snapshots and add any manual behavioral contracts");
  console.log("  2. Run: npx tsx scripts/scan-defects.ts");
  console.log("  3. Review and prioritize defect taxonomy");
}

main().catch(console.error);
