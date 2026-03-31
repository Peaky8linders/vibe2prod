# VibeCheck — Autonomous Production Hardening System

## Project Overview
Transforms working-but-fragile prototype code into production-grade software using an autonomous scan → eval → fix → gate → loop pipeline. Combines Karpathy's autoresearch pattern with eval-driven development. Systems don't just survive attacks — they get stronger from them (antifragile by design).

## Architecture
```
v2p-complete-package/repo/
├── cli.ts                    # CLI entry point (init, scan, eval, score, run, report, comply, status)
├── evals/                    # READ-ONLY eval harness (SHA-256 integrity verified)
│   ├── harness.ts            # Orchestrates L1 + L2 + security + behavioral gates
│   ├── l1-assertions.ts      # Deterministic checks (tests, types, lint, secrets)
│   ├── l2-judges.ts          # LLM binary judges with heuristic fallback
│   ├── security-gates.ts     # Non-negotiable security barriers
│   └── scanners/             # Language-specific defect pattern scanners
├── programs/                 # 7 hardening dimensions (security, error-handling, etc. + subtraction)
├── scripts/                  # Orchestration (scan, fix, overnight loop, reports, comply, evidence)
├── deploy/                   # Docker, CI (GitHub Actions), Terraform (AWS ECS)
├── target/demo-app/          # Intentionally broken Express + PostgreSQL task API
├── logs/                     # Append-only audit trail + evidence-chain.jsonl
│
│── # Antifragile Extension (v2.0)
├── chaos/                    # Phase 1 — Adversarial probes (fuzzing, auth, injection replay)
├── sentinel/                 # Phase 2 — Production feedback loop middleware
├── scoring/                  # Phase 3 — Three-component antifragility score
├── subtract/                 # Phase 4 — Via negativa scanner (remove attack surface)
├── judges/                   # Phase 5 — Judge accountability & production accuracy
│
│── # Compliance & Governance
├── scanners/                 # Compliance scanner plugins (AI safety, governance, evidence)
│   ├── compliance-scanner.ts # AI safety, human oversight, transparency, audit logging
│   ├── governance-scanner.ts # Access control, secrets, incident response
│   ├── evidence-scanner.ts   # Evidence chain management
│   └── plugin-interface.ts   # Scanner plugin contract
├── guardian/                  # Comprehensive security scanning subsystem
│   ├── scanners/             # 9+ specialized scanners (DAST, PII, injection, supply-chain, etc.)
│   ├── loop/                 # Guardian loop orchestration
│   └── report/               # PDF report generation
│
│── # Product Surface
├── dashboard/                # Next.js 15.3 production readiness UI
│   ├── src/app/              # App router (dark theme, 5-tab interface)
│   ├── src/app/api/          # API routes (scan, github webhook, reports, auth)
│   │   ├── scan/github/      # GitHub repo scanning endpoint
│   │   ├── github/webhook/   # GitHub App webhook handler (PR events → check runs)
│   │   ├── github/setup/     # GitHub App installation flow
│   │   └── reports/          # Report CRUD (save, list, retrieve)
│   ├── src/app/report/       # Shareable report pages (UUID-based, OG meta tags)
│   ├── src/app/setup/        # GitHub App setup/installation flow
│   ├── src/lib/              # Core libraries
│   │   ├── github-app.ts     # GitHub App client (JWT auth, RSA-SHA256, zero deps)
│   │   ├── api-auth.ts       # Rate limiting & payload validation
│   │   ├── report-store.ts   # Filesystem report storage (UUID, path traversal protection)
│   │   ├── scanner-engine.ts # Scan orchestration (batch fetch, 10 concurrent)
│   │   ├── scan-limits.ts    # Per-tier scan limits & trial tracking
│   │   ├── review-engine.ts  # Structured review report generation
│   │   ├── export-review.ts  # Review export (Markdown, JSON, clipboard)
│   │   └── scanners/         # 10 production readiness scanner plugins
│   │       ├── security-scanner.ts          # Hardcoded secrets, injection, auth gaps
│   │       ├── database-security-scanner.ts # Supabase RLS, Firebase rules, service keys
│   │       ├── performance-scanner.ts       # N+1 queries, sync blocking, pagination
│   │       ├── observability-scanner.ts     # Tracing, health checks, logging gaps
│   │       ├── api-contract-scanner.ts      # Missing validation, breaking changes
│   │       ├── code-quality-scanner.ts      # Dead code, unused imports, complexity
│   │       ├── compliance-scanner.ts        # GDPR, PII handling, audit logging
│   │       ├── governance-scanner.ts        # Access control, secrets, incident response
│   │       ├── supply-chain-scanner.ts      # Slopsquatting, hallucinated pkgs, deprecated deps
│   │       └── plugin-interface.ts          # Standard scanner contract (ScannerPlugin type)
│   └── src/components/       # UI components
│       ├── score-ring, defect-chart, stats-cards, file-list
│       ├── review-tab.tsx    # Structured review with severity badges & export
│       ├── antifragile-score.tsx
│       └── landing/          # Landing page components
│           ├── navbar.tsx    # Nav with GitHub App install button
│           ├── hero.tsx      # GitHub URL input wired to /api/scan/github
│           ├── features.tsx  # 9-card capability grid
│           ├── pricing.tsx   # 3-tier with annual/monthly toggle
│           ├── how-it-works.tsx
│           └── footer.tsx
├── servers/                  # MCP server (vibecheck-server.ts)
├── skills/                   # Claude Code MCP skills (scan-and-fix, harden, comply, etc.)
│   ├── ci-cd/                # CI/CD integration skills
│   └── perf-audit/           # Performance audit skills
├── integrations/             # External integrations (migrationforge)
├── reports/                  # Generated stakeholder reports + prompt templates
│
│── # Planning & Monetization
├── .planning/                # Monetization milestone planning docs
│   ├── PROJECT.md            # Milestone overview (Stripe + Supabase Auth)
│   ├── REQUIREMENTS.md       # v1 requirements (DB, Auth, Payments, Quotas, Gating, Billing UI)
│   ├── ROADMAP.md            # 3-phase roadmap (Foundation → Payments → Gating)
│   ├── STATE.md              # Project state tracker
│   ├── config.json           # Project configuration
│   └── research/             # Deep research (ARCHITECTURE, FEATURES, PITFALLS, STACK, SUMMARY)
│
│── # Configuration
├── .claude-plugin/           # Claude Code plugin (manifest.json, plugin.json)
├── github-app-manifest.json  # GitHub App permissions & webhook config
├── DEPLOY.md                 # Deployment guide (Vercel, Netlify, Cloudflare, Railway)
└── .env.example              # Environment vars for GitHub App, Stripe, Supabase
```

## Key Conventions
- **One defect per commit**: `fix(<dimension>): <defect-id> — <description>`
- **ALL gates must pass** before commit: L1 + L2 + Security + Behavioral
- **Score must ratchet upward** — never regress
- **Agent boundaries**: Only modify `target/**` and `logs/fixes.jsonl`
- **Eval integrity**: SHA-256 hash verified every run
- **Evidence chain**: Tamper-proof JSONL with SHA-256 integrity for compliance audits

## Tech Stack
- **Runtime**: Node.js >= 20, TypeScript 5.6+
- **Demo app**: Express 4.21, PostgreSQL (pg), JWT, CORS
- **Framework**: Anthropic SDK, MCP SDK, Zod, tsx
- **Dashboard**: Next.js 15.3, Tailwind CSS 4.0 (@tailwindcss/postcss), Recharts 2.15, Lucide React 0.475
- **Auth**: Supabase Auth (`@supabase/ssr`) — planned for monetization
- **Payments**: Stripe Checkout (`stripe` ^17.x, `@stripe/stripe-js` ^9.0) — planned for monetization
- **Deploy**: Vercel (dashboard), Docker multi-stage, GitHub Actions CI, AWS ECS Fargate + RDS

## Score Computation
- Readiness = 0.3*L1 + 0.3*L2 + 0.25*Security + 0.15*Behavioral
- Dimension weights: security & data-integrity (1.5x), others (0.8-1.0x)
- Priority weights: P0=4x, P1=2x, P2=1x, P3=0.5x
- **P0 cap**: Any open P0 defect caps composite at 50%
- **Antifragility score**: Robustness (0-40) + Chaos resilience (0-30) + Production adaptation (0-30)

## Antifragile Architecture (v2.0)

V2P v1.0 produces **robustness**. The antifragile extension produces systems that **get stronger from every attack**, applying Taleb's antifragility framework.

### Core Principles
| Taleb Principle | VibeCheck Translation |
|---|---|
| **Optionality** | Each fix is one atomic commit. Fails → revert. Succeeds → permanent. |
| **Barbell Strategy** | L1 hard gates (zero tolerance) + L2 soft gates (experimental approaches). |
| **Via Negativa** | Remove attack surface: dead endpoints, unused deps, broad permissions. |
| **Skin in the Game** | If a "fixed" defect resurfaces, the eval judge is flagged for recalibration. |
| **Hormesis** | Controlled chaos injection — adversarial inputs, auth probes, dependency failures. |
| **Non-predictive** | Evals follow observed failures, never predicted ones. Production signals > hypothesized threats. |

### The Antifragile Loop
```
HARDEN → Scan → Fix → Eval Gate → Commit/Revert
    ↓
CHAOS → Inject stress → Probe fixed defects → Discover new vectors
    ↓
COMPLY → Compliance scan → Evidence chain → Governance audit
    ↓
DEPLOY → Hardened + chaos-tested + compliant code → Production
    ↓
SENTINEL → Capture: blocked attacks, unhandled errors, anomalies
    ↓
LEARN → Production signals → New defects → New eval judges
    ↓
  └──── back to HARDEN (continuous improvement cycle)
```

### Implementation Status
- **Phase 1 — Chaos Testing**: `vibecheck chaos` — adversarial probes, input fuzzing, auth probes, injection replay
- **Phase 2 — Sentinel Middleware**: `vibecheck learn` — production signal processing into new defects
- **Phase 3 — Antifragility Score**: `vibecheck score --antifragile` — three-component scoring with time decay
- **Phase 4 — Via Negativa**: `vibecheck subtract` — scan for things to REMOVE (most differentiated feature)
- **Phase 5 — Judge Accountability**: `vibecheck judges:audit` — track judge accuracy vs production outcomes

### Compliance & Evidence Layer
- **Scanner plugins**: Standardized interface for compliance, governance, and evidence scanners
- **Evidence chain**: SHA-256 integrity-verified JSONL audit trail (`logs/evidence-chain.jsonl`)
- **Guardian subsystem**: 10+ specialized scanners (DAST, PII, injection, supply-chain, secret, prompt-injection, database-security, etc.)
- **Database security scanner**: Detects missing Supabase RLS policies, insecure Firebase rules, exposed service role keys
- **PDF reports**: Automated compliance report generation

### Dashboard (Next.js 15.3)
- Dark theme (#0a0a0f) with green/cyan accents — SaaS security product positioning
- 5 tabs: Overview, File Analysis, Store Ready (Apple/Google), Antifragile, Review
- Real scan data integration — wired to actual VibeCheck scan output
- Responsive design with accessibility fixes
- **Shareable reports**: UUID-based report URLs with OG meta tags, score ring, defect charts, stats cards
  - Filesystem-based storage with path traversal protection (UUID format validation)
  - REST API: `POST /api/reports` (save), `GET /api/reports` (list), `GET /api/reports/[id]` (retrieve)
  - Auto-save on GitHub scans with shareable URL generation + copy-to-clipboard
- **API auth & rate limiting**: Per-tier limits (scan: 10/min, report: 30/min, 1MB payload max) — v1 in-memory, Upstash Redis planned
- **GitHub App integration**: Zero-dependency client using native `node:crypto`
  - JWT-based auth with RSA-SHA256 signing, timing-safe webhook signature verification
  - Webhook handler for `pull_request` (opened/synchronize) and `installation` events
  - Check run creation with inline annotations and review comments
  - Setup page with install button and permissions display
- **Review tab**: Structured review reports with engineering, design, and QA passes
  - Severity badges (P0/P1/P2/P3), expandable sections, top priority actions
  - Export in 3 formats: Markdown, JSON (CI/CD), clipboard
- **Production readiness scanners** (10 plugins in `src/lib/scanners/`):
  - Security, database security, performance, observability, API contract
  - Code quality, compliance (GDPR/PII), governance, supply chain, + plugin interface
  - Supply chain scanner: slopsquatting detection, hallucinated package names, deprecated/insecure deps, unpinned versions, dynamic imports with user input
- **Real GitHub scanning**: URL parser + validation, batch file fetch (10 concurrent, per_page=100)

### Security Hardening (Latest)
- Escaped table names before regex to prevent ReDoS
- Timing-safe equality for webhook signature comparison
- URL sanitization preventing stored XSS via `javascript:` URLs
- Open redirect prevention in GitHub setup (`url.origin` not `request.url`)
- Removed console.log from production routes
- Fixed React hydration mismatch in header
- Proper error handling on clipboard API calls
- Removed orphaned check run logic race condition

### Landing Page
- **Branding**: "VibeCheck by Antifragile.AI" in navbar
- **Layout**: Hero → Features (9-card grid) → Social proof → How It Works → Pricing → CTA → Footer
- **Features visible immediately**: Capabilities grid appears right after hero, above the fold
- **Components**: `src/components/landing/` — navbar, hero, features, how-it-works, pricing, footer
- **CTA**: "Ready to harden your code?" with free scan link at bottom
- **GitHub scanning**: Real repo URL input in hero, wired to `/api/scan/github`
- **Trial system**: 3 free scans/day, 7-day trial, upgrade prompts

### MCP Integration
- **MCP server**: `vibecheck-mcp` — exposes VibeCheck tools to Claude Code
- **Skills**: scan-and-fix, harden, post-migration, antifragile-report, comply, ci-cd, perf-audit
- **MCP tools**: `vc_comply`, `vc_evidence_verify`, `vc_scan_database`, `vc_scan_github`, and standard scan/fix/score tools

### Monetization Roadmap (Planned)
- **Phase 1**: Supabase database + Auth setup (users, customers, subscriptions, scans tables with RLS)
- **Phase 2**: Stripe Checkout + webhooks (subscription lifecycle management)
- **Phase 3**: Scan quotas + feature gating + billing UI
- **Pricing tiers**: Free (3 scans/mo) → Pro ($49/mo) → Enterprise ($199/mo)
- **Distribution**: GitHub App webhook → PR check runs + inline review comments

## Common Commands
```bash
# Core Hardening
npm run vibecheck -- scan        # Discover defects
npm run vibecheck -- eval        # Run all gates
npm run vibecheck -- score       # Compute readiness score
npm run vibecheck -- fix         # Single atomic fix cycle
npm run vibecheck -- harden      # Automated hardening
npm run vibecheck -- report      # Generate stakeholder report
npm run vibecheck -- status      # Quick overview

# Antifragile
npm run vibecheck -- chaos       # Run adversarial probes
npm run vibecheck -- subtract    # Via negativa — find attack surface to remove
npm run vibecheck -- learn       # Process production signals into new defects
npm run vibecheck -- score --antifragile  # Three-component antifragility score
npm run vibecheck -- judges:audit         # Judge accuracy vs production outcomes

# Compliance
npm run vibecheck -- comply              # Run compliance scanners
npm run vibecheck -- evidence:verify     # Verify evidence chain integrity

# Analysis
npm run vibecheck -- analyze             # Error analysis
npm run vibecheck -- scan:database       # Database security scanning (RLS, service keys)
npm run vibecheck -- scan:perf           # Performance scanner (N+1, blocking, pagination)
npm run vibecheck -- scan:observability  # Observability scanner (tracing, health, logging)
npm run vibecheck -- scan:api            # API contract scanner (validation, breaking changes)
npm run vibecheck -- scan:github         # GitHub repo scanning (dashboard-integrated)
npm run vibecheck -- scan:e2e            # End-to-end scanning with compliance
npm run vibecheck -- validate-judges     # Measure judge precision + recall
npm run vibecheck -- launch-report       # Generate launch report
npm run vibecheck -- badge               # Generate readiness badge
```

## Environment Variables
```bash
# GitHub App
GITHUB_APP_ID=                    # GitHub App ID
GITHUB_APP_PRIVATE_KEY=           # RSA private key (PEM format)
GITHUB_WEBHOOK_SECRET=            # Webhook signature verification secret
NEXT_PUBLIC_GITHUB_APP_URL=       # Public GitHub App install URL

# Monetization (Planned)
NEXT_PUBLIC_SUPABASE_URL=         # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Supabase anon/public key
SUPABASE_SERVICE_ROLE_KEY=        # Supabase service role (server-only)
STRIPE_SECRET_KEY=                # Stripe secret key (server-only)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY= # Stripe publishable key
STRIPE_WEBHOOK_SECRET=            # Stripe webhook signing secret
```

## Deployment
- **Primary**: Vercel (recommended for Next.js dashboard)
- **Alternatives**: Netlify, Cloudflare Pages, Railway
- **Guide**: `dashboard/DEPLOY.md` — env setup, custom domain, pre-flight checklist

## Positioning
- **Core**: "Security scanners tell you what's broken. VibeCheck fixes it while you sleep."
- **Antifragile**: "Your app doesn't just survive attacks — it gets stronger from them."
- **Compliance**: "Evidence-based compliance — every fix cryptographically linked to its defect."
- **Category**: "Antifragile" is unoccupied in the vibe-coding security market.

## Competitive Landscape (March 2026)
- **Vibe App Scanner (VAS)**: Quick scan focus, tiered pricing ($5-$29/mo), detects exposed secrets/RLS/auth gaps
- **Aikido**: Broader AppSec platform, not vibe-coding specific
- **ChakraView**: Newer entrant, vibe-code focused
- **amihackable.dev**: Simple vulnerability check for vibe-coded apps
- **Lovable built-in**: Auto-scans before publish (RLS, schema, deps) — shallow checks
- **kluster.ai**: IDE-integrated real-time scanning with OWASP guardrails
- **VibeCheck differentiator**: Only tool that both scans AND autonomously fixes, with antifragile loop (chaos testing → production learning → continuous hardening). Competitors scan and report; VibeCheck closes the loop.
