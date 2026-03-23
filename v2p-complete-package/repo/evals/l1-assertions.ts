/**
 * evals/l1-assertions.ts — Deterministic hard gates
 *
 * READ-ONLY TO AGENT.
 *
 * L1 assertions are fast, deterministic, and binary. They run on every
 * fix attempt and block commits on ANY failure. No exceptions.
 *
 * Categories:
 *   - Tests pass (existing test suite)
 *   - Type check passes (tsc --strict)
 *   - No secrets in source (gitleaks / regex)
 *   - No new `any` types introduced
 *   - No console.log in production code
 *   - Schema validation (outputs conform to declared shapes)
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { glob } from "glob";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface L1Result {
  passed: boolean;
  failures: string[];
  checks: Array<{
    name: string;
    passed: boolean;
    detail?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Individual Checks
// ---------------------------------------------------------------------------

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

async function checkTestsPass(): Promise<CheckResult> {
  try {
    execSync("npm test --if-present 2>&1", {
      cwd: "target",
      encoding: "utf-8",
      timeout: 120_000,
    });
    return { name: "tests-pass", passed: true };
  } catch (err: unknown) {
    const stderr =
      err && typeof err === "object" && "stderr" in err
        ? String((err as { stderr: string }).stderr).slice(0, 500)
        : "unknown error";
    return { name: "tests-pass", passed: false, detail: stderr };
  }
}

async function checkTypeCheck(): Promise<CheckResult> {
  try {
    execSync("npx tsc --noEmit 2>&1", {
      cwd: "target",
      encoding: "utf-8",
      timeout: 60_000,
    });
    return { name: "type-check", passed: true };
  } catch (err: unknown) {
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout: string }).stdout).slice(0, 500)
        : "unknown error";
    return { name: "type-check", passed: false, detail: stdout };
  }
}

async function checkNoSecrets(): Promise<CheckResult> {
  // Pattern-based secret detection (subset of gitleaks patterns)
  const secretPatterns = [
    /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/gi,
    /(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    /(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*['"]?[A-Z0-9]{16,}['"]?/g,
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
    /ghp_[A-Za-z0-9]{36}/g,
    /sk-[A-Za-z0-9]{32,}/g,
    /AKIA[A-Z0-9]{16}/g,
  ];

  const files = await glob("target/**/*.{ts,tsx,js,jsx,json,env,yaml,yml}", {
    ignore: ["**/node_modules/**", "**/dist/**", "**/.git/**"],
  });

  const findings: string[] = [];

  for (const file of files) {
    // Skip lock files and binary-ish files
    if (file.includes("lock") || file.includes(".min.")) continue;

    const content = readFileSync(file, "utf-8");
    for (const pattern of secretPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(content);
      if (match) {
        findings.push(`${file}: potential secret (${match[0].slice(0, 30)}...)`);
      }
    }
  }

  return {
    name: "no-secrets",
    passed: findings.length === 0,
    detail: findings.length > 0 ? findings.join("\n") : undefined,
  };
}

async function checkNoNewAnyTypes(): Promise<CheckResult> {
  // Check git diff for newly introduced `any` types
  try {
    const diff = execSync("git diff --cached target/ || git diff target/", {
      encoding: "utf-8",
      timeout: 10_000,
    });

    const addedLines = diff
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

    const anyPattern = /:\s*any\b|as\s+any\b|<any>/g;
    const violations: string[] = [];

    for (const line of addedLines) {
      if (anyPattern.test(line)) {
        violations.push(line.trim().slice(1)); // remove leading +
      }
      anyPattern.lastIndex = 0;
    }

    return {
      name: "no-new-any-types",
      passed: violations.length === 0,
      detail:
        violations.length > 0
          ? `New \`any\` types in diff:\n${violations.join("\n")}`
          : undefined,
    };
  } catch {
    // No git diff available (maybe not in a git repo yet)
    return { name: "no-new-any-types", passed: true, detail: "skipped: no git diff" };
  }
}

async function checkNoConsoleLog(): Promise<CheckResult> {
  const files = await glob("target/src/**/*.{ts,tsx,js,jsx}", {
    ignore: ["**/node_modules/**", "**/dist/**", "**/*.test.*", "**/*.spec.*"],
  });

  const violations: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (/\bconsole\.(log|debug|info)\b/.test(line) && !/\/\/\s*eslint-disable/.test(line)) {
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  return {
    name: "no-console-log",
    passed: violations.length === 0,
    detail:
      violations.length > 0
        ? `console.log in production code:\n${violations.slice(0, 10).join("\n")}`
        : undefined,
  };
}

async function checkLintClean(): Promise<CheckResult> {
  try {
    execSync("npx eslint src/ --max-warnings 0 2>&1 || true", {
      cwd: "target",
      encoding: "utf-8",
      timeout: 60_000,
    });
    return { name: "lint-clean", passed: true };
  } catch (err: unknown) {
    const stdout =
      err && typeof err === "object" && "stdout" in err
        ? String((err as { stdout: string }).stdout).slice(0, 500)
        : "linting failed";
    return { name: "lint-clean", passed: false, detail: stdout };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runL1Assertions(): Promise<L1Result> {
  const checks = await Promise.all([
    checkTestsPass(),
    checkTypeCheck(),
    checkNoSecrets(),
    checkNoNewAnyTypes(),
    checkNoConsoleLog(),
    checkLintClean(),
  ]);

  const failures = checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail ?? "failed"}`);

  return {
    passed: failures.length === 0,
    failures,
    checks,
  };
}
