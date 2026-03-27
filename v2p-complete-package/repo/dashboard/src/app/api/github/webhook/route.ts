/**
 * api/github/webhook/route.ts — GitHub App webhook handler
 *
 * Receives PR events, triggers security scans, posts check runs
 * and inline review comments. This is the distribution engine.
 */

import { NextResponse } from "next/server";
import { verifyWebhookSignature, scanPR } from "@/lib/github-app";

export const maxDuration = 60; // Match existing scan route timeout

interface WebhookPayload {
  action: string;
  installation?: { id: number };
  pull_request?: {
    number: number;
    head: { sha: string };
  };
  repository?: {
    owner: { login: string };
    name: string;
  };
}

export async function POST(request: Request) {
  // 1. Read raw body for signature verification
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256") ?? "";
  const event = request.headers.get("x-github-event") ?? "";

  // 2. Verify webhook signature
  if (!verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // 3. Parse payload
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // 4. Handle pull_request events
  if (event === "pull_request" && (payload.action === "opened" || payload.action === "synchronize")) {
    const installationId = payload.installation?.id;
    const prNumber = payload.pull_request?.number;
    const headSha = payload.pull_request?.head?.sha;
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;

    if (!installationId || !prNumber || !headSha || !owner || !repo) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Run scan (synchronous for v1 — async queue in v2)
    try {
      await scanPR(installationId, owner, repo, prNumber, headSha);
    } catch (err) {
      console.error("[vibecheck-webhook] Scan failed:", err instanceof Error ? err.message : err);
      // Still return 200 — GitHub retries on non-2xx
    }

    return NextResponse.json({ status: "scanned" });
  }

  // 5. Handle installation events (logging only for v1)
  if (event === "installation") {
    // Installation event received — handled silently for v1
    return NextResponse.json({ status: "ok" });
  }

  // 6. Acknowledge other events
  return NextResponse.json({ status: "ignored", event });
}
