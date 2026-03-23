#!/usr/bin/env tsx
/**
 * AI Compliance Guardian CLI
 *
 * Commands:
 *   scan [--preset <name>] [--domain <n>] [--target <dir>]  Run compliance scan
 *   fix [--finding <id>]                                     Fix a specific finding
 *   loop [--hours <n>] [--target <score>]                    Autonomous remediation loop
 *   score [--target <dir>]                                   Show compliance score
 *   dashboard                                                 Start interactive dashboard
 *   report                                                    Generate compliance report
 *   status                                                    Quick status summary
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FINDINGS_DIR = path.join(__dirname, 'findings');

// Ensure directories exist
fs.mkdirSync(FINDINGS_DIR, { recursive: true });

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

function readFindings(): Finding[] {
  const file = path.join(FINDINGS_DIR, 'findings.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((f): f is Finding => f !== null);
}

function computeScore(findings: Finding[]): { composite: number; domains: Record<number, number> } {
  const openFindings = findings.filter(f => f.status === 'open');
  const hasOpenP0 = openFindings.some(f => f.severity === 'P0');

  const domainScores: Record<number, number> = {};
  for (let d = 1; d <= 10; d++) {
    const domainOpen = openFindings.filter(f => f.domain === d);
    let score = 100;
    for (const f of domainOpen) {
      const penalty: Record<string, number> = { P0: 15, P1: 8, P2: 3, P3: 1 };
      score -= penalty[f.severity] || 0;
    }
    domainScores[d] = Math.max(0, score);
  }

  let weightedSum = 0;
  let weightSum = 0;
  for (let d = 1; d <= 10; d++) {
    const w = DOMAIN_WEIGHTS[d] || 1.0;
    weightedSum += domainScores[d] * w;
    weightSum += 100 * w;
  }

  let composite = Math.round(weightedSum / weightSum * 1000) / 10;
  if (hasOpenP0) composite = Math.min(composite, 50);

  return { composite, domains: domainScores };
}

async function cmdScan(args: string[]) {
  const targetIdx = args.indexOf('--target');
  const githubIdx = args.indexOf('--github');
  const urlIdx = args.indexOf('--url');
  const isJson = args.includes('--json');

  let findings: Finding[];

  // GitHub repo scan
  if (githubIdx >= 0 && args[githubIdx + 1]) {
    const githubUrl = args[githubIdx + 1];
    if (!isJson) {
      console.log(`\n🛡️  Guardian Scan (GitHub)\n   Repo: ${githubUrl}\n`);
      console.log('   Cloning repository...');
    }
    const { scanGitHubRepo } = await import('./scanners/github-scanner.js');
    const result = await scanGitHubRepo(githubUrl);
    findings = result.findings;
    // Save score
    fs.writeFileSync(path.join(FINDINGS_DIR, 'compliance-score.json'), JSON.stringify(result.score));
  }
  // DAST URL scan
  else if (urlIdx >= 0 && args[urlIdx + 1]) {
    const targetUrl = args[urlIdx + 1];
    if (!isJson) console.log(`\n🛡️  Guardian Scan (DAST)\n   URL: ${targetUrl}\n`);
    const { scan: dastScan } = await import('./scanners/dast-scanner.js');
    findings = await dastScan(targetUrl);
  }
  // Local directory scan (default)
  else {
    const targetDir = targetIdx >= 0 ? args[targetIdx + 1] : path.join(__dirname, '..', 'target', 'demo-app');
    if (!isJson) console.log(`\n🛡️  Guardian Scan\n   Target: ${targetDir}\n`);
    const { runAllScanners } = await import('./scanners/index.js');
    const result = await runAllScanners(targetDir);
    findings = result.findings;
  }

  // Save findings
  const findingsFile = path.join(FINDINGS_DIR, 'findings.jsonl');
  const existing = readFindings();
  const existingIds = new Set(existing.map(f => f.id));

  let newCount = 0;
  for (const f of findings) {
    if (!existingIds.has(f.id)) {
      const entry = { ...f, status: 'open', ts: new Date().toISOString() };
      fs.appendFileSync(findingsFile, JSON.stringify(entry) + '\n');
      newCount++;
    }
  }

  if (isJson) {
    console.log(JSON.stringify(findings));
  } else {
    const scanLabel = githubIdx >= 0 ? args[githubIdx + 1] : urlIdx >= 0 ? args[urlIdx + 1] : (targetIdx >= 0 ? args[targetIdx + 1] : 'demo-app');
    console.log(`   Scanned: ${scanLabel}`);
    console.log(`   Total findings: ${findings.length}`);
    console.log(`   New findings: ${newCount}`);
    console.log(`   By severity:`);
    for (const sev of ['P0', 'P1', 'P2', 'P3']) {
      const count = findings.filter(f => f.severity === sev).length;
      if (count > 0) {
        const icon = sev === 'P0' ? '🔴' : sev === 'P1' ? '🟠' : sev === 'P2' ? '🟡' : '🔵';
        console.log(`     ${icon} ${sev}: ${count}`);
      }
    }

    if (findings.length > 0) {
      console.log(`\n   Top findings:`);
      for (const f of findings.slice(0, 10)) {
        const icon = f.severity === 'P0' ? '🔴' : f.severity === 'P1' ? '🟠' : f.severity === 'P2' ? '🟡' : '🔵';
        console.log(`     ${icon} [${f.id}] ${f.title}`);
        console.log(`        ${f.file}:${f.line} — ${f.category}`);
      }
    }

    // Compute and save score
    const allFindings = readFindings();
    const score = computeScore(allFindings);
    fs.writeFileSync(
      path.join(FINDINGS_DIR, 'compliance-score.json'),
      JSON.stringify(score, null, 2)
    );
    console.log(`\n   Compliance Score: ${score.composite}%`);
  }
}

function cmdScore(args: string[]) {
  const isJson = args.includes('--json');
  const findings = readFindings();
  const score = computeScore(findings);

  fs.writeFileSync(
    path.join(FINDINGS_DIR, 'compliance-score.json'),
    JSON.stringify(score, null, 2)
  );

  if (isJson) {
    console.log(JSON.stringify(score));
    return;
  }

  const open = findings.filter(f => f.status === 'open');
  console.log(`\n🛡️  Compliance Score: ${score.composite}%\n`);
  console.log(`   Open findings: ${open.length}`);
  console.log(`     P0 (critical): ${open.filter(f => f.severity === 'P0').length}`);
  console.log(`     P1 (high):     ${open.filter(f => f.severity === 'P1').length}`);
  console.log(`     P2 (medium):   ${open.filter(f => f.severity === 'P2').length}`);
  console.log(`     P3 (low):      ${open.filter(f => f.severity === 'P3').length}`);
  console.log(`\n   Domain Scores:`);
  for (let d = 1; d <= 10; d++) {
    const s = score.domains[d];
    const bar = '█'.repeat(Math.round(s / 5)) + '░'.repeat(20 - Math.round(s / 5));
    const icon = s >= 90 ? '✅' : s >= 70 ? '🟡' : '🔴';
    console.log(`     ${icon} D${d.toString().padStart(2, '0')} ${bar} ${s}% — ${DOMAIN_NAMES[d]}`);
  }
}

async function cmdDashboard() {
  const { startDashboard } = await import('./dashboard/api.js');
  await startDashboard();
}

async function cmdLoop(args: string[]) {
  const hoursIdx = args.indexOf('--hours');
  const targetIdx = args.indexOf('--target');
  const hours = hoursIdx >= 0 ? parseFloat(args[hoursIdx + 1]) : 1;
  const targetScore = targetIdx >= 0 ? parseInt(args[targetIdx + 1]) : 90;

  const { runLoop } = await import('./loop/run-loop.js');
  await runLoop({
    targetDir: path.join(__dirname, '..', 'target', 'demo-app'),
    hours,
    targetScore,
    autoFix: !args.includes('--no-fix'),
    maxIterations: 1000,
    timeBudgetPerFix: 300,
  });
}

function cmdStatus() {
  const findings = readFindings();
  const open = findings.filter(f => f.status === 'open');
  const score = computeScore(findings);

  const p0 = open.filter(f => f.severity === 'P0').length;
  const p1 = open.filter(f => f.severity === 'P1').length;

  if (open.length === 0) {
    console.log(`🛡️ Guardian: No open findings | Score: ${score.composite}%`);
  } else {
    console.log(`🛡️ Guardian: ${open.length} open (${p0} P0, ${p1} P1) | Score: ${score.composite}%`);
  }
}

// Main
const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
  case 'scan':
    cmdScan(args).catch(console.error);
    break;
  case 'score':
    cmdScore(args);
    break;
  case 'dashboard':
    cmdDashboard().catch(console.error);
    break;
  case 'loop':
    cmdLoop(args).catch(console.error);
    break;
  case 'status':
    cmdStatus();
    break;
  default:
    console.log(`
🛡️  AI Compliance Guardian

Commands:
  scan [--preset <name>] [--target <dir>]  Run compliance scan
  score [--target <dir>]                   Show compliance score
  dashboard                                Start interactive dashboard
  loop [--hours <n>] [--target <score>]    Autonomous remediation loop
  status                                   Quick status summary

Presets: quick, gdpr, soc2, eu-ai-act, owasp-llm, full

Examples:
  guardian scan --preset quick
  guardian score
  guardian loop --hours 2 --target 90
  guardian dashboard
`);
}
