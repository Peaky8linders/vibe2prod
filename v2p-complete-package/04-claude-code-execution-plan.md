# CLAUDE.md — V2P Claude Code Execution Plan

## Project Context

V2P (Vibe-to-Prod) is an open-source autonomous production hardening tool for vibe-coded projects. The repo is functionally complete with:
- Eval harness (L1 assertions, L2 LLM judges, security gates, behavioral preservation)
- Defect scanner (TS/JS + Python, ~50 patterns, LLM deep scan mode)
- Overnight autonomous loop (run-fix.sh + run-overnight.sh)
- Zero-config `v2p harden` command
- Badge generator (3 SVG variants)
- Report generators (HTML stakeholder + PDF launch readiness)
- Demo Express app with ~30 intentional defects
- Production deployment templates (Docker, GitHub Actions CI, Terraform/AWS)
- CLI with 12 commands
- 6 program.md files (one per hardening dimension)

## What Needs to Happen Next (Priority Order)

### Sprint 1: Make It Actually Run (Days 1-3)

The repo has working code but hasn't been end-to-end tested with `npm install && npm run harden`. Fix this.

```
Task 1.1: npm install + dependency resolution
- Run `npm install` in the repo root
- Fix any missing or conflicting dependencies
- Ensure `tsx` can execute every .ts file without import errors
- Verify `glob` import works (ESM module resolution)

Task 1.2: End-to-end smoke test with demo app
- Run: `npx tsx cli.ts init target/demo-app`
- Verify: scan-defects.ts finds defects in the demo app
- Verify: readiness-score.ts produces a score
- Verify: generate-badge.ts creates SVG files
- Verify: generate-report.ts creates HTML report
- Verify: generate-launch-report.ts creates HTML (PDF optional)

Task 1.3: Fix the harden command
- Run: `npx tsx scripts/harden.ts target/demo-app --dry-run`
- Ensure framework detection works for the demo Express app
- Ensure scan runs and taxonomy is populated
- Test with ANTHROPIC_API_KEY set: verify LLM fix attempts work
- Test without API key: verify graceful fallback (scan-only mode)

Task 1.4: Git integration
- Initialize git in target/ before running fixes
- Ensure run-fix.sh works with actual git commits
- Test the commit/revert flow
```

### Sprint 2: Harden the Hardener (Days 4-6)

Eat your own dogfood. Run V2P on itself.

```
Task 2.1: Run the scanner on the V2P codebase itself
- `npx tsx scripts/scan-defects.ts` with target pointing at V2P's own src
- Fix any P0/P1 defects in the eval harness and scripts
- Ensure strict TypeScript passes on all .ts files

Task 2.2: Add tests
- Unit tests for scan-defects.ts (feed it known-vulnerable files, verify defects found)
- Unit tests for readiness-score.ts (feed it a taxonomy, verify score computation)
- Unit tests for framework detection in harden.ts
- Integration test: init demo app → scan → verify taxonomy has expected defects

Task 2.3: Fix edge cases
- Handle projects with no package.json and no pyproject.toml
- Handle projects with only .jsx files (no .ts)
- Handle empty directories gracefully
- Handle projects where `npm test` doesn't exist
- Handle Python projects where pytest isn't installed
```

### Sprint 3: NPX Distribution (Days 7-9)

Make `npx v2p harden .` work from any directory.

```
Task 3.1: Package for npx
- Update package.json: set "bin": {"v2p": "./dist/cli.js"}
- Add build step: tsc to compile .ts → .js
- Add shebang to cli.ts: #!/usr/bin/env node
- Test: npx . harden target/demo-app (local)
- Publish to npm as `vibe-to-prod` or `v2p`

Task 3.2: First-run experience
- When run outside the repo (npx v2p harden .):
  - Create a temp working directory
  - Copy necessary eval files, scanners, scripts
  - Run against the user's project in-place (don't require copying to target/)
  - Output reports to ./v2p-reports/ in the user's project

Task 3.3: README badges
- Generate the actual badges for the V2P repo's own README
- Add screenshot/gif of terminal output to README
- Add "Quick Start" section that works with npx
```

### Sprint 4: GitHub Action (Days 10-12)

```
Task 4.1: Create .github/actions/v2p-harden/action.yml
- Input: path (default: .), max-fixes, anthropic-api-key (secret)
- Runs: npx v2p harden $path --max-fixes $max-fixes
- Output: readiness score, badge path, report path
- Posts readiness score as PR comment
- Uploads badge and report as artifacts
- Fails the check if P0 defects are open

Task 4.2: Create .github/workflows/v2p.yml example
- Triggered on PR
- Runs harden in dry-run mode
- Posts scan results as PR comment
- Blocks merge if P0 defects found
```

### Sprint 5: GTM Launch (Days 13-15)

```
Task 5.1: GitHub repo setup
- Create public repo
- Add LICENSE (MIT)
- Add CONTRIBUTING.md
- Add .github/ISSUE_TEMPLATE/ (bug report, feature request)
- Add the architecture doc (01-architecture-doc.html) to docs/
- Generate actual badges from demo app scan

Task 5.2: Execute social distribution
- Follow the calendar in 03-gtm-social-content.md
- Day 1: r/webdev + HN
- Day 2: X thread
- Day 3: r/vibecoding
- Day 4: Indie Hackers
- Day 5: r/cursor + r/SaaS

Task 5.3: Record demo
- Terminal recording of `npx v2p harden target/demo-app`
- Show: framework detection → scan → fix attempts → score → badge
- Convert to gif for README
- Post on X as video
```

## Agent Swarm Structure (for parallel execution)

If using Claude Code with git worktrees for parallel agents:

```
Worktree 1: sprint-1-smoke-test
  → Task 1.1-1.4 (make it run)
  
Worktree 2: sprint-2-tests  
  → Task 2.2 (unit tests — can work in parallel with worktree 1)

Worktree 3: sprint-3-npx
  → Task 3.1-3.2 (packaging — depends on worktree 1 completing)

Worktree 4: sprint-4-action
  → Task 4.1-4.2 (GitHub Action — independent, can start immediately)
```

## Rules for All Agents

- No stubs. No placeholders. Every file must be complete and working.
- Run `npx tsx <file>` after every change to verify it executes.
- TypeScript strict mode. Zero `any` types. Zero `@ts-ignore`.
- Every scanner pattern must have at least one test case.
- Git commit after each completed task with descriptive message.
- If a task is blocked, skip to the next and note the blocker.

## File Layout Reference

```
repo/
├── cli.ts                         # CLI entry point (12 commands)
├── scripts/
│   ├── harden.ts                  # Zero-config magic wand
│   ├── scan-defects.ts            # Defect scanner (TS/JS + Python)
│   ├── capture-behavior.ts        # Behavioral snapshot
│   ├── readiness-score.ts         # Composite score calculator
│   ├── generate-badge.ts          # SVG badge generator
│   ├── generate-report.ts         # HTML stakeholder report
│   ├── generate-launch-report.ts  # PDF launch readiness report
│   ├── validate-judges.ts         # Judge precision/recall
│   ├── run-fix.sh                 # Single fix gate
│   ├── run-overnight.sh           # Autonomous loop
│   └── seal-evals.sh              # Hash-seal eval integrity
├── evals/
│   ├── harness.ts                 # Eval orchestrator
│   ├── l1-assertions.ts           # Deterministic checks
│   ├── l2-judges.ts               # LLM binary judges
│   ├── security-gates.ts          # Security hard gates
│   ├── scanners/python.ts         # Python defect patterns
│   └── l2_judge_prompts/*.json    # Judge prompt configs
├── programs/*.md                  # Program.md per dimension
├── deploy/                        # Production target state
│   ├── docker/                    # Dockerfile, compose, init.sql
│   ├── ci/                        # GitHub Actions pipeline
│   └── infra/                     # Terraform AWS module
└── target/demo-app/               # Demo project with ~30 defects
```

## Key Decisions Already Made

- **Language:** TypeScript (ESM, strict mode)
- **LLM:** Claude Sonnet via direct API (not SDK — keeps deps minimal)
- **Eval approach:** Binary per defect, not numeric quality scores
- **Fix discipline:** One defect per commit, auto-revert on failure
- **Behavioral preservation:** Command-output snapshot comparison
- **Score:** Weighted composite, P0 caps at 50%, monotonic ratchet
- **Licensing:** MIT
- **Target audience:** Vibe coders scared of launching with security holes
- **Positioning:** "Security scanners tell you what's broken. V2P fixes it while you sleep."
