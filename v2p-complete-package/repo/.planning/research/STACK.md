# VibeCheck Monetization Stack — Research Report

_Research date: 2026-03-27. Stack covers Next.js 15 (App Router), Supabase Auth, Stripe payments on Vercel._

---

## 1. Supabase Auth with Next.js 15

### Package Decision: `@supabase/ssr` (not auth-helpers)

**Use `@supabase/ssr` exclusively.** The `@supabase/auth-helpers-nextjs` package is deprecated — all bug fixes and new features are in `@supabase/ssr`. All auth-helpers mappings have direct equivalents:

| Old (deprecated) | New |
|---|---|
| `createMiddlewareClient` | `createServerClient` |
| `createClientComponentClient` | `createBrowserClient` |
| `createServerComponentClient` | `createServerClient` |
| `createRouteHandlerClient` | `createServerClient` |

### Package Versions

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- `@supabase/supabase-js`: `^2.100.1` (latest as of March 2026)
- `@supabase/ssr`: `^0.5.x` (check npm for latest patch)

### Client Setup Pattern

Create `lib/supabase/` with three files:

**`lib/supabase/client.ts`** — browser client (use in `"use client"` components):
```ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

**`lib/supabase/server.ts`** — server client (Server Components, Route Handlers, Server Actions):
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {} // Server Component can't set cookies — middleware handles this
        },
      },
    }
  )
}
```

**`lib/supabase/middleware.ts`** — token refresh utility called from `middleware.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // CRITICAL: use getUser(), never getSession() in server/middleware code
  // getUser() re-validates with Supabase Auth server on every call
  await supabase.auth.getUser()

  return supabaseResponse
}
```

### Root `middleware.ts`:
```ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

### Route Protection in Server Components:
```ts
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ProtectedPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // render page
}
```

### Critical Security Notes

- **CVE-2025-29927**: Never rely solely on middleware for auth. Always call `getUser()` at data access points too. Requires Next.js 15.2.3+.
- **Never use `getSession()` in server code** — it doesn't re-validate the token with Supabase Auth.
- Session cookies are HTTP-only, avoiding XSS exposure. Supabase refresh tokens are single-use.

---

## 2. Stripe Integration with Next.js 15

### Package Versions

```bash
npm install stripe @stripe/stripe-js @stripe/react-stripe-js
```

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

**Recommendation for VibeCheck: Embedded Checkout.** It keeps users on your domain, is PCI compliant via iframe, supports Link (Stripe's 1-click checkout, ~10% conversion uplift), and is the current Stripe push.

### Embedded Checkout Pattern (Server Action + Client):

**Server Action** (`app/actions/stripe.ts`):
```ts
'use server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

export async function createCheckoutSession(priceId: string, customerId: string) {
  const session = await stripe.checkout.sessions.create({
    ui_mode: 'embedded',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
  })
  return { clientSecret: session.client_secret }
}
```

**Client Component** (`app/checkout/page.tsx`):
```tsx
'use client'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function CheckoutPage({ clientSecret }: { clientSecret: string }) {
  return (
    <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  )
}
```

### Stripe Webhook Handler

**Route**: `app/api/webhooks/stripe/route.ts`

**Critical**: Use `await request.text()`, NOT `request.json()`. Next.js 15 App Router returns the raw body via `.text()`.

```ts
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

export async function POST(request: Request) {
  const body = await request.text()  // NOT request.json()
  const sig = request.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err) {
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 })
  }

  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object as Stripe.Checkout.Session)
      break
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice)
      break
    case 'invoice.payment_failed':
      await handlePaymentFailed(event.data.object as Stripe.Invoice)
      break
    case 'customer.subscription.updated':
      await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
      break
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
      break
  }

  return new Response('ok', { status: 200 })
}
```

**Vercel webhook gotchas:**
- Disable Vercel Deployment Protection for the `/api/webhooks/stripe` route (it blocks Stripe's requests).
- Respond within 20 seconds — acknowledge immediately, queue async work if needed.
- Set `STRIPE_WEBHOOK_SECRET` in Vercel dashboard (different secret for dev vs prod).
- Local dev: use Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`).

**Serverless vs Edge for webhooks**: Use **serverless** (not Edge) for webhooks. Edge runtime has more restrictive APIs and the raw body handling is less predictable. Webhooks don't need edge latency benefits.

### Stripe Customer Portal

```ts
// app/api/billing-portal/route.ts
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: customer } = await supabase
    .from('customers')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single()

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard`,
  })

  return Response.redirect(portalSession.url, 303)
}
```

Configure portal features in Stripe Dashboard: `dashboard.stripe.com/settings/billing/portal`. Enable plan switching, cancellation, payment method updates.

---

## 3. Database Schema

### Linking Auth Users to Stripe Customers

The pattern is a `customers` bridge table (not exposed to the public schema) plus a `profiles` table, with all Stripe subscription state mirrored locally.

### SQL Schema

```sql
-- Public user profiles (mirrors auth.users)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Stripe customer mapping (private — no RLS SELECT for user)
create table public.customers (
  id uuid references auth.users on delete cascade primary key,
  stripe_customer_id text unique not null
);

alter table public.customers enable row level security;
-- Only service role can read/write customers

-- Stripe products (synced from Stripe via webhooks)
create table public.products (
  id text primary key,           -- Stripe product ID
  name text not null,
  description text,
  active boolean default true,
  metadata jsonb
);

-- Stripe prices (synced from Stripe via webhooks)
create table public.prices (
  id text primary key,           -- Stripe price ID
  product_id text references public.products,
  active boolean default true,
  currency text not null,
  unit_amount bigint,            -- in cents
  interval text,                 -- month, year
  interval_count integer,
  trial_period_days integer,
  metadata jsonb
);

-- Subscriptions (synced from Stripe via webhooks)
create table public.subscriptions (
  id text primary key,           -- Stripe subscription ID
  user_id uuid references auth.users on delete cascade not null,
  status text not null,          -- active, canceled, trialing, past_due, incomplete, unpaid
  price_id text references public.prices,
  quantity integer default 1,
  cancel_at_period_end boolean default false,
  cancel_at timestamptz,
  canceled_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  ended_at timestamptz,
  created timestamptz default now()
);

alter table public.subscriptions enable row level security;
create policy "Users can view own subscription"
  on public.subscriptions for select using (auth.uid() = user_id);

-- Scan quota tracking (VibeCheck-specific)
create table public.scan_usage (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  scans_used integer default 0,
  scans_limit integer not null,   -- set from plan at period start
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.scan_usage enable row level security;
create policy "Users can view own usage"
  on public.scan_usage for select using (auth.uid() = user_id);

-- Scan history (audit trail)
create table public.scans (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users on delete cascade not null,
  target_url text,
  status text,                   -- pending, running, completed, failed
  result jsonb,
  created_at timestamptz default now()
);

alter table public.scans enable row level security;
create policy "Users can view own scans"
  on public.scans for select using (auth.uid() = user_id);
```

### Auto-Provision Profile on Signup

```sql
-- Trigger: create profile row when auth.users row is inserted
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
```

### Stripe Webhook → DB Sync Pattern

In webhook handlers, use the Supabase **service role** client (not the anon key) to write subscription data:

```ts
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!, // never expose to client
  { auth: { autoRefreshToken: false, persistSession: false } }
)

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  await supabaseAdmin.from('subscriptions').upsert({
    id: subscription.id,
    user_id: await getUserIdFromCustomerId(subscription.customer as string),
    status: subscription.status,
    price_id: subscription.items.data[0].price.id,
    cancel_at_period_end: subscription.cancel_at_period_end,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    canceled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString() : null,
  })
}

async function getUserIdFromCustomerId(stripeCustomerId: string) {
  const { data } = await supabaseAdmin
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .single()
  return data?.id
}
```

**Note on Stripe API version `2025-03-31.basil` and later**: `current_period_start`/`current_period_end` are moving from `Subscription` to `SubscriptionItem`. When upgrading the API version, update the sync logic to read from `subscription.items.data[0].current_period_start`.

### Plan → Quota Mapping

Define quota limits per plan in a constants file (or in a `plans` DB table):

```ts
// lib/plans.ts
export const PLAN_QUOTAS: Record<string, number> = {
  free: 5,       // scans per month
  starter: 50,
  pro: 500,
  enterprise: -1, // unlimited (-1 = no limit)
}

export function getQuotaForPriceId(priceId: string): number {
  // Map Stripe price IDs to quota limits
  const priceQuotaMap: Record<string, number> = {
    [process.env.STRIPE_PRICE_STARTER!]: 50,
    [process.env.STRIPE_PRICE_PRO!]: 500,
  }
  return priceQuotaMap[priceId] ?? PLAN_QUOTAS.free
}
```

On `checkout.session.completed` or `invoice.paid`, upsert a `scan_usage` row for the new billing period with the correct `scans_limit`.

---

## 4. Rate Limiting / Quota Enforcement

### Two-Layer Strategy

For VibeCheck scans, use two complementary layers:

1. **Quota enforcement (Supabase DB)**: Check `scan_usage` before executing a scan. Increment atomically after. This is the source of truth.
2. **Rate limiting (Upstash Redis)**: Protect API routes from abuse/bursts. This is a fast-path shield, not the billing source of truth.

### Layer 1: Quota Enforcement (Supabase)

Use a Postgres function with atomic increment to avoid race conditions:

```sql
-- Atomically check and increment scan quota
create or replace function public.try_consume_scan(p_user_id uuid)
returns boolean as $$
declare
  v_usage record;
begin
  select * into v_usage
  from public.scan_usage
  where user_id = p_user_id
    and period_start <= now()
    and period_end > now()
  for update;  -- row-level lock

  if not found then
    return false;  -- no active subscription period
  end if;

  if v_usage.scans_limit != -1 and v_usage.scans_used >= v_usage.scans_limit then
    return false;  -- quota exceeded
  end if;

  update public.scan_usage
  set scans_used = scans_used + 1, updated_at = now()
  where id = v_usage.id;

  return true;
end;
$$ language plpgsql security definer;
```

Call via RPC in the scan API route:

```ts
// app/api/scan/route.ts
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { data: allowed } = await supabase.rpc('try_consume_scan', {
    p_user_id: user.id,
  })

  if (!allowed) {
    return new Response(
      JSON.stringify({ error: 'Scan quota exceeded. Upgrade your plan.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // proceed with scan...
}
```

### Layer 2: Rate Limiting (Upstash Redis)

Install:
```bash
npm install @upstash/ratelimit @upstash/redis
```

Versions: `@upstash/ratelimit@^2.0.8`, `@upstash/redis@^1.x`

**Option A — In Middleware (recommended for abuse prevention)**:

```ts
// middleware.ts (extend existing Supabase middleware)
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '60 s'),  // 20 req/min per IP
  analytics: true,
  prefix: 'vibecheck',
})

export async function middleware(request: NextRequest) {
  // Only rate-limit scan endpoints
  if (request.nextUrl.pathname.startsWith('/api/scan')) {
    const ip = request.headers.get('x-forwarded-for') ?? '127.0.0.1'
    const { success, limit, remaining, reset } = await ratelimit.limit(ip)

    if (!success) {
      return new Response('Rate limit exceeded', {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
        },
      })
    }
  }

  return await updateSession(request)
}
```

**Option B — Per-User Rate Limiting in Route Handler**:

For authenticated routes, use user ID as the identifier (more fair than IP, handles VPNs/NATs):

```ts
const { success } = await ratelimit.limit(`user_${user.id}`)
```

**Algorithm choice**:
- Use `slidingWindow` for scan endpoints (prevents burst gaming)
- Use `fixedWindow` if you add multi-region Vercel deployments (sliding window has high Redis command count in multi-region)

**Upstash setup**: Create a Redis database at [console.upstash.com](https://console.upstash.com). Add to Vercel env:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### Quota vs Rate Limit Comparison

| Concern | Tool | Resets |
|---|---|---|
| Monthly scan quota (billing) | Supabase `scan_usage` table | Per billing period |
| Per-minute burst protection | Upstash `@upstash/ratelimit` | Rolling window |

Do not use Redis as the source of truth for billing quotas — it's a cache, not durable storage. Always write scan counts to Postgres.

---

## 5. Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # server-only, never NEXT_PUBLIC_

# Stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...      # server-only
STRIPE_WEBHOOK_SECRET=whsec_...    # server-only (different for dev/prod)
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...

# Upstash
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=AX...

# App
NEXT_PUBLIC_APP_URL=https://vibecheck.app
```

---

## 6. Key Warnings & Gotchas

1. **CVE-2025-29927**: Upgrade to Next.js 15.2.3+. Never trust middleware-only auth.
2. **Stripe webhook body**: Use `await request.text()`, not `request.json()`. Raw body is required for signature verification.
3. **Vercel Deployment Protection**: Disable it for `/api/webhooks/stripe` — it will block Stripe's POST requests.
4. **Service role key**: Only use `SUPABASE_SERVICE_ROLE_KEY` in server-side webhook handlers. Never expose to client or use `NEXT_PUBLIC_` prefix.
5. **Stripe API version pinning**: Pin the `apiVersion` in the Stripe constructor. Stripe Dashboard API version and code API version must match.
6. **Subscription period fields**: Stripe is deprecating `current_period_start/end` at the subscription level in newer API versions — read from `subscription.items.data[0]` instead.
7. **Upstash IP in serverless**: `request.ip` can be undefined in Vercel serverless. Use `request.headers.get('x-forwarded-for')` instead.
8. **Atomic quota increment**: Use a Postgres function with `FOR UPDATE` lock, not application-level check-then-update. Race conditions will oversell quota in serverless.
9. **Stripe Customer Portal**: Must be configured in Stripe Dashboard before the API call works. Enable subscription modification features you want.
10. **Local dev**: Run Stripe CLI alongside dev server — two separate terminals. `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.

---

## 7. Recommended Starter Template

The [vercel/nextjs-subscription-payments](https://github.com/vercel/nextjs-subscription-payments) repo is the canonical reference implementation. It uses exactly this stack (Next.js + Supabase + Stripe) and is actively maintained. Reviewing its webhook handler, schema, and middleware is worth the time before writing from scratch.
