/**
 * Guardian Dashboard API Server
 *
 * Serves the interactive findings browser UI and provides
 * API endpoints for scanning, fixing, and configuration.
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUARDIAN_ROOT = path.join(__dirname, '..');
const FINDINGS_DIR = path.join(GUARDIAN_ROOT, 'findings');
const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.guardian');

fs.mkdirSync(CONFIG_DIR, { recursive: true });
fs.mkdirSync(FINDINGS_DIR, { recursive: true });

const CONFIG_FILE = path.join(CONFIG_DIR, 'config.yaml');

function readConfig(): Record<string, string> {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
  const config: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const [key, ...val] = line.split(':');
    if (key && val.length) config[key.trim()] = val.join(':').trim();
  }
  return config;
}

function writeConfig(config: Record<string, string>): void {
  const content = Object.entries(config).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(CONFIG_FILE, content);
}

function readFindings(): Array<Record<string, unknown>> {
  const file = path.join(FINDINGS_DIR, 'findings.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function readScore(): Record<string, unknown> {
  const file = path.join(FINDINGS_DIR, 'compliance-score.json');
  if (!fs.existsSync(file)) return { composite: 0, domains: {} };
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

export async function startDashboard(port = 3002): Promise<void> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve dashboard UI
  app.use('/', express.static(path.join(__dirname)));

  // API: Get findings
  app.get('/api/findings', (_req, res) => {
    const findings = readFindings();
    res.json(findings);
  });

  // API: Get compliance score
  app.get('/api/score', (_req, res) => {
    res.json(readScore());
  });

  // API: Get config (mask API keys)
  app.get('/api/config', (_req, res) => {
    const config = readConfig();
    const masked = { ...config };
    if (masked.claude_api_key) masked.claude_api_key = masked.claude_api_key.substring(0, 10) + '...';
    if (masked.codex_api_key) masked.codex_api_key = masked.codex_api_key.substring(0, 10) + '...';
    res.json(masked);
  });

  // API: Update config
  app.post('/api/config', (req, res) => {
    const config = readConfig();
    const updates = req.body;
    for (const [key, val] of Object.entries(updates)) {
      if (typeof val === 'string' && val.trim()) {
        config[key] = val.trim();
      }
    }
    writeConfig(config);
    res.json({ saved: true });
  });

  // API: Run scan
  app.post('/api/scan', async (_req, res) => {
    try {
      const { runAllScanners } = await import('../scanners/index.js');
      const targetDir = path.join(GUARDIAN_ROOT, '..', 'target', 'demo-app');
      const result = await runAllScanners(targetDir);
      const findings = result.findings;

      // Save to file
      const findingsFile = path.join(FINDINGS_DIR, 'findings.jsonl');
      // Clear previous findings for a fresh scan
      const entries = findings.map((f: Record<string, unknown>) => JSON.stringify({ ...f, status: 'open', ts: new Date().toISOString() }));
      fs.writeFileSync(findingsFile, entries.join('\n') + '\n');

      res.json({ count: findings.length, findings });
    } catch (err) {
      res.status(500).json({ error: 'Scan failed', details: err instanceof Error ? err.message : 'unknown' });
    }
  });

  // API: Fix a finding (dispatches subagent)
  app.post('/api/fix/:findingId', async (req, res) => {
    const { findingId } = req.params;
    const config = readConfig();

    if (!config.claude_api_key) {
      res.status(400).json({ error: 'Claude API key not configured. Add it in Settings.' });
      return;
    }

    const findings = readFindings();
    const finding = findings.find(f => f.id === findingId);
    if (!finding) {
      res.status(404).json({ error: 'Finding not found' });
      return;
    }

    // Return immediately — fix runs async
    res.json({ status: 'dispatched', findingId, message: 'Fix agent started. Check findings for status updates.' });

    // TODO: Dispatch Claude API subagent here using the API key
    // For now, mark as in_progress
    const findingsFile = path.join(FINDINGS_DIR, 'findings.jsonl');
    const updated = findings.map(f => {
      if (f.id === findingId) return { ...f, status: 'in_progress' };
      return f;
    });
    fs.writeFileSync(findingsFile, updated.map(f => JSON.stringify(f)).join('\n') + '\n');
  });

  // API: Get findings queue (from hooks)
  app.get('/api/queue', (_req, res) => {
    const queueFile = path.join(CONFIG_DIR, 'findings-queue.jsonl');
    if (!fs.existsSync(queueFile)) {
      res.json([]);
      return;
    }
    const entries = fs.readFileSync(queueFile, 'utf-8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    res.json(entries);
  });

  app.listen(port, () => {
    console.log(`\n🛡️  Guardian Dashboard`);
    console.log(`   http://localhost:${port}`);
    console.log(`   Findings: ${readFindings().length}`);
    console.log(`   Score: ${readScore().composite || '--'}%\n`);
  });
}

if (process.argv[1]?.includes('api')) {
  startDashboard().catch(console.error);
}
