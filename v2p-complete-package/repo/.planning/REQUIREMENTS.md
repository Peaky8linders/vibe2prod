# REQUIREMENTS.md — VibeCheck Monetization Milestone

## v1 Requirements

### Database & Infrastructure (DB)

- [ ] **DB-01**: Supabase database schema with tables: users, customers, subscriptions, scans, scan_usage, stripe_webhook_events — all with RLS enabled
- [ ] **DB-02**: Postgres trigger on auth.users to auto-create public.users profile row on signup
- [ ] **DB-03**: Three Supabase client modules: browser client, server client, service role admin client (with `import 'server-only'`)
- [ ] **DB-04**: Environment variables configured for Supabase (URL, anon key, service role key) and Stripe (secret key, publishable key, webhook secret, price IDs)

### Authentication (AUTH)

- [ ] **AUTH-01**: User can create account with email/password via Supabase Auth
- [ ] **AUTH-02**: User can log in and stay logged in across sessions (JWT refresh via middleware)
- [ ] **AUTH-03**: User can log out from any page
- [ ] **AUTH-04**: Next.js middleware refreshes session cookies using `getUser()` (not `getSession()`) and protects /dashboard routes
- [ ] **AUTH-05**: Webhook route `/api/webhooks/stripe` excluded from auth middleware matcher

### Stripe Integration (PAY)

- [ ] **PAY-01**: Server Action creates Stripe customer on signup and stores stripe_customer_id in customers table
- [ ] **PAY-02**: API route `/api/stripe/checkout` creates Stripe Checkout session for Pro/Enterprise plans
- [ ] **PAY-03**: Webhook handler at `/api/webhooks/stripe` verifies signature using raw body (`request.text()`), checks idempotency, and handles: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_failed
- [ ] **PAY-04**: Webhook handler upserts subscription data into subscriptions table via service role client
- [ ] **PAY-05**: API route `/api/stripe/portal` creates Stripe Customer Portal session for billing management

### Scan Quota Enforcement (QUOTA)

- [ ] **QUOTA-01**: Postgres function `try_consume_scan()` atomically checks and decrements scan quota with row-level locking
- [ ] **QUOTA-02**: Scan API route calls `try_consume_scan()` before executing scan; returns 429 if quota exhausted
- [ ] **QUOTA-03**: Free tier limited to 3 scans/month; Pro tier unlimited; Enterprise tier unlimited
- [ ] **QUOTA-04**: Scan counter visible in dashboard header showing remaining scans for current billing period

### Feature Gating (GATE)

- [ ] **GATE-01**: Server Components check subscription status (active/trialing) and map price_id to plan tier
- [ ] **GATE-02**: Free tier shows basic scan results; Pro features (LLM analysis, fix suggestions, PDF reports) shown as locked with upgrade CTA
- [ ] **GATE-03**: Upgrade modal fires when scan quota is exhausted — shows plan comparison and Stripe Checkout CTA

### Billing UI (BILL)

- [ ] **BILL-01**: Pricing page with 3-tier layout, annual/monthly toggle (default annual), "Most Popular" badge on Pro
- [ ] **BILL-02**: Dashboard billing section showing current plan, usage, and link to Stripe Customer Portal
- [ ] **BILL-03**: Success page after Stripe Checkout that fetches session to show plan immediately (handles webhook race condition)

## v2 Requirements (Deferred)

- OAuth login (Google, GitHub) — nice-to-have, email/password sufficient for v1
- Post-scan email notifications — requires email provider integration
- 5-email onboarding drip sequence — requires email provider
- Win-back offer on cancellation — requires analytics data first
- Upstash Redis rate limiting for burst protection — add when traffic warrants
- Annual pricing discount implementation — display toggle now, enforce via Stripe price IDs

## Out of Scope

- Team/multi-seat management — enterprise feature, not needed for individual plans
- Custom billing engine / usage-based metering — Stripe handles this
- In-app plan upgrade/downgrade UI — Stripe Customer Portal handles it
- Pause subscription — not standard for security tools
- VS Code extension — distribution milestone (next)
- Live credential verification — product depth milestone

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DB-01..04   | 1     | —      |
| AUTH-01..05 | 2     | —      |
| PAY-01..05  | 3     | —      |
| QUOTA-01..04| 4     | —      |
| GATE-01..03 | 4     | —      |
| BILL-01..03 | 5     | —      |

---
*Last updated: 2026-03-27 after requirements definition*
