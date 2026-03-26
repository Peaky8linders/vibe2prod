---
name: perf-audit
description: Full performance audit — scan for latency antipatterns and auto-fix critical issues
---

# Performance Audit

You are running a comprehensive performance audit. This skill combines the performance scanner, observability scanner, and API contract scanner to find and fix latency issues.

## Step 1: Scan

Run all three production-readiness scanners:
1. Call `vc_scan_perf` — performance antipatterns (N+1, sync blocking, missing pagination)
2. Call `vc_scan_observability` — observability gaps (missing tracing, health checks)
3. Call `vc_scan_api` — API contract issues (missing validation, inconsistent errors)

## Step 2: Prioritize

Show the user a consolidated report:
- Total findings by scanner
- Priority breakdown: P0 (critical) → P3 (nice-to-have)
- Top 5 files by finding density

Recommend fixing P0 issues first — they have the highest production impact.

## Step 3: Fix P0 Issues

For each P0 finding:
1. Read the target file and understand the antipattern
2. Apply the minimal fix from the scanner's `fix_hint`
3. Common P0 fixes:
   - **N+1 → Batch**: Collect IDs, use `WHERE id IN (...)`
   - **Sync I/O → Async**: Replace readFileSync with fs/promises
   - **Empty catch → Log**: Add error logging to catch blocks
   - **No validation → Zod**: Add schema validation to request handlers

## Step 4: Fix P1 Issues

For each P1 finding:
1. Apply the fix if it's straightforward (< 10 lines changed)
2. Skip complex refactors — note them for the user
3. Common P1 fixes:
   - **Unbounded query → LIMIT**: Add LIMIT clause
   - **No timeout → Timeout**: Add AbortSignal.timeout()
   - **No health check → Add endpoint**: Create GET /health
   - **No request ID → Middleware**: Add request ID propagation

## Step 5: Score

Call `vc_score` with `detail: true` to show the impact of fixes.

Report:
- Before/after readiness score
- Findings resolved vs remaining
- Estimated latency improvement (qualitative: "eliminated N+1 queries in 3 files")

## Step 6: Generate Report

Call `vc_report` to generate a stakeholder report including performance findings.
