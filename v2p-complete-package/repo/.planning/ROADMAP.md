# ROADMAP — VibeCheck Monetization

## Milestone 1: Monetization

### Phase 1: Foundation
**Goal:** Stand up the database schema, Supabase clients, and auth so every subsequent phase has a secure, working base to build on.
**Requirements:** DB-01, DB-02, DB-03, DB-04, AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05
**UI hint:** no

**Success Criteria:**
1. A new user can sign up with email/password and a profile row is automatically created in the database.
2. A logged-in user's session persists across page refreshes and protected /dashboard routes redirect unauthenticated users to login.
3. A logged-out user can log out from any page and is redirected away from protected routes.

---

### Phase 2: Payments
**Goal:** Wire up Stripe so users can subscribe to Pro/Enterprise, subscriptions are recorded server-side, and billing management is self-serve.
**Requirements:** PAY-01, PAY-02, PAY-03, PAY-04, PAY-05
**UI hint:** no

**Success Criteria:**
1. A user clicking "Upgrade to Pro" is redirected to Stripe Checkout and can complete a test payment.
2. After a successful checkout, the user's subscription status is reflected in the database within seconds (webhook upsert confirmed).
3. A subscribed user can reach the Stripe Customer Portal to manage or cancel their plan without contacting support.

---

### Phase 3: Gating, Quotas & Billing UI
**Goal:** Enforce scan limits and plan-tier feature gates server-side, and give users the UI to understand their plan, see their usage, and upgrade.
**Requirements:** QUOTA-01, QUOTA-02, QUOTA-03, QUOTA-04, GATE-01, GATE-02, GATE-03, BILL-01, BILL-02, BILL-03
**UI hint:** yes

**Success Criteria:**
1. A free user who exhausts their 3 monthly scans receives a 429 response from the scan API and sees an upgrade modal — not a blank error.
2. A free user sees Pro features (LLM analysis, fix suggestions, PDF reports) visually locked with an upgrade CTA rather than hidden entirely.
3. A Pro user sees "Unlimited" scans remaining and has access to all Pro features without any upgrade prompts.
4. After completing Stripe Checkout, the success page immediately shows the correct plan name without waiting for the webhook.
5. The dashboard billing section shows the user's current plan, scan usage, and a link to the Stripe Customer Portal.
