/**
 * scripts/generate-badge.ts — Embeddable readiness badge
 *
 * Produces SVG badges for READMEs, landing pages, and social proof:
 *   - readiness-badge.svg        "vibecheck hardened | 94%"
 *   - readiness-badge-detail.svg "security ✓ | errors ✓ | validation ✓ | 94%"
 *   - readiness-badge-shield.svg shields.io-compatible simple badge
 *
 * Usage:
 *   npx tsx scripts/generate-badge.ts                  # from taxonomy
 *   npx tsx scripts/generate-badge.ts --score 94       # override score
 *   npx tsx scripts/generate-badge.ts --style shield   # shields.io style
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

interface DimScore {
  name: string;
  score: number;
  total: number;
  fixed: number;
  hasP0: boolean;
}

// ---------------------------------------------------------------------------
// Score Computation
// ---------------------------------------------------------------------------

function computeScores(): { composite: number; dimensions: DimScore[] } {
  const taxPath = resolve(ROOT, "evals/defect-taxonomy.json");

  if (!existsSync(taxPath)) {
    return { composite: 0, dimensions: [] };
  }

  const taxonomy = JSON.parse(readFileSync(taxPath, "utf-8"));
  const dimensions: DimScore[] = [];
  const priorityWeight: Record<string, number> = { P0: 4, P1: 2, P2: 1, P3: 0.5 };
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
  let hasAnyP0 = false;

  for (const [name, dim] of Object.entries(taxonomy.dimensions ?? {})) {
    const defects = (dim as { defects: Array<{ fixed: boolean; priority: string }> }).defects ?? [];

    if (defects.length === 0) {
      dimensions.push({ name, score: 100, total: 0, fixed: 0, hasP0: false });
      const w = dimensionWeight[name] ?? 1.0;
      totalWeight += w;
      weightedScore += 1.0 * w;
      continue;
    }

    let tw = 0;
    let fw = 0;
    let hp0 = false;

    for (const d of defects) {
      const w = priorityWeight[d.priority] ?? 1;
      tw += w;
      if (d.fixed) fw += w;
      if (d.priority === "P0" && !d.fixed) hp0 = true;
    }

    const score = tw > 0 ? Math.round((fw / tw) * 100) : 100;
    if (hp0) hasAnyP0 = true;

    dimensions.push({
      name,
      score,
      total: defects.length,
      fixed: defects.filter((d) => d.fixed).length,
      hasP0: hp0,
    });

    const dw = dimensionWeight[name] ?? 1.0;
    totalWeight += dw;
    weightedScore += (score / 100) * dw;
  }

  let composite = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
  if (hasAnyP0) composite = Math.min(composite, 50);

  return { composite, dimensions };
}

// ---------------------------------------------------------------------------
// Badge Generators
// ---------------------------------------------------------------------------

function colorForScore(score: number): string {
  if (score >= 90) return "#22c55e";
  if (score >= 75) return "#4ade80";
  if (score >= 50) return "#eab308";
  if (score >= 25) return "#f97316";
  return "#ef4444";
}

function generateMainBadge(score: number): string {
  const color = colorForScore(score);
  const labelText = "vibecheck hardened";
  const valueText = `${score}%`;
  const labelWidth = 88;
  const valueWidth = 46;
  const totalWidth = labelWidth + valueWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="20" role="img" aria-label="${labelText}: ${valueText}">
  <title>${labelText}: ${valueText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${valueWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text aria-hidden="true" x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${labelText}</text>
    <text x="${labelWidth / 2}" y="14">${labelText}</text>
    <text aria-hidden="true" x="${labelWidth + valueWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${valueText}</text>
    <text x="${labelWidth + valueWidth / 2}" y="14">${valueText}</text>
  </g>
</svg>`;
}

function generateDetailBadge(score: number, dimensions: DimScore[]): string {
  const color = colorForScore(score);
  const shortNames: Record<string, string> = {
    security: "sec",
    "data-integrity": "data",
    "error-handling": "err",
    "input-validation": "val",
    observability: "obs",
    "test-coverage": "test",
  };

  // Build segments
  const segments = dimensions
    .filter((d) => d.total > 0)
    .map((d) => {
      const label = shortNames[d.name] ?? d.name.slice(0, 4);
      const icon = d.score >= 80 ? "✓" : d.hasP0 ? "✗" : "~";
      const segColor = d.hasP0 ? "#ef4444" : d.score >= 80 ? "#22c55e" : d.score >= 50 ? "#eab308" : "#f97316";
      return { label, icon, color: segColor, score: d.score };
    });

  const segWidth = 48;
  const scoreWidth = 52;
  const labelWidth = 72;
  const totalWidth = labelWidth + segments.length * segWidth + scoreWidth;

  let x = labelWidth;
  const segmentRects = segments.map((s) => {
    const rect = `<rect x="${x}" width="${segWidth}" height="20" fill="${s.color}"/>`;
    const text = `<text x="${x + segWidth / 2}" y="14" fill="#fff" font-size="9">${s.label} ${s.icon}</text>`;
    x += segWidth;
    return rect + text;
  }).join("\n    ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="vibecheck: ${score}%">
  <title>vibecheck hardened: ${score}%</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    ${segmentRects}
    <rect x="${x}" width="${scoreWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="14">vibecheck</text>
    <text x="${x + scoreWidth / 2}" y="14" font-weight="bold">${score}%</text>
  </g>
</svg>`;
}

function generateShieldBadge(score: number): string {
  const color = colorForScore(score);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="28" role="img">
  <rect width="150" height="28" rx="5" fill="#1a1a1a"/>
  <rect x="1" y="1" width="148" height="26" rx="4" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.6"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,sans-serif" font-size="11">
    <text x="50" y="18" fill="#ccc">vibecheck hardened</text>
    <text x="120" y="18" fill="${color}" font-weight="bold">${score}%</text>
  </g>
  <circle cx="14" cy="14" r="6" fill="none" stroke="${color}" stroke-width="1.5"/>
  <path d="M11 14l2 2 4-4" stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

// ---------------------------------------------------------------------------
// Markdown Snippet
// ---------------------------------------------------------------------------

function generateMarkdownSnippet(score: number): string {
  return `<!-- VibeCheck Readiness Badge -->
[![V2P Hardened](reports/readiness-badge.svg)](https://github.com/yourorg/vibecheck)

<!-- Or use the detail badge -->
[![V2P Hardened](reports/readiness-badge-detail.svg)](https://github.com/yourorg/vibecheck)

<!-- For dark backgrounds -->
[![V2P Hardened](reports/readiness-badge-shield.svg)](https://github.com/yourorg/vibecheck)

<!-- Score: ${score}% -->
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2);

  // Parse --score override
  const scoreIdx = args.indexOf("--score");
  let overrideScore: number | null = null;
  if (scoreIdx >= 0) {
    overrideScore = parseFloat(args[scoreIdx + 1] ?? "0");
  }

  const { composite, dimensions } = computeScores();
  const score = overrideScore ?? composite;

  // Ensure reports dir
  const reportsDir = resolve(ROOT, "reports");
  mkdirSync(reportsDir, { recursive: true });

  // Generate all badge variants
  writeFileSync(resolve(reportsDir, "readiness-badge.svg"), generateMainBadge(score));
  writeFileSync(resolve(reportsDir, "readiness-badge-detail.svg"), generateDetailBadge(score, dimensions));
  writeFileSync(resolve(reportsDir, "readiness-badge-shield.svg"), generateShieldBadge(score));
  writeFileSync(resolve(reportsDir, "badge-snippet.md"), generateMarkdownSnippet(score));

  console.log(`Badges generated (score: ${score}%):`);
  console.log(`  reports/readiness-badge.svg         — standard badge`);
  console.log(`  reports/readiness-badge-detail.svg   — per-dimension detail`);
  console.log(`  reports/readiness-badge-shield.svg   — shield style`);
  console.log(`  reports/badge-snippet.md             — markdown embed code`);
}

main();
