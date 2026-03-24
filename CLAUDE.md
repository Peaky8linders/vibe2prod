# Vibe-to-Prod — Autonomous Production Hardening System

## Project Overview
Transforms working-but-fragile prototype code into production-grade software using an autonomous scan → eval → fix → gate → loop pipeline. Combines Karpathy's autoresearch pattern with eval-driven development.

## Architecture
```
vibe-to-prod/
├── cli.ts                    # CLI entry point (init, scan, eval, score, run, report)
├── evals/                    # READ-ONLY eval harness (SHA-256 integrity verified)
│   ├── harness.ts            # Orchestrates L1 + L2 + security + behavioral gates
│   ├── l1-assertions.ts      # Deterministic checks (tests, types, lint, secrets)
│   ├── l2-judges.ts          # LLM binary judges with heuristic fallback
│   ├── security-gates.ts     # Non-negotiable security barriers
│   └── scanners/python.ts    # FastAPI/Python defect patterns
├── programs/                 # 6 hardening dimensions (security, error-handling, etc.)
├── scripts/                  # Orchestration (scan, fix, overnight loop, reports)
├── deploy/                   # Docker, CI (GitHub Actions), Terraform (AWS ECS)
├── target/demo-app/          # Intentionally broken Express + PostgreSQL task API
└── logs/                     # Append-only audit trail
```

## Key Conventions
- **One defect per commit**: `fix(<dimension>): <defect-id> — <description>`
- **ALL gates must pass** before commit: L1 + L2 + Security + Behavioral
- **Score must ratchet upward** — never regress
- **Agent boundaries**: Only modify `target/**` and `logs/fixes.jsonl`
- **Eval integrity**: SHA-256 hash verified every run

## Tech Stack
- **Runtime**: Node.js >= 20, TypeScript 5.6+
- **Demo app**: Express 4.21, PostgreSQL (pg), JWT, CORS
- **Framework**: Anthropic SDK, Zod, tsx
- **Deploy**: Docker multi-stage, GitHub Actions CI, AWS ECS Fargate + RDS

## Score Computation
- Readiness = 0.3*L1 + 0.3*L2 + 0.25*Security + 0.15*Behavioral
- Dimension weights: security & data-integrity (1.5x), others (0.8-1.0x)
- Priority weights: P0=4x, P1=2x, P2=1x, P3=0.5x
- **P0 cap**: Any open P0 defect caps composite at 50%

## Antifragile Architecture (Extension — v2.0)

V2P v1.0 produces **robustness** — a system that withstands known attacks. The antifragile extension produces systems that **get stronger from every attack they encounter**, applying Nassim Taleb's antifragility framework to production hardening.

### Taleb's Triad Applied
- **Fragile**: The vibe-coded prototype. SQL injection → data leak → game over.
- **Robust**: V2P-hardened app. Injection → 400 response → logged. Survives but doesn't learn.
- **Antifragile**: Injection attempt → captured → new eval judge → next hardening run closes all similar vectors.

### Core Principles
| Taleb Principle | V2P Translation |
|---|---|
| **Optionality** | Each fix is one atomic commit. Fails → revert. Succeeds → permanent. Downside capped, upside unbounded. |
| **Barbell Strategy** | L1 hard gates (zero tolerance) + L2 soft gates (experimental fix approaches). |
| **Via Negativa** | Remove attack surface: dead endpoints, unused deps, broad permissions. Subtraction > Addition. |
| **Skin in the Game** | If a "fixed" defect resurfaces, the eval judge that approved it is flagged for recalibration. |
| **Hormesis** | Controlled chaos injection — adversarial inputs, auth probes, dependency failures — in staging. |
| **Non-predictive** | Evals follow observed failures, never predicted ones. Production signals > hypothesized threats. |

### The Antifragile Loop
```
HARDEN (existing V2P) → Scan → Fix → Eval Gate → Commit/Revert
    ↓
CHAOS (Phase 1) → Inject stress → Probe fixed defects → Discover new vectors
    ↓
DEPLOY → Hardened + chaos-tested code → Production
    ↓
SENTINEL (Phase 2) → Capture: blocked attacks, unhandled errors, anomalies
    ↓
LEARN (Phase 3) → Production signals → New defects → New eval judges
    ↓
  └──── back to HARDEN (continuous improvement cycle)
```

### Implementation Phases

**Phase 4 — Via Negativa (ship first, standalone, 3-5 days)**
- `v2p subtract` — scans for things to REMOVE: dead endpoints, unused deps, broad permissions, debug code
- No competitor does subtraction-based hardening. Most differentiated feature.
- "The most secure code is the code that doesn't exist."

**Phase 1 — Chaos Testing (1-2 weeks, depends on fix loop)**
- `v2p chaos` — adversarial probes against hardened endpoints
- Input fuzzing, auth probes, injection replay, dependency failure simulation
- Every probe that breaks through becomes a new P0 defect (`source: chaos`)

**Phase 2 — Sentinel Middleware (1 week, standalone npm package)**
- `npm install @v2p/sentinel` → `app.use(v2pSentinel())`
- Captures: rejected inputs, auth failures, unhandled errors, rate limit hits, anomalous payloads
- Events → `.v2p/sentinel.jsonl` → `v2p learn` → new defects (`source: production`)

**Phase 3 — Antifragility Score (3 days, depends on Phase 1+2)**
- `v2p score --antifragile` — three-component scoring:
  - Robustness baseline (0-40): existing V2P readiness
  - Chaos resilience (0-30): adversarial probe survival rate
  - Production adaptation (0-30): real-world signals converted to improvements
- Time decay: stagnation reduces score. Continuous adaptation required.

**Phase 5 — Judge Accountability (3 days, depends on Phase 2)**
- `v2p judges:audit` — track judge decisions vs production outcomes
- Judge that approved a fix that fails in production gets flagged
- 3+ false positives → automatic recalibration flag
- Self-correcting eval system with production accuracy metrics

### Antifragile File Structure Extension
```
vibe-to-prod/
├── chaos/                    # Phase 1 — Controlled chaos injection
│   ├── probes/
│   │   ├── input-fuzzing.ts
│   │   ├── auth-probes.ts
│   │   ├── injection-replay.ts
│   │   └── dependency-failure.ts
│   └── chaos-runner.ts
├── sentinel/                 # Phase 2 — Production feedback loop
│   ├── middleware/
│   │   ├── express.ts
│   │   ├── fastapi.py
│   │   └── nextjs.ts
│   └── sentinel.ts
├── scoring/                  # Phase 3 — Antifragility scoring
│   ├── antifragility-score.ts
│   └── time-decay.ts
├── subtract/                 # Phase 4 — Via negativa scanner
│   ├── dead-endpoints.ts
│   ├── unused-deps.ts
│   ├── broad-permissions.ts
│   └── unnecessary-exposure.ts
├── judges/                   # Phase 5 — Judge accountability
│   ├── production-accuracy.ts
│   └── auto-recalibrate.ts
└── programs/
    └── subtraction.md        # Via negativa program definition
```

### Positioning
- **Current**: "Security scanners tell you what's broken. V2P fixes it while you sleep."
- **Antifragile**: "Your app doesn't just survive attacks — it gets stronger from them."
- **Badge**: "Antifragility: 87 — 142 attacks adapted" > "Hardened: 94%"
- **Category**: "Antifragile" is unoccupied in the vibe-coding security market.

## Common Commands
```bash
# Existing V2P
npm run v2p -- scan          # Discover defects
npm run v2p -- eval          # Run all gates
npm run v2p -- score         # Compute readiness score
npm run v2p -- fix           # Single atomic fix cycle
npm run v2p -- run           # Autonomous overnight loop
npm run v2p -- report        # Generate stakeholder report

# Antifragile Extension
npm run v2p -- chaos         # Run adversarial probes against hardened code
npm run v2p -- subtract      # Via negativa — find attack surface to remove
npm run v2p -- learn         # Process production signals into new defects
npm run v2p -- score --antifragile  # Three-component antifragility score
npm run v2p -- judges:audit  # Judge accuracy vs production outcomes
```
