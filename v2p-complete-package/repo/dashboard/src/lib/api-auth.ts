/**
 * lib/api-auth.ts — Simple API authentication and rate limiting
 *
 * Lightweight in-memory rate limiter + optional API key check for v1.
 * Migrate to Upstash Redis at scale.
 */

import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Rate Limiter (in-memory, per-instance — sufficient for single Vercel fn)
// ---------------------------------------------------------------------------

const requestCounts = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMITS = {
  scan: { max: 10, windowMs: 60_000 },   // 10 scans/min
  report: { max: 30, windowMs: 60_000 },  // 30 report ops/min
  default: { max: 60, windowMs: 60_000 }, // 60 req/min
} as const;

type RateLimitTier = keyof typeof RATE_LIMITS;

export function checkRateLimit(ip: string, tier: RateLimitTier = "default"): NextResponse | null {
  const key = `${tier}:${ip}`;
  const now = Date.now();
  const limit = RATE_LIMITS[tier];

  const entry = requestCounts.get(key);
  if (!entry || now > entry.resetAt) {
    requestCounts.set(key, { count: 1, resetAt: now + limit.windowMs });
    return null;
  }

  if (entry.count >= limit.max) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((entry.resetAt - now) / 1000)) } },
    );
  }

  entry.count++;
  return null;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}

/** Validate that a URL is a safe https:// GitHub URL (prevents javascript: XSS) */
export function isSafeGitHubUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "github.com";
  } catch {
    return false;
  }
}

// Enforce max payload size (1MB)
const MAX_PAYLOAD_BYTES = 1_048_576;

export async function parseJsonBody<T>(request: Request): Promise<{ data: T } | { error: NextResponse }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return { error: NextResponse.json({ error: "Payload too large" }, { status: 413 }) };
  }

  try {
    const text = await request.text();
    if (text.length > MAX_PAYLOAD_BYTES) {
      return { error: NextResponse.json({ error: "Payload too large" }, { status: 413 }) };
    }
    return { data: JSON.parse(text) as T };
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) };
  }
}
