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
├── dashboard/                # Next.js 15 production readiness UI
│   ├── src/app/              # App router (dark theme, 4-tab interface)
│   └── src/components/       # score-ring, defect-chart, action-prompts, antifragile-score
├── servers/                  # MCP server (vibecheck-server.ts)
├── skills/                   # Claude Code MCP skills (scan-and-fix, harden, comply, etc.)
├── integrations/             # External integrations (migrationforge)
└── reports/                  # Generated stakeholder reports + prompt templates
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
- **Dashboard**: Next.js 15, Tailwind CSS 4, Recharts, Lucide icons
- **Deploy**: Docker multi-stage, GitHub Actions CI, AWS ECS Fargate + RDS

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
- **Guardian subsystem**: 9+ specialized scanners (DAST, PII, injection, supply-chain, secret, prompt-injection, etc.)
- **PDF reports**: Automated compliance report generation

### Dashboard (Next.js 15)
- Dark theme (#0a0a0f) with green/cyan accents — SaaS security product positioning
- 4 tabs: Overview, File Analysis, Store Ready (Apple/Google), Antifragile
- Real scan data integration — wired to actual VibeCheck scan output
- Responsive design with accessibility fixes

### MCP Integration
- **MCP server**: `vibecheck-mcp` — exposes VibeCheck tools to Claude Code
- **Skills**: scan-and-fix, harden, post-migration, antifragile-report, comply
- **MCP tools**: `vc_comply`, `vc_evidence_verify`, and standard scan/fix/score tools

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
npm run vibecheck -- scan:e2e            # End-to-end scanning with compliance
npm run vibecheck -- validate-judges     # Measure judge precision + recall
npm run vibecheck -- launch-report       # Generate launch report
npm run vibecheck -- badge               # Generate readiness badge
```

## Positioning
- **Core**: "Security scanners tell you what's broken. VibeCheck fixes it while you sleep."
- **Antifragile**: "Your app doesn't just survive attacks — it gets stronger from them."
- **Compliance**: "Evidence-based compliance — every fix cryptographically linked to its defect."
- **Category**: "Antifragile" is unoccupied in the vibe-coding security market.
