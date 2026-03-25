/**
 * scoring/antifragility-score.ts — Three-component antifragility metric
 *
 * Replaces the static readiness score with a dynamic metric that
 * measures how much stronger the system gets from stress.
 *
 * Components:
 *   Robustness (0-40):        Existing V2P readiness score
 *   Chaos Freshness (0-30):   Decays if chaos testing hasn't run recently
 *   Production Adaptation (0-30): Cumulative count of production-discovered defects fixed
 *
 * Usage:
 *   npx tsx scoring/antifragility-score.ts
 *   npx tsx scoring/antifragility-score.ts --detail
 *   npx tsx scoring/antifragility-score.ts --badge
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FixLog {
  status: string;
  defect_id?: string;
  timestamp?: string;
  source?: string;
}

interface ChaosReport {
  timestamp: string;
  probes_run: number;
  passed: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Component 1: Robustness (0-40)
// ---------------------------------------------------------------------------

function computeRobustness(): { score: number; detail: string } {
  const baselinePath = ".baseline-score";
  if (!existsSync(baselinePath)) {
    return { score: 0, detail: "No baseline score — run vibecheck scan + fix first" };
  }

  const baseline = parseFloat(readFileSync(baselinePath, "utf-8").trim());
  // Scale 0-1 readiness to 0-40 robustness
  const score = Math.round(baseline * 40 * 10) / 10;
  return { score, detail: `${(baseline * 100).toFixed(1)}% readiness → ${score}/40` };
}

// ---------------------------------------------------------------------------
// Component 2: Chaos Freshness (0-30)
// ---------------------------------------------------------------------------

function computeChaosFreshness(): { score: number; detail: string; days_since: number | null } {
  const chaosPath = "logs/chaos-results.json";
  if (!existsSync(chaosPath)) {
    return { score: 0, detail: "No chaos testing run yet — run vibecheck chaos", days_since: null };
  }

  const report = JSON.parse(readFileSync(chaosPath, "utf-8")) as ChaosReport;
  const daysSince = (Date.now() - new Date(report.timestamp).getTime()) / (1000 * 60 * 60 * 24);

  // Chaos resilience: percentage of probes passed (0-1)
  const resilience = report.probes_run > 0 ? report.passed / report.probes_run : 0;

  // Time decay: full score if tested within 7 days, linear decay to 0 at 30 days
  let freshness: number;
  if (daysSince <= 7) {
    freshness = 1;
  } else if (daysSince <= 30) {
    freshness = 1 - ((daysSince - 7) / 23);
  } else {
    freshness = 0;
  }

  const score = Math.round(resilience * freshness * 30 * 10) / 10;
  return {
    score,
    detail: `${(resilience * 100).toFixed(0)}% resilience × ${(freshness * 100).toFixed(0)}% freshness → ${score}/30 (${daysSince.toFixed(0)}d ago)`,
    days_since: Math.round(daysSince),
  };
}

// ---------------------------------------------------------------------------
// Component 3: Production Adaptation (0-30) — CUMULATIVE, no decay
// ---------------------------------------------------------------------------

function computeProductionAdaptation(): { score: number; detail: string; adaptations: number } {
  const fixLogPath = "logs/fixes.jsonl";
  if (!existsSync(fixLogPath)) {
    return { score: 0, detail: "No fix history yet", adaptations: 0 };
  }

  const lines = readFileSync(fixLogPath, "utf-8").trim().split("\n").filter(Boolean);
  const fixes = lines.map((line) => {
    try { return JSON.parse(line) as FixLog; }
    catch { return null; }
  }).filter((f): f is FixLog => f !== null);

  // Count fixes from production sources (chaos + production + judge-failure)
  const productionFixes = fixes.filter((f) =>
    f.status === "committed" && f.defect_id &&
    (f.defect_id.startsWith("CHAOS-") || f.defect_id.startsWith("PROD-")),
  );

  const adaptations = productionFixes.length;

  // Scoring: logarithmic scale — first adaptations count more
  // 0 adaptations → 0, 1 → 6, 5 → 15, 10 → 21, 20 → 27, 30+ → 30
  const score = adaptations === 0 ? 0 :
    Math.min(30, Math.round(30 * (1 - Math.exp(-adaptations / 10)) * 10) / 10);

  return {
    score,
    detail: `${adaptations} production-discovered defects fixed → ${score}/30`,
    adaptations,
  };
}

// ---------------------------------------------------------------------------
// Composite Score
// ---------------------------------------------------------------------------

interface AntifragilityScore {
  composite: number;
  robustness: { score: number; detail: string };
  chaos_freshness: { score: number; detail: string; days_since: number | null };
  production_adaptation: { score: number; detail: string; adaptations: number };
  badge_text: string;
}

function computeAntifragilityScore(): AntifragilityScore {
  const robustness = computeRobustness();
  const chaosFreshness = computeChaosFreshness();
  const productionAdaptation = computeProductionAdaptation();

  const composite = Math.round((robustness.score + chaosFreshness.score + productionAdaptation.score) * 10) / 10;

  return {
    composite,
    robustness,
    chaos_freshness: chaosFreshness,
    production_adaptation: productionAdaptation,
    badge_text: `Antifragility: ${composite} — ${productionAdaptation.adaptations} attacks adapted`,
  };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

function displayScore(score: AntifragilityScore, detail: boolean): void {
  const PURPLE = "\x1b[35m";
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const DIM = "\x1b[2m";
  const NC = "\x1b[0m";

  const compositeColor = score.composite >= 70 ? GREEN :
                         score.composite >= 40 ? YELLOW : "\x1b[31m";

  console.log(`\n${PURPLE}Antifragility Score${NC}`);
  console.log("═".repeat(60));

  if (detail) {
    // Robustness bar
    const rBar = "█".repeat(Math.round(score.robustness.score)).padEnd(40, "░");
    console.log(`  Robustness          ${rBar} ${score.robustness.score}/40`);
    console.log(`  ${DIM}${score.robustness.detail}${NC}`);

    // Chaos Freshness bar
    const cBar = "█".repeat(Math.round(score.chaos_freshness.score)).padEnd(30, "░");
    const chaosWarning = score.chaos_freshness.days_since !== null && score.chaos_freshness.days_since > 14
      ? ` ${YELLOW}⚠ stale${NC}` : "";
    console.log(`  Chaos Freshness     ${cBar} ${score.chaos_freshness.score}/30${chaosWarning}`);
    console.log(`  ${DIM}${score.chaos_freshness.detail}${NC}`);

    // Production Adaptation bar
    const pBar = "█".repeat(Math.round(score.production_adaptation.score)).padEnd(30, "░");
    console.log(`  Prod. Adaptation    ${pBar} ${score.production_adaptation.score}/30`);
    console.log(`  ${DIM}${score.production_adaptation.detail}${NC}`);

    console.log("═".repeat(60));
  }

  console.log(`  ${compositeColor}COMPOSITE             ${score.composite}/100${NC}`);
  console.log(`  ${DIM}${score.badge_text}${NC}\n`);
}

// ---------------------------------------------------------------------------
// Badge Generation
// ---------------------------------------------------------------------------

function generateBadgeSvg(score: AntifragilityScore): string {
  const color = score.composite >= 70 ? "#2ecc71" :
                score.composite >= 40 ? "#f39c12" : "#e74c3c";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a"><rect width="280" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h130v20H0z"/>
    <path fill="${color}" d="M130 0h150v20H130z"/>
    <path fill="url(#b)" d="M0 0h280v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,sans-serif" font-size="11">
    <text x="65" y="15" fill="#010101" fill-opacity=".3">antifragility</text>
    <text x="65" y="14">antifragility</text>
    <text x="205" y="15" fill="#010101" fill-opacity=".3">${score.composite} · ${score.production_adaptation.adaptations} adapted</text>
    <text x="205" y="14">${score.composite} · ${score.production_adaptation.adaptations} adapted</text>
  </g>
</svg>`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const detail = process.argv.includes("--detail");
  const badge = process.argv.includes("--badge");

  const score = computeAntifragilityScore();

  if (badge) {
    const svg = generateBadgeSvg(score);
    writeFileSync("antifragility-badge.svg", svg);
    console.log("Badge written to antifragility-badge.svg");
    displayScore(score, true);
  } else {
    displayScore(score, detail);
  }
}

main();
