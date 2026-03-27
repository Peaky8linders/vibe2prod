/**
 * lib/github-app.ts — GitHub App integration for PR-level scanning
 *
 * Handles webhook signature verification, installation auth,
 * PR file fetching, check run creation, and inline review comments.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { scanFiles } from "./scanner-engine";
import type { ScanResult } from "./scanner-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PullRequestFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "failure" | "warning" | "notice";
  message: string;
  title: string;
}

interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

// ---------------------------------------------------------------------------
// Webhook Signature Verification
// ---------------------------------------------------------------------------

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return false;

  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return timingSafeEqual(expectedBuf, signatureBuf);
}

// ---------------------------------------------------------------------------
// GitHub API Helpers (using fetch — no Octokit dependency for v1)
// ---------------------------------------------------------------------------

async function getInstallationToken(installationId: number): Promise<string> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !privateKey) throw new Error("GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required");

  // Create JWT for GitHub App authentication
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600, iss: appId })).toString("base64url");

  // Sign with RSA private key
  const { createSign } = await import("node:crypto");
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(privateKey.replace(/\\n/g, "\n"), "base64url");
  const jwt = `${header}.${payload}.${signature}`;

  // Exchange JWT for installation access token
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!res.ok) throw new Error(`Failed to get installation token: ${res.status}`);
  const data = await res.json() as { token: string };
  return data.token;
}

async function githubApi(token: string, endpoint: string, options?: RequestInit) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${endpoint}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// PR File Operations
// ---------------------------------------------------------------------------

export async function getChangedFiles(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PullRequestFile[]> {
  const files = await githubApi(token, `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`) as PullRequestFile[];
  return files.filter((f) => f.status !== "removed");
}

export async function fetchFileContents(
  token: string,
  owner: string,
  repo: string,
  ref: string,
  filenames: string[],
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const sourceExts = /\.(ts|tsx|js|jsx|mjs|cjs|py|rules|sql)$/;

  // Only fetch source files, skip large lists
  const toFetch = filenames.filter((f) => sourceExts.test(f)).slice(0, 100);

  // Fetch in batches of 10 to avoid GitHub secondary rate limits
  const BATCH_SIZE = 10;
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    const batch = toFetch.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (filename) => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(filename)}?ref=${ref}`,
            {
              headers: {
                Authorization: `token ${token}`,
                Accept: "application/vnd.github.raw+json",
                "X-GitHub-Api-Version": "2022-11-28",
              },
            },
          );
          if (res.ok) {
            const content = await res.text();
            if (content.length <= 1024 * 1024) { // Skip files > 1MB
              files.set(filename, content);
            }
          }
        } catch {
          // Skip files we can't fetch
        }
      }),
    );
  }

  return files;
}

// ---------------------------------------------------------------------------
// Check Run Management
// ---------------------------------------------------------------------------

function buildCheckRunOutput(scanResult: ScanResult): {
  conclusion: string;
  output: { title: string; summary: string };
} {
  const { by_priority, total_defects, overall_readiness, files_scanned } = scanResult;
  const readiness = Math.round(overall_readiness * 100);

  let conclusion: string;
  if (by_priority.P0 > 0) conclusion = "failure";
  else if (by_priority.P1 > 0) conclusion = "neutral";
  else conclusion = "success";

  const summary = [
    `## VibeCheck Security Scan`,
    ``,
    `**${readiness}% Production Ready** | ${files_scanned} files scanned | ${total_defects} defects found`,
    ``,
    `| Priority | Count |`,
    `|----------|-------|`,
    `| P0 (Critical) | ${by_priority.P0} |`,
    `| P1 (High) | ${by_priority.P1} |`,
    `| P2 (Medium) | ${by_priority.P2} |`,
    `| P3 (Low) | ${by_priority.P3} |`,
    ``,
    by_priority.P0 > 0
      ? `> **Merge blocked**: ${by_priority.P0} critical (P0) issues must be resolved.`
      : `> All critical checks passed.`,
  ].join("\n");

  return {
    conclusion,
    output: { title: `${readiness}% Ready — ${total_defects} defects`, summary },
  };
}

export async function createCheckRun(
  token: string,
  owner: string,
  repo: string,
  headSha: string,
  status: "in_progress" | "completed",
  scanResult?: ScanResult,
): Promise<number> {
  const body: Record<string, unknown> = {
    name: "VibeCheck Security",
    head_sha: headSha,
    status,
  };

  if (status === "completed" && scanResult) {
    const { conclusion, output } = buildCheckRunOutput(scanResult);
    body.conclusion = conclusion;
    body.output = output;
  }

  const result = await githubApi(token, `/repos/${owner}/${repo}/check-runs`, {
    method: "POST",
    body: JSON.stringify(body),
  }) as { id: number };

  return result.id;
}

export async function updateCheckRun(
  token: string,
  owner: string,
  repo: string,
  checkRunId: number,
  scanResult: ScanResult,
  annotations: CheckAnnotation[],
): Promise<void> {
  const { conclusion, output } = buildCheckRunOutput(scanResult);

  // GitHub limits annotations to 50 per request
  const limitedAnnotations = annotations.slice(0, 50);

  await githubApi(token, `/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      conclusion,
      output: {
        ...output,
        annotations: limitedAnnotations,
      },
    }),
  });
}

// ---------------------------------------------------------------------------
// PR Review Comments
// ---------------------------------------------------------------------------

export async function postReviewComments(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  commitSha: string,
  comments: ReviewComment[],
): Promise<void> {
  if (comments.length === 0) return;

  // Limit to 25 comments per review to avoid spam
  const limited = comments.slice(0, 25);

  await githubApi(token, `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, {
    method: "POST",
    body: JSON.stringify({
      commit_id: commitSha,
      body: `VibeCheck found ${comments.length} issue${comments.length === 1 ? "" : "s"} in this PR.`,
      event: "COMMENT",
      comments: limited.map((c) => ({
        path: c.path,
        line: c.line,
        body: c.body,
      })),
    }),
  });
}

// ---------------------------------------------------------------------------
// PR Scan Orchestrator
// ---------------------------------------------------------------------------

export async function scanPR(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
): Promise<void> {
  const token = await getInstallationToken(installationId);

  // 1. Create in-progress check run
  const checkRunId = await createCheckRun(token, owner, repo, headSha, "in_progress");

  try {
    // 2. Get changed files
    const changedFiles = await getChangedFiles(token, owner, repo, prNumber);
    const filenames = changedFiles.map((f) => f.filename);

    // 3. Fetch file contents
    const files = await fetchFileContents(token, owner, repo, headSha, filenames);

    if (files.size === 0) {
      // No scannable files — update existing check run as success
      const emptyResult: ScanResult = {
        project: repo,
        scanned_at: new Date().toISOString(),
        files_scanned: 0,
        total_defects: 0,
        overall_readiness: 1.0,
        by_priority: { P0: 0, P1: 0, P2: 0, P3: 0 },
        by_dimension: {},
        files: [],
        antifragile: { robustness: 40, chaos_resilience: 0, production_adaptation: 0, total: 40, attacks_adapted: 0 },
        store_checks: { apple: { passed: 0, total: 0, blocked: [] }, google: { passed: 0, total: 0, blocked: [] } },
      };
      await updateCheckRun(token, owner, repo, checkRunId, emptyResult, []);
      return;
    }

    // 4. Run scan
    const scanResult = scanFiles(files, repo);

    // 5. Build annotations from scan results
    const annotations: CheckAnnotation[] = [];
    const reviewComments: ReviewComment[] = [];

    // Build annotations via lightweight inline scan on changed files
    for (const [filePath, content] of files) {
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const lineNum = i + 1;

        // Quick P0 checks for annotations
        const checks: Array<{ pattern: RegExp; title: string; msg: string; level: "failure" | "warning" }> = [
          { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"][A-Za-z0-9]{20,}['"]/i, title: "Hardcoded API Key", msg: "Move to environment variable.", level: "failure" },
          { pattern: /AKIA[A-Z0-9]{16}/, title: "AWS Access Key", msg: "Use IAM roles or env vars.", level: "failure" },
          { pattern: /SUPABASE_SERVICE_ROLE_KEY/, title: "Service Role Key Exposed", msg: "Must only be used server-side.", level: "failure" },
          { pattern: /allow\s+(?:read|write)\s*[:,]\s*if\s+true/, title: "Open Firebase Rule", msg: "Add auth checks.", level: "failure" },
          { pattern: /\.from\s*\(['"`]\w+['"`]\)/, title: "Supabase Query", msg: "Verify RLS policies are enabled.", level: "warning" },
        ];

        for (const { pattern, title, msg, level } of checks) {
          if (pattern.test(line)) {
            annotations.push({
              path: filePath,
              start_line: lineNum,
              end_line: lineNum,
              annotation_level: level,
              title,
              message: `${msg} (VibeCheck)`,
            });
            reviewComments.push({
              path: filePath,
              line: lineNum,
              body: `**VibeCheck** ${level === "failure" ? "P0" : "P1"}: ${title}\n\n${msg}`,
            });
          }
        }
      }
    }

    // 6. Update check run with results
    await updateCheckRun(token, owner, repo, checkRunId, scanResult, annotations);

    // 7. Post inline review comments (only for P0/P1 — avoid spam)
    const criticalComments = reviewComments.slice(0, 15);
    if (criticalComments.length > 0) {
      try {
        await postReviewComments(token, owner, repo, prNumber, headSha, criticalComments);
      } catch {
        // Review comments are best-effort — check run is the primary signal
      }
    }
  } catch (err) {
    // On error, mark check run as failed
    try {
      await githubApi(token, `/repos/${owner}/${repo}/check-runs/${checkRunId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "completed",
          conclusion: "failure",
          output: {
            title: "Scan Error",
            summary: `VibeCheck scan failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
        }),
      });
    } catch {
      // Best effort
    }
  }
}
