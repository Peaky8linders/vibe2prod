# ARCHITECTURE.md — Supabase Auth + Stripe in Next.js 15 App Router

Research date: 2026-03-27
Context: VibeCheck SaaS on Vercel — adding Supabase Auth + Stripe to existing Next.js 15 app.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          VIBECHECK SYSTEM                               │
│                                                                         │
│  Browser              Next.js 15 (Vercel)          External Services   │
│  ─────────────────    ─────────────────────────    ──────────────────  │
│                                                                         │
│  Landing Page    ──►  middleware.ts               Supabase Auth         │
│  /auth/login     ──►  (auth + plan check)    ──►  (PostgreSQL + RLS)   │
│  /dashboard      ──►  app/(protected)/            Stripe                │
│  /report/[id]    ──►  Server Components       ──►  (Checkout + Portal)  │
│                       app/api/webhooks/stripe/                          │
│                       (webhook handler)       ──►  Supabase DB sync     │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Boundaries

### 2.1 Middleware Layer (`middleware.ts` at project root)

Runs on the Edge before every request. Two responsibilities:

1. **Auth check**: Refresh session cookies via `updateSession()` from `@supabase/ssr`
2. **Route protection**: Redirect unauthenticated users to `/auth/login`

```
middleware.ts
├── updateSession(request)          ← refreshes auth cookies (required for SSR)
├── Check auth.getUser()
│   ├── No user + private route → redirect to /login
│   └── User + auth route → redirect to /dashboard
└── Does NOT check subscription here (too slow for edge, read below)
```

Important constraint: Middleware should NOT query the subscriptions table on every
request — that's a DB round-trip on every page load. Subscription checks belong in
Server Components and API Route handlers, not middleware.

Protected routes matcher:
```ts
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

Note: `/api/webhooks/stripe` must be excluded from auth middleware (Stripe hits it
directly). `/api/scan/github` also needs exclusion or a separate service-key auth
pattern for the GitHub App webhook.

### 2.2 Route Groups (App Router)

```
app/
├── (public)/                       ← No auth required
│   ├── page.tsx                    ← Landing page
│   ├── report/[id]/page.tsx        ← Shareable reports (keep public)
│   └── auth/
│       ├── login/page.tsx
│       ├── signup/page.tsx
│       └── callback/route.ts       ← Supabase OAuth callback handler
│
├── (protected)/                    ← Auth required (middleware enforces)
│   └── dashboard/
│       ├── page.tsx                ← Scan history + plan display
│       ├── billing/page.tsx        ← Redirect to Stripe Customer Portal
│       └── upgrade/page.tsx        ← Plan selection → Stripe Checkout
│
└── api/
    ├── scan/github/route.ts        ← EXISTING: keep working (service key auth)
    ├── reports/route.ts            ← EXISTING: add plan check
    ├── stripe/
    │   ├── checkout/route.ts       ← Create Stripe Checkout session
    │   └── portal/route.ts         ← Create Customer Portal session
    └── webhooks/
        └── stripe/route.ts         ← Stripe webhook handler (NO auth middleware)
```

### 2.3 Supabase Client Instances

Three distinct clients required:

| Client | File | Used In | Auth |
|--------|------|---------|------|
| Browser client | `lib/supabase/client.ts` | Client Components | User session cookies |
| Server client | `lib/supabase/server.ts` | Server Components, Server Actions | User session cookies |
| Service role client | `lib/supabase/admin.ts` | Webhook handler ONLY | `SUPABASE_SERVICE_ROLE_KEY` |

The service role client bypasses RLS — it is ONLY for the webhook handler where Stripe
POSTs with no user session. Never expose it in client-side code.

### 2.4 Stripe Webhook Handler

```
app/api/webhooks/stripe/route.ts
├── Reads raw body via request.text()          ← Required (not request.json())
├── Verifies signature via constructEvent()
├── Uses service role Supabase client           ← Bypasses RLS
└── Switch on event.type:
    ├── checkout.session.completed
    │   ├── Extract customer ID + subscription ID
    │   └── Upsert into subscriptions table
    ├── customer.subscription.updated
    │   └── Update status, price_id, period dates
    ├── customer.subscription.deleted
    │   └── Set status = 'canceled'
    └── invoice.payment_failed
        └── Update status (optional: trigger email)
```

### 2.5 Feature Gating (Subscription Checks)

Performed at the Server Component level, not middleware:

```ts
// Example: app/(protected)/dashboard/page.tsx
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
const { data: subscription } = await supabase
  .from('subscriptions')
  .select('status, price_id')
  .eq('user_id', user.id)
  .in('status', ['active', 'trialing'])
  .maybeSingle()

const plan = getPlanFromPriceId(subscription?.price_id)  // 'free' | 'pro' | 'enterprise'
```

Plan tier resolution from price_id:
```ts
// lib/plans.ts
const PRICE_MAP = {
  [process.env.STRIPE_PRO_PRICE_ID]:        'pro',
  [process.env.STRIPE_ENTERPRISE_PRICE_ID]: 'enterprise',
}
export function getPlanFromPriceId(priceId?: string): 'free' | 'pro' | 'enterprise' {
  return PRICE_MAP[priceId ?? ''] ?? 'free'
}
```

---

## 3. Data Flow Diagrams

### 3.1 Sign-Up → Stripe Customer Creation

```
User submits signup form
         │
         ▼
Supabase Auth creates user in auth.users
         │
         ├─► DB trigger fires → inserts row in public.users (profile)
         │
         ▼
Server Action: createStripeCustomer(userId, email)
         │
         ├─► stripe.customers.create({ email, metadata: { supabase_uid: userId } })
         │
         ▼
Supabase upsert into customers table:
  { id: userId, stripe_customer_id: 'cus_xxx' }
         │
         ▼
Redirect to /dashboard (free tier, no subscription yet)
```

Two implementation options for the trigger:
- **Option A (recommended)**: Supabase Database Webhook (HTTP Function Hook) on
  `auth.users` INSERT → calls `/api/stripe/create-customer`
- **Option B**: Server Action in the signup route handler — simpler, no separate
  webhook infrastructure needed for v1

For VibeCheck v1, Option B (Server Action) is simpler and avoids a circular
dependency where a Supabase webhook calls back into your own app.

### 3.2 Subscribe Flow (Free → Pro)

```
User hits scan limit or clicks "Upgrade"
         │
         ▼
/dashboard/upgrade (Server Component renders plan cards)
         │
User clicks "Upgrade to Pro"
         │
         ▼
POST /api/stripe/checkout
  ├── Verifies auth via supabase.auth.getUser()
  ├── Fetches stripe_customer_id from customers table
  ├── stripe.checkout.sessions.create({
  │     customer: stripe_customer_id,
  │     price: STRIPE_PRO_PRICE_ID,
  │     success_url: /dashboard?upgraded=true,
  │     cancel_url: /dashboard/upgrade,
  │   })
  └── Returns { url: checkoutUrl }
         │
         ▼
Browser redirects to Stripe Checkout (hosted page)
         │
User completes payment
         │
         ▼
Stripe fires webhook → /api/webhooks/stripe
  ├── Event: checkout.session.completed
  ├── Inserts/updates subscriptions table
  └── Returns 200 OK to Stripe
         │
         ▼
Stripe redirects user to /dashboard?upgraded=true
         │
         ▼
Dashboard Server Component re-fetches subscription
→ User sees Pro tier unlocked
```

### 3.3 Webhook → Supabase Subscription Sync

```
Stripe Event
     │
     ▼
POST /api/webhooks/stripe
     │
     ├── stripe.webhooks.constructEvent(body, sig, secret)
     │   └── Throws if invalid → return 400
     │
     ▼
switch (event.type):
     │
     ├── 'checkout.session.completed'
     │   ├── session.subscription → retrieve full subscription object
     │   └── upsert subscriptions table:
     │       { id, user_id, status, price_id, current_period_end, ... }
     │
     ├── 'customer.subscription.updated'
     │   └── update subscriptions table (status, price_id, cancel_at_period_end)
     │
     ├── 'customer.subscription.deleted'
     │   └── update subscriptions set status = 'canceled'
     │
     └── 'invoice.payment_failed'
         └── update subscriptions set status = 'past_due'
     │
     ▼
return NextResponse.json({ received: true }, { status: 200 })
```

User lookup in webhook (no session available):
```ts
// Map Stripe customer → Supabase user
const { data: customer } = await supabaseAdmin
  .from('customers')
  .select('id')
  .eq('stripe_customer_id', stripeCustomerId)
  .single()
const userId = customer.id
```

---

## 4. Database Schema

### 4.1 Tables (Supabase / PostgreSQL)

```sql
-- Mirror of auth.users with public profile fields
CREATE TABLE public.users (
  id          uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz DEFAULT now()
);

-- Maps Supabase user → Stripe customer (1:1)
CREATE TABLE public.customers (
  id                 uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  stripe_customer_id text UNIQUE NOT NULL
);

-- Synced from Stripe via webhooks (source of truth for access control)
CREATE TABLE public.subscriptions (
  id                   text PRIMARY KEY,  -- Stripe subscription ID: sub_xxx
  user_id              uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status               text NOT NULL,     -- active | trialing | past_due | canceled | incomplete
  price_id             text,              -- Stripe price ID: price_xxx (determines tier)
  quantity             integer DEFAULT 1,
  cancel_at_period_end boolean DEFAULT false,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  ended_at             timestamptz,
  trial_start          timestamptz,
  trial_end            timestamptz,
  canceled_at          timestamptz,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

-- VibeCheck-specific: scan quota tracking
CREATE TABLE public.scans (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  repo_url    text NOT NULL,
  report_id   text,                       -- links to existing report system
  created_at  timestamptz DEFAULT now()
);
```

### 4.2 Row Level Security Policies

```sql
-- Users can only see their own profile
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_data" ON public.users
  FOR ALL USING (auth.uid() = id);

-- Customers table: users can read their own mapping
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customers_own_data" ON public.customers
  FOR SELECT USING (auth.uid() = id);
-- INSERT/UPDATE only via service role (webhook handler)

-- Subscriptions: users can read their own
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subscriptions_own_data" ON public.subscriptions
  FOR SELECT USING (auth.uid() = user_id);
-- INSERT/UPDATE only via service role (webhook handler)

-- Scans: users can read and insert their own
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scans_own_data" ON public.scans
  FOR ALL USING (auth.uid() = user_id);
```

### 4.3 Auth Trigger (optional, simplifies signup flow)

```sql
-- Auto-create public.users row when auth.users row is inserted
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, full_name, avatar_url)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

---

## 5. Build Order

This is the sequence that avoids blocking dependencies:

```
Phase 1: Foundation (nothing else works without this)
  [1a] Database schema + migrations
       - public.users, public.customers, public.subscriptions, public.scans
       - RLS policies for all tables
       - Auth trigger for public.users auto-creation
  [1b] Supabase client setup
       - lib/supabase/client.ts   (browser)
       - lib/supabase/server.ts   (server + SSR)
       - lib/supabase/admin.ts    (service role, webhook-only)

Phase 2: Auth (users need accounts before they can pay)
  [2a] middleware.ts — updateSession + route protection
  [2b] app/(public)/auth/login/page.tsx + signup/page.tsx
  [2c] app/auth/callback/route.ts — OAuth + email link handler
  [2d] Test: user can sign up, log in, session persists across routes

Phase 3: Stripe Customer Creation (required before Checkout)
  [3a] Stripe SDK setup + environment variables
  [3b] Server Action or API route: createStripeCustomer()
       - Called after successful Supabase signup
       - Writes stripe_customer_id to customers table
  [3c] lib/plans.ts — price ID → plan tier mapping

Phase 4: Stripe Checkout + Webhook
  [4a] app/api/stripe/checkout/route.ts — create Checkout session
  [4b] app/api/webhooks/stripe/route.ts — webhook handler
       - Verify signature
       - Handle checkout.session.completed, subscription.updated/deleted
       - Upsert into subscriptions table via admin client
  [4c] Stripe CLI local testing: stripe listen --forward-to localhost:3000/api/webhooks/stripe
  [4d] Test full flow: checkout → webhook → subscription row appears in DB

Phase 5: Feature Gating + Quota Enforcement
  [5a] Subscription helper: getCurrentSubscription(userId) → plan tier
  [5b] Scan quota check in /api/scan/github — replace localStorage logic
       - Free: 3 scans/period, basic results only
       - Pro: unlimited scans, full results + reports
  [5c] Gate /api/reports behind Pro check
  [5d] Dashboard Server Component reads subscription + scan count

Phase 6: Billing Management UI
  [6a] app/api/stripe/portal/route.ts — Customer Portal session
  [6b] app/(protected)/dashboard/billing/page.tsx — link to portal
  [6c] app/(protected)/dashboard/upgrade/page.tsx — plan comparison + checkout CTA
  [6d] Upgrade prompt component shown when scan limit hit

Phase 7: Integration + Polish
  [7a] Protect existing /api/reports with auth + plan check
  [7b] Shareable /report/[id] stays public (no change needed)
  [7c] GitHub App webhook (/api/scan/github) — add service key auth, not user auth
  [7d] Production Stripe webhook endpoint configured in Stripe Dashboard
```

---

## 6. Middleware Pattern (Detailed)

```ts
// middleware.ts
import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

const PROTECTED_ROUTES = ['/dashboard']
const AUTH_ROUTES = ['/auth/login', '/auth/signup']

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Required: refresh session cookies on every request
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: use getUser() not getSession() in server/middleware context
  const { data: { user } } = await supabase.auth.getUser()
  const { pathname } = request.nextUrl

  // Redirect unauthenticated users away from protected routes
  if (!user && PROTECTED_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  // Redirect authenticated users away from auth pages
  if (user && AUTH_ROUTES.some(r => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on all routes except static assets and Stripe webhook
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

Subscription check is NOT in middleware. It belongs in Server Components:
```ts
// Subscription gating — in Server Component, not middleware
const plan = await getUserPlan(user.id)   // queries subscriptions table
if (plan === 'free' && requestingProFeature) {
  redirect('/dashboard/upgrade')
}
```

---

## 7. Environment Variables Required

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...        # Server-only, never expose to client

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_xxx
STRIPE_ENTERPRISE_PRICE_ID=price_yyy

# App
NEXT_PUBLIC_SITE_URL=https://vibecheck.dev
```

---

## 8. Key Decisions & Tradeoffs

| Decision | Rationale |
|----------|-----------|
| Subscription check in Server Components, not middleware | Middleware runs on every request including static assets — a DB query here would be expensive and slow. Server Components only run when the user loads that specific page. |
| Service role client only in webhook handler | Webhook has no user session. All other server code uses the user-scoped client to benefit from RLS. |
| `request.text()` not `request.json()` in webhook | Stripe signature verification requires the raw body bytes. Parsing to JSON first corrupts the signature check. |
| Stripe Checkout (hosted page) over Elements | Faster to implement, handles PCI compliance, works with Vercel serverless 60s timeout. Elements requires more complex client-side integration. |
| No subscription in middleware | CVE-2025-29927 underscores that middleware alone cannot be trusted for security. Always verify at the data access layer too. |
| Public users table auto-populated via trigger | Avoids race condition where user logs in before Stripe customer creation completes. Trigger fires synchronously on auth.users INSERT. |

---

## 9. Security Notes

- CVE-2025-29927: Upgrade to Next.js 15.2.3+ before going live. This vulnerability
  allows bypass of middleware checks via `x-middleware-subrequest` header manipulation.
- Always use `supabase.auth.getUser()` in server code — never `getSession()`. The
  former validates with Supabase's auth server on every call; the latter trusts
  potentially-stale JWT data.
- The `SUPABASE_SERVICE_ROLE_KEY` bypasses all RLS. Only use it in `/api/webhooks/stripe`.
  Treat it like a database root password.
- Stripe webhook secret (`STRIPE_WEBHOOK_SECRET`) must be verified on every incoming
  webhook. Never trust Stripe event data without calling `constructEvent()` first.

---

## Sources

- [Supabase Server-Side Auth for Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [Vercel Next.js Subscription Payments (reference implementation)](https://github.com/vercel/nextjs-subscription-payments)
- [KolbySisk Next.js 15 + Supabase + Stripe Starter](https://github.com/KolbySisk/next-supabase-stripe-starter)
- [Stripe Integration Guide for Next.js 15 + Supabase (fzeba.com)](https://www.fzeba.com/posts/33_nextjs-stripe-integration/)
- [Makerkit: Subscription Permissions Pattern](https://makerkit.dev/docs/next-supabase/organizations/subscription-permissions)
- [Stripe Checkout and Webhook in Next.js 15 (Medium)](https://medium.com/@gragson.john/stripe-checkout-and-webhook-in-a-next-js-15-2025-925d7529855e)
- [Supabase + Stripe Webhooks Docs](https://supabase.com/docs/guides/functions/examples/stripe-webhooks)
- [Vercel Supabase schema.sql reference](https://github.com/vercel/nextjs-subscription-payments/blob/main/schema.sql)
