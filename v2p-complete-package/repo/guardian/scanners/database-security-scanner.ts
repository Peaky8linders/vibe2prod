/**
 * guardian/scanners/database-security-scanner.ts — Supabase RLS & Firebase Rules Scanner
 *
 * Filesystem-level scanner for missing Row-Level Security policies,
 * insecure Firebase rules, and service role key exposure.
 * Also scans Supabase migration files for tables without RLS.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SKIP_DIRS, parseGitignore, isGitignored } from './scan-utils';

export interface Finding {
  id: string;
  domain: number;
  control_id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  category: string;
  title: string;
  description: string;
  file: string;
  line: number;
  evidence: string;
  remediation: string;
  standard_refs: string[];
  auto_fixable: boolean;
}

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py',
]);

const RULES_EXTENSIONS = new Set(['.rules']);

const SQL_EXTENSIONS = new Set(['.sql']);

function collectFiles(dir: string): string[] {
  const files: string[] = [];
  const gitignorePatterns = parseGitignore(dir);

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          const entryPath = path.join(currentDir, entry.name);
          const relPath = path.relative(dir, entryPath);
          if (!isGitignored(relPath, gitignorePatterns)) {
            walk(entryPath);
          }
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext) || RULES_EXTENSIONS.has(ext) || SQL_EXTENSIONS.has(ext)) {
          const entryPath = path.join(currentDir, entry.name);
          const relPath = path.relative(dir, entryPath);
          if (!isGitignored(relPath, gitignorePatterns)) {
            files.push(entryPath);
          }
        }
      }
    }
  }

  walk(dir);
  return files;
}

function extractEvidence(line: string): string {
  const maxLen = 150;
  let evidence = line.trim();
  if (evidence.length > maxLen) {
    evidence = evidence.substring(0, maxLen) + '...';
  }
  return evidence;
}

function makeCounter() {
  let count = 0;
  return {
    next: () => ++count,
  };
}

function addFinding(
  findings: Finding[],
  counter: ReturnType<typeof makeCounter>,
  opts: {
    severity: 'P0' | 'P1' | 'P2';
    category: string;
    control_id: string;
    title: string;
    description: string;
    file: string;
    line: number;
    evidence: string;
    remediation: string;
    auto_fixable?: boolean;
  },
): void {
  findings.push({
    id: `DBSEC-${String(counter.next()).padStart(3, '0')}`,
    domain: 4,
    control_id: opts.control_id,
    severity: opts.severity,
    category: opts.category,
    title: opts.title,
    description: opts.description,
    file: opts.file,
    line: opts.line,
    evidence: extractEvidence(opts.evidence),
    remediation: opts.remediation,
    standard_refs: ['CWE-284', 'OWASP-A01:2021'],
    auto_fixable: opts.auto_fixable ?? false,
  });
}

function isClientSideFile(filePath: string): boolean {
  const clientPatterns = /(?:^|[/\\])(?:components|app|pages|src[/\\]client|src[/\\]app|src[/\\]pages|src[/\\]components|hooks|contexts|providers|views)[/\\]/;
  const serverPatterns = /(?:^|[/\\])(?:api|server|lib[/\\]server|utils[/\\]server|middleware|scripts|workers|functions|supabase[/\\]functions)[/\\]/;
  if (serverPatterns.test(filePath)) return false;
  if (clientPatterns.test(filePath)) return true;
  if (/client/i.test(filePath)) return true;
  return false;
}

function hasUserScopedFilter(lines: string[], startIdx: number, range: number): boolean {
  const context = lines.slice(startIdx, Math.min(startIdx + range, lines.length)).join(' ');
  return /\.eq\s*\(\s*['"`](?:user_id|userId|owner_id|ownerId|created_by|createdBy|auth\.uid)['"`]/.test(context) ||
    /\.match\s*\(\s*\{[^}]*(?:user_id|userId|owner_id|ownerId)/.test(context) ||
    /auth\s*\(\s*\)\s*\.getUser/.test(context) ||
    /session\s*\?\.\s*user/.test(context);
}

// ---------------------------------------------------------------------------
// Supabase code file checks
// ---------------------------------------------------------------------------

function checkSupabaseCode(
  lines: string[],
  content: string,
  filePath: string,
  relativeFile: string,
  findings: Finding[],
  counter: ReturnType<typeof makeCounter>,
): void {
  const isClient = isClientSideFile(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // P0: Service role key in client-side code
    if (isClient && /SUPABASE_SERVICE_ROLE_KEY|supabase_service_role|service_role/.test(line) && !/\/\//.test(line.split(/service_role/)[0]!)) {
      addFinding(findings, counter, {
        severity: 'P0', category: 'supabase-rls', control_id: 'DATA-004',
        title: 'Service role key in client-side code',
        description: 'Supabase service role key used in client-side code — bypasses all RLS policies',
        file: relativeFile, line: i + 1, evidence: line,
        remediation: 'Service role keys must ONLY be used in server-side code. Use the anon key for client-side.',
      });
    }

    // P0: Admin client in client-side code
    if (isClient && /(?:createClient|createServerClient)\s*\([^)]*service_role/.test(line)) {
      addFinding(findings, counter, {
        severity: 'P0', category: 'supabase-rls', control_id: 'DATA-004',
        title: 'Supabase admin client in client-side code',
        description: 'Supabase client created with service role in client-side code — full database access exposed to browser',
        file: relativeFile, line: i + 1, evidence: line,
        remediation: 'Move admin client to server-side. Client-side should use createBrowserClient() with anon key.',
      });
    }

    // P1: .from('table') without user-scoped filter
    if (/\.from\s*\(\s*['"`](\w+)['"`]\s*\)/.test(line)) {
      const tableMatch = line.match(/\.from\s*\(\s*['"`](\w+)['"`]\s*\)/);
      const tableName = tableMatch?.[1] ?? 'unknown';
      if (!hasUserScopedFilter(lines, i, 6)) {
        const context = lines.slice(i, Math.min(i + 6, lines.length)).join(' ');
        if (/\.select\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/.test(context)) {
          addFinding(findings, counter, {
            severity: 'P1', category: 'supabase-rls', control_id: 'DATA-004',
            title: `Query on "${tableName}" without user-scoped filter`,
            description: `Supabase query on "${tableName}" without user-scoped filter — relies entirely on RLS`,
            file: relativeFile, line: i + 1, evidence: line,
            remediation: `Add .eq('user_id', userId) or verify RLS policies are enabled for "${tableName}".`,
          });
        }
      }
    }

    // P1: .rpc() without auth context
    if (/\.rpc\s*\(\s*['"`](\w+)['"`]/.test(line)) {
      const rpcMatch = line.match(/\.rpc\s*\(\s*['"`](\w+)['"`]/);
      const funcName = rpcMatch?.[1] ?? 'unknown';
      const context = lines.slice(Math.max(0, i - 3), Math.min(i + 3, lines.length)).join(' ');
      if (!/auth|session|user|token|verify/.test(context)) {
        addFinding(findings, counter, {
          severity: 'P1', category: 'supabase-rls', control_id: 'DATA-004',
          title: `RPC call "${funcName}" without auth context`,
          description: `Supabase RPC call "${funcName}" without visible auth context — RPC functions can bypass RLS`,
          file: relativeFile, line: i + 1, evidence: line,
          remediation: 'Ensure the RPC function uses auth.uid() internally, or add SECURITY DEFINER with proper checks.',
        });
      }
    }

    // P2: Hardcoded anon key
    if (/(?:supabaseKey|supabaseAnonKey|SUPABASE_ANON_KEY|anon_key)\s*[:=]\s*['"`]eyJ/.test(line)) {
      addFinding(findings, counter, {
        severity: 'P2', category: 'supabase-rls', control_id: 'DATA-004',
        title: 'Hardcoded Supabase anon key',
        description: 'Supabase anon key appears hardcoded rather than from env var',
        file: relativeFile, line: i + 1, evidence: line,
        remediation: 'Use process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY or equivalent.',
      });
    }
  }

  // File-level: uses .from() but no auth patterns at all
  if (/\.from\s*\(/.test(content) && !/(?:auth|rls|policy|row.level|user_id|userId|getUser|getSession)/.test(content)) {
    addFinding(findings, counter, {
      severity: 'P1', category: 'supabase-rls', control_id: 'DATA-004',
      title: 'Supabase queries with no auth patterns',
      description: 'File uses Supabase .from() queries with no auth, RLS, or user-scoping patterns',
      file: relativeFile, line: 1, evidence: 'File-level check',
      remediation: 'Ensure RLS is enabled on all tables. Run: ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;',
    });
  }
}

// ---------------------------------------------------------------------------
// Firebase code file checks
// ---------------------------------------------------------------------------

function checkFirebaseCode(
  lines: string[],
  filePath: string,
  relativeFile: string,
  findings: Finding[],
  counter: ReturnType<typeof makeCounter>,
): void {
  const isClient = isClientSideFile(filePath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // P0: Admin SDK in client-side code
    if (isClient && /(?:firebase-admin|admin\.firestore|admin\.database|admin\.auth|getFirestore\s*\(\s*adminApp)/.test(line)) {
      addFinding(findings, counter, {
        severity: 'P0', category: 'firebase-rules', control_id: 'DATA-005',
        title: 'Firebase Admin SDK in client-side code',
        description: 'Firebase Admin SDK used in client-side code — grants unrestricted database access',
        file: relativeFile, line: i + 1, evidence: line,
        remediation: 'Firebase Admin SDK must only be used server-side. Client-side should use the regular Firebase SDK with security rules.',
      });
    }

    // P1: Firestore/RTDB operations without auth
    if (/(?:collection|doc|ref)\s*\(/.test(line)) {
      const context = lines.slice(i, Math.min(i + 3, lines.length)).join(' ');
      if (/(?:get|set|add|update|delete|push|onSnapshot)\s*\(/.test(context)) {
        const widerContext = lines.slice(Math.max(0, i - 5), Math.min(i + 5, lines.length)).join(' ');
        if (!/(?:auth|currentUser|uid|onAuthStateChanged|signIn)/.test(widerContext)) {
          addFinding(findings, counter, {
            severity: 'P1', category: 'firebase-rules', control_id: 'DATA-005',
            title: 'Firebase DB operation without auth context',
            description: 'Firebase database operation without visible authentication context',
            file: relativeFile, line: i + 1, evidence: line,
            remediation: 'Ensure user is authenticated before database operations. Check auth.currentUser.',
          });
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Firebase rules file checks
// ---------------------------------------------------------------------------

function checkFirebaseRules(
  lines: string[],
  content: string,
  relativeFile: string,
  findings: Finding[],
  counter: ReturnType<typeof makeCounter>,
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // P0: Wide-open Firestore rules
    if (/allow\s+(?:read|write|get|list|create|update|delete)\s*[:,]\s*if\s+true/.test(line)) {
      addFinding(findings, counter, {
        severity: 'P0', category: 'firebase-rules', control_id: 'DATA-005',
        title: 'Firebase rule allows unrestricted access',
        description: 'Security rule allows unrestricted access (if true) — anyone can read/write',
        file: relativeFile, line: i + 1, evidence: line,
        remediation: "Replace 'if true' with 'if request.auth != null'. Add ownership checks.",
      });
    }

    // P0: Wide-open RTDB rules
    if (/['"]\.(read|write)['"]\s*:\s*['"]?true['"]?/.test(line)) {
      addFinding(findings, counter, {
        severity: 'P0', category: 'firebase-rules', control_id: 'DATA-005',
        title: 'Firebase RTDB rule allows unrestricted access',
        description: 'RTDB rule allows unrestricted read/write (.read: true)',
        file: relativeFile, line: i + 1, evidence: line,
        remediation: 'Restrict: ".read": "auth != null" and add data ownership validation.',
      });
    }

    // P1: Rules without auth check
    if (/allow\s+(?:read|write|get|list|create|update|delete)/.test(line) && !/(?:auth|request\.auth|false|true)/.test(line)) {
      addFinding(findings, counter, {
        severity: 'P1', category: 'firebase-rules', control_id: 'DATA-005',
        title: 'Firebase rule without explicit auth check',
        description: 'Security rule without explicit authentication check',
        file: relativeFile, line: i + 1, evidence: line,
        remediation: "Add 'if request.auth != null' to require authentication.",
      });
    }
  }

  // File-level: No auth references in rules file
  if (!/request\.auth|auth\s*!=\s*null|auth\.uid/.test(content) && /allow\s+(?:read|write)/.test(content)) {
    addFinding(findings, counter, {
      severity: 'P0', category: 'firebase-rules', control_id: 'DATA-005',
      title: 'Firebase rules file with no auth checks',
      description: 'Rules file contains no authentication checks — all data may be publicly accessible',
      file: relativeFile, line: 1, evidence: 'File-level check',
      remediation: "Add authentication requirements to all rules. Minimum: 'if request.auth != null'.",
    });
  }
}

// ---------------------------------------------------------------------------
// Supabase migration file checks
// ---------------------------------------------------------------------------

function checkSupabaseMigrations(
  content: string,
  relativeFile: string,
  findings: Finding[],
  counter: ReturnType<typeof makeCounter>,
): void {
  const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/gi;
  let match;
  while ((match = createTableRegex.exec(content)) !== null) {
    const tableName = match[1]!;
    // Escape for safe regex interpolation (table names from \w+ are safe, but defense-in-depth)
    const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rlsPattern = new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?["']?${escaped}["']?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i');
    const policyPattern = new RegExp(`CREATE\\s+POLICY\\s+[^;]*ON\\s+(?:public\\.)?["']?${escaped}["']?`, 'i');

    if (!rlsPattern.test(content)) {
      addFinding(findings, counter, {
        severity: 'P0', category: 'supabase-rls', control_id: 'DATA-004',
        title: `Table "${tableName}" missing RLS in migration`,
        description: `Table "${tableName}" created without ENABLE ROW LEVEL SECURITY`,
        file: relativeFile, line: 1, evidence: `CREATE TABLE ${tableName}`,
        remediation: `Add: ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY;`,
        auto_fixable: true,
      });
    } else if (!policyPattern.test(content)) {
      addFinding(findings, counter, {
        severity: 'P1', category: 'supabase-rls', control_id: 'DATA-004',
        title: `Table "${tableName}" has RLS but no policies`,
        description: `Table "${tableName}" has RLS enabled but no policies — blocks all access`,
        file: relativeFile, line: 1, evidence: `ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY`,
        remediation: `Create policies: CREATE POLICY "Users can view own data" ON ${tableName} FOR SELECT USING (auth.uid() = user_id);`,
        auto_fixable: true,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Main scan function
// ---------------------------------------------------------------------------

export async function scan(targetDir: string): Promise<Finding[]> {
  const counter = makeCounter();
  const findings: Finding[] = [];
  const files = collectFiles(targetDir);

  for (const filePath of files) {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relativeFile = path.relative(targetDir, filePath);
    const lines = content.split('\n');
    const ext = path.extname(filePath).toLowerCase();

    // Skip test files
    const isTest = /(?:test|spec|mock|fixture|__test__|__spec__|\.test\.|\.spec\.)/i.test(filePath);
    if (isTest) continue;

    const usesSupabase = /(?:@supabase\/supabase-js|@supabase\/ssr|createClient.*supabase|supabase)/i.test(content);
    const usesFirebase = /(?:firebase\/firestore|firebase\/database|firebase-admin|getFirestore|initializeApp)/i.test(content);
    const isFirebaseRulesFile = RULES_EXTENSIONS.has(ext) || /rules_version\s*=/.test(content) || /firestore\.rules|database\.rules/.test(filePath);
    const isSupabaseMigration = /supabase[/\\]migrations[/\\]/.test(filePath) && ext === '.sql';

    if (usesSupabase && (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs')) {
      checkSupabaseCode(lines, content, filePath, relativeFile, findings, counter);
    }

    if (usesFirebase && (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs')) {
      checkFirebaseCode(lines, filePath, relativeFile, findings, counter);
    }

    if (isFirebaseRulesFile) {
      checkFirebaseRules(lines, content, relativeFile, findings, counter);
    }

    if (isSupabaseMigration) {
      checkSupabaseMigrations(content, relativeFile, findings, counter);
    }
  }

  return findings;
}
