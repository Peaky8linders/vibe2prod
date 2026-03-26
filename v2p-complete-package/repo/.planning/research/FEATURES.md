# VibeCheck Monetization Feature Research

**Context:** Security scanning SaaS targeting vibe coders (non-technical founders using AI code tools).
**Stack:** Stripe + Supabase Auth
**Tiers:** Free (3 scans/mo) → Pro ($49/mo unlimited) → Enterprise ($199/mo)
**Research date:** 2026-03-27

---

## 1. Table Stakes (Must-Have, Users Expect These)

Features users will consider broken or missing if absent. Not differentiating — just required.

### Payment Infrastructure

| Feature | Complexity | Notes |
|---|---|---|
| Stripe Checkout hosted page | Low | PCI compliance handled by Stripe; never touch card data yourself |
| Webhook handler (subscription events) | Medium | Must handle: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed` |
| Supabase subscription status sync | Medium | Store tier + scan count in Supabase; gate features via Row Level Security |
| Automated invoice emails | Low | Stripe sends these automatically — just configure branding |
| Monthly/annual billing toggle | Low | Companies with a toggle see 25–35% higher annual plan uptake; default to annual |
| Cancel anytime (self-serve) | Low | Stripe Billing Portal covers this out of the box |
| Update payment method (self-serve) | Low | Stripe Billing Portal covers this |
| View billing history (self-serve) | Low | Stripe Billing Portal covers this |

### Dunning (Involuntary Churn Prevention)

| Feature | Complexity | Notes |
|---|---|---|
| Smart Retries for failed payments | Low | Enable in Stripe settings — built-in retry logic |
| Failed payment email notification | Low | Stripe sends automatically; configure timing (3/5/7 day sequence) |
| Grace period before downgrade | Low | Keep user on paid tier 7–14 days while retrying; prevents support tickets |

**Why it matters:** Involuntary churn (failed payments, not cancellations) accounts for 20–40% of all SaaS churn. Ignoring dunning until it hurts is the most common billing mistake.

### Usage Tracking

| Feature | Complexity | Notes |
|---|---|---|
| Scan count tracking per user/month | Low | Required for Free tier limit enforcement |
| Monthly reset of scan counter | Low | Cron job or Supabase Edge Function |
| Scan count visible in UI | Low | Users need to see how many scans remain |

---

## 2. Differentiators (Competitive Advantage)

Features that drive conversion and revenue above the baseline. Build these after table stakes.

### Conversion Triggers (Highest ROI)

| Feature | Complexity | Revenue Impact | Notes |
|---|---|---|---|
| Scan limit hit → upgrade modal | Low | High | Triggered exactly when user wants to scan more; highest-intent moment. Include "You've used 3/3 free scans this month" + clear upgrade CTA |
| Feature-locked upsells | Low | High | Lock enterprise features (audit logs, team access, API access) behind visible "locked" state with upgrade prompt when user clicks |
| In-dashboard upgrade nudge | Low | Medium | Banner showing scans remaining (e.g., "1 scan left this month — upgrade for unlimited") |
| Scan result teaser on Free | Medium | High | Show partial results on Free, gate full detail behind Pro. Forces value demonstration before paywall |

**Benchmark:** Contextual upsell prompts at the friction point (limit hit) convert at 60–70% success rate vs. 5–20% for cold outreach. This is the single highest-ROI feature to build.

### Onboarding Flow

| Feature | Complexity | Revenue Impact | Notes |
|---|---|---|---|
| First scan within 60 seconds of signup | Low | Very High | Products delivering value within 5 min show 40% higher 30-day retention. For VibeCheck: auto-trigger first scan on signup or show prominent "Run Your First Scan" CTA |
| Aha moment: show real vulnerabilities found | Low | High | The aha moment for security SaaS is "seeing real issues in your code." Make the first result visually impactful — don't bury findings |
| Progress indicator during scan | Low | Medium | Non-technical users get anxious with loading states. Show "Scanning... checking for XSS, SQL injection, exposed secrets..." |
| Post-scan email with summary | Low | Medium | Email "Your scan found 3 issues" drives re-engagement for users who didn't upgrade immediately |
| Personalized onboarding email (use name) | Low | Medium | Personalized emails open at 26% higher rate |

### Pricing Page Psychology

| Feature | Complexity | Revenue Impact | Notes |
|---|---|---|---|
| 3-tier layout (Free / Pro / Enterprise) | Low | High | Center-stage effect: 3-tier pages convert at 1.4x vs 2-tier. Middle tier (Pro) gets disproportionate selection |
| "Most Popular" badge on Pro | Low | High | Loss aversion + social proof in one element |
| Annual default with savings callout | Low | Medium | "Save 20% with annual" badge; default toggle to annual. 19% lift in annual adoption when defaulted |
| Feature framing as inclusions not exclusions | Low | Medium | "Pro includes unlimited scans" converts 23% better than "Free limits you to 3 scans/month" |
| Social proof near CTA | Low | Medium | "Trusted by 500+ founders" or logos near the upgrade button. Lifts pricing page conversion 15–25% |
| Money-back guarantee | Low | Medium | "30-day money-back, no questions asked" reduces signup anxiety 30–40% |
| Security badges near payment form | Low | Low | Relevant for VibeCheck specifically — you're a security product, show you practice what you preach |

### Revenue Recovery

| Feature | Complexity | Revenue Impact | Notes |
|---|---|---|---|
| Win-back offer on cancel | Low | Medium | When user cancels, offer 1-month at 50% off. Spotify/Dropbox pattern. Captures users who are price-sensitive, not value-negative |
| 30-day trial-to-paid email sequence | Medium | High | Most freemium conversions happen within 30 days; diminishing returns after 90 days. 5-email sequence: Day 1 (welcome), Day 3 (tips), Day 7 (results), Day 14 (case study), Day 28 (urgency) |

---

## 3. Anti-Features (Do Not Build)

Things that waste engineering time for VibeCheck's current stage. Most require enterprise scale to justify.

### Premature Infrastructure

| Anti-Feature | Why to Skip |
|---|---|
| Custom billing engine | Stripe Billing handles subscriptions, prorations, retries, invoicing. Building your own wastes months for problems Stripe already solved |
| Usage-based / metered billing | Complexity multiplies for zero gain at current pricing. Flat-rate tiers are simpler to explain and sell to non-technical users |
| CPQ (Configure-Price-Quote) system | For sales-negotiated enterprise contracts. Not relevant until you have a sales team |
| Multi-currency support | Stripe Adaptive Pricing handles this automatically. Don't build custom currency logic |
| Revenue recognition / accounting automation | Zuora/Chargebee feature for companies with complex GAAP compliance needs. Not needed at this scale |
| Seat-based pricing management | Adds significant complexity. Flat-rate per account is simpler and sufficient for current user base |

### Premature UX

| Anti-Feature | Why to Skip |
|---|---|
| In-app upgrade/downgrade flow | Stripe Billing Portal handles plan changes with correct proration. Don't rebuild this |
| Custom invoice PDF builder | Stripe generates these automatically |
| Payment method management UI | Stripe Billing Portal covers this; redirecting users there is correct pattern |
| Pause subscription feature | Adds churn management complexity. Cancellation with win-back offer is simpler |
| Team/org management (multi-seat) | Enterprise feature. Free + Pro are individual plans — keep it simple until Enterprise tier has demand |

### Bloated Platforms Too Early

| Anti-Feature | Why to Skip |
|---|---|
| Chargebee / Zuora / Maxio | $50K+/yr, 3–6 month implementations. Stripe Billing covers everything needed at current scale |
| Separate dunning tool | Stripe's Smart Retries + email sequences cover this natively |
| A/B testing platform for billing | Run manual tests first; add analytics tooling only after baseline conversion is established |

---

## 4. Conversion Patterns for Dev Tools / Security SaaS

### The Flow That Works

```
Landing page → Social proof (logos + "found X vulnerabilities") → Sign up (email only, no CC)
→ First scan IMMEDIATELY (< 60 seconds to value) → Show real findings with severity
→ [Free: 3 scans/mo] → Hit scan limit → Upgrade modal (highest-intent moment)
→ Stripe Checkout (hosted) → Webhook → Supabase tier update → Confirmation email
```

### Key Conversion Benchmarks

- Average SaaS freemium-to-paid conversion: 2–5%
- Top-quartile with strong onboarding: 8–15%
- Mixpanel data: users engaging with core features in first week are **5x more likely to convert**
- Value delivery within 5 minutes: **40% higher 30-day retention**
- Time-to-first-value target: **under 2 minutes**

### What Vibe Coders Specifically Need

Vibe coders (non-technical founders using AI tools) are not reading documentation. They need:

1. **Outcome framing, not feature framing** — "Find and fix security holes before launch" not "Performs OWASP Top 10 analysis"
2. **Visible progress during scans** — Anxiety is high when waiting; narrate what's happening
3. **Plain-English results** — Severity levels (Critical/High/Medium/Low) with "What to do" not just "What's wrong"
4. **In-app help/chat** — 85% of users more likely to stay with products that invest in onboarding support
5. **No credit card on signup** — Reduces friction; qualify users with the free tier, gate with scan limits
6. **Fast signup** — Email + password only. Every additional field reduces completion rate ~15%

### Onboarding Email Sequence (5 emails, 28 days)

| Day | Subject | Goal |
|---|---|---|
| 0 | "Your first VibeCheck scan is ready" | Drive immediate activation |
| 3 | "3 things founders miss before launch" | Education → trust building |
| 7 | "Your scan found X issues — here's what matters" | Re-engage with personalized results |
| 14 | "How [similar founder] fixed their app in one afternoon" | Social proof case study |
| 28 | "Your free scans reset in 3 days" | Urgency before monthly reset |

---

## 5. Pricing Page Best Practices for Vibe Coders

### Structure (in order, top to bottom)

1. **Headline** — Value-focused, not "Pricing." Example: "Find security holes before your users do."
2. **Subheadline** — Address the #1 objection: "No credit card required. Cancel anytime."
3. **Annual/monthly toggle** — Default to annual; show savings badge ("Save 20%")
4. **3-tier cards** — Free / Pro (highlighted) / Enterprise
5. **"Most Popular" on Pro**
6. **Feature list as inclusions** — "Pro includes: unlimited scans, PDF reports, priority support"
7. **CTA buttons** — Action language: "Start Free Scan" (Free), "Upgrade to Pro" (Pro), "Contact Sales" (Enterprise)
8. **Social proof** — Logos or count near CTA ("Trusted by 500+ founders")
9. **Money-back guarantee** — "30-day money-back, no questions asked"
10. **FAQ** — Address: "What happens when I hit 3 scans?", "Can I cancel anytime?", "What does VibeCheck actually scan?"

### Tier Card Design

```
FREE             PRO ★ Most Popular    ENTERPRISE
$0/mo            $49/mo               $199/mo
                 or $39/mo annual      or $159/mo annual

3 scans/month    Unlimited scans      Everything in Pro
Basic report     Full PDF report      Team access
                 Priority support     API access
                                      Audit logs
                                      Custom integrations

[Start Free]     [Upgrade to Pro]     [Contact Sales]
```

### Psychology Tactics (Ranked by Impact for This Audience)

1. **Scan limit hit modal** — Highest impact. User is already bought in and wants more.
2. **Annual default** — 19% lift in annual adoption; better cash flow for VibeCheck
3. **3-tier layout** — Pro gets selected disproportionately when flanked by Free and Enterprise
4. **Feature framing as inclusions** — 23% better than exclusion framing
5. **Social proof near CTA** — 15–25% lift on pricing page
6. **Money-back guarantee** — 30–40% reduction in signup anxiety
7. **"Cancel anytime" in subheadline** — Addresses top objection preemptively

---

## 6. Implementation Priority Order

Given the Stripe + Supabase stack, build in this sequence:

### Phase 1 — Table Stakes (Week 1–2)
1. Supabase user table with `tier` and `scans_used_this_month` columns
2. Stripe products + prices created (Free, Pro monthly, Pro annual, Enterprise)
3. Stripe Checkout session creation endpoint
4. Webhook handler syncing subscription status to Supabase
5. Monthly scan counter reset (cron)
6. Stripe Billing Portal link for self-serve management

### Phase 2 — Conversion (Week 3)
1. Scan limit hit → upgrade modal
2. Remaining scans counter in dashboard header
3. Feature-locked states with upgrade CTAs for Pro/Enterprise features
4. Pricing page with 3-tier layout + annual toggle + social proof

### Phase 3 — Retention (Week 4+)
1. Failed payment grace period + email sequence
2. Post-scan email with summary
3. Win-back offer on cancel
4. Onboarding email sequence (5 emails)

### Phase 4 — Optimization (After launch)
1. A/B test: annual vs monthly default on pricing page
2. A/B test: scan result teaser on Free tier
3. Conversion funnel analytics

---

## Sources

- [Stripe Billing Features](https://stripe.com/billing/features)
- [Stripe SaaS Integration Guide](https://docs.stripe.com/saas)
- [Supabase Stripe Webhook Handling](https://supabase.com/docs/guides/functions/examples/stripe-webhooks)
- [Vercel Next.js + Stripe + Supabase Starter](https://vercel.com/templates/next.js/stripe-supabase-saas-starter-kit)
- [SaaS Freemium Conversion Rates 2026](https://firstpagesage.com/seo-blog/saas-freemium-conversion-rates/)
- [Freemium Upgrade Prompts Best Practices](https://www.appcues.com/blog/best-freemium-upgrade-prompts)
- [SaaS Pricing Page Psychology](https://www.orbix.studio/blogs/saas-pricing-page-psychology-convert)
- [SaaS Pricing Page Best Practices 2026](https://pipelineroad.com/agency/blog/saas-pricing-page-best-practices)
- [SaaS Onboarding Best Practices](https://productled.com/blog/5-best-practices-for-better-saas-user-onboarding)
- [Common SaaS Billing Mistakes to Avoid](https://www.maxio.com/blog/6-common-saas-subscription-billing-mistakes-to-look-out-for)
- [Conversion Rate Optimization for SaaS](https://userpilot.com/blog/conversion-rate-optimization-for-saas/)
- [Free Trial Conversion Statistics 2025](https://www.amraandelma.com/free-trial-conversion-statistics/)
