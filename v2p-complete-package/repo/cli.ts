#!/usr/bin/env node

/**
 * v2p — Vibe-to-Prod CLI
 *
 * Usage:
 *   v2p init <path>          Copy project into target/, capture baseline
 *   v2p scan                 Run defect scan, produce taxonomy
 *   v2p eval                 Run full eval harness
 *   v2p score                Show readiness score (--detail for breakdown)
 *   v2p fix                  Run single fix attempt
 *   v2p run <dimension>      Autonomous hardening loop (--hours N)
 *   v2p report               Generate stakeholder HTML report
 *   v2p seal                 Seal eval harness integrity hash
 *   v2p validate-judges      Measure judge precision + recall
 *   v2p status               Quick overview of current state
 */

import { execSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname);

const args = process.argv.slice(2);
const command = args[0];

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

function run(cmd: string, opts: Record<string, unknown> = {}): void {
  try {
    execSync(cmd, { cwd: ROOT, stdio: "inherit", ...opts });
  } catch {
    process.exit(1);
  }
}

function tsx(script: string, extraArgs: string[] = []): void {
  const all = ["tsx", resolve(ROOT, script), ...extraArgs];
  const result = spawnSync(all[0]!, all.slice(1), { cwd: ROOT, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

switch (command) {
  case "init": {
    const sourcePath = args[1];
    if (!sourcePath) {
      console.error(`${RED}Usage: v2p init <path-to-project>${NC}`);
      process.exit(1);
    }
    const absSource = resolve(sourcePath);
    if (!existsSync(absSource)) {
      console.error(`${RED}Path not found: ${absSource}${NC}`);
      process.exit(1);
    }

    console.log(`${CYAN}Initializing target from ${absSource}...${NC}`);

    // Clear and copy
    const targetDir = resolve(ROOT, "target");
    mkdirSync(targetDir, { recursive: true });
    cpSync(absSource, targetDir, {
      recursive: true,
      filter: (src) => !src.includes("node_modules") && !src.includes(".git"),
    });

    console.log(`${GREEN}✓${NC} Project copied to target/`);

    // Capture behavioral baseline
    console.log(`\n${CYAN}Capturing behavioral baseline...${NC}`);
    tsx("scripts/capture-behavior.ts");

    // Run initial scan
    console.log(`\n${CYAN}Running defect scan...${NC}`);
    tsx("scripts/scan-defects.ts");

    console.log(`\n${GREEN}✓ Initialization complete.${NC}`);
    console.log(`${DIM}Next: review evals/defect-taxonomy.json and adjust priorities.${NC}`);
    console.log(`${DIM}Then: v2p run security --hours 4${NC}`);
    break;
  }

  case "scan":
    tsx("scripts/scan-defects.ts", args.slice(1));
    break;

  case "scan:e2e":
    tsx("scripts/scan-e2e.ts", args.slice(1));
    break;

  case "harden:post-migration":
    tsx("integrations/migrationforge.ts", args.slice(1));
    break;

  case "eval":
    tsx("evals/harness.ts", args.slice(1));
    break;

  case "score":
    if (args.includes("--antifragile")) {
      tsx("scoring/antifragility-score.ts", args.slice(1));
    } else {
      tsx("scripts/readiness-score.ts", args.slice(1));
    }
    break;

  case "fix":
    run("bash scripts/run-fix.sh " + args.slice(1).join(" "));
    break;

  case "run": {
    const dimension = args[1] ?? "all";
    const hoursIdx = args.indexOf("--hours");
    const hours = hoursIdx >= 0 ? args[hoursIdx + 1] ?? "8" : "8";
    const agentIdx = args.indexOf("--agent");
    const agent = agentIdx >= 0 ? `--agent ${args[agentIdx + 1]}` : "";
    run(`bash scripts/run-overnight.sh --dimension ${dimension} --hours ${hours} ${agent}`);
    break;
  }

  case "harden":
    tsx("scripts/harden.ts", args.slice(1));
    break;

  case "badge":
    tsx("scripts/generate-badge.ts", args.slice(1));
    break;

  case "report":
    tsx("scripts/generate-report.ts", args.slice(1));
    break;

  case "launch-report":
    tsx("scripts/generate-launch-report.ts", args.slice(1));
    break;

  case "subtract":
    tsx("subtract/scanner.ts", args.slice(1));
    break;

  case "chaos":
    tsx("chaos/chaos-runner.ts", args.slice(1));
    break;

  case "learn":
    tsx("sentinel/learn.ts", args.slice(1));
    break;

  case "analyze":
    tsx("scripts/error-analysis.ts", args.slice(1));
    break;

  case "judges:audit":
    tsx("judges/production-accuracy.ts", args.slice(1));
    break;

  case "seal":
    run("bash scripts/seal-evals.sh");
    break;

  case "validate-judges":
    tsx("scripts/validate-judges.ts", args.slice(1));
    break;

  case "status": {
    console.log(`${CYAN}Vibe-to-Prod Status${NC}\n`);

    // Check target
    const hasTarget = existsSync(resolve(ROOT, "target/package.json")) ||
      existsSync(resolve(ROOT, "target/demo-app/package.json"));
    console.log(`  Target project:   ${hasTarget ? `${GREEN}loaded${NC}` : `${DIM}empty — run: v2p init <path>${NC}`}`);

    // Check taxonomy
    const taxPath = resolve(ROOT, "evals/defect-taxonomy.json");
    if (existsSync(taxPath)) {
      const tax = JSON.parse(readFileSync(taxPath, "utf-8"));
      const total = tax.total_defects ?? 0;
      const fixed = Object.values(tax.dimensions ?? {})
        .flatMap((d: any) => d.defects ?? [])
        .filter((d: any) => d.fixed).length;
      console.log(`  Defects:          ${fixed}/${total} fixed`);
    } else {
      console.log(`  Defects:          ${DIM}not scanned — run: v2p scan${NC}`);
    }

    // Check logs
    const logPath = resolve(ROOT, "logs/fixes.jsonl");
    if (existsSync(logPath)) {
      const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
      const commits = lines.filter((l) => l.includes('"committed"')).length;
      const reverts = lines.filter((l) => l.includes('"reverted"')).length;
      console.log(`  Fix history:      ${GREEN}${commits} commits${NC}, ${RED}${reverts} reverts${NC}`);
    } else {
      console.log(`  Fix history:      ${DIM}no runs yet${NC}`);
    }

    // Score
    const baselinePath = resolve(ROOT, ".baseline-score");
    if (existsSync(baselinePath)) {
      const score = readFileSync(baselinePath, "utf-8").trim();
      console.log(`  Readiness score:  ${parseFloat(score) >= 0.8 ? GREEN : YELLOW}${(parseFloat(score) * 100).toFixed(1)}%${NC}`);
    }

    console.log("");
    break;
  }

  default:
    console.log(`${CYAN}v2p${NC} — Vibe-to-Prod: Autonomous Production Hardening\n`);
    console.log("Commands:");
    console.log(`  ${GREEN}harden${NC} [path]         Zero-config magic wand — scan, fix, report, badge`);
    console.log(`  ${GREEN}init${NC} <path>           Copy project, capture baseline, scan defects`);
    console.log(`  ${GREEN}scan${NC} [--llm]          Run defect scanner`);
    console.log(`  ${GREEN}scan:e2e${NC} [--report]   File-by-file scan with actionable fix prompts`);
    console.log(`  ${GREEN}eval${NC}                  Run full eval harness`);
    console.log(`  ${GREEN}score${NC} [--detail]      Show readiness score (--antifragile for 3-component)`);
    console.log(`  ${GREEN}fix${NC}                   Run single fix attempt`);
    console.log(`  ${GREEN}run${NC} <dim> [--hours N] Autonomous hardening loop`);
    console.log(`  ${GREEN}subtract${NC} [--merge]     Via negativa — find attack surface to remove`);
    console.log(`  ${GREEN}chaos${NC} [--merge]        Run adversarial probes against hardened code`);
    console.log(`  ${GREEN}learn${NC} [--merge]        Process production signals into new defects`);
    console.log(`  ${GREEN}analyze${NC} [--detail]      Error analysis of hardening loop failures`);
    console.log(`  ${GREEN}judges:audit${NC}           Judge accuracy vs production outcomes`);
    console.log(`  ${GREEN}badge${NC}                 Generate embeddable readiness badges`);
    console.log(`  ${GREEN}report${NC}                Generate HTML stakeholder report`);
    console.log(`  ${GREEN}launch-report${NC}         Generate PDF launch readiness report`);
    console.log(`  ${GREEN}seal${NC}                  Seal eval harness integrity`);
    console.log(`  ${GREEN}validate-judges${NC}       Measure judge precision + recall`);
    console.log(`  ${GREEN}status${NC}                Quick overview`);
    console.log(`\nQuick start:`);
    console.log(`  ${DIM}npx v2p harden ../my-app${NC}       # one command, production-ready by morning`);
    console.log(`\n${DIM}Full workflow:${NC}`);
    console.log(`  v2p init ../my-prototype`);
    console.log(`  v2p score --detail`);
    console.log(`  v2p run security --hours 4`);
    console.log(`  v2p launch-report`);
}
