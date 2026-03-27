# Stripe + Supabase Auth Integration Pitfalls

Research for VibeCheck: Next.js 15 on Vercel, Supabase auth+DB, Stripe payments.

---

## 1. Stripe Pitfalls

### 1.1 Webhook Signature Verification Fails on Vercel

**What goes wrong:** The most common Stripe+Vercel failure. Next.js App Router (or middleware) parses the request body before the webhook handler runs. Stripe's `constructEvent` hashes the _raw_ bytes. Once parsed and re-serialized, the body no longer matches the signature — you get `No signatures found matching the expected signature for payload` and all webhook processing silently stops.

**Second trap:** The Stripe CLI generates its own `whsec_` secret per session. The Dashboard webhook endpoint has a different secret entirely. Teams commonly paste the CLI secret into Vercel env vars and then wonder why production webhooks fail.

**Third trap:** After adding a new webhook endpoint in the Stripe Dashboard, a _new_ signing secret is generated. You must copy it into Vercel env vars and redeploy. The old secret (from a previous endpoint or the CLI) will not work.

**Prevention:**
- In App Router, read the body with `await req.text()` before any parsing: `const rawBody = await req.text()`. Never call `req.json()` first.
- Store the signing secret as `STRIPE_WEBHOOK_SECRET` in Vercel. After creating or updating the Dashboard endpoint, re-copy the secret and redeploy.
- Keep `STRIPE_WEBHOOK_SECRET_CLI` as a separate env var for local dev to avoid confusion.
- Verify `req.headers.get('stripe-signature')` (App Router) vs `req.headers['stripe-signature']` (Pages Router) — mixing these causes silent header misses.

**Phase:** Monetization setup (Phase 1), before any webhook event is handled.

---

### 1.2 Race Condition: Checkout Redirect vs. Webhook Arrival

**What goes wrong:** User completes Stripe Checkout and lands on `/dashboard`. The page immediately calls `/api/billing/status`. The webhook (`checkout.session.completed`) arrives 1–5 seconds later and only then updates the DB. The user sees "Free plan" despite having just paid.

**Prevention:**
- On the success redirect URL, immediately call the Stripe API directly (`stripe.checkout.sessions.retrieve(sessionId)`) and write the subscription record synchronously. The webhook then processes the same data idempotently (no harm).
- If the direct fetch also races (edge case), poll `/api/billing/status` with exponential backoff for up to 10 seconds before showing an error state.
- Never rely solely on webhooks to gate the post-checkout experience.

**Phase:** Checkout flow implementation.

---

### 1.3 Duplicate Webhook Deliveries

**What goes wrong:** Stripe retries webhooks for up to 3 days in live mode if your handler returns a non-200 or times out. Without idempotency, the same `invoice.paid` event triggers duplicate feature unlocks, duplicate welcome emails, or double-credits.

**Prevention:**
- Create a `stripe_webhook_events` table with `(stripe_event_id TEXT PRIMARY KEY, status TEXT, processed_at TIMESTAMPTZ)`.
- At the start of every handler: insert with `ON CONFLICT DO NOTHING`, check if a row was inserted. If not, the event is a duplicate — return 200 immediately.
- Use a status enum (`processing` / `processed` / `failed`) so failed events can be retried manually.
- Index `stripe_event_id` for fast lookups.

**Phase:** Webhook infrastructure (before any event handler logic).

---

### 1.4 Test Mode vs. Live Mode Key Confusion

**What goes wrong:** Stripe uses entirely separate key namespaces (`sk_test_` vs `sk_live_`, `pk_test_` vs `pk_live_`). Mixing them causes hard-to-diagnose failures. Test customers/subscriptions never appear in live mode and vice versa. Over 15% of misconfigured payment environments stem from incorrect API credentials.

Webhook signing secrets are also mode-scoped. A secret from a test-mode endpoint will fail to verify live-mode events.

**Prevention:**
- Use a single env var name `STRIPE_SECRET_KEY` that holds the appropriate key per environment. Never hardcode `_test_` or `_live_` distinctions in variable names that stay constant across environments — it invites copy-paste errors.
- Add a startup assertion: `if (process.env.NODE_ENV === 'production' && process.env.STRIPE_SECRET_KEY?.includes('_test_')) throw new Error('Test key in production')`.
- In Vercel, use separate preview vs. production environment variable groups.
- Never use the CLI `whsec_` secret in any Vercel env var — it rotates every session.

**Phase:** Environment configuration before launch.

---

### 1.5 Failed Payment Handling and Dunning

**What goes wrong:** A subscription's payment fails. Without handling, the user loses access silently or — worse — retains access while you lose revenue. Failed payments account for 5–10% of SaaS MRR churn, nearly all of which is recoverable.

**Prevention:**
- Enable Stripe Smart Retries (Dashboard → Billing → Subscriptions → Smart Retries). Default: 7 retries over 21 days.
- Handle the `invoice.payment_failed` webhook: set a `past_due` flag in your DB, trigger an email series (day 1, day 3, day 7) with a direct link to the Stripe Customer Portal for payment update.
- Handle `customer.subscription.deleted` to revoke access definitively.
- Decide grace period policy explicitly: do users retain access during `past_due` before `deleted`? Default Stripe behavior cancels after exhausting retries, so the subscription transitions `active → past_due → canceled`. Your RLS policies need to handle `past_due` status as a valid "still-paying" state during the retry window.

**Phase:** Billing lifecycle (alongside webhook handlers).

---

### 1.6 Proration Surprises on Plan Changes

**What goes wrong:** When a user upgrades mid-cycle, Stripe creates a proration invoice. If you use `proration_behavior: 'create_prorations'` (the default) without setting `payment_behavior: 'error_if_incomplete'`, the subscription updates _immediately_ even if the proration payment fails. The user gets the higher-tier access without paying for the difference.

Downgrade credits do not auto-refund — they apply to the next invoice. Users expect a refund and open support tickets.

**Prevention:**
- Always set `payment_behavior: 'error_if_incomplete'` on subscription updates. If the payment fails, the update is rejected and the user stays on their current plan.
- Preview prorations before confirming plan changes: use `stripe.invoices.retrieveUpcoming()` and show the user the amount they'll owe.
- Document your downgrade credit behavior in the UI (e.g., "Your account will receive a $X credit applied to your next billing cycle").
- For VibeCheck's security scan context: if a user downgrades during an active scan, define what happens to that scan (let it finish, cap it, or hold it).

**Phase:** Plan management UI.

---

## 2. Supabase Auth Pitfalls

### 2.1 Next.js 15 Async Cookie API Breaking Change

**What goes wrong:** Next.js 15 made `cookies()`, `headers()`, and `draftMode()` asynchronous. Code written for Next.js 14 that calls `cookies().get(...)` synchronously throws in Next.js 15. Supabase auth helpers that used the old pattern stop working silently in some environments and throw in others.

**Prevention:**
- Always `await cookies()` before accessing any cookie value: `const cookieStore = await cookies()`.
- Use `@supabase/ssr` (not the deprecated `@supabase/auth-helpers-nextjs`). The `ssr` package is maintained for Next.js 15 compatibility.
- Run `next build` locally before deploying to catch these errors early — they surface as build or runtime errors rather than silent auth failures.

**Phase:** Initial auth setup.

---

### 2.2 Using `getSession()` Instead of `getUser()` on the Server

**What goes wrong:** `supabase.auth.getSession()` on the server reads from the cookie without revalidating with Supabase's auth server. A spoofed or expired session token will pass `getSession()` but fail `getUser()`. Using `getSession()` to gate premium features means a motivated attacker can fake their session.

**Prevention:**
- In Server Components and API routes, always use `supabase.auth.getUser()` to protect any data or action. It calls Supabase's auth server on every request.
- Reserve `getSession()` for client-side use where revalidation cost is prohibitive and the stakes are display-only.
- In middleware, call `supabase.auth.getUser()` — this both refreshes the token and validates it.

**Phase:** Auth implementation before any protected routes are built.

---

### 2.3 Middleware Token Refresh Architecture

**What goes wrong:** Server Components cannot write cookies. If middleware does not refresh the JWT and write the new tokens to both the request (for Server Components) and the response (for the browser), users encounter random 401s as tokens expire mid-session. Placing `middleware.ts` in the wrong directory (project root instead of `src/`) causes Next.js to silently skip it.

**Prevention:**
- Follow the `@supabase/ssr` middleware pattern exactly: call `supabase.auth.getUser()` in middleware to trigger a token refresh, set `request.cookies.set(...)` to pass the refreshed token downstream to Server Components, and set `response.cookies.set(...)` to update the browser.
- If using a `src/` directory layout, place `middleware.ts` at `src/middleware.ts` — not at the project root.
- Add a middleware matcher that excludes static assets and `_next/` paths to avoid running auth logic on every image request.

**Phase:** Auth setup, before building any protected routes.

---

### 2.4 Token Expiry During Long Scans

**What goes wrong:** VibeCheck runs security scans that may take 30–90 seconds. If the user's JWT expires mid-scan (default Supabase JWT TTL is 1 hour, but tokens issued near their expiry time can expire before the scan finishes), the scan's DB writes using the user's session will fail with a 401. The scan result is lost.

**Prevention:**
- Security scan writes should use the **service role key** in a server-side API route, not the user's JWT. Authenticate the user with `getUser()` at the start of the request to verify identity, then use the service role client for all DB operations within that request.
- Never expose the service role key to the browser or client components.
- For the client-side scan status polling, implement session refresh before initiating the scan: call `supabase.auth.refreshSession()` explicitly and confirm success before starting.
- Set the Supabase JWT expiry no lower than 1 hour (the default). Values under 5 minutes cause clock-skew errors on some devices.

**Phase:** Scan execution infrastructure.

---

### 2.5 RLS Policy Mistakes on Subscription Data

**What goes wrong:** The three most common failure modes:

1. **RLS not enabled** on subscription tables — all data is publicly readable via the `anon` key.
2. **RLS enabled but no policies** — all queries return empty results with no error, causing silent data failures that look like "no subscription found."
3. **Missing `WITH CHECK` on INSERT/UPDATE** — users can set `user_id` to another user's UUID on insert, or modify ownership on update.

An additional VibeCheck-specific risk: subscription status is stored server-side (written by webhooks using the service role key) but read client-side. RLS policies must allow authenticated users to read their own subscription row but never write to it directly.

**Prevention:**
- Enable RLS on `subscriptions`, `scan_results`, and any table containing user-owned data from day one.
- Policy template for subscription reads: `USING (user_id = auth.uid())`.
- Policy template for subscription writes: no `INSERT`/`UPDATE`/`DELETE` policies for the `authenticated` role. Webhook handlers use the service role key (which bypasses RLS) to write subscription data.
- Never use `user_metadata` JWT claims in RLS policies — users can modify their own `user_metadata` and escalate privileges.
- Test policies through the Supabase client SDK with a real user session. The SQL Editor runs as the `postgres` superuser and bypasses RLS — testing there gives false confidence.
- Add an index on `user_id` on every table with a `user_id = auth.uid()` policy. Without an index, every authenticated query performs a full table scan.

**Phase:** Database schema design, before any data is written.

---

## 3. Integration Pitfalls (Stripe ↔ Supabase)

### 3.1 Stripe Customer ↔ Supabase User Mapping Race Condition

**What goes wrong:** User signs up → Supabase creates auth record → app calls Stripe to create a customer. If the Stripe API call fails or is slow, the user exists in Supabase without a `stripe_customer_id`. The next time the user tries to subscribe, the app tries to create another Stripe customer, potentially creating duplicates. Duplicate customers in Stripe mean subscription history is split across records.

**Prevention:**
- Use a Supabase database trigger or function hook on the `auth.users` insert to call a Supabase Edge Function that creates the Stripe customer. This is more reliable than doing it in the Next.js API route where request cancellations can interrupt the flow.
- Store `stripe_customer_id` in a `profiles` table with a `NOT NULL` constraint enforced after a grace period, or use a lookup-or-create pattern: always call `stripe.customers.list({ email })` before creating to detect existing customers.
- If creating the Stripe customer during checkout (lazily): use a DB transaction — write the `stripe_customer_id` atomically with initiating checkout. Do not write it in a webhook handler (which arrives after checkout, creating a second race).

**Phase:** User registration flow.

---

### 3.2 Webhook Event Ordering — Don't Assume Sequential Delivery

**What goes wrong:** Stripe sends `customer.subscription.created` before `checkout.session.completed` in some cases, and network conditions can invert their arrival order at your endpoint. If your handler for `checkout.session.completed` expects the subscription to already exist in your DB (written by `customer.subscription.created`), it will silently fail.

**Prevention:**
- Make each webhook handler self-sufficient: fetch the full object from the Stripe API inside the handler rather than relying on a DB record written by a previous webhook. Use `stripe.subscriptions.retrieve(subscriptionId)` to get authoritative state.
- Use Stripe's `created` timestamp (not your DB insert time) to resolve out-of-order events: only apply an update if the event's timestamp is newer than the last-applied timestamp stored in your DB.
- Log unprocessable events (e.g., subscription webhook arrived before customer mapping exists) to a dead-letter table for manual recovery.

**Phase:** Webhook handler implementation.

---

### 3.3 Service Role Key Leakage in Webhook Handlers

**What goes wrong:** Webhook handlers need to write subscription data to Supabase bypassing RLS (since there is no user session in a webhook request). This requires the service role key. Teams sometimes create a Supabase client using the service role key in a shared module that also gets imported by client components — leaking the key to the browser bundle.

**Prevention:**
- Create the service-role Supabase client only in files under `app/api/` or `lib/server/`. Never import server-only modules from client components.
- Add `import 'server-only'` at the top of any file that initializes the service role client. Next.js will throw a build error if this file is imported in a client component.
- Verify with `next build --debug` that no `SUPABASE_SERVICE_ROLE_KEY` reference appears in the client bundle.

**Phase:** Webhook infrastructure setup.

---

## 4. Conversion Pitfalls

### 4.1 Paywalling Before Delivering Value

**What goes wrong:** Users land on VibeCheck, immediately hit a paywall or credit card prompt before running a single scan. They have no evidence the product works for their codebase. They leave. Research (Profitwell) shows users who understand value before encountering a paywall are 30% more likely to convert.

**Prevention:**
- Allow at least one free scan with real results before any payment prompt. The scan result _is_ the sales pitch.
- Show the paywall after the first scan result is displayed, in context: "Your scan found 3 critical issues. Upgrade to see the full report and remediation steps."
- Never show a pricing page as the first screen after signup. Show it after the "aha moment" (first scan result).

**Phase:** Onboarding design, pre-monetization.

---

### 4.2 Confusing Pricing Page

**What goes wrong:** Too many tiers, unclear feature differentiation, per-scan vs. per-seat vs. per-repo pricing all on one page. Users spend time trying to calculate which plan fits them and abandon.

**Prevention:**
- Lead with outcomes, not features: "Scan up to 10 repos/month" not "API rate limit: 10 RPM."
- Hardcoding prices in the UI guarantees inconsistency when you change Stripe prices. Fetch active prices from `stripe.prices.list({ active: true })` at build time or with a short TTL cache. Display the Stripe-sourced price, not a hardcoded constant.
- For early VibeCheck: start with 2 tiers maximum (Free + Pro). Add tiers only when you have evidence of distinct user segments.
- Clearly state what happens at the end of a trial in plain language. Ambiguity about billing causes chargebacks.

**Phase:** Pricing page design.

---

### 4.3 Asking for Credit Card Before Trial Value

**What goes wrong:** Requiring a credit card at signup reduces free trial sign-ups dramatically (from ~10% conversion to ~2% for cold traffic). For a security tool like VibeCheck, where users are already skeptical about giving access to their code, adding a payment gate at signup compounds friction.

**Prevention:**
- Use an opt-in free trial (no card required) for initial launch. Get users to the first scan result first.
- If a card is required for any technical reason (e.g., to prevent abuse), use Stripe's free trial with `trial_period_days` — no charge occurs until the trial ends, but the card is held.
- Note the tradeoff: card-required trials convert at ~50% trial-to-paid vs. ~15% for card-not-required, but the total number of trials is much lower. For a new product with limited traffic, maximizing trial volume matters more than conversion rate.

**Phase:** Onboarding design, pre-monetization.

---

## 5. Vercel-Specific Pitfalls

### 5.1 Cold Start Delays on Webhook Processing

**What goes wrong:** Webhook routes that haven't been invoked recently will cold-start when Stripe delivers an event. Cold starts can take 1–3 seconds. If your handler is slow (DB writes, additional API calls), Stripe may not receive a 200 within its timeout window and will retry, causing duplicate delivery.

**Prevention:**
- Keep the webhook handler lean: verify signature, write the event ID to the idempotency table, and return 200 immediately. Enqueue the actual processing work asynchronously.
- For async processing on Vercel: use `after()` (Next.js 15 built-in) to defer non-critical work after the response is sent, or use a lightweight queue service (Inngest, Upstash QStash).
- Do not perform email sending, external API calls, or multi-step DB transactions inside the synchronous webhook handler path.

**Phase:** Webhook infrastructure.

---

### 5.2 The 60-Second Function Timeout

**What goes wrong:** Vercel Hobby plan: 10-second timeout. Vercel Pro plan: 60-second timeout. A security scan that also triggers a Stripe checkout or processes payment confirmation inside the same function invocation will hit this limit. Any function doing both a scan (potentially slow) and payment processing in sequence will time out.

**Prevention:**
- Never combine scan execution and payment processing in the same serverless function invocation.
- Scan initiation: accept the request, start the scan asynchronously, return a scan job ID immediately. Poll for results separately.
- For scans expected to exceed 60 seconds: use Vercel Fluid Compute (available 2025, extends limits to 800 seconds on Pro) or offload to a background worker (Supabase Edge Function with longer timeout, or a dedicated compute service).
- Set explicit `maxDuration` in the Next.js route config: `export const maxDuration = 60` on Pro. Without this, the default may be shorter than the plan maximum.

**Phase:** Scan execution architecture.

---

### 5.3 CDN Caching Set-Cookie Headers on Auth Routes

**What goes wrong:** Vercel's Edge Network can cache responses including `Set-Cookie` headers. If an authenticated page is accidentally cached, User A's session cookie gets served to User B. This is a critical security issue that bypasses all RLS.

**Prevention:**
- Set `Cache-Control: private, no-store` on every route that handles authentication, reads session cookies, or writes `Set-Cookie` headers.
- Never enable ISR (Incremental Static Regeneration) on pages that call `supabase.auth.getUser()` or read session state.
- In Next.js App Router, authenticated Server Components using `cookies()` are automatically dynamic (not cached), but verify this with `next build` output — pages should show `ƒ` (dynamic) not `○` (static) in the build output for any auth-gated route.

**Phase:** Deployment configuration review before launch.

---

## Phase Assignment Summary

| Pitfall | Phase |
|---|---|
| Webhook signature verification (raw body, secret rotation) | Monetization setup — Day 1 of Stripe integration |
| Test vs. live mode key confusion | Environment configuration — before launch |
| Async cookie API (Next.js 15) | Auth setup — before any protected routes |
| `getSession()` vs. `getUser()` on server | Auth setup — before any protected routes |
| Middleware token refresh architecture | Auth setup |
| RLS not enabled / no policies | DB schema design — from Day 1 |
| RLS missing WITH CHECK / service role leakage | DB schema + webhook infrastructure |
| Stripe customer ↔ Supabase user mapping | User registration flow |
| Checkout redirect race condition | Checkout flow implementation |
| Duplicate webhook delivery | Webhook infrastructure — before any handlers |
| Webhook event ordering | Webhook handler implementation |
| Token expiry during long scans | Scan execution infrastructure |
| Proration surprises on plan changes | Plan management UI |
| Failed payment / dunning | Billing lifecycle |
| Paywall before value | Onboarding design — pre-monetization |
| Confusing pricing / hardcoded prices | Pricing page design |
| Credit card before trial value | Onboarding design |
| Cold start delays on webhook processing | Webhook infrastructure |
| 60-second function timeout | Scan execution architecture |
| CDN caching Set-Cookie on auth routes | Deployment configuration — before launch |
