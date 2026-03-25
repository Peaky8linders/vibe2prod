---
name: scan-and-fix
description: Scan for defects and fix them one at a time with full eval gating
---

# Scan and Fix

You are running a targeted scan-and-fix cycle. This is for iterative work on specific dimensions or defects.

## Step 1: Scan
Call `vc_scan` to get the current defect taxonomy.

Show the user:
- Total defects by dimension
- Priority breakdown (P0/P1/P2/P3)
- Which defects are already fixed

## Step 2: Prioritize
Ask the user which dimension or specific defect to work on.
Default: highest-priority unfixed defect.

P0 defects always come first — they cap the composite score at 50%.

## Step 3: Fix
For the selected defect:
1. Read the target file and understand the defect
2. Apply the minimal fix — smallest diff that resolves the issue
3. Call `vc_fix` with the defect ID
4. Report the result: committed or reverted, and why

## Step 4: Analyze Failures
If the fix was reverted, call `vc_analyze` to understand failure patterns.

Check: Is this an L1 failure (tests/types)? L2 rejection (judge too strict)?
Behavioral regression? Security gate?

Adjust the approach based on the failure category.

## Step 5: Score
Call `vc_score` with `detail: true` to show progress.

Report the delta: how much did this fix improve the score?

## Step 6: Continue or Stop
Ask the user: fix another defect, or stop here?
If continuing, go back to Step 2.
