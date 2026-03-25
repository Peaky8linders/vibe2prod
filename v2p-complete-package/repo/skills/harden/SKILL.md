---
name: harden
description: Zero-config production hardening — scan, fix, and verify in one workflow
---

# Harden Workflow

You are running the VibeCheck production hardening pipeline. Follow these steps exactly.

## Step 1: Check Status
Call `vc_status` to see if a target project is loaded and current state.

If no target is loaded, ask the user for the path to their project.

## Step 2: Scan for Defects
Call `vc_scan` to discover production readiness defects.

Report the results: total defects found, breakdown by dimension and priority.
Highlight any P0 defects — these block deployment.

## Step 3: Run Via Negativa
Call `vc_subtract` to find attack surface that should be removed.

Report findings: unused dependencies, unreferenced endpoints, overly broad config.

## Step 4: Show Current Score
Call `vc_score` with `detail: true` to show per-dimension breakdown.

## Step 5: Fix Loop
For each unfixed defect (highest priority first):
1. Apply the minimal fix
2. Call `vc_fix` with the defect ID
3. If committed — move to next defect
4. If reverted — try a different approach (max 3 attempts)
5. After 3 failures — skip and flag for human review

## Step 6: Chaos Test
Call `vc_chaos` to verify fixes hold under adversarial conditions.

Report chaos resilience percentage and any failures.

## Step 7: Final Score
Call `vc_score` with `detail: true, antifragile: true` to show the final antifragility score.

## Step 8: Generate Report
Call `vc_report` to produce the stakeholder HTML report.

Tell the user where the report was saved and summarize the results.
