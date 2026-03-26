# PROJECT.md — VibeCheck Monetization Milestone

## What This Is

VibeCheck is an autonomous production hardening system that scans vibe-coded apps for security defects, fixes them while you sleep, and provides antifragile chaos testing. The product differentiates from competitors (Snyk, Aikido, VibeCheck competitor) through its **autonomous fix loop** — not just scanning, but actually fixing defects with provable safety guarantees.

**This milestone** adds the revenue engine: Stripe payment integration, Supabase Auth for user accounts, and a conversion funnel that turns free scans into paying customers.

## Core Value

**"Scan → Pay → Fix"** — The path from first scan to paying customer to autonomous hardening must be frictionless. A vibe coder pastes a GitHub URL, sees scary results, and upgrades to get them fixed automatically.

## Context

- **Existing product:** Next.js 15 dashboard + CLI + MCP server with 50+ defect scanners
- **Just shipped (PR #32):** Supabase RLS scanner, shareable reports, GitHub App integration
- **Current pricing tiers:** Starter (Free/3 scans), Pro ($49/mo), Enterprise ($199/mo)
- **Current trial:** Client-side localStorage tracking (7-day, 3 scans/day)
- **What's missing:** No payment processing, no user accounts, no subscription management
- **Target audience:** Non-technical founders and vibe coders using Cursor/Lovable/Bolt/v0
- **Tech stack:** Next.js 15 (App Router), Tailwind CSS 4, Recharts, deployed on Vercel

## Market Signal

From our Reddit/Indie Hackers research (March 2026):
- Vibe coding security is the #1 market opportunity — 45% of AI-generated code has vulnerabilities
- VibeCheck's competitor charges $5-$29/scan with freemium model
- Finance tools show strongest willingness to pay (direct ROI = saved money/breach prevention)
- Fastest MVPs win — successful indie hackers ship in <2 weeks

## Requirements

### Validated

- Existing: GitHub URL scanning via dashboard
- Existing: 50+ defect pattern scanners (security, performance, compliance, database)
- Existing: Shareable report URLs at /report/[id]
- Existing: Landing page with scan CTA, pricing display, trial tracking
- Existing: 3-tier pricing display (Starter/Pro/Enterprise)
- Existing: GitHub App integration for PR-level scanning

### Active

- [ ] Supabase Auth integration (sign up, login, session management)
- [ ] Stripe Checkout integration (subscribe to Pro/Enterprise)
- [ ] Stripe Customer Portal (manage subscription, billing, cancel)
- [ ] Server-side scan quota enforcement (replace localStorage trial)
- [ ] Feature gating by plan tier (basic results free, deep analysis/reports for Pro)
- [ ] Conversion flow: scan limit hit → upgrade prompt → Stripe Checkout → dashboard
- [ ] User dashboard showing scan history, current plan, usage
- [ ] Webhook handling for Stripe events (subscription created/cancelled/updated)
- [ ] Database schema for users, subscriptions, scan history (Supabase)

### Out of Scope

- VS Code extension — distribution milestone (next)
- Live credential verification — product depth milestone (after distribution)
- Team/org features — enterprise milestone (later)
- Custom domain / white-labeling — not needed for v1 monetization

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Supabase Auth over Clerk/Auth.js | Dogfooding — VibeCheck scans Supabase apps, using Supabase Auth is great marketing | Decided |
| Keep 3-tier pricing ($0/$49/$199) | Validated by market — matches competitor pricing, clear upgrade path | Decided |
| Scan + feature combo gate | Free users get 3 scans with basic results; Pro unlocks unlimited + deep analysis + reports | Decided |
| Stripe Checkout (not embedded) | Fastest integration, handles PCI compliance, works with Vercel serverless | Decided |
| Server-side quota enforcement | Replace client-side localStorage — prevents bypass, enables real usage tracking | Decided |

## Technical Constraints

- **Deployment:** Vercel (serverless functions, 60s timeout)
- **Database:** Supabase (PostgreSQL + Auth + RLS)
- **Payments:** Stripe (Checkout + Customer Portal + Webhooks)
- **No breaking changes:** Existing scan API must continue working for GitHub App webhooks

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-27 after initialization*
