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

## Common Commands
```bash
npm run v2p -- scan          # Discover defects
npm run v2p -- eval          # Run all gates
npm run v2p -- score         # Compute readiness score
npm run v2p -- fix           # Single atomic fix cycle
npm run v2p -- run           # Autonomous overnight loop
npm run v2p -- report        # Generate stakeholder report
```
