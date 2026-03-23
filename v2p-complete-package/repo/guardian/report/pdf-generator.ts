/**
 * AI Compliance Guardian — PDF/HTML Report Generator
 *
 * Generates a self-contained, printable HTML report that can be saved as PDF
 * via browser print (Ctrl+P → Save as PDF).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINDINGS_DIR = path.join(__dirname, '..', 'findings');

// ─── Domain Configuration ────────────────────────────────────────────

const DOMAIN_WEIGHTS: Record<number, number> = {
  4: 2.0, 6: 1.8, 5: 1.5, 7: 1.5, 9: 1.3,
  8: 1.2, 3: 1.0, 1: 1.0, 2: 1.0, 10: 1.0,
};

const DOMAIN_NAMES: Record<number, string> = {
  1: 'AI Governance & Accountability',
  2: 'Risk Management & Oversight',
  3: 'Model Lifecycle Security',
  4: 'Training & Inference Data Security',
  5: 'Model Integrity & Adversarial Resistance',
  6: 'Access Control & Identity Management',
  7: 'Infrastructure & MLOps Security',
  8: 'Monitoring, Logging & Incident Response',
  9: 'Third Party & Supply Chain Risk',
  10: 'Regulatory Compliance & Ethics',
};

const FRAMEWORKS = [
  'ISO 42001',
  'NIST AI RMF',
  'OWASP LLM',
  'GDPR',
  'SOC 2',
];

// ─── Data Types ──────────────────────────────────────────────────────

interface Finding {
  id: string;
  domain: number;
  control_id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  file: string;
  line: number;
  evidence: string;
  remediation: string;
  standard_refs: string[];
  auto_fixable: boolean;
  status: string;
  ts: string;
}

interface ScoreData {
  composite: number;
  domains: Record<string, number>;
}

interface ReportData {
  generatedAt: string;
  target: string;
  score: ScoreData;
  grade: string;
  findings: Finding[];
  openFindings: Finding[];
  severityCounts: Record<string, number>;
  domainDetails: DomainDetail[];
  frameworkMapping: FrameworkMapping[];
  remediationRoadmap: RemediationWeek[];
}

interface DomainDetail {
  id: number;
  name: string;
  score: number;
  weight: number;
  status: 'pass' | 'warn' | 'fail';
  findingCount: number;
}

interface FrameworkMapping {
  framework: string;
  totalControls: number;
  passingControls: number;
  failingControls: number;
  findings: string[];
}

interface RemediationWeek {
  label: string;
  severity: string;
  actions: string[];
}

// ─── Data Loading ────────────────────────────────────────────────────

function readFindings(): Finding[] {
  const file = path.join(FINDINGS_DIR, 'findings.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function readScore(): ScoreData {
  const file = path.join(FINDINGS_DIR, 'compliance-score.json');
  if (!fs.existsSync(file)) return { composite: 0, domains: {} };
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function getGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Report Data Assembly ────────────────────────────────────────────

function assembleReportData(target: string): ReportData {
  const findings = readFindings();
  const score = readScore();
  const openFindings = findings.filter(f => f.status === 'open');
  const grade = getGrade(score.composite);

  const severityCounts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of openFindings) {
    severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
  }

  const domainDetails: DomainDetail[] = [];
  for (let d = 1; d <= 10; d++) {
    const s = score.domains[String(d)] ?? 100;
    const count = openFindings.filter(f => f.domain === d).length;
    domainDetails.push({
      id: d,
      name: DOMAIN_NAMES[d],
      score: s,
      weight: DOMAIN_WEIGHTS[d],
      status: s >= 90 ? 'pass' : s >= 70 ? 'warn' : 'fail',
      findingCount: count,
    });
  }

  // Framework mapping — match findings to frameworks by standard_refs keywords
  const frameworkKeywords: Record<string, string[]> = {
    'ISO 42001': ['ISO', 'ISO-42001'],
    'NIST AI RMF': ['NIST', 'NIST-AI'],
    'OWASP LLM': ['OWASP', 'CWE'],
    'GDPR': ['GDPR'],
    'SOC 2': ['SOC2', 'SOC-2', 'SOC 2'],
  };

  const frameworkMapping: FrameworkMapping[] = FRAMEWORKS.map(fw => {
    const keywords = frameworkKeywords[fw] || [];
    const matched = openFindings.filter(f =>
      f.standard_refs.some(ref =>
        keywords.some(kw => ref.toUpperCase().includes(kw.toUpperCase()))
      )
    );
    const uniqueControls = new Set(matched.map(f => f.control_id));
    return {
      framework: fw,
      totalControls: Math.max(uniqueControls.size, 1),
      passingControls: matched.length === 0 ? 1 : 0,
      failingControls: uniqueControls.size,
      findings: matched.map(f => f.id),
    };
  });

  // Remediation roadmap
  const remediationRoadmap: RemediationWeek[] = [
    {
      label: 'Week 1: Critical (P0)',
      severity: 'P0',
      actions: [...new Set(
        openFindings.filter(f => f.severity === 'P0').map(f => `[${f.id}] ${f.remediation}`)
      )],
    },
    {
      label: 'Week 2: High (P1)',
      severity: 'P1',
      actions: [...new Set(
        openFindings.filter(f => f.severity === 'P1').map(f => `[${f.id}] ${f.remediation}`)
      )],
    },
    {
      label: 'Weeks 3–4: Medium & Low (P2/P3)',
      severity: 'P2/P3',
      actions: [...new Set(
        openFindings.filter(f => f.severity === 'P2' || f.severity === 'P3').map(f => `[${f.id}] ${f.remediation}`)
      )],
    },
  ];

  return {
    generatedAt: new Date().toISOString(),
    target,
    score,
    grade,
    findings,
    openFindings,
    severityCounts,
    domainDetails,
    frameworkMapping,
    remediationRoadmap,
  };
}

// ─── SVG Gauge ───────────────────────────────────────────────────────

function renderScoreGauge(score: number, grade: string): string {
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dashOffset = circumference * (1 - pct);
  const color = score >= 90 ? '#16a34a' : score >= 70 ? '#ca8a04' : score >= 50 ? '#ea580c' : '#dc2626';

  return `
    <svg width="200" height="200" viewBox="0 0 200 200" class="score-gauge">
      <circle cx="100" cy="100" r="${radius}" fill="none" stroke="#e5e7eb" stroke-width="14"/>
      <circle cx="100" cy="100" r="${radius}" fill="none" stroke="${color}" stroke-width="14"
        stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
        stroke-linecap="round" transform="rotate(-90 100 100)"/>
      <text x="100" y="90" text-anchor="middle" font-size="36" font-weight="700" fill="#1e293b">${score}%</text>
      <text x="100" y="120" text-anchor="middle" font-size="24" font-weight="600" fill="${color}">Grade ${grade}</text>
    </svg>`;
}

// ─── Severity Badge ──────────────────────────────────────────────────

function severityBadge(severity: string): string {
  const colors: Record<string, string> = {
    P0: '#dc2626',
    P1: '#ea580c',
    P2: '#ca8a04',
    P3: '#2563eb',
  };
  const labels: Record<string, string> = {
    P0: 'CRITICAL',
    P1: 'HIGH',
    P2: 'MEDIUM',
    P3: 'LOW',
  };
  const bg = colors[severity] || '#6b7280';
  const label = labels[severity] || severity;
  return `<span class="severity-badge" style="background:${bg}">${severity} ${label}</span>`;
}

// ─── HTML Generation ─────────────────────────────────────────────────

function renderHtml(data: ReportData): string {
  const {
    generatedAt, target, score, grade, openFindings,
    severityCounts, domainDetails, frameworkMapping, remediationRoadmap,
  } = data;

  const dateStr = new Date(generatedAt).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  // Sort findings by severity for display
  const severityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const sortedFindings = [...openFindings]
    .sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9))
    .slice(0, 30);

  // Most critical issue for exec summary
  const topFinding = sortedFindings[0];
  const keyRisk = topFinding
    ? `The most critical issue is ${topFinding.title.toLowerCase()} (${topFinding.id}) in ${topFinding.file}.`
    : 'No critical issues were identified.';

  // Executive summary text
  const totalOpen = openFindings.length;
  const execSummary = `This automated compliance audit identified ${totalOpen} open finding${totalOpen !== 1 ? 's' : ''} across the target codebase. ` +
    `The overall compliance score is ${score.composite}% (Grade ${grade}). ` +
    `${severityCounts.P0 > 0 ? `There are ${severityCounts.P0} critical (P0) findings requiring immediate attention. ` : ''}` +
    keyRisk;

  // ─── Findings HTML ───────────────────────────────────────────────
  let findingsHtml = '';
  let currentSeverity = '';
  for (const f of sortedFindings) {
    if (f.severity !== currentSeverity) {
      if (currentSeverity) findingsHtml += '</div>';
      currentSeverity = f.severity;
      const label: Record<string, string> = { P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low' };
      findingsHtml += `<div class="severity-group"><h3>${label[f.severity] || f.severity} Severity</h3>`;
    }
    findingsHtml += `
      <div class="finding-card">
        <div class="finding-header">
          ${severityBadge(f.severity)}
          <span class="finding-id">${escapeHtml(f.id)}</span>
          <span class="finding-title">${escapeHtml(f.title)}</span>
        </div>
        <div class="finding-meta">
          <span>${escapeHtml(f.file)}:${f.line}</span>
          <span class="finding-category">${escapeHtml(f.category)}</span>
          ${f.standard_refs.map(r => `<span class="ref-badge">${escapeHtml(r)}</span>`).join('')}
        </div>
        <div class="finding-evidence"><code>${escapeHtml(f.evidence)}</code></div>
        <div class="finding-remediation"><strong>Remediation:</strong> ${escapeHtml(f.remediation)}</div>
      </div>`;
  }
  if (currentSeverity) findingsHtml += '</div>';

  // ─── Domain Table ────────────────────────────────────────────────
  const domainRows = domainDetails.map(d => {
    const statusIcon = d.status === 'pass' ? '&#10003;' : d.status === 'warn' ? '&#9888;' : '&#10007;';
    const statusColor = d.status === 'pass' ? '#16a34a' : d.status === 'warn' ? '#ca8a04' : '#dc2626';
    const barWidth = Math.max(0, Math.min(100, d.score));
    const barColor = d.score >= 90 ? '#16a34a' : d.score >= 70 ? '#ca8a04' : '#dc2626';
    return `
      <tr>
        <td>D${String(d.id).padStart(2, '0')}</td>
        <td>${escapeHtml(d.name)}</td>
        <td class="num">${d.score}%</td>
        <td class="num">${d.weight.toFixed(1)}</td>
        <td>
          <div class="bar-track"><div class="bar-fill" style="width:${barWidth}%;background:${barColor}"></div></div>
        </td>
        <td style="color:${statusColor};font-weight:600;text-align:center">${statusIcon}</td>
        <td class="num">${d.findingCount}</td>
      </tr>`;
  }).join('');

  // ─── Framework Table ─────────────────────────────────────────────
  const fwRows = frameworkMapping.map(fw => {
    const status = fw.failingControls === 0 ? 'PASS' : 'FAIL';
    const statusColor = fw.failingControls === 0 ? '#16a34a' : '#dc2626';
    return `
      <tr>
        <td>${escapeHtml(fw.framework)}</td>
        <td class="num">${fw.findings.length}</td>
        <td class="num">${fw.failingControls}</td>
        <td style="color:${statusColor};font-weight:600;text-align:center">${status}</td>
      </tr>`;
  }).join('');

  // ─── Roadmap ─────────────────────────────────────────────────────
  const roadmapHtml = remediationRoadmap.map(week => {
    if (week.actions.length === 0) return '';
    return `
      <div class="roadmap-week">
        <h3>${escapeHtml(week.label)}</h3>
        <ul>${week.actions.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
      </div>`;
  }).join('');

  // ─── Full HTML Document ──────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Compliance Guardian — Security Audit Report</title>
<style>
  /* ── Base ────────────────────────────────────────── */
  :root {
    --blue: #2563eb;
    --blue-light: #dbeafe;
    --gray-50: #f8fafc;
    --gray-100: #f1f5f9;
    --gray-200: #e2e8f0;
    --gray-300: #cbd5e1;
    --gray-600: #475569;
    --gray-800: #1e293b;
    --gray-900: #0f172a;
    --red: #dc2626;
    --orange: #ea580c;
    --yellow: #ca8a04;
    --green: #16a34a;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: var(--gray-800);
    background: #fff;
    font-size: 13px;
    line-height: 1.6;
  }

  .page { max-width: 900px; margin: 0 auto; padding: 40px 32px; }

  h1, h2, h3 { color: var(--gray-900); }
  h1 { font-size: 28px; margin-bottom: 4px; }
  h2 {
    font-size: 20px;
    color: var(--blue);
    border-bottom: 2px solid var(--blue);
    padding-bottom: 6px;
    margin: 32px 0 16px;
  }
  h3 { font-size: 15px; margin: 16px 0 8px; }

  /* ── Cover / Header ─────────────────────────────── */
  .report-header {
    text-align: center;
    padding: 48px 0 32px;
    border-bottom: 3px solid var(--blue);
    margin-bottom: 32px;
  }
  .report-header .brand {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 3px;
    color: var(--blue);
    font-weight: 700;
    margin-bottom: 8px;
  }
  .report-header h1 { font-size: 32px; color: var(--gray-900); }
  .report-header .subtitle { color: var(--gray-600); font-size: 14px; margin-top: 4px; }
  .report-header .meta { color: var(--gray-600); font-size: 12px; margin-top: 16px; }

  .score-gauge { display: block; margin: 24px auto 0; }

  /* ── Executive Summary ──────────────────────────── */
  .exec-summary {
    background: var(--gray-50);
    border: 1px solid var(--gray-200);
    border-radius: 8px;
    padding: 20px 24px;
    margin-bottom: 8px;
  }
  .exec-summary p { margin-bottom: 8px; }

  .severity-counts {
    display: flex;
    gap: 16px;
    margin: 12px 0;
  }
  .severity-count {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    font-size: 14px;
  }
  .severity-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    display: inline-block;
  }

  /* ── Tables ─────────────────────────────────────── */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 24px;
    font-size: 12.5px;
  }
  th, td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--gray-200);
  }
  th {
    background: var(--gray-100);
    font-weight: 600;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--gray-600);
  }
  .num { text-align: right; font-variant-numeric: tabular-nums; }

  /* ── Progress Bars ──────────────────────────────── */
  .bar-track {
    width: 100%;
    height: 8px;
    background: var(--gray-200);
    border-radius: 4px;
    overflow: hidden;
    min-width: 80px;
  }
  .bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s;
  }

  /* ── Findings ───────────────────────────────────── */
  .finding-card {
    border: 1px solid var(--gray-200);
    border-radius: 6px;
    padding: 14px 16px;
    margin: 8px 0;
    page-break-inside: avoid;
  }
  .finding-header {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }
  .finding-id {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 12px;
    color: var(--gray-600);
    font-weight: 600;
  }
  .finding-title { font-weight: 600; font-size: 13px; }
  .finding-meta {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--gray-600);
    margin-bottom: 8px;
  }
  .finding-category {
    background: var(--gray-100);
    padding: 1px 6px;
    border-radius: 3px;
  }
  .ref-badge {
    background: var(--blue-light);
    color: var(--blue);
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
  }
  .finding-evidence {
    background: var(--gray-50);
    border: 1px solid var(--gray-200);
    border-radius: 4px;
    padding: 8px 12px;
    margin: 8px 0;
    overflow-x: auto;
  }
  .finding-evidence code {
    font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
    font-size: 11.5px;
    color: var(--gray-800);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .finding-remediation {
    font-size: 12px;
    color: var(--gray-600);
  }

  .severity-badge {
    display: inline-block;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .severity-group { margin-bottom: 24px; }
  .severity-group h3 { margin-top: 20px; }

  /* ── Roadmap ────────────────────────────────────── */
  .roadmap-week {
    margin-bottom: 20px;
    page-break-inside: avoid;
  }
  .roadmap-week ul {
    list-style: disc;
    padding-left: 24px;
    font-size: 12px;
  }
  .roadmap-week li { margin-bottom: 4px; }

  /* ── Footer ─────────────────────────────────────── */
  .report-footer {
    margin-top: 48px;
    padding-top: 16px;
    border-top: 2px solid var(--gray-200);
    text-align: center;
    font-size: 11px;
    color: var(--gray-600);
  }
  .report-footer .disclaimer {
    margin-top: 12px;
    font-style: italic;
    font-size: 10px;
    max-width: 700px;
    margin-left: auto;
    margin-right: auto;
  }

  /* ── Print CSS ──────────────────────────────────── */
  @media print {
    @page {
      size: A4;
      margin: 20mm 15mm 25mm 15mm;
    }

    body { font-size: 11px; }
    .page { padding: 0; max-width: none; }

    .report-header { padding-top: 24px; }

    h2 { page-break-after: avoid; }
    .finding-card { page-break-inside: avoid; }
    .roadmap-week { page-break-inside: avoid; }
    table { page-break-inside: auto; }
    tr { page-break-inside: avoid; }

    /* Section page breaks */
    .section-break { page-break-before: always; }

    /* Running header via CSS */
    @top-center {
      content: "AI Compliance Guardian — Security Audit Report";
      font-size: 8px;
      color: #94a3b8;
    }

    /* Ensure backgrounds print */
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- ─── Cover / Header ─────────────────────────── -->
  <div class="report-header">
    <div class="brand">AI Compliance Guardian</div>
    <h1>Security Audit Report</h1>
    <div class="subtitle">Automated Compliance Assessment</div>
    <div class="meta">
      <div>Generated: ${escapeHtml(dateStr)}</div>
      <div>Target: ${escapeHtml(target)}</div>
    </div>
    ${renderScoreGauge(score.composite, grade)}
  </div>

  <!-- ─── Executive Summary ──────────────────────── -->
  <h2>Executive Summary</h2>
  <div class="exec-summary">
    <p>${escapeHtml(execSummary)}</p>
    <div class="severity-counts">
      <div class="severity-count"><span class="severity-dot" style="background:var(--red)"></span> P0 Critical: ${severityCounts.P0}</div>
      <div class="severity-count"><span class="severity-dot" style="background:var(--orange)"></span> P1 High: ${severityCounts.P1}</div>
      <div class="severity-count"><span class="severity-dot" style="background:var(--yellow)"></span> P2 Medium: ${severityCounts.P2}</div>
      <div class="severity-count"><span class="severity-dot" style="background:var(--blue)"></span> P3 Low: ${severityCounts.P3}</div>
    </div>
    <p><strong>Standards Covered:</strong> ${FRAMEWORKS.join(', ')}</p>
  </div>

  <!-- ─── Domain Compliance Scores ───────────────── -->
  <div class="section-break"></div>
  <h2>Domain Compliance Scores</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Domain</th>
        <th class="num">Score</th>
        <th class="num">Weight</th>
        <th>Progress</th>
        <th style="text-align:center">Status</th>
        <th class="num">Findings</th>
      </tr>
    </thead>
    <tbody>
      ${domainRows}
    </tbody>
  </table>

  <!-- ─── Top Findings ───────────────────────────── -->
  <div class="section-break"></div>
  <h2>Top Findings</h2>
  <p style="color:var(--gray-600);font-size:12px;margin-bottom:12px;">
    Showing top ${sortedFindings.length} of ${openFindings.length} open findings, sorted by severity.
  </p>
  ${findingsHtml}

  <!-- ─── Compliance Framework Mapping ───────────── -->
  <div class="section-break"></div>
  <h2>Compliance Framework Mapping</h2>
  <table>
    <thead>
      <tr>
        <th>Framework</th>
        <th class="num">Related Findings</th>
        <th class="num">Failing Controls</th>
        <th style="text-align:center">Status</th>
      </tr>
    </thead>
    <tbody>
      ${fwRows}
    </tbody>
  </table>

  <!-- ─── Remediation Roadmap ────────────────────── -->
  <div class="section-break"></div>
  <h2>Remediation Roadmap</h2>
  ${roadmapHtml || '<p style="color:var(--gray-600)">No open findings to remediate.</p>'}

  <!-- ─── Footer ─────────────────────────────────── -->
  <div class="report-footer">
    <div>Generated by <strong>AI Compliance Guardian</strong></div>
    <div>${escapeHtml(dateStr)}</div>
    <div class="disclaimer">
      This report is generated by automated scanning tools and should be reviewed by qualified
      security professionals before making compliance decisions. Automated scanners may produce
      false positives and cannot detect all vulnerability classes. This report does not constitute
      legal advice or a formal compliance certification.
    </div>
  </div>

</div>
</body>
</html>`;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Generate a compliance report in HTML or JSON format.
 *
 * The HTML output is a self-contained, printable document designed for
 * browser print → Save as PDF (Ctrl+P).
 */
export function generateReport(options?: { target?: string; format?: 'html' | 'json' }): string {
  const target = options?.target || 'demo-app';
  const format = options?.format || 'html';
  const data = assembleReportData(target);

  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }

  return renderHtml(data);
}

/**
 * Generate the structured report data as a JSON string.
 */
export function generateJsonReport(options?: { target?: string }): string {
  const target = options?.target || 'demo-app';
  const data = assembleReportData(target);
  return JSON.stringify(data, null, 2);
}

// ─── CLI entrypoint ──────────────────────────────────────────────────
// Allows running directly: tsx report/pdf-generator.ts [--target name] [--format html|json] [--out file]

const isMain = process.argv[1] && (
  process.argv[1].endsWith('pdf-generator.ts') ||
  process.argv[1].endsWith('pdf-generator.js')
);

if (isMain) {
  const args = process.argv.slice(2);
  const targetIdx = args.indexOf('--target');
  const formatIdx = args.indexOf('--format');
  const outIdx = args.indexOf('--out');

  const target = targetIdx >= 0 ? args[targetIdx + 1] : 'demo-app';
  const format = (formatIdx >= 0 ? args[formatIdx + 1] : 'html') as 'html' | 'json';
  const outFile = outIdx >= 0 ? args[outIdx + 1] : undefined;

  const output = generateReport({ target, format });

  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, output);
    console.log(`Report written to ${outFile}`);
  } else {
    console.log(output);
  }
}
