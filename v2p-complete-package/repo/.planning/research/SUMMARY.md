# Research Summary

_Synthesized from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md — 2026-03-27_

---

## Recommended Stack

- `next` — `^15.2.3+` (minimum; patches CVE-2025-29927)
- `@supabase/supabase-js` — `^2.100.1`
- `@supabase/ssr` — `^0.5.x` (replaces deprecated auth-helpers; handles Next.js 15 async cookies)
- `stripe` (server SDK) — `^17.x`; API version pinned to `2026-02-25.clover`
- `@stripe/stripe-js` (client) — `^9.0.0`
- `@stripe/react-stripe-js` — `^3.x` (only needed if using Embedded Checkout)
- `@upstash/ratelimit` — `^2.0.8` + `@upstash/redis` — `^1.x` (burst protection layer)

---

## Table Stakes Features

Features required for monetization to function at launch:

1. **Stripe Checkout session** — create and redirect; Embedded or Hosted (Hosted is faster for v1)
2. **Webhook handler** — verifies signature, handles `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
3. **Subscription sync to Supabase** — webhook writes to `subscriptions` table via service role client; source of truth for access control
4. **Stripe Customer Portal link** — self-serve cancel, update payment method, view history
5. **Scan quota enforcement** — atomic Postgres function (`try_consume_scan`) gating the scan API; monthly reset via cron
6. **Scan counter visible in dashboard** — users must see remaining scans to feel the limit
7. **Upgrade modal on limit hit** — highest-intent conversion moment; must fire when quota is exhausted
8. **Dunning: Smart Retries + grace period** — enable in Stripe Dashboard; keep users on paid tier 7–14 days while retrying (involuntary churn = 20–40% of total churn)
9. **Idempotency table for webhooks** — `stripe_webhook_events` with `ON CONFLICT DO NOTHING` before any handler logic runs

---

## Key Architecture Decisions

**Three Supabase clients, strictly separated:**
- Browser client (`lib/supabase/client.ts`) — client components only
- Server client (`lib/supabase/server.ts`) — Server Components, Server Actions, Route Handlers
- Service role client (`lib/supabase/admin.ts`) — webhook handler ONLY; add `import 'server-only'` to prevent bundle leakage

**Middleware does auth refresh only, never subscription checks:**
- Middleware calls `getUser()` (not `getSession()`) to refresh JWT cookies and protect routes
- Subscription/plan checks belong in Server Components — a DB query on every request is too expensive at the edge
- Exclude `/api/webhooks/stripe` from the middleware matcher (Stripe POSTs with no user session)

**Webhook handler is the single write path for subscription state:**
- Uses service role client to bypass RLS
- Reads raw body via `await request.text()` before any parsing (required for Stripe signature verification)
- Must return 200 within 20 seconds; defer slow work with Next.js `after()` or Upstash QStash

**Subscription check pattern in Server Components:**
- Query `subscriptions` table filtered to `status IN ('active', 'trialing')`
- Map `price_id` → plan tier via `lib/plans.ts` constants
- Feature gate at data access layer, not only in middleware (defense in depth per CVE-2025-29927)

**Data flow summary:**
- Signup → Supabase auth → DB trigger creates `public.users` row → Server Action creates Stripe customer → writes to `customers` table
- Upgrade → `/api/stripe/checkout` creates session → Stripe Checkout → webhook → `subscriptions` upsert → dashboard re-fetches on return
- Scan request → `try_consume_scan()` RPC (atomic quota check + increment) → scan executes → result written via service role client

---

## Critical Pitfalls to Avoid

1. **Webhook body parsing destroys signature verification** — always `await request.text()` before any parsing; never call `request.json()` first. Separate `STRIPE_WEBHOOK_SECRET` (Dashboard) from `STRIPE_WEBHOOK_SECRET_CLI` (local dev) — they are different secrets.

2. **`getSession()` on the server is a security hole** — it trusts the cookie without revalidating; use `getUser()` everywhere in server/middleware code or an attacker can spoof session tokens to access gated features.

3. **RLS disabled or misconfigured = all data publicly readable** — enable RLS on every table from day one; grant no `INSERT`/`UPDATE` on `subscriptions` to the `authenticated` role (only service role writes it); test policies via the SDK, not the SQL editor (which bypasses RLS).

4. **Checkout redirect race condition** — webhook arrives 1–5 seconds after Stripe redirects the user back; on the success URL, immediately call `stripe.checkout.sessions.retrieve(sessionId)` and write the subscription synchronously rather than waiting for the webhook.

5. **Service role key leakage into client bundle** — add `import 'server-only'` to any file that initializes the admin client; never prefix with `NEXT_PUBLIC_`; verify with `next build --debug` that the key does not appear in the client bundle.

---

## Build Order Recommendation

**Phase 1 — Foundation** (nothing else works without this)
1. Database schema + migrations: `users`, `customers`, `subscriptions`, `scans`, `scan_usage`, `stripe_webhook_events`; RLS policies and auth trigger on all tables
2. Supabase client setup: browser, server, and service-role clients in `lib/supabase/`
3. Environment variables configured for local and Vercel (separate test/live groups)

**Phase 2 — Auth**
4. `middleware.ts` with `updateSession()` + route protection (exclude `/api/webhooks`)
5. Login, signup, and OAuth callback routes
6. Verify: user can sign up, log in, session persists and refreshes across routes

**Phase 3 — Stripe Customer Creation**
7. Server Action: `createStripeCustomer(userId, email)` called after successful signup
8. Writes `stripe_customer_id` to `customers` table
9. `lib/plans.ts`: price ID → plan tier mapping + quota constants

**Phase 4 — Stripe Checkout and Webhook**
10. `/api/stripe/checkout` — create Checkout session (Hosted for v1)
11. `/api/webhooks/stripe` — signature verification, idempotency check, subscription upsert handlers
12. Local testing with Stripe CLI; end-to-end test: checkout → webhook → subscription row in DB

**Phase 5 — Feature Gating and Quota Enforcement**
13. `try_consume_scan()` Postgres function (atomic, row-locked) wired into `/api/scan`
14. Server Components read subscription + scan count; gate Pro features
15. Upstash rate limiting in middleware for burst protection on scan routes

**Phase 6 — Billing Management UI**
16. `/api/stripe/portal` — Customer Portal session creation
17. Dashboard billing page (link to portal) and upgrade page (plan cards + checkout CTA)
18. Upgrade modal component triggered on quota exhaustion

**Phase 7 — Conversion and Retention Layer**
19. Pricing page: 3-tier layout, annual/monthly toggle (default annual), "Most Popular" badge, social proof
20. Post-scan summary email; 5-email onboarding sequence
21. Win-back offer on cancellation; failed payment email sequence
22. Production Stripe webhook endpoint configured in Stripe Dashboard; Vercel Deployment Protection disabled for `/api/webhooks/stripe`
