# CLAUDE.md — Agent Boundary Rules for VibeCheck Hardening

## Identity
You are a production hardening agent. Your job is to take a working prototype
and systematically close production defects — one atomic commit at a time —
without breaking existing behavior.

## Hard Boundaries

### Files You May Modify
- `target/**` — the vibe-coded project files listed in the active `programs/*.md`
- `logs/fixes.jsonl` — append-only, you may only append

### Files You May NOT Modify (Read-Only)
- `evals/**` — the entire eval harness, judges, prompts, and snapshots
- `programs/**` — the program.md files that instruct you
- `scripts/**` — the orchestration scripts
- `CLAUDE.md` — this file
- `package.json`, `tsconfig.json` — project configuration

### Verification
The eval harness verifies its own integrity via SHA-256 hash on every run.
If you modify any file in `evals/`, the run will fail and be logged as a
tampering attempt. Don't try.

## Commit Discipline

### One Defect Per Commit
Each commit addresses exactly ONE defect from `evals/defect-taxonomy.json`.
The commit message format is:
```
fix(<dimension>): <defect-id> — <short description>
```
Example: `fix(error-handling): EH-003 — add timeout to external API calls in user-service`

### Commit Gate
A commit is ONLY allowed when ALL of the following are true:
1. All L1 assertions pass (tests, types, lint, secrets scan)
2. All L2 judges pass at ≥85% rate for the active dimension
3. Behavioral snapshot tests show zero regression
4. Readiness score ≥ previous committed baseline

If ANY gate fails → `git checkout -- target/` and log the failure reason.
No exceptions. No "almost passing." No partial commits.

## Experiment Protocol
1. Read the active `programs/<dimension>.md`
2. Read `evals/defect-taxonomy.json` — pick highest-priority unfixed defect
3. Read the target files relevant to this defect
4. Form a hypothesis for the minimal fix (log it)
5. Apply the fix — smallest diff that resolves the defect
6. Run: `bash scripts/run-fix.sh`
7. If committed → move to next defect
8. If reverted → read the failure reason, try a different approach (max 3 attempts per defect)
9. After 3 failed attempts → skip defect, log as "needs-human-review"

## What You Must Never Do
- Modify eval infrastructure
- Disable, weaken, or skip any gate
- Introduce `any` types, `@ts-ignore`, `eslint-disable` to pass gates
- Add dependencies without security audit
- Change existing API contracts (request/response shapes)
- Remove existing tests
- Introduce secrets, credentials, or PII in source
- Make network calls to domains not in the allowlist

## What "Fixed" Means
A defect is fixed when:
- The specific binary assertion for that defect passes
- The LLM judge confirms the fix addresses the failure mode
- All other gates still pass (no regressions)
- The fix is minimal — no unrelated changes in the diff

<!-- GSD:project-start source:PROJECT.md -->
## Project

**PROJECT.md — VibeCheck Monetization Milestone**

VibeCheck is an autonomous production hardening system that scans vibe-coded apps for security defects, fixes them while you sleep, and provides antifragile chaos testing. The product differentiates from competitors (Snyk, Aikido, VibeCheck competitor) through its **autonomous fix loop** — not just scanning, but actually fixing defects with provable safety guarantees.

**This milestone** adds the revenue engine: Stripe payment integration, Supabase Auth for user accounts, and a conversion funnel that turns free scans into paying customers.

**Core Value:** **"Scan → Pay → Fix"** — The path from first scan to paying customer to autonomous hardening must be frictionless. A vibe coder pastes a GitHub URL, sees scary results, and upgrades to get them fixed automatically.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## 1. Supabase Auth with Next.js 15
### Package Decision: `@supabase/ssr` (not auth-helpers)
| Old (deprecated) | New |
|---|---|
| `createMiddlewareClient` | `createServerClient` |
| `createClientComponentClient` | `createBrowserClient` |
| `createServerComponentClient` | `createServerClient` |
| `createRouteHandlerClient` | `createServerClient` |
### Package Versions
- `@supabase/supabase-js`: `^2.100.1` (latest as of March 2026)
- `@supabase/ssr`: `^0.5.x` (check npm for latest patch)
### Client Setup Pattern
### Root `middleware.ts`:
### Route Protection in Server Components:
### Critical Security Notes
- **CVE-2025-29927**: Never rely solely on middleware for auth. Always call `getUser()` at data access points too. Requires Next.js 15.2.3+.
- **Never use `getSession()` in server code** — it doesn't re-validate the token with Supabase Auth.
- Session cookies are HTTP-only, avoiding XSS exposure. Supabase refresh tokens are single-use.
## 2. Stripe Integration with Next.js 15
### Package Versions
- `stripe` (server SDK): `^17.x` (latest stable — v17/18 are the production-recommended range; v21 is bleeding edge as of March 2026, check changelog before using latest major)
- `@stripe/stripe-js` (client): `^9.0.0` (latest as of March 2026)
- `@stripe/react-stripe-js`: `^3.x` (React wrappers for Stripe Elements)
- Stripe API version: `2026-02-25.clover` (current stable)
### Stripe Checkout vs Embedded Form vs Payment Element
| Option | Use Case | Effort | Recommendation |
|---|---|---|---|
| **Hosted Checkout** (redirect) | MVP, fastest to ship | Low | Use for launch; redirect to `stripe.com` |
| **Embedded Checkout** | SaaS, keep user on domain | Medium | **Recommended for VibeCheck** |
| **Payment Element** | Full custom UI | High | Overkill unless custom design is required |
### Embedded Checkout Pattern (Server Action + Client):
### Stripe Webhook Handler
- Disable Vercel Deployment Protection for the `/api/webhooks/stripe` route (it blocks Stripe's requests).
- Respond within 20 seconds — acknowledge immediately, queue async work if needed.
- Set `STRIPE_WEBHOOK_SECRET` in Vercel dashboard (different secret for dev vs prod).
- Local dev: use Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`).
### Stripe Customer Portal
## 3. Database Schema
### Linking Auth Users to Stripe Customers
### SQL Schema
### Auto-Provision Profile on Signup
### Stripe Webhook → DB Sync Pattern
### Plan → Quota Mapping
## 4. Rate Limiting / Quota Enforcement
### Two-Layer Strategy
### Layer 1: Quota Enforcement (Supabase)
### Layer 2: Rate Limiting (Upstash Redis)
- Use `slidingWindow` for scan endpoints (prevents burst gaming)
- Use `fixedWindow` if you add multi-region Vercel deployments (sliding window has high Redis command count in multi-region)
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
### Quota vs Rate Limit Comparison
| Concern | Tool | Resets |
|---|---|---|
| Monthly scan quota (billing) | Supabase `scan_usage` table | Per billing period |
| Per-minute burst protection | Upstash `@upstash/ratelimit` | Rolling window |
## 5. Environment Variables
# Supabase
# Stripe
# Upstash
# App
## 6. Key Warnings & Gotchas
## 7. Recommended Starter Template
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
