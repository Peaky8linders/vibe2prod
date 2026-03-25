/**
 * sentinel/middleware/express.ts — Production signal capture for Express
 *
 * Zero-config middleware that captures security-relevant events in production
 * and writes them to .v2p/sentinel.jsonl for the antifragile feedback loop.
 *
 * Usage:
 *   import { v2pSentinel } from '@v2p/sentinel';
 *   app.use(v2pSentinel());
 *
 * Privacy-safe by architecture:
 *   - Captures attack patterns, not user data
 *   - Strips values from payloads (keeps only keys and types)
 *   - Hashes IP addresses (one-way, for clustering)
 *   - Never captures bodies of successful requests
 *   - Configurable field blocklist
 */

import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
// Express types inlined to avoid dependency on @types/express in the V2P system.
// The sentinel middleware runs in the TARGET app which has Express installed.
interface Request {
  ip?: string;
  socket: { remoteAddress?: string };
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, unknown>;
}
interface Response {
  statusCode: number;
  on(event: string, listener: () => void): void;
}
type NextFunction = (err?: unknown) => void;
type ErrorRequestHandler = (err: Error, req: Request, res: Response, next: NextFunction) => void;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SentinelEvent {
  timestamp: string;
  type: "rejected-input" | "auth-failure" | "unhandled-error" | "rate-limit-hit" | "anomalous-payload";
  endpoint: string;
  method: string;
  ip_hash: string;
  user_agent: string;
  pattern: Record<string, unknown>;
  frequency?: number;
}

export interface SentinelOptions {
  /** Path to write events. Default: .v2p/sentinel.jsonl */
  output?: string;
  /** Fields to always redact from captured payloads */
  redact?: string[];
  /** Disable sentinel (for testing) */
  disabled?: boolean;
  /** Max events to buffer before flushing. Default: 10 */
  bufferSize?: number;
}

// ---------------------------------------------------------------------------
// Redaction Layer (privacy-safe by architecture)
// ---------------------------------------------------------------------------

const DEFAULT_REDACT_FIELDS = [
  "password", "passwd", "pwd", "secret", "token", "api_key", "apikey",
  "authorization", "cookie", "ssn", "credit_card", "card_number",
  "cvv", "pin", "dob", "date_of_birth",
];

function redactPayload(
  obj: unknown,
  redactFields: string[],
): Record<string, string> {
  if (obj === null || obj === undefined) return {};
  if (typeof obj !== "object") return { _type: typeof obj };
  if (Array.isArray(obj)) return { _type: "array", _length: String(obj.length) };

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (redactFields.includes(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (value === null) {
      result[key] = "null";
    } else if (Array.isArray(value)) {
      result[key] = `array[${value.length}]`;
    } else if (typeof value === "object") {
      result[key] = "object";
    } else {
      result[key] = typeof value;
    }
  }
  return result;
}

// Per-process random salt — never hardcoded, never shared
const IP_SALT = randomBytes(16).toString("hex");

function hashIp(ip: string): string {
  return createHash("sha256").update(ip + IP_SALT).digest("hex").slice(0, 12);
}

// ---------------------------------------------------------------------------
// Event Buffer & Writer
// ---------------------------------------------------------------------------

class EventWriter {
  private buffer: SentinelEvent[] = [];
  private readonly outputPath: string;
  private readonly bufferSize: number;
  private static readonly MAX_BUFFER = 1000; // Cap to prevent OOM

  constructor(outputPath: string, bufferSize: number) {
    this.outputPath = outputPath;
    this.bufferSize = bufferSize;

    // Ensure output directory exists
    const dir = this.outputPath.split("/").slice(0, -1).join("/");
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  write(event: SentinelEvent): void {
    // Drop oldest events if buffer exceeds cap (prevents OOM under sustained attack)
    if (this.buffer.length >= EventWriter.MAX_BUFFER) {
      this.buffer.splice(0, this.buffer.length - EventWriter.MAX_BUFFER + 1);
    }
    this.buffer.push(event);
    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.map((e) => JSON.stringify(e)).join("\n") + "\n";
    try {
      appendFileSync(this.outputPath, lines);
    } catch {
      // Disk full or permission denied — drop events rather than crash host app
      process.stderr.write(`[v2p-sentinel] Failed to write events to ${this.outputPath}\n`);
    }
    this.buffer = [];
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export function v2pSentinel(options: SentinelOptions = {}): Array<
  ((req: Request, res: Response, next: NextFunction) => void) | ErrorRequestHandler
> {
  if (options.disabled) {
    return [(_req: Request, _res: Response, next: NextFunction) => next()];
  }

  const outputPath = options.output ?? ".v2p/sentinel.jsonl";
  const redactFields = [...DEFAULT_REDACT_FIELDS, ...(options.redact ?? [])];
  const writer = new EventWriter(outputPath, options.bufferSize ?? 10);

  // Flush on process exit — use once() to not hijack host app's signal handlers
  process.on("exit", () => writer.flush());
  process.once("SIGINT", () => writer.flush());
  process.once("SIGTERM", () => writer.flush());

  // Request tracking middleware
  const requestMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    // Hook into response finish
    res.on("finish", () => {
      const statusCode = res.statusCode;
      const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

      // Capture rejected inputs (4xx responses)
      if (statusCode >= 400 && statusCode < 500) {
        const eventType = statusCode === 401 || statusCode === 403
          ? "auth-failure" as const
          : statusCode === 429
            ? "rate-limit-hit" as const
            : "rejected-input" as const;

        writer.write({
          timestamp: new Date().toISOString(),
          type: eventType,
          endpoint: req.path,
          method: req.method,
          ip_hash: hashIp(ip),
          user_agent: String(req.headers["user-agent"] ?? "unknown").slice(0, 100),
          pattern: {
            status_code: statusCode,
            body_shape: redactPayload(req.body, redactFields),
            query_params: redactPayload(req.query, redactFields),
            content_type: req.headers["content-type"] ?? "none",
            response_time_ms: Date.now() - startTime,
          },
        });
      }

      // Detect anomalous payloads on any request
      if (req.body && typeof req.body === "object") {
        const bodyStr = JSON.stringify(req.body);
        const anomalies: string[] = [];

        if (bodyStr.length > 50_000) anomalies.push("oversized-body");
        if (/__proto__|constructor\.prototype/.test(bodyStr)) anomalies.push("prototype-pollution-attempt");
        if (/<script|javascript:|onerror=|onload=/i.test(bodyStr)) anomalies.push("xss-attempt");
        if (/UNION\s+SELECT|;\s*DROP\s+TABLE|pg_sleep|WAITFOR\s+DELAY/i.test(bodyStr)) anomalies.push("sql-injection-attempt");
        if (/\.\.\/|\.\.\\|%2e%2e/i.test(bodyStr)) anomalies.push("path-traversal-attempt");

        if (anomalies.length > 0) {
          writer.write({
            timestamp: new Date().toISOString(),
            type: "anomalous-payload",
            endpoint: req.path,
            method: req.method,
            ip_hash: hashIp(ip),
            user_agent: String(req.headers["user-agent"] ?? "unknown").slice(0, 100),
            pattern: {
              anomalies,
              body_shape: redactPayload(req.body, redactFields),
              body_size: bodyStr.length,
            },
          });
        }
      }
    });

    next();
  };

  // Error tracking middleware (must be 4-arg for Express error handler)
  const errorMiddleware: ErrorRequestHandler = (err: Error, req: Request, _res: Response, next: NextFunction): void => {
    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

    writer.write({
      timestamp: new Date().toISOString(),
      type: "unhandled-error",
      endpoint: req.path,
      method: req.method,
      ip_hash: hashIp(ip),
      user_agent: String(req.headers["user-agent"] ?? "unknown").slice(0, 100),
      pattern: {
        error_name: err.name,
        error_message: err.message.slice(0, 200),
        // NO stack trace — privacy safe
      },
    });

    next(err);
  };

  return [requestMiddleware, errorMiddleware];
}
