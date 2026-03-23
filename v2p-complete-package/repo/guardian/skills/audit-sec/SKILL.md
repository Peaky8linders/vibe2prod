---
name: audit-sec
version: 1.0.0
description: |
  AI security audit scanner covering OWASP Top 10 for LLMs, access controls,
  supply chain integrity, and infrastructure security. Maps to EU AI Act and
  ISO/IEC 42001 Domains 3 (Model Lifecycle), 5 (Model Integrity & Robustness),
  6 (Access Control & Authentication), 7 (Infrastructure Security), and
  9 (Supply Chain & Third-Party Risk).
  Produces findings with severity, evidence, and remediation specs.
  Use when: "security audit", "OWASP check", "scan for vulnerabilities",
  "check access controls", "supply chain audit".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# audit-sec — Security Scanner

Scan the target codebase for security defects across five compliance domains.
Output is append-only `findings.jsonl` entries with structured evidence.

## Phase 1 — Discovery & Inventory

1. Read `program.md` (or the active program file) to identify the target directory and tech stack.
2. Glob for all source files in the target directory. Build a file manifest.
3. Identify entry points: API routes, CLI handlers, serverless functions, model inference endpoints.
4. Identify dependency manifests: `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.

## Phase 2 — Secret & Credential Scanning (Domain 7)

1. Grep for high-entropy strings, hardcoded API keys, tokens, passwords, and connection strings.
   Patterns: `AKIA[0-9A-Z]{16}`, `sk-[a-zA-Z0-9]{48}`, `-----BEGIN (RSA|EC|DSA) PRIVATE KEY-----`,
   `password\s*=\s*["'][^"']+["']`, `secret\s*=`, `token\s*=`, `Bearer [a-zA-Z0-9._-]+`.
2. Check for `.env` files committed to the repo.
3. Check `.gitignore` for missing secret file patterns.
4. For each finding, emit a `findings.jsonl` entry:
   ```json
   {"scanner":"secret-scanner","domain":7,"control":"INFRA-*","severity":"P0",
    "file":"<path>","line":<n>,"evidence":"<redacted pattern match>",
    "remediation":"Move to environment variable or secrets manager."}
   ```

## Phase 3 — Injection & Prompt Injection Scanning (Domain 5)

1. Grep for unsanitized user input flowing into:
   - LLM prompt templates (string concatenation, f-strings, template literals with user data)
   - SQL queries (no parameterized queries)
   - Shell commands (`exec`, `spawn`, `system`, `eval`)
   - File paths (path traversal)
2. Check for prompt injection defenses: input validation, output filtering, system prompt anchoring.
3. Check for model output sanitization before rendering (XSS via LLM output).
4. Emit findings with `scanner: "injection-scanner"`, domain 5.

## Phase 4 — Access Control Scanning (Domain 6)

1. Grep for authentication middleware usage on all route handlers.
2. Identify routes missing auth guards.
3. Check for role-based access control (RBAC) or attribute-based access control (ABAC) patterns.
4. Check for rate limiting on API endpoints.
5. Check for CORS configuration — overly permissive origins.
6. Emit findings with `scanner: "access-control-scanner"`, domain 6.

## Phase 5 — Supply Chain Scanning (Domain 9)

1. Read dependency manifests and lockfiles.
2. Check for pinned versions vs. floating ranges (`^`, `~`, `*`).
3. Check for known-vulnerable packages: run `npm audit --json` or equivalent.
4. Check for pre/post-install scripts in dependencies that execute arbitrary code.
5. Check for vendored dependencies with no integrity verification.
6. Emit findings with `scanner: "supply-chain-scanner"`, domain 9.

## Phase 6 — Lifecycle Security (Domain 3)

1. Check for model artifact integrity: signed checksums, hash verification on model loads.
2. Check for secure model serialization (no pickle with untrusted sources).
3. Check for inference endpoint authentication and input size limits.
4. Emit findings with `scanner: "lifecycle-scanner"`, domain 3.

## Phase 7 — Findings Consolidation & Human Review

1. Read all emitted findings from this scan session.
2. Deduplicate findings by file + line + control.
3. Sort by severity: P0 > P1 > P2 > P3.
4. For any P0 finding, use **AskUserQuestion** to present the finding and get human confirmation:
   ```
   [P0 SECURITY FINDING] <control-id>
   File: <path>:<line>
   Evidence: <description>
   Recommended action: <remediation>
   Should this be flagged for immediate fix? (yes/skip/false-positive)
   ```
5. Append all confirmed findings to `findings.jsonl`.

## Completion Protocol

- **DONE** — All 5 scanners completed, zero P0 findings.
- **DONE_WITH_CONCERNS** — Scanners completed, P0/P1 findings exist and are logged.
- **BLOCKED** — Target directory unreadable, no source files found, or dependency manifests missing.

Report the final status, total finding count by severity, and the path to `findings.jsonl`.
