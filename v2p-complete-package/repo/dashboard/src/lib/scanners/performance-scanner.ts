/**
 * scanners/performance-scanner.ts — Performance Antipattern Detection
 *
 * Detects N+1 queries, synchronous blocking, missing pagination, unbounded
 * results, and other patterns that cause production latency issues.
 *
 * LinkedIn signal: "Latency is the most critical factor for production" — Sangam Pandey
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface";

interface PerfPattern {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  description: string;
  fix_hint: string;
  pattern: RegExp;
  /** Only apply to files matching these extensions */
  languages?: string[];
  /** Negative lookahead — skip if this pattern also matches the same line */
  exclude?: RegExp;
}

const PERF_PATTERNS: PerfPattern[] = [
  // P0 — Critical Performance
  {
    id: "PERF-001",
    dimension: "performance",
    priority: "P0",
    description: "N+1 query: database call inside a loop — causes O(N) round-trips instead of O(1) batch",
    fix_hint: "Batch queries: collect IDs first, then query with WHERE id IN (...) or use a JOIN",
    pattern: /(?:for\s*\(|\.(?:forEach|map|flatMap|reduce)\s*\()[^}]{0,500}(?:\.query|\.execute|\.find(?:One)?|\.select|\.from|\.where|await\s+\w+\.(?:get|fetch|load|find))\s*\(/s,
  },
  {
    id: "PERF-002",
    dimension: "performance",
    priority: "P0",
    description: "Synchronous file I/O in async handler — blocks the event loop for all requests",
    fix_hint: "Replace readFileSync/writeFileSync/existsSync with async fs/promises equivalents",
    pattern: /(?:async\s+(?:function|\([^)]{0,200}\)\s*=>))[^}]{0,500}(?:readFileSync|writeFileSync|appendFileSync|existsSync|readdirSync|statSync|mkdirSync)/s,
    exclude: /(?:scripts|cli|build|config)\//,
  },

  // P1 — Must Fix
  {
    id: "PERF-010",
    dimension: "performance",
    priority: "P1",
    description: "Unbounded query: SELECT without LIMIT — can return millions of rows and OOM",
    fix_hint: "Add LIMIT clause to all SELECT queries, or use pagination (OFFSET/LIMIT or cursor-based)",
    pattern: /(?:\.query|\.execute|pool\.query|client\.query)\s*\(\s*[`'"]\s*SELECT\b(?!.*\bLIMIT\b)/i,
  },
  {
    id: "PERF-011",
    dimension: "performance",
    priority: "P1",
    description: "No request timeout — external API calls can hang indefinitely and exhaust connections",
    fix_hint: "Add timeout option to fetch/axios/http calls (e.g., signal: AbortSignal.timeout(10000))",
    pattern: /(?:fetch|axios\.(?:get|post|put|delete|patch)|http\.request|https\.request)\s*\([^)]{0,200}\)/,
    exclude: /(?:timeout|signal|AbortSignal)/,
  },
  {
    id: "PERF-012",
    dimension: "performance",
    priority: "P1",
    description: "Large JSON response without pagination — sends entire dataset to client",
    fix_hint: "Add pagination: accept page/limit params, return { data, total, page, pageSize }",
    pattern: /res\.(?:json|send)\s*\(\s*(?:rows|results|items|data|records|all\w*)\s*\)/,
  },
  {
    id: "PERF-013",
    dimension: "performance",
    priority: "P1",
    description: "Missing database index hint — querying on columns without WHERE/ORDER optimization",
    fix_hint: "Add CREATE INDEX on columns used in WHERE, JOIN, and ORDER BY clauses",
    pattern: /CREATE\s+TABLE\b(?!.*CREATE\s+INDEX)/s,
    languages: ["sql"],
  },

  // P2 — Should Fix
  {
    id: "PERF-020",
    dimension: "performance",
    priority: "P2",
    description: "Importing entire library when only specific functions are needed — inflates bundle size",
    fix_hint: "Use named imports: import { specific } from 'library' instead of import * or import library",
    pattern: /import\s+\*\s+as\s+\w+\s+from\s+['"](?!node:|\.)/,
  },
  {
    id: "PERF-021",
    dimension: "performance",
    priority: "P2",
    description: "No compression middleware — responses sent uncompressed over the wire",
    fix_hint: "Add compression middleware: app.use(compression()) for Express or equivalent",
    pattern: /(?:express\s*\(\)|createServer)\s*/,
    exclude: /compression/,
  },
  {
    id: "PERF-022",
    dimension: "performance",
    priority: "P2",
    description: "Missing Cache-Control headers — browser re-fetches static resources on every request",
    fix_hint: "Set Cache-Control headers for static assets: res.set('Cache-Control', 'public, max-age=31536000')",
    pattern: /\.(?:static|use)\s*\(\s*['"]\/(?:public|static|assets)/,
    exclude: /[Cc]ache/,
  },
  {
    id: "PERF-023",
    dimension: "performance",
    priority: "P2",
    description: "Sequential await in loop — each iteration waits for the previous, use Promise.all for parallelism",
    fix_hint: "Collect promises and use Promise.all([...promises]) or Promise.allSettled for parallel execution",
    pattern: /for\s*\([^)]{0,200}\)\s*\{[^}]{0,500}await\s+/s,
  },

  // P3 — Nice to Have
  {
    id: "PERF-030",
    dimension: "performance",
    priority: "P3",
    description: "No connection pooling configuration — database connections created per-request",
    fix_hint: "Configure connection pool: { min: 2, max: 10, idleTimeoutMillis: 30000 }",
    pattern: /new\s+(?:Pool|Client|pg\.Pool|mysql\.createConnection)\s*\(/,
    exclude: /(?:max|min|pool|connectionLimit)/,
  },
  {
    id: "PERF-031",
    dimension: "performance",
    priority: "P3",
    description: "Console.log in hot path — synchronous I/O in request handler degrades throughput",
    fix_hint: "Replace console.log with async logger (pino, winston) or remove from hot paths",
    pattern: /(?:app\.(?:get|post|put|delete|patch|use)|router\.(?:get|post|put|delete|patch))[^}]{0,500}console\.(?:log|info|debug)/s,
  },
];

// ---------------------------------------------------------------------------
// Scanner Implementation
// ---------------------------------------------------------------------------

function findLineNumber(content: string, match: RegExpMatchArray): number | null {
  if (match.index === undefined) return null;
  const beforeMatch = content.substring(0, match.index);
  return beforeMatch.split("\n").length;
}

export const performanceScanner: ScannerPlugin = {
  name: "performance",
  dimensions: ["performance"],

  scan(filePath: string, content: string, language: string): FileDefect[] {
    const defects: FileDefect[] = [];
    const seenIds = new Set<string>();

    // Skip non-source files
    if (!/\.(ts|js|tsx|jsx|mjs|cjs|sql)$/.test(filePath)) return [];

    // Skip test files and config
    if (/(?:\.test\.|\.spec\.|__tests__|\.config\.|scripts\/|evals\/)/.test(filePath)) return [];

    for (const rule of PERF_PATTERNS) {
      // Skip language-specific rules
      if (rule.languages && !rule.languages.includes(language)) continue;

      const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace(/[gs]/g, "") + "gs");
      let match: RegExpExecArray | null;

      while ((match = globalPattern.exec(content)) !== null) {
        // Check exclusion pattern on the matched text
        if (rule.exclude && rule.exclude.test(match[0])) continue;

        const line = findLineNumber(content, match);
        const defectKey = `${rule.id}-${line}`;
        if (seenIds.has(defectKey)) continue;
        seenIds.add(defectKey);

        defects.push({
          id: rule.id,
          dimension: rule.dimension,
          priority: rule.priority,
          line,
          description: rule.description,
          fix_hint: rule.fix_hint,
          code_snippet: match[0].substring(0, 120),
        });
      }
    }

    return defects;
  },
};

export default performanceScanner;
