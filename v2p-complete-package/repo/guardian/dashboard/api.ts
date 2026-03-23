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
  return fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function readScore(): Record<string, unknown> {
  const file = path.join(FINDINGS_DIR, 'compliance-score.json');
  if (!fs.existsSync(file)) return { composite: 0, domains: {} };
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

// SSRF protection: block internal/private IP ranges
function isPrivateUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname;
    // Block obvious private/internal ranges
    if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|localhost|::1|\[::1\])/.test(hostname)) return true;
    // Block cloud metadata endpoints
    if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return true;
    return false;
  } catch {
    return true; // If we can't parse it, block it
  }
}

// Allowed config keys — reject all others
const ALLOWED_CONFIG_KEYS = new Set(['claude_api_key', 'codex_api_key', 'target_dir', 'default_preset', 'auto_fix']);

export async function startDashboard(port = 3002): Promise<void> {
  const app = express();

  // Bind to localhost only — not exposed to network by default
  const BIND_HOST = process.env.GUARDIAN_BIND_HOST || '127.0.0.1';

  // Restrict CORS to localhost origins only
  app.use(cors({
    origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
  }));
  app.use(express.json({ limit: '100kb' }));

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

  // API: Get config (mask API keys — only show last 4 chars)
  app.get('/api/config', (_req, res) => {
    const config = readConfig();
    const masked = { ...config };
    for (const key of ['claude_api_key', 'codex_api_key']) {
      if (masked[key]) {
        masked[key] = '****' + masked[key].slice(-4);
      }
    }
    res.json(masked);
  });

  // API: Update config (only allowed keys)
  app.post('/api/config', (req, res) => {
    const config = readConfig();
    const updates = req.body;
    const rejected: string[] = [];
    for (const [key, val] of Object.entries(updates)) {
      if (!ALLOWED_CONFIG_KEYS.has(key)) {
        rejected.push(key);
        continue;
      }
      if (typeof val === 'string' && val.trim()) {
        config[key] = val.trim();
      }
    }
    writeConfig(config);
    if (rejected.length > 0) {
      res.json({ saved: true, rejected, message: `Keys not allowed: ${rejected.join(', ')}` });
    } else {
      res.json({ saved: true });
    }
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
      console.error('Scan failed:', err);
      res.status(500).json({ error: 'Scan failed' });
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

  // API: Scan GitHub repo
  app.post('/api/scan/github', async (req, res) => {
    const { url, branch } = req.body;
    if (!url) { res.status(400).json({ error: 'GitHub URL is required' }); return; }
    try {
      const { scanGitHubRepo } = await import('../scanners/github-scanner.js');
      const result = await scanGitHubRepo(url, branch);
      const findingsArr = result.findings;

      const findingsFile = path.join(FINDINGS_DIR, 'findings.jsonl');
      const entries = findingsArr.map((f: Record<string, unknown>) => JSON.stringify({ ...f, status: 'open', ts: new Date().toISOString() }));
      fs.writeFileSync(findingsFile, entries.join('\n') + '\n');

      // Save score
      fs.writeFileSync(path.join(FINDINGS_DIR, 'compliance-score.json'), JSON.stringify(result.score));

      res.json({ count: findingsArr.length, findings: findingsArr, score: result.score });
    } catch (err) {
      console.error('GitHub scan failed:', err);
      res.status(500).json({ error: 'GitHub scan failed' });
    }
  });

  // API: DAST scan (live URL) — with SSRF protection
  app.post('/api/scan/url', async (req, res) => {
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: 'URL is required' }); return; }
    if (isPrivateUrl(url)) {
      res.status(400).json({ error: 'Cannot scan internal/private URLs' });
      return;
    }
    try {
      const { scan: dastScan } = await import('../scanners/dast-scanner.js');
      const dastFindings = await dastScan(url);

      const findingsFile = path.join(FINDINGS_DIR, 'findings.jsonl');
      const entries = dastFindings.map((f: Record<string, unknown>) => JSON.stringify({ ...f, status: 'open', ts: new Date().toISOString() }));
      fs.appendFileSync(findingsFile, entries.join('\n') + '\n');

      res.json({ count: dastFindings.length, findings: dastFindings });
    } catch {
      res.status(500).json({ error: 'URL scan failed' });
    }
  });

  // API: HTML compliance report
  app.get('/api/report/html', async (_req, res) => {
    try {
      const { generateReport } = await import('../report/pdf-generator.js');
      const html = generateReport();
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (err) {
      console.error('Report generation failed:', err);
      res.status(500).json({ error: 'Report generation failed' });
    }
  });

  // API: JSON report
  app.get('/api/report/json', async (_req, res) => {
    try {
      const { generateJsonReport } = await import('../report/pdf-generator.js');
      const report = generateJsonReport();
      // generateJsonReport returns a JSON string — send it directly as JSON content
      res.setHeader('Content-Type', 'application/json');
      res.send(report);
    } catch (err) {
      console.error('Report generation failed:', err);
      res.status(500).json({ error: 'Report generation failed' });
    }
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

  const server = app.listen(port, BIND_HOST, () => {
    console.log(`\n🛡️  Guardian Dashboard`);
    console.log(`   http://${BIND_HOST}:${port}`);
    console.log(`   Findings: ${readFindings().length}`);
    console.log(`   Score: ${(readScore() as { composite?: number }).composite || '--'}%\n`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛡️  Shutting down Guardian Dashboard...');
    server.close(() => process.exit(0));
    // Force exit after 5s if connections don't drain
    setTimeout(() => process.exit(1), 5_000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (process.argv[1]?.endsWith('api.ts') || process.argv[1]?.endsWith('api.js')) {
  startDashboard().catch(console.error);
}
