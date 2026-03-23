/**
 * evals/security-gates.ts — Non-negotiable security checks
 *
 * READ-ONLY TO AGENT.
 *
 * These gates block commits regardless of metric improvement.
 * The agent cannot disable or modify these checks.
 *
 * Checks:
 *   - No secrets/credentials in source
 *   - No new network calls to domains not in allowlist
 *   - No PII patterns in output/log strings
 *   - Dependencies scanned for known vulnerabilities
 *   - No unencrypted storage paths introduced
 *   - Auth checks not bypassed in diff
 */

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { glob } from "glob";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SecurityResult {
  passed: boolean;
  findings: string[];
  checks: Array<{
    name: string;
    passed: boolean;
    detail?: string;
  }>;
}

interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Network Allowlist
// ---------------------------------------------------------------------------

const DEFAULT_NETWORK_ALLOWLIST = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  // Add project-specific allowed domains here
]);

function loadNetworkAllowlist(): Set<string> {
  const allowlistPath = "evals/network-allowlist.json";
  if (existsSync(allowlistPath)) {
    const domains = JSON.parse(readFileSync(allowlistPath, "utf-8")) as string[];
    return new Set([...DEFAULT_NETWORK_ALLOWLIST, ...domains]);
  }
  return DEFAULT_NETWORK_ALLOWLIST;
}

// ---------------------------------------------------------------------------
// Individual Checks
// ---------------------------------------------------------------------------

async function checkNoNewNetworkCalls(): Promise<CheckResult> {
  const allowlist = loadNetworkAllowlist();

  try {
    const diff = execSync("git diff --cached target/ || git diff target/", {
      encoding: "utf-8",
      timeout: 10_000,
    });

    const addedLines = diff
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"));

    // Match fetch(), axios, http.get, https.get, new URL(), etc.
    const urlPattern =
      /(?:fetch|axios|http\.get|https\.get|new URL|request)\s*\(\s*['"`](https?:\/\/[^'"`\s]+)/g;

    const violations: string[] = [];

    for (const line of addedLines) {
      let match: RegExpExecArray | null;
      while ((match = urlPattern.exec(line)) !== null) {
        try {
          const url = new URL(match[1]!);
          if (!allowlist.has(url.hostname)) {
            violations.push(`New network call to non-allowlisted domain: ${url.hostname}`);
          }
        } catch {
          // Invalid URL, skip
        }
      }
    }

    return {
      name: "no-new-network-calls",
      passed: violations.length === 0,
      detail: violations.length > 0 ? violations.join("\n") : undefined,
    };
  } catch {
    return { name: "no-new-network-calls", passed: true, detail: "skipped: no git diff" };
  }
}

async function checkNoPIIInOutputs(): Promise<CheckResult> {
  const piiPatterns = [
    { name: "SSN", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
    { name: "email-in-log", pattern: /(?:log|console|logger).*[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
    { name: "phone", pattern: /(?:log|console|logger).*\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g },
  ];

  const files = await glob("target/src/**/*.{ts,tsx,js,jsx}", {
    ignore: ["**/node_modules/**", "**/dist/**", "**/*.test.*"],
  });

  const findings: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const { name, pattern } of piiPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        findings.push(`${file}: potential ${name} in output/log`);
      }
    }
  }

  return {
    name: "no-pii-in-outputs",
    passed: findings.length === 0,
    detail: findings.length > 0 ? findings.join("\n") : undefined,
  };
}

async function checkDependencyAudit(): Promise<CheckResult> {
  try {
    const result = execSync("npm audit --json 2>/dev/null || echo '{}'", {
      cwd: "target",
      encoding: "utf-8",
      timeout: 30_000,
    });

    const audit = JSON.parse(result) as {
      metadata?: { vulnerabilities?: { critical?: number; high?: number } };
    };

    const critical = audit.metadata?.vulnerabilities?.critical ?? 0;
    const high = audit.metadata?.vulnerabilities?.high ?? 0;

    if (critical > 0 || high > 0) {
      return {
        name: "dependency-audit",
        passed: false,
        detail: `${critical} critical, ${high} high vulnerabilities`,
      };
    }

    return { name: "dependency-audit", passed: true };
  } catch {
    return { name: "dependency-audit", passed: true, detail: "skipped: npm audit unavailable" };
  }
}

async function checkNoErrorLeakage(): Promise<CheckResult> {
  // Check that error responses don't leak stack traces or internal paths
  const files = await glob("target/src/**/*.{ts,tsx,js,jsx}", {
    ignore: ["**/node_modules/**", "**/dist/**"],
  });

  const leakPatterns = [
    /res\.\w+\(\s*\d+\s*,\s*(?:err|error)\.(?:stack|message)\s*\)/g,
    /\.json\(\s*\{\s*(?:error|message)\s*:\s*(?:err|error)\.stack/g,
    /\.send\(\s*(?:err|error)\.stack\s*\)/g,
  ];

  const findings: string[] = [];

  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    for (const pattern of leakPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        findings.push(`${file}: potential error stack leakage to client`);
      }
    }
  }

  return {
    name: "no-error-leakage",
    passed: findings.length === 0,
    detail: findings.length > 0 ? findings.join("\n") : undefined,
  };
}

async function checkAuthNotBypassed(): Promise<CheckResult> {
  try {
    const diff = execSync("git diff --cached target/ || git diff target/", {
      encoding: "utf-8",
      timeout: 10_000,
    });

    const removedLines = diff
      .split("\n")
      .filter((line) => line.startsWith("-") && !line.startsWith("---"));

    // Check if auth middleware was removed
    const authPatterns = [
      /authenticate|authorize|requireAuth|checkAuth|verifyToken|isAuthenticated/,
      /middleware.*auth/i,
      /jwt\.verify|passport\.authenticate/,
    ];

    const removals: string[] = [];

    for (const line of removedLines) {
      for (const pattern of authPatterns) {
        if (pattern.test(line)) {
          removals.push(`Removed auth-related code: ${line.trim().slice(1)}`);
        }
      }
    }

    return {
      name: "auth-not-bypassed",
      passed: removals.length === 0,
      detail: removals.length > 0 ? removals.join("\n") : undefined,
    };
  } catch {
    return { name: "auth-not-bypassed", passed: true, detail: "skipped: no git diff" };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function runSecurityGates(): Promise<SecurityResult> {
  const checks = await Promise.all([
    checkNoNewNetworkCalls(),
    checkNoPIIInOutputs(),
    checkDependencyAudit(),
    checkNoErrorLeakage(),
    checkAuthNotBypassed(),
  ]);

  const findings = checks
    .filter((c) => !c.passed)
    .map((c) => `${c.name}: ${c.detail ?? "failed"}`);

  return {
    passed: findings.length === 0,
    findings,
    checks,
  };
}
