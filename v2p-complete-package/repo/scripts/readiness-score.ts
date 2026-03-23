/**
 * scripts/readiness-score.ts — Composite production readiness score
 *
 * Calculates a 0-1 score across all hardening dimensions.
 * Used by run-fix.sh to gate commits (score must not regress).
 *
 * Usage:
 *   npx tsx scripts/readiness-score.ts          # print score
 *   npx tsx scripts/readiness-score.ts --detail  # print per-dimension breakdown
 */

import { readFileSync, existsSync } from "node:fs";

interface Defect {
  id: string;
  dimension: string;
  priority: string;
  fixed: boolean;
}

interface DimensionScore {
  dimension: string;
  total: number;
  fixed: number;
  score: number;
  p0_open: number;
  p1_open: number;
}

function main(): void {
  const taxonomyPath = "evals/defect-taxonomy.json";

  if (!existsSync(taxonomyPath)) {
    // No taxonomy yet — return 0
    console.log("0");
    return;
  }

  const taxonomy = JSON.parse(readFileSync(taxonomyPath, "utf-8")) as {
    dimensions: Record<string, { defects: Defect[] }>;
  };

  const showDetail = process.argv.includes("--detail");
  const scores: DimensionScore[] = [];

  // Priority weights: P0 defects count 4x, P1 count 2x, P2 count 1x, P3 count 0.5x
  const priorityWeight: Record<string, number> = { P0: 4, P1: 2, P2: 1, P3: 0.5 };

  for (const [name, dim] of Object.entries(taxonomy.dimensions)) {
    if (dim.defects.length === 0) {
      scores.push({ dimension: name, total: 0, fixed: 0, score: 1.0, p0_open: 0, p1_open: 0 });
      continue;
    }

    let totalWeight = 0;
    let fixedWeight = 0;
    let p0Open = 0;
    let p1Open = 0;

    for (const defect of dim.defects) {
      const w = priorityWeight[defect.priority] ?? 1;
      totalWeight += w;
      if (defect.fixed) {
        fixedWeight += w;
      } else {
        if (defect.priority === "P0") p0Open++;
        if (defect.priority === "P1") p1Open++;
      }
    }

    const score = totalWeight > 0 ? fixedWeight / totalWeight : 1.0;

    scores.push({
      dimension: name,
      total: dim.defects.length,
      fixed: dim.defects.filter((d) => d.fixed).length,
      score: Math.round(score * 1000) / 1000,
      p0_open: p0Open,
      p1_open: p1Open,
    });
  }

  // Composite score: weighted average across dimensions
  // Security and data-integrity get 1.5x weight
  const dimensionWeight: Record<string, number> = {
    security: 1.5,
    "data-integrity": 1.5,
    "error-handling": 1.0,
    "input-validation": 1.0,
    observability: 0.8,
    "test-coverage": 0.8,
  };

  let totalWeight = 0;
  let weightedScore = 0;

  for (const ds of scores) {
    const w = dimensionWeight[ds.dimension] ?? 1.0;
    totalWeight += w;
    weightedScore += ds.score * w;
  }

  const composite = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 1000) / 1000 : 0;

  // Any open P0 caps the score at 0.5
  const hasOpenP0 = scores.some((s) => s.p0_open > 0);
  const finalScore = hasOpenP0 ? Math.min(composite, 0.5) : composite;

  if (showDetail) {
    console.log("Production Readiness Score");
    console.log("=".repeat(60));
    for (const ds of scores) {
      const bar = "█".repeat(Math.round(ds.score * 20)).padEnd(20, "░");
      const status = ds.p0_open > 0 ? " ⛔ P0 OPEN" : ds.p1_open > 0 ? " ⚠ P1 open" : "";
      console.log(`  ${ds.dimension.padEnd(20)} ${bar} ${(ds.score * 100).toFixed(1)}% (${ds.fixed}/${ds.total})${status}`);
    }
    console.log("=".repeat(60));
    console.log(`  COMPOSITE${" ".repeat(14)} ${(finalScore * 100).toFixed(1)}%${hasOpenP0 ? " (capped — P0 defects open)" : ""}`);
  } else {
    console.log(String(finalScore));
  }
}

main();
