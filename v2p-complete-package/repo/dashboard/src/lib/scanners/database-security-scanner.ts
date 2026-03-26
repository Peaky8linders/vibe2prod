/**
 * scanners/database-security-scanner.ts — Supabase RLS & Firebase Rules Scanner
 *
 * Detects missing Row-Level Security policies in Supabase projects,
 * insecure Firebase security rules, and service role key exposure
 * in client-side code. The #1 blind spot in vibe-coded apps.
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface";

function createIdGen() {
  let counter = 0;
  return () => { counter++; return `DBSEC-${String(counter).padStart(3, "0")}`; };
}

/** Heuristic: is this file likely client-side (browser) code? */
function isClientSideFile(filePath: string): boolean {
  const clientPatterns = /(?:^|\/)(?:components|app|pages|src\/client|src\/app|src\/pages|src\/components|hooks|contexts|providers|views)\//;
  const serverPatterns = /(?:^|\/)(?:api|server|lib\/server|utils\/server|middleware|scripts|workers|functions|supabase\/functions)\//;
  // If it matches server patterns, it's not client-side
  if (serverPatterns.test(filePath)) return false;
  // If it matches client patterns, it is client-side
  if (clientPatterns.test(filePath)) return true;
  // Files with "client" in the name or path
  if (/client/i.test(filePath)) return true;
  return false;
}

/** Heuristic: does the surrounding context contain user-scoped filtering? */
function hasUserScopedFilter(lines: string[], startIdx: number, range: number): boolean {
  const context = lines.slice(startIdx, Math.min(startIdx + range, lines.length)).join(" ");
  return /\.eq\s*\(\s*['"`](?:user_id|userId|owner_id|ownerId|created_by|createdBy|auth\.uid)['"`]/.test(context) ||
    /\.match\s*\(\s*\{[^}]*(?:user_id|userId|owner_id|ownerId)/.test(context) ||
    /\.filter\s*\([^)]*(?:user_id|userId|owner_id)/.test(context) ||
    /auth\s*\(\s*\)\s*\.getUser/.test(context) ||
    /session\s*\?\.\s*user/.test(context);
}

function scan(filePath: string, content: string, language: string): FileDefect[] {
  const nextId = createIdGen();
  const defects: FileDefect[] = [];
  const lines = content.split("\n");
  const isTest = /\.test\.|\.spec\.|__tests__|tests[/\\]|conftest/.test(filePath);
  if (isTest) return defects;

  const isTsJs = language === "typescript" || language === "javascript";
  const isClient = isClientSideFile(filePath);

  // Detect if this file uses Supabase or Firebase
  const usesSupabase = /(?:@supabase\/supabase-js|@supabase\/ssr|createClient|supabase)/.test(content);
  const usesFirebase = /(?:firebase\/firestore|firebase\/database|firebase-admin|getFirestore|initializeApp)/.test(content);
  const isFirebaseRulesFile = /(?:firestore\.rules|database\.rules|\.rules)$/.test(filePath) || /rules_version\s*=/.test(content);

  // =========================================================================
  // SUPABASE DETECTIONS
  // =========================================================================

  if (isTsJs && usesSupabase) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // P0: Service role key in client-side code
      if (isClient && /SUPABASE_SERVICE_ROLE_KEY|supabase_service_role|service_role/.test(line) && !/\/\//.test(line.split(/service_role/)[0]!)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P0", line: lineNum,
          description: "Supabase service role key used in client-side code — bypasses all RLS policies",
          fix_hint: "Service role keys must ONLY be used in server-side code (API routes, server functions). Use the anon key for client-side.",
          code_snippet: line.trim().slice(0, 100),
        });
      }

      // P0: supabaseAdmin / service role client in client-side code
      if (isClient && /(?:createClient|createServerClient)\s*\([^)]*service_role/.test(line)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P0", line: lineNum,
          description: "Supabase admin client (service role) created in client-side code",
          fix_hint: "Move admin client creation to server-side code. Client-side should only use the anon key.",
          code_snippet: line.trim().slice(0, 100),
        });
      }

      // P1: .from('table') query without user-scoped filter
      if (/\.from\s*\(\s*['"`](\w+)['"`]\s*\)/.test(line)) {
        const tableMatch = line.match(/\.from\s*\(\s*['"`](\w+)['"`]\s*\)/);
        const tableName = tableMatch?.[1] ?? "unknown";
        // Check if the query chain has a user-scoped filter
        if (!hasUserScopedFilter(lines, i, 6)) {
          // Check if this is a read or write operation
          const context = lines.slice(i, Math.min(i + 6, lines.length)).join(" ");
          const isDataOp = /\.select\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/.test(context);
          if (isDataOp) {
            defects.push({
              id: nextId(), dimension: "security", priority: "P1", line: lineNum,
              description: `Supabase query on "${tableName}" without user-scoped filter — relies entirely on RLS`,
              fix_hint: `Add .eq('user_id', userId) or verify RLS policies are enabled and correct for "${tableName}".`,
              code_snippet: line.trim().slice(0, 100),
            });
          }
        }
      }

      // P1: .rpc() call without auth context
      if (/\.rpc\s*\(\s*['"`](\w+)['"`]/.test(line)) {
        const rpcMatch = line.match(/\.rpc\s*\(\s*['"`](\w+)['"`]/);
        const funcName = rpcMatch?.[1] ?? "unknown";
        const context = lines.slice(Math.max(0, i - 3), Math.min(i + 3, lines.length)).join(" ");
        if (!/auth|session|user|token|verify/.test(context)) {
          defects.push({
            id: nextId(), dimension: "security", priority: "P1", line: lineNum,
            description: `Supabase RPC call "${funcName}" without visible auth context — RPC functions can bypass RLS`,
            fix_hint: "Ensure the RPC function uses auth.uid() internally, or add SECURITY DEFINER with proper checks.",
            code_snippet: line.trim().slice(0, 100),
          });
        }
      }

      // P2: Supabase anon key hardcoded (not from env var)
      if (/(?:supabaseKey|supabaseAnonKey|SUPABASE_ANON_KEY|anon_key)\s*[:=]\s*['"`]eyJ/.test(line)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P2", line: lineNum,
          description: "Supabase anon key appears hardcoded rather than loaded from environment variable",
          fix_hint: "Use process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY or equivalent env var.",
          code_snippet: line.trim().slice(0, 80),
        });
      }
    }

    // File-level: imports Supabase and has .from() but no auth/RLS patterns at all
    if (/\.from\s*\(/.test(content) && !/(?:auth|rls|policy|row.level|user_id|userId|getUser|getSession)/.test(content)) {
      defects.push({
        id: nextId(), dimension: "security", priority: "P1", line: null,
        description: "File uses Supabase .from() queries with no auth, RLS, or user-scoping patterns detected",
        fix_hint: "Ensure RLS is enabled on all tables and queries filter by authenticated user. Run: ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;",
      });
    }
  }

  // =========================================================================
  // FIREBASE DETECTIONS
  // =========================================================================

  if (isTsJs && usesFirebase) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // P0: admin SDK in client-side code
      if (isClient && /(?:firebase-admin|admin\.firestore|admin\.database|admin\.auth|getFirestore\s*\(\s*adminApp)/.test(line)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P0", line: lineNum,
          description: "Firebase Admin SDK used in client-side code — grants unrestricted database access",
          fix_hint: "Firebase Admin SDK must only be used server-side (Cloud Functions, API routes). Client-side should use the regular Firebase SDK with security rules.",
          code_snippet: line.trim().slice(0, 100),
        });
      }

      // P1: Firestore/RTDB operations without auth checks
      if (/(?:collection|doc|ref)\s*\(/.test(line) && /(?:get|set|add|update|delete|push|onSnapshot)\s*\(/.test(lines.slice(i, Math.min(i + 3, lines.length)).join(" "))) {
        const context = lines.slice(Math.max(0, i - 5), Math.min(i + 5, lines.length)).join(" ");
        if (!/(?:auth|currentUser|uid|onAuthStateChanged|signIn)/.test(context)) {
          defects.push({
            id: nextId(), dimension: "security", priority: "P1", line: lineNum,
            description: "Firebase database operation without visible auth context",
            fix_hint: "Ensure the user is authenticated before database operations. Check auth.currentUser and use security rules with request.auth.",
            code_snippet: line.trim().slice(0, 100),
          });
        }
      }
    }
  }

  // =========================================================================
  // FIREBASE RULES FILE DETECTIONS
  // =========================================================================

  if (isFirebaseRulesFile) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      // P0: Wide-open rules (Firestore)
      if (/allow\s+(?:read|write|get|list|create|update|delete)\s*[:,]\s*if\s+true/.test(line)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P0", line: lineNum,
          description: "Firebase security rule allows unrestricted access (if true) — anyone can read/write this data",
          fix_hint: "Replace 'if true' with 'if request.auth != null' at minimum. Add ownership checks: request.auth.uid == resource.data.userId.",
          code_snippet: line.trim().slice(0, 100),
        });
      }

      // P0: Wide-open rules (RTDB)
      if (/['"]\.(read|write)['"]\s*:\s*['"]?true['"]?/.test(line)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P0", line: lineNum,
          description: "Firebase RTDB rule allows unrestricted access (.read: true / .write: true)",
          fix_hint: "Restrict access: \".read\": \"auth != null\" and add data ownership validation.",
          code_snippet: line.trim().slice(0, 100),
        });
      }

      // P1: Rules without auth check
      if (/allow\s+(?:read|write|get|list|create|update|delete)/.test(line) && !/(?:auth|request\.auth|false|true)/.test(line)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P1", line: lineNum,
          description: "Firebase security rule without explicit auth check",
          fix_hint: "Add 'if request.auth != null' to require authentication.",
          code_snippet: line.trim().slice(0, 100),
        });
      }
    }

    // File-level: Rules file without any auth references
    if (!/request\.auth|auth\s*!=\s*null|auth\.uid/.test(content) && /allow\s+(?:read|write)/.test(content)) {
      defects.push({
        id: nextId(), dimension: "security", priority: "P0", line: null,
        description: "Firebase rules file contains no authentication checks — all data may be publicly accessible",
        fix_hint: "Add authentication requirements to all rules. Minimum: 'if request.auth != null'.",
      });
    }
  }

  // =========================================================================
  // SUPABASE MIGRATION FILE DETECTIONS
  // =========================================================================

  if (/supabase\/migrations\//.test(filePath) && /\.sql$/.test(filePath)) {
    // Find CREATE TABLE statements
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?/gi;
    let match;
    while ((match = createTableRegex.exec(content)) !== null) {
      const tableName = match[1]!;
      // Escape for safe regex interpolation (table names from \w+ are safe, but defense-in-depth)
      const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Check if RLS is enabled for this table in this migration
      const rlsPattern = new RegExp(`ALTER\\s+TABLE\\s+(?:public\\.)?["']?${escaped}["']?\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i");
      const policyPattern = new RegExp(`CREATE\\s+POLICY\\s+[^;]*ON\\s+(?:public\\.)?["']?${escaped}["']?`, "i");
      if (!rlsPattern.test(content)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P0", line: null,
          description: `Table "${tableName}" created without ENABLE ROW LEVEL SECURITY in migration`,
          fix_hint: `Add: ALTER TABLE ${tableName} ENABLE ROW LEVEL SECURITY; and create appropriate policies with CREATE POLICY.`,
        });
      } else if (!policyPattern.test(content)) {
        defects.push({
          id: nextId(), dimension: "security", priority: "P1", line: null,
          description: `Table "${tableName}" has RLS enabled but no policies defined — effectively blocks all access`,
          fix_hint: `Create at least one policy: CREATE POLICY "Users can view own data" ON ${tableName} FOR SELECT USING (auth.uid() = user_id);`,
        });
      }
    }
  }

  return defects;
}

export const databaseSecurityScanner: ScannerPlugin = {
  name: "database-security",
  dimensions: ["security"],
  scan,
};
