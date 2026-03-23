/**
 * Guardian Autonomous Loop — Karpathy autoresearch + Ralph Wiggum hybrid
 *
 * scan → hypothesize → fix → gate → commit/revert → loop
 *
 * Key principles:
 * - Fixed time budget per iteration (Karpathy: makes results comparable)
 * - Fresh context per fix attempt (Ralph Wiggum: avoids context pollution)
 * - Persist learnings to progress.txt (Ralph Wiggum: accumulated wisdom)
 * - Git as memory (Karpathy: commit history informs future hypotheses)
 * - Confidence-gated judging (Semgrep: act only when confident)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARDIAN_ROOT = path.join(__dirname, '..');
const FINDINGS_DIR = path.join(GUARDIAN_ROOT, 'findings');
const PROGRESS_FILE = path.join(__dirname, 'progress.txt');
const LEDGER_FILE = path.join(FINDINGS_DIR, 'ledger.tsv');

interface LoopConfig {
  targetDir: string;
  hours: number;
  targetScore: number;
  autoFix: boolean;
  maxIterations: number;
  timeBudgetPerFix: number; // seconds
}

interface LoopResult {
  startScore: number;
  endScore: number;
  iterations: number;
  findings: number;
  fixes: number;
  reverts: number;
  duration: number;
}

// Domain weights from program.md
const DOMAIN_WEIGHTS: Record<number, number> = {
  4: 2.0, 6: 1.8, 5: 1.5, 7: 1.5, 9: 1.3,
  8: 1.2, 3: 1.0, 1: 1.0, 2: 1.0, 10: 1.0,
};

const PRIORITY_ORDER = [4, 6, 5, 7, 9, 8, 3, 1, 2, 10];

function readFindings(): Array<{ id: string; domain: number; severity: string; status: string }> {
  const findingsFile = path.join(FINDINGS_DIR, 'findings.jsonl');
  if (!fs.existsSync(findingsFile)) return [];
  return fs.readFileSync(findingsFile, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function readLedger(): string[] {
  if (!fs.existsSync(LEDGER_FILE)) return [];
  return fs.readFileSync(LEDGER_FILE, 'utf-8').split('\n').filter(Boolean);
}

function appendLedger(entry: string): void {
  fs.appendFileSync(LEDGER_FILE, entry + '\n');
}

function readProgress(): string {
  if (!fs.existsSync(PROGRESS_FILE)) return '';
  return fs.readFileSync(PROGRESS_FILE, 'utf-8');
}

function appendProgress(learning: string): void {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(PROGRESS_FILE, `[${timestamp}] ${learning}\n`);
}

function computeScore(findings: Array<{ domain: number; severity: string; status: string }>): number {
  const openFindings = findings.filter(f => f.status !== 'fixed' && f.status !== 'false_positive');
  const hasOpenP0 = openFindings.some(f => f.severity === 'P0');

  // Start at 100, deduct for open findings
  let score = 100;
  for (const f of openFindings) {
    const weight = DOMAIN_WEIGHTS[f.domain] || 1.0;
    const severityPenalty: Record<string, number> = { P0: 4, P1: 2, P2: 1, P3: 0.5 };
    score -= (severityPenalty[f.severity] || 0) * weight;
  }

  // P0 cap rule: any open P0 caps at 50%
  if (hasOpenP0) score = Math.min(score, 50);

  return Math.max(0, Math.round(score * 10) / 10);
}

function selectNextDomain(findings: Array<{ domain: number; severity: string; status: string }>): number {
  // Prioritize domains with open P0 findings first
  for (const domain of PRIORITY_ORDER) {
    const openP0 = findings.filter(f => f.domain === domain && f.severity === 'P0' && f.status === 'open');
    if (openP0.length > 0) return domain;
  }
  // Then highest-weight domains with any open findings
  for (const domain of PRIORITY_ORDER) {
    const open = findings.filter(f => f.domain === domain && f.status === 'open');
    if (open.length > 0) return domain;
  }
  // Default: cycle through in priority order
  return PRIORITY_ORDER[0];
}

export async function runLoop(config: LoopConfig): Promise<LoopResult> {
  const startTime = Date.now();
  const endTime = startTime + config.hours * 3600 * 1000;
  let iterations = 0;
  let fixes = 0;
  let reverts = 0;
  let noNewFindingsCount = 0;

  const findings = readFindings();
  const startScore = computeScore(findings);

  console.log(`\n🛡️  Guardian Loop Starting`);
  console.log(`   Target: ${config.targetDir}`);
  console.log(`   Budget: ${config.hours}h`);
  console.log(`   Target Score: ${config.targetScore}%`);
  console.log(`   Start Score: ${startScore}%`);
  console.log(`   Open Findings: ${findings.filter(f => f.status === 'open').length}`);
  console.log(`   Auto-fix: ${config.autoFix ? 'enabled' : 'disabled'}\n`);

  while (Date.now() < endTime && iterations < config.maxIterations) {
    iterations++;
    const domain = selectNextDomain(findings);
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    console.log(`\n--- Iteration ${iterations} (${elapsed}s elapsed) ---`);
    console.log(`   Domain: ${domain} (weight: ${DOMAIN_WEIGHTS[domain]}x)`);

    // Run scanner for this domain
    try {
      const scanResult = execSync(
        `npx tsx ${GUARDIAN_ROOT}/cli.ts scan --domain ${domain} --target "${config.targetDir}" --json`,
        { encoding: 'utf-8', timeout: config.timeBudgetPerFix * 1000, cwd: GUARDIAN_ROOT }
      );

      const newFindings = JSON.parse(scanResult);
      if (newFindings.length === 0) {
        noNewFindingsCount++;
        console.log(`   No new findings (${noNewFindingsCount}/3 empty cycles)`);
        if (noNewFindingsCount >= 3) {
          console.log(`   Stopping: 3 consecutive empty cycles`);
          break;
        }
        continue;
      }

      noNewFindingsCount = 0;
      console.log(`   Found: ${newFindings.length} findings`);

      // Attempt fix for highest priority finding
      if (config.autoFix) {
        const topFinding = newFindings
          .sort((a: { severity: string }, b: { severity: string }) => {
            const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
            return (order[a.severity as keyof typeof order] ?? 4) - (order[b.severity as keyof typeof order] ?? 4);
          })[0];

        console.log(`   Fixing: ${topFinding.id} (${topFinding.severity}) — ${topFinding.title}`);

        try {
          execSync(
            `bash ${GUARDIAN_ROOT}/loop/run-fix.sh "${topFinding.id}" "${config.targetDir}"`,
            { encoding: 'utf-8', timeout: config.timeBudgetPerFix * 1000, cwd: GUARDIAN_ROOT }
          );
          fixes++;
          appendLedger(`${new Date().toISOString()}\t${topFinding.id}\t${topFinding.severity}\tcommitted\t${topFinding.title}`);
          appendProgress(`Fixed ${topFinding.id}: ${topFinding.title}`);
          console.log(`   ✅ Committed`);
        } catch {
          reverts++;
          appendLedger(`${new Date().toISOString()}\t${topFinding.id}\t${topFinding.severity}\treverted\t${topFinding.title}`);
          appendProgress(`Reverted ${topFinding.id}: fix attempt failed — ${topFinding.title}`);
          console.log(`   ❌ Reverted`);
        }
      }
    } catch (err) {
      console.log(`   ⚠️  Scanner error, skipping domain ${domain}`);
      appendProgress(`Scanner error on domain ${domain}: ${err instanceof Error ? err.message : 'unknown'}`);
    }

    // Check score
    const currentFindings = readFindings();
    const currentScore = computeScore(currentFindings);
    console.log(`   Score: ${currentScore}% (target: ${config.targetScore}%)`);

    if (currentScore >= config.targetScore) {
      console.log(`\n🎯 Target score reached: ${currentScore}% ≥ ${config.targetScore}%`);
      break;
    }
  }

  const endFindings = readFindings();
  const endScore = computeScore(endFindings);
  const duration = Math.round((Date.now() - startTime) / 1000);

  const result: LoopResult = {
    startScore,
    endScore,
    iterations,
    findings: endFindings.length,
    fixes,
    reverts,
    duration,
  };

  console.log(`\n━━━ Guardian Loop Complete ━━━`);
  console.log(`   Duration: ${duration}s`);
  console.log(`   Iterations: ${iterations}`);
  console.log(`   Score: ${startScore}% → ${endScore}%`);
  console.log(`   Fixes: ${fixes} committed, ${reverts} reverted`);
  console.log(`   Commit rate: ${iterations > 0 ? Math.round(fixes / iterations * 100) : 0}%\n`);

  return result;
}

// CLI entry
if (process.argv[1] && process.argv[1].includes('run-loop')) {
  const args = process.argv.slice(2);
  const targetDir = args.find(a => !a.startsWith('--')) || '.';
  const hours = parseFloat(args.find(a => a.startsWith('--hours='))?.split('=')[1] || '1');
  const target = parseInt(args.find(a => a.startsWith('--target='))?.split('=')[1] || '90');

  runLoop({
    targetDir,
    hours,
    targetScore: target,
    autoFix: !args.includes('--no-fix'),
    maxIterations: 1000,
    timeBudgetPerFix: 300,
  }).catch(console.error);
}
