---
name: post-migration
description: Post-migration production hardening — scan migrated code, compute trust score, generate fix prompts
---

# Post-Migration Hardening

You are running VibeCheck as a post-migration hardening step after MigrationForge has generated modern code. The goal is to take migrated code from "functionally correct" to "production ready and compliant."

## Step 1: Detect Migration Context
Check if the project has a MigrationForge pipeline state:
- Look for `migration/pipeline_state.json`
- If found: read phase, wave, and module status
- If not found: treat as a standalone vibe-coded project

## Step 2: Run End-to-End Scan
Call `vc_scan` with the project path or use `vibecheck scan:e2e --path <project-path> --report`.

This scans every file individually and produces:
- Per-file readiness scores
- Per-file defect lists with line numbers
- Maturity levels (critical / needs-work / mostly-clean / hardened)

## Step 3: Review Critical Findings
Focus on P0 and P1 defects first:

**P0 (blocks deploy):**
- Hardcoded secrets → move to environment variables
- SQL injection → parameterized queries
- Missing authentication on data endpoints

**P1 (must fix):**
- External calls without error handling
- Mutation endpoints without input validation
- No structured logging
- Missing database transactions

## Step 4: Apply Fixes Per Dimension
Use the generated actionable skills from the scan report. Each skill targets one dimension across all affected files:

1. `fix-security` — Secrets, injection, auth, CORS
2. `fix-error-handling` — Try/catch, timeouts, error propagation
3. `fix-input-validation` — Zod/Pydantic schemas, type safety
4. `fix-observability` — Structured logging, request context
5. `fix-data-integrity` — Transactions, constraints

For each fix:
- Make the smallest change that resolves the defect
- Verify existing tests still pass
- One commit per defect: `fix(<dimension>): <id> — <description>`

## Step 5: Re-Scan and Verify
After fixes, re-run the scanner to verify:
- P0 count should be 0
- Readiness should be > 85%
- All critical files should be resolved

## Step 6: Compute Trust Score
If MigrationForge context exists, compute the enhanced trust score:
- VibeCheck Readiness (40%) + Security (30%) + Review Gates (30%)
- Grade: A (90+), B (75+), C (60+), D (40+), F (<40)

## Step 7: Generate Compliance Report
The final report includes:
- Overall trust score and grade
- Per-file readiness breakdown
- All defects found and fixed
- Actionable prompts for remaining work
- Migration module status (if MF context exists)
