#!/usr/bin/env node
/**
 * servers/v2p-server.ts — V2P MCP Server
 *
 * Exposes V2P CLI commands as MCP tools for Claude Code integration.
 * Uses stdio transport (JSON-RPC over stdin/stdout).
 *
 * IMPORTANT: Never write to stdout directly — it's the JSON-RPC channel.
 * Use stderr for logging.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes from output — Claude doesn't render them */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
}

/** Validate that a user-supplied path doesn't escape expected boundaries */
function validatePath(inputPath: string, label: string): string {
  const resolved = resolve(inputPath);
  // Block system directories and sensitive paths
  const blocked = ["/etc", "/var", "/usr", "/bin", "/sbin", "/root",
    "C:\\Windows", "C:\\Program Files", "C:\\ProgramData"];
  for (const b of blocked) {
    if (resolved.toLowerCase().startsWith(b.toLowerCase())) {
      throw new Error(`${label}: path '${resolved}' is in a protected system directory`);
    }
  }
  return resolved;
}

/** Run a tsx script and return stdout/stderr */
function runTsx(script: string, args: string[] = []): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("npx", ["tsx", resolve(ROOT, script), ...args.filter(Boolean)], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 120_000,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  return {
    stdout: stripAnsi(result.stdout ?? ""),
    stderr: stripAnsi(result.stderr ?? ""),
    exitCode: result.status ?? 1,
  };
}

/** Run a bash script */
function runBash(script: string, args: string[] = []): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync("bash", [resolve(ROOT, script), ...args.filter(Boolean)], {
    cwd: ROOT,
    encoding: "utf-8",
    timeout: 300_000,
    env: { ...process.env, FORCE_COLOR: "0" },
  });

  return {
    stdout: stripAnsi(result.stdout ?? ""),
    stderr: stripAnsi(result.stderr ?? ""),
    exitCode: result.status ?? 1,
  };
}

/** Format tool result from command output */
function formatResult(result: { stdout: string; stderr: string; exitCode: number }): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  const output = result.stdout || result.stderr || "(no output)";
  return {
    content: [{ type: "text" as const, text: output.trim() }],
    isError: result.exitCode !== 0 ? true : undefined,
  };
}

// ---------------------------------------------------------------------------
// Server Setup
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "v2p",
  version: "2.0.0",
});

// ---------------------------------------------------------------------------
// Tool: v2p_status — Quick overview of current state
// ---------------------------------------------------------------------------

server.tool(
  "v2p_status",
  "Quick overview of V2P state: target loaded, defects fixed, readiness score",
  {},
  async () => {
    const lines: string[] = ["V2P Status", "=".repeat(40)];

    // Check target
    const hasTarget = existsSync(resolve(ROOT, "target/package.json")) ||
      existsSync(resolve(ROOT, "target/demo-app/package.json"));
    lines.push(`Target project: ${hasTarget ? "loaded" : "empty — run v2p init <path>"}`);

    // Check taxonomy
    const taxPath = resolve(ROOT, "evals/defect-taxonomy.json");
    if (existsSync(taxPath)) {
      const tax = JSON.parse(readFileSync(taxPath, "utf-8"));
      const total = tax.total_defects ?? 0;
      const fixed = Object.values(tax.dimensions ?? {})
        .flatMap((d: any) => (d as any).defects ?? [])
        .filter((d: any) => d.fixed).length;
      lines.push(`Defects: ${fixed}/${total} fixed`);
    } else {
      lines.push("Defects: not scanned");
    }

    // Check logs
    const logPath = resolve(ROOT, "logs/fixes.jsonl");
    if (existsSync(logPath)) {
      const logLines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
      const commits = logLines.filter((l) => l.includes('"committed"')).length;
      const reverts = logLines.filter((l) => l.includes('"reverted"')).length;
      lines.push(`Fix history: ${commits} commits, ${reverts} reverts`);
    }

    // Score
    const baselinePath = resolve(ROOT, ".baseline-score");
    if (existsSync(baselinePath)) {
      const score = parseFloat(readFileSync(baselinePath, "utf-8").trim());
      lines.push(`Readiness: ${(score * 100).toFixed(1)}%`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_scan — Run defect scanner
// ---------------------------------------------------------------------------

server.tool(
  "v2p_scan",
  "Scan target project for production readiness defects. Produces a structured defect taxonomy.",
  { llm: z.boolean().optional().describe("Enable LLM-assisted deep scan (requires ANTHROPIC_API_KEY)") },
  async ({ llm }) => {
    const args = llm ? ["--llm"] : [];
    return formatResult(runTsx("scripts/scan-defects.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_eval — Run full eval harness
// ---------------------------------------------------------------------------

server.tool(
  "v2p_eval",
  "Run the full eval harness: L1 assertions + L2 judges + security gates + behavioral checks. Returns JSON.",
  {},
  async () => formatResult(runTsx("evals/harness.ts")),
);

// ---------------------------------------------------------------------------
// Tool: v2p_score — Show readiness score
// ---------------------------------------------------------------------------

server.tool(
  "v2p_score",
  "Show production readiness score. Use --antifragile for three-component scoring (Robustness + Chaos Freshness + Production Adaptation).",
  {
    detail: z.boolean().optional().describe("Show per-dimension breakdown"),
    antifragile: z.boolean().optional().describe("Use three-component antifragility score"),
  },
  async ({ detail, antifragile }) => {
    if (antifragile) {
      const args = detail ? ["--detail"] : [];
      return formatResult(runTsx("scoring/antifragility-score.ts", args));
    }
    const args = detail ? ["--detail"] : [];
    return formatResult(runTsx("scripts/readiness-score.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_fix — Run single fix attempt
// ---------------------------------------------------------------------------

server.tool(
  "v2p_fix",
  "Run a single atomic fix attempt. Applies a fix, runs eval gates, commits if all pass or reverts if any fail.",
  { defect_id: z.string().regex(/^[A-Z]{2,4}-\d{1,4}$/).optional().describe("Specific defect ID to fix (e.g. SEC-001)") },
  async ({ defect_id }) => {
    const args = defect_id ? [defect_id] : [];
    return formatResult(runBash("scripts/run-fix.sh", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_subtract — Via Negativa scanner
// ---------------------------------------------------------------------------

server.tool(
  "v2p_subtract",
  "Via Negativa: scan for attack surface to REMOVE — unused deps, dead endpoints, broad config, unnecessary exposure.",
  { merge: z.boolean().optional().describe("Merge findings into defect taxonomy") },
  async ({ merge }) => {
    const args = merge ? ["--merge"] : [];
    return formatResult(runTsx("subtract/scanner.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_chaos — Adversarial chaos testing
// ---------------------------------------------------------------------------

server.tool(
  "v2p_chaos",
  "Run adversarial probes against hardened endpoints: input fuzzing, auth bypass, injection replay, dependency failure.",
  {
    endpoint: z.string().optional().describe("Target specific endpoint (e.g. /api/users)"),
    merge: z.boolean().optional().describe("Merge findings into defect taxonomy"),
  },
  async ({ endpoint, merge }) => {
    const args: string[] = [];
    if (endpoint) args.push("--endpoint", endpoint);
    if (merge) args.push("--merge");
    return formatResult(runTsx("chaos/chaos-runner.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_learn — Process production signals
// ---------------------------------------------------------------------------

server.tool(
  "v2p_learn",
  "Process production signals from sentinel middleware into new defect taxonomy entries.",
  {
    from: z.string().optional().describe("Path to sentinel JSONL file (default: .v2p/sentinel.jsonl)"),
    merge: z.boolean().optional().describe("Merge findings into defect taxonomy"),
  },
  async ({ from, merge }) => {
    const args: string[] = [];
    if (from) args.push("--from", validatePath(from, "v2p_learn"));
    if (merge) args.push("--merge");
    return formatResult(runTsx("sentinel/learn.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_scan_e2e — End-to-end file-by-file scan with actionable prompts
// ---------------------------------------------------------------------------

server.tool(
  "v2p_scan_e2e",
  "End-to-end file-by-file scan with per-file readiness scores, actionable fix prompts, and remediation plan.",
  {
    path: z.string().optional().describe("Path to project to scan (default: target/)"),
    prompts: z.boolean().optional().describe("Generate individual fix prompt files per dimension"),
  },
  async ({ path, prompts }) => {
    const args = ["--report"];
    if (path) args.push("--path", validatePath(path, "v2p_scan_e2e"));
    if (prompts) args.push("--prompts");
    return formatResult(runTsx("scripts/scan-e2e.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_harden_post_migration — Post-migration hardening with trust score
// ---------------------------------------------------------------------------

server.tool(
  "v2p_harden_post_migration",
  "Run post-migration hardening scan against a MigrationForge project. Computes enhanced trust score (A-F).",
  {
    path: z.string().describe("Path to the MigrationForge project"),
    module: z.string().optional().describe("Scan a specific module only"),
  },
  async ({ path, module }) => {
    const validPath = validatePath(path, "v2p_harden_post_migration");
    const args = ["--path", validPath];
    if (module) args.push("--module", module);
    return formatResult(runTsx("integrations/migrationforge.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_analyze — Error analysis of hardening loop
// ---------------------------------------------------------------------------

server.tool(
  "v2p_analyze",
  "Guided error analysis of hardening loop failures. Groups reverts by failure category, sorted by frequency.",
  {
    detail: z.boolean().optional().describe("Show individual failure traces"),
    dimension: z.string().optional().describe("Filter to specific dimension (e.g. security)"),
  },
  async ({ detail, dimension }) => {
    const args: string[] = [];
    if (detail) args.push("--detail");
    if (dimension) args.push("--dimension", dimension);
    return formatResult(runTsx("scripts/error-analysis.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_report — Generate stakeholder report
// ---------------------------------------------------------------------------

server.tool(
  "v2p_report",
  "Generate an HTML stakeholder report showing readiness score, defects fixed, and remaining work.",
  {},
  async () => formatResult(runTsx("scripts/generate-report.ts")),
);

// ---------------------------------------------------------------------------
// Tool: v2p_validate_judges — Validate L2 judges
// ---------------------------------------------------------------------------

server.tool(
  "v2p_validate_judges",
  "Validate L2 judges against gold labels using TPR/TNR metrics with Rogan-Gladen bias correction.",
  {
    disagreements: z.boolean().optional().describe("Show all human-judge disagreements"),
    test: z.boolean().optional().describe("Use held-out test split (run once only)"),
  },
  async ({ disagreements, test }) => {
    const args: string[] = [];
    if (disagreements) args.push("--disagreements");
    if (test) args.push("--test");
    return formatResult(runTsx("scripts/validate-judges.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Tool: v2p_judges_audit — Judge accountability
// ---------------------------------------------------------------------------

server.tool(
  "v2p_judges_audit",
  "Audit L2 judge accuracy against production outcomes. Flags judges with >5% false positive rate.",
  { flag: z.boolean().optional().describe("Auto-flag failing judges and write audit report") },
  async ({ flag }) => {
    const args = flag ? ["--flag"] : [];
    return formatResult(runTsx("judges/production-accuracy.ts", args));
  },
);

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[v2p-mcp] Server started on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`[v2p-mcp] Fatal: ${err}\n`);
  process.exit(1);
});
