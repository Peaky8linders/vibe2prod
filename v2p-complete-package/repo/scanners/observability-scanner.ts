/**
 * scanners/observability-scanner.ts — Observability Gap Detection
 *
 * Detects missing error tracking, absent request IDs, unstructured logging,
 * missing health checks, and other gaps that make production debugging impossible.
 *
 * LinkedIn signal: "LangSmith closes the observability gap — debugging a graph,
 * not a black box" — Fabrizio Scanavini
 */

import type { ScannerPlugin, FileDefect } from "./plugin-interface.js";

interface ObsPattern {
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
  languages?: string[];
}

// Detect if file defines HTTP handlers
const HANDLER_PATTERNS = [
  /app\.(?:get|post|put|delete|patch|use|all)\s*\(/,
  /router\.(?:get|post|put|delete|patch|use)\s*\(/,
  /export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD)\s*\(/,
  /export\s+(?:const|let)\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD)\s*=/,
];

const OBS_PATTERNS: ObsPattern[] = [
  // P0 — Critical Observability Gaps
  {
    id: "OBS-001",
    dimension: "observability",
    priority: "P0",
    description: "No error tracking integration — production errors go unnoticed until users report them",
    fix_hint: "Add Sentry, Datadog, or similar: Sentry.init({ dsn: '...' }); app.use(Sentry.Handlers.errorHandler())",
    pattern: /(?:express\s*\(\)|createServer|new\s+Hono|new\s+Elysia)/,
    file_exclude: /(?:Sentry|datadog|bugsnag|rollbar|airbrake|honeybadger|newrelic|@sentry)/,
  },
  {
    id: "OBS-002",
    dimension: "observability",
    priority: "P0",
    description: "Catch block with no logging — errors silently swallowed, impossible to debug",
    fix_hint: "Log the error in every catch block: logger.error({ err, context }, 'operation failed')",
    pattern: /catch\s*\(\s*\w*\s*\)\s*\{[\s\n]*(?:\}|\/\/|return\s|res\.)/,
  },

  // P1 — Must Fix
  {
    id: "OBS-010",
    dimension: "observability",
    priority: "P1",
    description: "No request ID propagation — cannot trace a request across services or log entries",
    fix_hint: "Add request ID middleware: req.id = req.headers['x-request-id'] || crypto.randomUUID()",
    pattern: /app\.(?:use|get|post|put|delete)\s*\(/,
    file_exclude: /(?:request[_-]?id|x-request-id|correlation[_-]?id|trace[_-]?id|req\.id)/i,
    handler_only: true,
  },
  {
    id: "OBS-011",
    dimension: "observability",
    priority: "P1",
    description: "No health check endpoint — load balancers and orchestrators cannot verify service health",
    fix_hint: "Add GET /health or /healthz endpoint returning { status: 'ok', uptime, version }",
    pattern: /app\.listen|server\.listen|export\s+default\s+app/,
    file_exclude: /(?:\/health|\/healthz|\/readyz|\/livez|health[_-]?check)/i,
  },
  {
    id: "OBS-012",
    dimension: "observability",
    priority: "P1",
    description: "Unstructured error response — 500 errors return raw message instead of structured error object",
    fix_hint: "Return structured errors: { error: { code, message, requestId } } — never expose stack traces",
    pattern: /res\.status\s*\(\s*500\s*\)\.(?:send|json)\s*\(\s*(?:err|error|e)(?:\.message)?\s*\)/,
  },

  // P2 — Should Fix
  {
    id: "OBS-020",
    dimension: "observability",
    priority: "P2",
    description: "console.log/error in production code — unstructured, no log levels, no context",
    fix_hint: "Replace with structured logger (pino, winston): logger.info({ userId, action }, 'message')",
    pattern: /console\.(?:log|error|warn|info|debug)\s*\(/,
    handler_only: true,
  },
  {
    id: "OBS-021",
    dimension: "observability",
    priority: "P2",
    description: "No response time tracking — cannot identify slow endpoints or performance regression",
    fix_hint: "Add response time middleware: track and log Date.now() - start for each request",
    pattern: /app\.(?:use|get|post|put|delete)\s*\(/,
    file_exclude: /(?:response[_-]?time|x-response-time|duration|elapsed|latency|perf_hooks)/i,
    handler_only: true,
  },
  {
    id: "OBS-022",
    dimension: "observability",
    priority: "P2",
    description: "Missing trace context headers — distributed tracing cannot follow requests across services",
    fix_hint: "Propagate W3C trace context: traceparent and tracestate headers on outgoing requests",
    pattern: /fetch\s*\(|axios\.(?:get|post|put|delete)|http\.request/,
    file_exclude: /(?:traceparent|tracestate|x-trace|opentelemetry|@opentelemetry|dd-trace)/i,
  },

  // P3 — Nice to Have
  {
    id: "OBS-030",
    dimension: "observability",
    priority: "P3",
    description: "No log level configuration — cannot adjust verbosity without code changes",
    fix_hint: "Make log level configurable via env var: LOG_LEVEL=info (default), debug for development",
    pattern: /(?:pino|winston|bunyan|createLogger|new\s+Logger)\s*\(/,
    file_exclude: /(?:LOG_LEVEL|log[_-]?level|level:\s*process\.env)/i,
  },
  {
    id: "OBS-031",
    dimension: "observability",
    priority: "P3",
    description: "No graceful shutdown handler — in-flight requests dropped on deploy",
    fix_hint: "Handle SIGTERM: server.close() then process.exit(0) after draining connections",
    pattern: /(?:app|server)\.listen\s*\(/,
    file_exclude: /(?:SIGTERM|SIGINT|graceful|shutdown|process\.on)/,
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

export const observabilityScanner: ScannerPlugin = {
  name: "observability",
  dimensions: ["observability"],

  scan(filePath: string, content: string, _language: string): FileDefect[] {
    const defects: FileDefect[] = [];
    const seenIds = new Set<string>();
    const isHandler = isHandlerFile(content);

    // Skip non-source files
    if (!/\.(ts|js|tsx|jsx|mjs|cjs)$/.test(filePath)) return [];

    // Skip test/config/eval files
    if (/(?:\.test\.|\.spec\.|__tests__|\.config\.|evals\/|scanners\/)/.test(filePath)) return [];

    for (const rule of OBS_PATTERNS) {
      // Skip handler-only rules for non-handler files
      if (rule.handler_only && !isHandler) continue;

      // Skip if file-level exclusion matches
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

export default observabilityScanner;
