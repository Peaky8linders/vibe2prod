# Vibe-to-Prod

**Autonomous production hardening for vibe-coded projects.**

Takes your working-but-fragile prototype and systematically hardens it into production-grade software — one atomic commit at a time, overnight, while you sleep.

```
v2p init ../my-prototype     # scan it
v2p run security --hours 4   # harden it
v2p report                   # see what changed
```

---

## The Problem

You vibe-coded an app. It works. But between "it works" and "it runs in production with SLAs" there are hundreds of specific defects: missing error handling, unvalidated inputs, hardcoded secrets, zero tests, no observability, SQL injection, race conditions.

Each defect is binary — present or absent. That makes this an **eval problem**. And eval problems have autonomous solutions.

## How It Works

Fuses [Karpathy's autoresearch pattern](https://x.com/karpathy/status/1886192184808149383) (autonomous experimentation loops) with [Hamel Husain's eval-driven methodology](https://hamel.dev/blog/posts/evals/) (error analysis → binary judges → CI flywheel):

```
SCAN    →  Find every production defect in your codebase
EVAL    →  L1 assertions + L2 LLM judges + behavioral preservation
FIX     →  Agent picks a defect, applies minimal fix, runs eval gate
GATE    →  Pass ALL evals → commit. Fail ANY → revert. No exceptions.
LOOP    →  Repeat overnight. Morning: review commit log + readiness score.
```

**Key constraints:**
- Single defect per commit (atomic, reviewable, revertable)
- Behavioral preservation gate (existing functionality never breaks)
- Agent cannot modify eval harness (read-only, hash-verified)
- Binary per defect — not fuzzy quality scores
- Ratcheting baseline — score only goes up, never regresses

## Quick Start

### 1. Try the demo

The repo ships with a deliberately vibe-coded Express task API full of real-world production defects (SQL injection, hardcoded secrets, no auth, no error handling, no tests).

```bash
git clone https://github.com/yourorg/vibe-to-prod.git
cd vibe-to-prod
npm install

# Scan the demo app
npx tsx cli.ts init target/demo-app

# See what's wrong
npx tsx cli.ts score --detail
```

Expected output:
```
Production Readiness Score
============================================================
  security             ░░░░░░░░░░░░░░░░░░░░   0.0% (0/8)  ⛔ P0 OPEN
  error-handling       ░░░░░░░░░░░░░░░░░░░░   0.0% (0/12)  ⚠ P1 open
  input-validation     ░░░░░░░░░░░░░░░░░░░░   0.0% (0/9)
  observability        ░░░░░░░░░░░░░░░░░░░░   0.0% (0/15)
  test-coverage        ░░░░░░░░░░░░░░░░░░░░   0.0% (0/5)
============================================================
  COMPOSITE              0.0% (capped — P0 defects open)
```

### 2. Run autonomous hardening

```bash
# Set your API key for L2 judges (optional — heuristic fallback works without)
export ANTHROPIC_API_KEY=sk-ant-...

# Harden security first (P0 defects block everything else)
npx tsx cli.ts run security --hours 2

# Then error handling
npx tsx cli.ts run error-handling --hours 4

# Generate a report for your team
npx tsx cli.ts report
```

### 3. Use on your own project

```bash
npx tsx cli.ts init ../your-vibe-coded-app

# Review and adjust defect priorities
# (this is the highest-leverage 2 hours in the entire process)
cat evals/defect-taxonomy.json | jq '.dimensions.security.defects[:5]'

# Run overnight
npx tsx cli.ts run all --hours 8
```

## Repo Structure

```
vibe-to-prod/
├── cli.ts                        # v2p CLI entry point
├── programs/                     # Karpathy-style program.md per dimension
│   ├── security.md               #   hardcoded secrets, auth, CORS, SQLi
│   ├── error-handling.md         #   try/catch, timeouts, retries
│   ├── input-validation.md       #   Zod/Pydantic schemas, type safety
│   ├── observability.md          #   structured logging, health endpoints
│   ├── test-coverage.md          #   unit, integration, edge cases
│   └── data-integrity.md         #   transactions, constraints, indices
├── evals/                        # READ-ONLY to agent (hash-verified)
│   ├── harness.ts                #   orchestrates L1 + L2 + security + behavioral
│   ├── l1-assertions.ts          #   deterministic: tests, types, lint, secrets
│   ├── l2-judges.ts              #   LLM binary judges with heuristic fallback
│   ├── l2_judge_prompts/         #   one JSON prompt per defect category
│   ├── scanners/python.ts        #   Python/FastAPI defect patterns
│   ├── security-gates.ts         #   network allowlist, PII scan, auth bypass
│   └── behavioral-snapshots.json #   captured before hardening starts
├── scripts/
│   ├── run-fix.sh                #   single fix: apply → eval → commit/revert
│   ├── run-overnight.sh          #   autonomous loop with time budget
│   ├── scan-defects.ts           #   static + LLM defect scanning (TS + Python)
│   ├── capture-behavior.ts       #   snapshot prototype behavior
│   ├── readiness-score.ts        #   composite score across dimensions
│   ├── generate-report.ts        #   stakeholder HTML report
│   ├── validate-judges.ts        #   judge precision + recall vs gold labels
│   └── seal-evals.sh             #   hash-seal eval harness integrity
├── deploy/                       # Production deployment templates
│   ├── docker/
│   │   ├── Dockerfile            #   multi-stage, non-root, health check
│   │   ├── docker-compose.yml    #   app + postgres + env validation
│   │   └── init.sql              #   production schema with constraints
│   ├── ci/
│   │   └── github-actions.yml    #   L1→security→L2→build→deploy pipeline
│   └── infra/
│       └── main.tf               #   AWS ECS Fargate + RDS + ALB + CloudWatch
├── target/                       # YOUR PROJECT (agent works here)
│   └── demo-app/                 #   included demo with intentional defects
├── logs/fixes.jsonl              # append-only audit trail
├── reports/                      # generated HTML reports
└── CLAUDE.md                     # agent boundary rules
```

## Deployment Target State

The `deploy/` directory contains production infrastructure templates — the **target state** your hardened code deploys into:

**`deploy/docker/`** — Multi-stage Dockerfile (non-root, health check, minimal attack surface), docker-compose with Postgres, `.env.example` with all required secrets documented, production DB schema with proper constraints/indices/triggers.

**`deploy/ci/github-actions.yml`** — CI pipeline mirroring the eval harness gate structure: L1 (type check + lint + unit tests) → Security (gitleaks + dep audit) → L2 (integration tests with Postgres service container) → Build + Push → Deploy with smoke test. The hardening loop produces code that passes this pipeline.

**`deploy/infra/main.tf`** — AWS ECS Fargate + RDS PostgreSQL + ALB. Secrets via SSM Parameter Store. CloudWatch logging. Deployment circuit breaker with auto-rollback. Least-privilege IAM. Storage encryption. Performance Insights.

## Hardening Dimensions

| Dimension | What it fixes | Priority triggers |
|---|---|---|
| **Security** | Hardcoded secrets, SQL injection, missing auth, open CORS, no rate limiting | P0: secrets/SQLi. P1: auth/CORS. |
| **Error Handling** | Bare catch, no timeouts, swallowed errors, no retries | P1: unhandled external calls. |
| **Input Validation** | Untyped inputs, no schemas, `any` types, no param validation | P1: API without validation. |
| **Observability** | console.log, no request IDs, no health endpoint, no metrics | P1: no structured logging. |
| **Test Coverage** | Zero tests, untested edge cases, no integration tests | P2: exported modules without tests. |
| **Data Integrity** | No constraints, missing indices, race conditions, no transactions | P1: concurrent writes without tx. |

## Language Support

| Language | Static Scanner | LLM Deep Scan | L2 Judges |
|---|---|---|---|
| TypeScript / JavaScript | ✅ | ✅ `--llm` | ✅ |
| Python / FastAPI | ✅ | ✅ `--llm` | ✅ |
| Other | — | ✅ `--llm` | ✅ heuristic |

## Success Metrics

| Metric | Target | Signal |
|---|---|---|
| Fixes/Night | 40+ per 8h run | Below 20 = loop too slow |
| Commit Rate | 20-35% | Below 10% = decompose defects |
| Readiness Score | Monotonically increasing | Plateau = switch dimension |
| Open P0s | 0 | Any P0 caps score at 50% |
| Behavioral Preservation | 100% | Any regression = auto-revert |

## CLI Reference

```
v2p init <path>           Copy project, capture baseline, scan defects
v2p scan [--llm]          Run defect scanner (add --llm for deep analysis)
v2p eval                  Run full eval harness
v2p score [--detail]      Show readiness score
v2p fix                   Run single fix attempt
v2p run <dim> [--hours N] Autonomous hardening loop
v2p report                Generate stakeholder HTML report
v2p seal                  Seal eval harness integrity hash
v2p validate-judges       Measure judge precision + recall
v2p status                Quick overview of current state
```

## License

MIT
