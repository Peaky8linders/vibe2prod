// Load test environment from .env.test — no hardcoded secrets in source
import { readFileSync } from 'fs';
import { resolve } from 'path';

const envFile = resolve(__dirname, '../../.env.test');
for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx > 0) {
    process.env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
}
