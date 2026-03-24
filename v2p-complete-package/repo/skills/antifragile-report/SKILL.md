---
name: antifragile-report
description: Generate a complete antifragility assessment — robustness, chaos resilience, and production adaptation
---

# Antifragile Report

You are generating a comprehensive antifragility assessment. This goes beyond static readiness to measure how much stronger the system gets from stress.

## Step 1: Baseline Score
Call `v2p_score` with `detail: true, antifragile: true`.

Report the three components:
- **Robustness (0-40)**: How many known defects are fixed
- **Chaos Freshness (0-30)**: How recently chaos testing was run and how well the system performed
- **Production Adaptation (0-30)**: How many production-discovered issues were fixed

## Step 2: Run Chaos Testing
Call `v2p_chaos` to run adversarial probes.

Report:
- Total probes run
- Pass/fail/warning breakdown
- Chaos resilience percentage
- Any P0/P1 failures that need immediate attention

## Step 3: Via Negativa Analysis
Call `v2p_subtract` to find attack surface to remove.

Report what can be removed to reduce attack surface.

## Step 4: Check Production Signals
Call `v2p_learn` to see if there are production sentinel events to process.

If events exist, report what patterns were observed and what new defects were discovered.

## Step 5: Judge Health Check
Call `v2p_judges_audit` to check eval judge accuracy.

Report any judges flagged for recalibration.

## Step 6: Error Analysis
Call `v2p_analyze` with `detail: true` to review hardening loop failures.

Report the top failure categories and recommendations.

## Step 7: Updated Score
Call `v2p_score` with `detail: true, antifragile: true` again.

Present the final antifragility score with the badge text.

## Step 8: Summary
Synthesize all findings into a concise executive summary:
- Current antifragility score and what it means
- Top risks (P0/P1 defects, flagged judges, low chaos resilience)
- Attack surface reduction opportunities
- Recommendations for improvement
