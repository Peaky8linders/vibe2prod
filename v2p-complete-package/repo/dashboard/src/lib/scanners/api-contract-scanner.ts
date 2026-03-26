/**
 * scanners/api-contract-scanner.ts — API Contract & Breaking Change Detection
 *
 * Detects missing API versioning, inconsistent error formats, absent schema
 * validation, and patterns that lead to breaking changes — the #1 cause of
 * production incidents.
 *
 * LinkedIn signal: "Type safety required" + "Deterministic behavior" +
 * "Auditable/compliant" — Cole Medin's framework requirements
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface";

interface ApiPattern {
  id: string;
  dimension: string;
  priority: "P0" | "P1" | "P2" | "P3";
  description: string;
  fix_hint: string;
  pattern: RegExp;
  /** Only flag if exclude pattern is NOT found in the same file */
  file_exclude?: RegExp;
  /** Only apply to route/handler files */
  handler_only?: boolean;
}

const HANDLER_PATTERNS = [
  /app\.(?:get|post|put|delete|patch|use|all)\s*\(/,
  /router\.(?:get|post|put|delete|patch|use)\s*\(/,
  /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD)\s*\(/,
  /export\s+(?:const|let)\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD)\s*=/,
];

const API_PATTERNS: ApiPattern[] = [
  // P0 — Critical Contract Violations
  {
    id: "API-001",
    dimension: "api-contract",
    priority: "P0",
    description: "No request body validation — accepts any shape, leading to runtime crashes or data corruption",
    fix_hint: "Validate request bodies with Zod/Joi/Yup: const body = schema.parse(req.body)",
    pattern: /(?:req\.body\.|request\.body\.)(?!.*(?:parse|validate|safeParse|check))/,
    handler_only: true,
  },
  {
    id: "API-002",
    dimension: "api-contract",
    priority: "P0",
    description: "Direct database object returned in API response — leaks internal schema and can break clients on DB changes",
    fix_hint: "Map DB results to a response DTO: return { id, name, email } instead of the raw row object",
    pattern: /res\.(?:json|send)\s*\(\s*(?:row|result|user|record|doc|entity)(?:\s*\)|\[)/,
    handler_only: true,
  },

  // P1 — Must Fix
  {
    id: "API-010",
    dimension: "api-contract",
    priority: "P1",
    description: "No API versioning — breaking changes affect all clients simultaneously",
    fix_hint: "Version your API: app.use('/api/v1', router) or use Accept-Version header",
    pattern: /app\.use\s*\(\s*['"]\/api(?!\/v\d)/,
    handler_only: true,
  },
  {
    id: "API-011",
    dimension: "api-contract",
    priority: "P1",
    description: "Inconsistent error response format — clients cannot reliably parse errors",
    fix_hint: "Standardize errors: { error: { code: 'VALIDATION_ERROR', message: '...', details: [...] } }",
    pattern: /res\.status\s*\(\s*[45]\d\d\s*\)\.(?:send|json)\s*\(\s*[{'"]/,
    handler_only: true,
  },
  {
    id: "API-012",
    dimension: "api-contract",
    priority: "P1",
    description: "Missing Content-Type header on response — clients may misparse the response body",
    fix_hint: "Always set Content-Type: res.type('application/json') or use res.json() which sets it automatically",
    pattern: /res\.send\s*\(\s*JSON\.stringify/,
    handler_only: true,
  },
  {
    id: "API-013",
    dimension: "api-contract",
    priority: "P1",
    description: "Query parameter used without validation or type coercion — 'limit=abc' crashes or returns wrong data",
    fix_hint: "Validate and coerce query params: const limit = Math.min(parseInt(req.query.limit) || 20, 100)",
    pattern: /req\.(?:query|params)\.\w+(?!\s*(?:\|\||&&|\?|!|=))/,
    file_exclude: /(?:parseInt|Number|parseFloat|validate|safeParse|zod|joi|yup)/,
    handler_only: true,
  },

  // P2 — Should Fix
  {
    id: "API-020",
    dimension: "api-contract",
    priority: "P2",
    description: "No rate limit headers in response — clients cannot implement backoff strategies",
    fix_hint: "Return rate limit headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
    pattern: /(?:rateLimit|rate[_-]?limit|throttle)/i,
    file_exclude: /(?:X-RateLimit|x-ratelimit|RateLimit-)/i,
    handler_only: true,
  },
  {
    id: "API-021",
    dimension: "api-contract",
    priority: "P2",
    description: "List endpoint without pagination metadata — clients cannot paginate through large datasets",
    fix_hint: "Return pagination: { data: [...], pagination: { page, pageSize, total, totalPages } }",
    pattern: /res\.(?:json|send)\s*\(\s*(?:rows|results|items|data|list)/,
    file_exclude: /(?:pagination|page[Ss]ize|total[Pp]ages|offset|cursor|next[Pp]age|hasMore)/,
    handler_only: true,
  },
  {
    id: "API-022",
    dimension: "api-contract",
    priority: "P2",
    description: "DELETE endpoint returns 200 without confirmation body — client cannot confirm what was deleted",
    fix_hint: "Return 200 { deleted: true, id: '...' } or use 204 No Content for successful deletes",
    pattern: /(?:delete|remove|destroy)[^}]*res\.(?:sendStatus\s*\(\s*200|status\s*\(\s*200\s*\)\.end)/i,
    handler_only: true,
  },
  {
    id: "API-023",
    dimension: "api-contract",
    priority: "P2",
    description: "No CORS configuration — API inaccessible from browser clients on other origins",
    fix_hint: "Configure CORS with specific origins: app.use(cors({ origin: ['https://app.example.com'] }))",
    pattern: /app\.listen|server\.listen/,
    file_exclude: /(?:cors|Access-Control-Allow)/i,
    handler_only: true,
  },

  // P3 — Nice to Have
  {
    id: "API-030",
    dimension: "api-contract",
    priority: "P3",
    description: "No OpenAPI/Swagger documentation — API consumers have no machine-readable spec",
    fix_hint: "Add OpenAPI spec: use swagger-jsdoc + swagger-ui-express, or generate from Zod schemas",
    pattern: /app\.listen|server\.listen/,
    file_exclude: /(?:swagger|openapi|@openapi|apiDoc)/i,
    handler_only: true,
  },
  {
    id: "API-031",
    dimension: "api-contract",
    priority: "P3",
    description: "Inconsistent HTTP method usage — using POST for read operations or GET with side effects",
    fix_hint: "Follow REST conventions: GET (read), POST (create), PUT (replace), PATCH (update), DELETE (remove)",
    pattern: /app\.post\s*\(\s*['"]\/(?:get|fetch|list|search|find|read)/i,
    handler_only: true,
  },
];

// ---------------------------------------------------------------------------
// Scanner Implementation
// ---------------------------------------------------------------------------

function findLineNumber(content: string, match: RegExpMatchArray): number | null {
  if (match.index === undefined) return null;
  return content.substring(0, match.index).split("\n").length;
}

function isHandlerFile(content: string): boolean {
  return HANDLER_PATTERNS.some((p) => p.test(content));
}

export const apiContractScanner: ScannerPlugin = {
  name: "api-contract",
  dimensions: ["api-contract"],

  scan(filePath: string, content: string, _language: string): FileDefect[] {
    const defects: FileDefect[] = [];
    const seenIds = new Set<string>();
    const isHandler = isHandlerFile(content);

    // Skip non-source files
    if (!/\.(ts|js|tsx|jsx|mjs|cjs)$/.test(filePath)) return [];

    // Skip test/config/eval files
    if (/(?:\.test\.|\.spec\.|__tests__|\.config\.|evals\/|scanners\/)/.test(filePath)) return [];

    for (const rule of API_PATTERNS) {
      if (rule.handler_only && !isHandler) continue;
      if (rule.file_exclude && rule.file_exclude.test(content)) continue;

      const globalPattern = new RegExp(rule.pattern.source, rule.pattern.flags.replace(/[gs]/g, "") + "g");
      let match: RegExpExecArray | null;

      while ((match = globalPattern.exec(content)) !== null) {
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
          code_snippet: match[0].substring(0, 100),
        });

        // For file-level checks, one finding per file is enough
        if (rule.file_exclude !== undefined) break;
      }
    }

    return defects;
  },
};

export default apiContractScanner;
