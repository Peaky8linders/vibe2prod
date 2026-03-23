/**
 * scripts/generate-report.ts — Produce a stakeholder-ready HTML report
 *
 * Reads logs/fixes.jsonl and evals/defect-taxonomy.json to generate
 * a visual report showing hardening progress, defects closed, and
 * remaining work.
 *
 * Usage:
 *   npx tsx scripts/generate-report.ts
 *   npx tsx scripts/generate-report.ts --output reports/2026-03-22.html
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";

interface FixLog {
  status: "committed" | "reverted" | "crash";
  defect_id?: string;
  baseline?: number;
  new_score?: number;
  delta?: number;
  timestamp?: string;
  reason?: Record<string, boolean | number>;
  type?: string;
  attempts?: number;
  commits?: number;
  reverts?: number;
  start_score?: number;
  end_score?: number;
  hours?: number;
  dimension?: string;
}

interface Defect {
  id: string;
  dimension: string;
  priority: string;
  file: string;
  description: string;
  fixed: boolean;
  needs_human_review: boolean;
}

function main(): void {
  const outputPath = process.argv.find((a) => a.startsWith("--output="))?.split("=")[1]
    ?? `reports/report-${new Date().toISOString().slice(0, 10)}.html`;

  // Load logs
  const logsPath = "logs/fixes.jsonl";
  const logs: FixLog[] = [];
  if (existsSync(logsPath)) {
    const raw = readFileSync(logsPath, "utf-8").trim();
    if (raw) {
      for (const line of raw.split("\n")) {
        try { logs.push(JSON.parse(line)); } catch { /* skip malformed */ }
      }
    }
  }

  // Load taxonomy
  let allDefects: Defect[] = [];
  let totalDefects = 0;
  let fixedDefects = 0;
  const dimStats: Record<string, { total: number; fixed: number; p0: number; p1: number; p0_fixed: number }> = {};

  if (existsSync("evals/defect-taxonomy.json")) {
    const taxonomy = JSON.parse(readFileSync("evals/defect-taxonomy.json", "utf-8"));
    for (const [name, dim] of Object.entries(taxonomy.dimensions ?? {})) {
      const d = dim as { defects: Defect[] };
      const defects = d.defects ?? [];
      allDefects.push(...defects);
      totalDefects += defects.length;
      const fixed = defects.filter((x) => x.fixed).length;
      fixedDefects += fixed;
      dimStats[name] = {
        total: defects.length,
        fixed,
        p0: defects.filter((x) => x.priority === "P0").length,
        p1: defects.filter((x) => x.priority === "P1").length,
        p0_fixed: defects.filter((x) => x.priority === "P0" && x.fixed).length,
      };
    }
  }

  // Compute stats from logs
  const commits = logs.filter((l) => l.status === "committed");
  const reverts = logs.filter((l) => l.status === "reverted");
  const crashes = logs.filter((l) => l.status === "crash");
  const summaries = logs.filter((l) => l.type === "overnight_summary");
  const latestSummary = summaries[summaries.length - 1];

  const commitRate = commits.length + reverts.length + crashes.length > 0
    ? Math.round((commits.length / (commits.length + reverts.length + crashes.length)) * 100)
    : 0;

  // Score trajectory
  const scorePoints = commits
    .filter((l) => l.new_score !== undefined && l.timestamp)
    .map((l) => ({ score: l.new_score!, ts: l.timestamp! }));

  const startScore = latestSummary?.start_score ?? scorePoints[0]?.score ?? 0;
  const endScore = latestSummary?.end_score ?? scorePoints[scorePoints.length - 1]?.score ?? startScore;

  // Open P0s
  const openP0 = allDefects.filter((d) => d.priority === "P0" && !d.fixed);
  const humanReview = allDefects.filter((d) => d.needs_human_review && !d.fixed);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Vibe-to-Prod Hardening Report</title>
<style>
  :root { --bg:#0a0a0b; --s:#111113; --s2:#18181b; --b:#27272a; --t:#fafafa; --tm:#a1a1aa; --td:#71717a; --a:#f97316; --g:#22c55e; --r:#ef4444; --bl:#3b82f6; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'DM Sans',system-ui,sans-serif; background:var(--bg); color:var(--t); line-height:1.6; }
  .c { max-width:800px; margin:0 auto; padding:2rem; }
  h1 { font-size:1.8rem; margin-bottom:0.5rem; }
  h2 { font-size:1.2rem; margin:2rem 0 1rem; color:var(--a); font-weight:600; }
  p { color:var(--tm); margin-bottom:0.75rem; }
  .meta { font-family:monospace; font-size:0.75rem; color:var(--td); margin-bottom:2rem; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:1rem; margin:1rem 0; }
  .card { background:var(--s); border:1px solid var(--b); border-radius:10px; padding:1.25rem; }
  .card .label { font-size:0.7rem; text-transform:uppercase; letter-spacing:0.1em; color:var(--td); margin-bottom:0.25rem; }
  .card .value { font-size:1.8rem; font-weight:700; }
  .card .sub { font-size:0.78rem; color:var(--td); margin-top:0.25rem; }
  .green { color:var(--g); }
  .red { color:var(--r); }
  .orange { color:var(--a); }
  .blue { color:var(--bl); }
  .dim-row { display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0; border-bottom:1px solid var(--b); }
  .dim-row:last-child { border:none; }
  .dim-name { font-weight:600; font-size:0.9rem; }
  .dim-bar { flex:1; margin:0 1rem; height:6px; background:var(--s2); border-radius:3px; overflow:hidden; }
  .dim-fill { height:100%; border-radius:3px; transition:width 0.3s; }
  .dim-pct { font-family:monospace; font-size:0.82rem; width:50px; text-align:right; }
  .alert { background:rgba(239,68,68,0.1); border:1px solid var(--r); border-radius:8px; padding:1rem 1.25rem; margin:1rem 0; }
  .alert .label { color:var(--r); font-weight:700; font-size:0.8rem; text-transform:uppercase; letter-spacing:0.1em; }
  .alert p { color:var(--tm); margin:0.5rem 0 0; font-size:0.88rem; }
  table { width:100%; border-collapse:collapse; margin:1rem 0; font-size:0.82rem; }
  th { text-align:left; padding:0.5rem 0.75rem; border-bottom:1px solid var(--b); color:var(--td); font-size:0.7rem; text-transform:uppercase; letter-spacing:0.1em; }
  td { padding:0.5rem 0.75rem; border-bottom:1px solid rgba(39,39,42,0.4); color:var(--tm); }
  td:first-child { color:var(--t); font-weight:500; }
  .tag { display:inline-block; padding:0.1rem 0.5rem; border-radius:4px; font-size:0.7rem; font-weight:600; }
  .tag-p0 { background:rgba(239,68,68,0.15); color:var(--r); }
  .tag-p1 { background:rgba(249,115,22,0.15); color:var(--a); }
  .tag-p2 { background:rgba(59,130,246,0.1); color:var(--bl); }
  .footer { margin-top:3rem; padding-top:1.5rem; border-top:1px solid var(--b); text-align:center; }
  .footer p { font-size:0.78rem; color:var(--td); }
</style>
</head>
<body>
<div class="c">
  <h1>Hardening Report</h1>
  <div class="meta">Generated ${new Date().toISOString()} · vibe-to-prod v1.0</div>

  <h2>Overview</h2>
  <div class="grid">
    <div class="card">
      <div class="label">Readiness Score</div>
      <div class="value ${endScore >= 0.8 ? 'green' : endScore >= 0.5 ? 'orange' : 'red'}">${(endScore * 100).toFixed(1)}%</div>
      <div class="sub">from ${(startScore * 100).toFixed(1)}%</div>
    </div>
    <div class="card">
      <div class="label">Defects Closed</div>
      <div class="value green">${fixedDefects}</div>
      <div class="sub">of ${totalDefects} total</div>
    </div>
    <div class="card">
      <div class="label">Commit Rate</div>
      <div class="value ${commitRate >= 20 ? 'green' : commitRate >= 10 ? 'orange' : 'red'}">${commitRate}%</div>
      <div class="sub">${commits.length} commits / ${commits.length + reverts.length + crashes.length} attempts</div>
    </div>
    <div class="card">
      <div class="label">Open P0s</div>
      <div class="value ${openP0.length === 0 ? 'green' : 'red'}">${openP0.length}</div>
      <div class="sub">${openP0.length === 0 ? 'deploy ready' : 'blocks deploy'}</div>
    </div>
  </div>

  ${openP0.length > 0 ? `
  <div class="alert">
    <div class="label">P0 Defects Open — Deployment Blocked</div>
    ${openP0.map((d) => `<p><strong>${d.id}</strong>: ${d.description} <span style="color:var(--td)">(${d.file})</span></p>`).join("")}
  </div>` : ""}

  ${humanReview.length > 0 ? `
  <div class="alert" style="border-color:var(--a); background:rgba(249,115,22,0.08);">
    <div class="label" style="color:var(--a);">Needs Human Review</div>
    ${humanReview.map((d) => `<p><strong>${d.id}</strong>: ${d.description}</p>`).join("")}
  </div>` : ""}

  <h2>Dimensions</h2>
  ${Object.entries(dimStats).map(([name, s]) => {
    const pct = s.total > 0 ? Math.round((s.fixed / s.total) * 100) : 100;
    const color = pct >= 80 ? "var(--g)" : pct >= 50 ? "var(--a)" : "var(--r)";
    return `
    <div class="dim-row">
      <span class="dim-name">${name}</span>
      <div class="dim-bar"><div class="dim-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="dim-pct" style="color:${color}">${pct}%</span>
    </div>`;
  }).join("")}

  ${allDefects.filter((d) => !d.fixed).length > 0 ? `
  <h2>Open Defects</h2>
  <table>
    <thead><tr><th>ID</th><th>Priority</th><th>Dimension</th><th>Description</th></tr></thead>
    <tbody>
    ${allDefects.filter((d) => !d.fixed).slice(0, 30).map((d) => `
      <tr>
        <td>${d.id}</td>
        <td><span class="tag tag-${d.priority.toLowerCase()}">${d.priority}</span></td>
        <td>${d.dimension}</td>
        <td style="color:var(--tm)">${d.description}</td>
      </tr>`).join("")}
    </tbody>
  </table>` : ""}

  <div class="footer">
    <p>Vibe-to-Prod · Autonomous Production Hardening</p>
  </div>
</div>
</body>
</html>`;

  // Ensure reports dir exists
  const dir = outputPath.split("/").slice(0, -1).join("/");
  if (dir) {
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(outputPath, html);
  console.log(`Report written to ${outputPath}`);
}

main();
