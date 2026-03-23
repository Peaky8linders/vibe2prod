---
name: audit-fix
version: 1.0.0
description: |
  Autofix skill implementing the Karpathy autoresearch loop pattern. Reads
  findings.jsonl, picks the highest-priority unfixed finding, generates a
  minimal fix, gates on tests + re-scan, then commits or reverts. Logs every
  attempt to ledger.tsv. Iterates until all fixable findings are resolved or
  max attempts are exhausted.
  Use when: "fix findings", "auto-remediate", "autofix", "fix compliance issues",
  "remediation loop".
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# audit-fix — Autofix Loop

Implement the Karpathy autoresearch loop: read policy, pick a defect, hypothesize
a fix, apply it, gate it, commit or revert, log everything. Repeat.

## Phase 1 — Policy & Context Loading

1. Read `program.md` to understand the target codebase, constraints, and conventions.
2. Read `findings.jsonl` and filter to findings with `status != "fixed"`.
3. Read `ledger.tsv` if it exists, to understand prior fix attempts and failures.
4. Sort unfixed findings by priority: P0 first, then P1, P2, P3. Within same severity, prefer findings with fewer prior failed attempts.

## Phase 2 — Finding Selection

1. Pick the highest-priority unfixed finding that has fewer than 3 prior failed attempts.
2. If no eligible findings remain, report completion and exit.
3. Log selection to stdout: `[audit-fix] Selected: <control-id> in <file>:<line> (severity: <P*>)`

## Phase 3 — Hypothesis Formation

1. Read the target file and surrounding context (50 lines above and below the finding location).
2. Read the remediation guidance from the finding entry.
3. Form a hypothesis for the minimal fix. The fix must:
   - Address the specific defect described in the finding
   - Be the smallest diff that resolves the issue
   - Not change unrelated code
   - Not introduce `any` types, `@ts-ignore`, `eslint-disable`, or other suppressions
   - Not change existing API contracts
4. Log the hypothesis: `[audit-fix] Hypothesis: <one-line description of planned change>`

## Phase 4 — Fix Application

1. Apply the fix using Edit (preferred) or Write (for new files only).
2. Keep a record of all files modified for potential revert.

## Phase 5 — Gate: Tests

1. Run the project test suite: `npm test`, `pytest`, or equivalent.
2. If tests fail:
   - Log the failure reason.
   - Revert all changes: `git checkout -- <modified files>`
   - Record the failed attempt in `ledger.tsv`.
   - Return to Phase 2 to try the next finding or a different approach.

## Phase 6 — Gate: Re-scan

1. Run a targeted re-scan of the specific scanner that produced the finding.
   Use an **Agent** subagent: "Re-scan `<file>` for `<control-id>` using `<scanner>`. Report if the finding is resolved."
2. If the finding still appears:
   - Log the failure reason.
   - Revert all changes.
   - Record the failed attempt in `ledger.tsv`.
   - Return to Phase 2.

## Phase 7 — Commit

1. All gates passed. Stage the changed files: `git add <modified files>`
2. Commit with message format:
   ```
   fix(<domain>): <control-id> — <short description>
   ```
   Example: `fix(access-control): INFRA-003 — add rate limiting to /api/inference endpoint`
3. Update the finding status in `findings.jsonl` to `"fixed"`.
4. Append success entry to `ledger.tsv`:
   ```
   <timestamp>\t<control-id>\t<severity>\t<file>\tfix\t<commit-hash>\t<hypothesis>
   ```

## Phase 8 — Loop or Complete

1. Check remaining unfixed findings count.
2. If findings remain and we have not exceeded the session fix limit (default: 10):
   - Return to Phase 2.
3. If no findings remain or limit reached:
   - Proceed to completion.

## Phase 9 — Summary & Human Review

Use **AskUserQuestion** to present the fix session summary:

```
=== AUTOFIX SESSION SUMMARY ===

Findings processed: <n>
Successfully fixed:  <n>
Failed attempts:     <n>
Skipped (max retries): <n>
Remaining unfixed:   <n>

FIXES APPLIED:
  1. <commit-hash> fix(<domain>): <control-id> — <description>
  2. ...

FAILED/SKIPPED:
  1. <control-id> — <failure reason> (attempts: <n>/3)
  ...

Would you like to:
  (a) Continue fixing remaining findings
  (b) Run full re-audit to verify
  (c) Done for now
```

## Ledger Format

`ledger.tsv` is append-only with columns:
```
timestamp	control_id	severity	file	outcome	commit_hash	hypothesis
```

Outcomes: `fix` (success), `revert-test-fail`, `revert-rescan-fail`, `skip-max-retries`

## Completion Protocol

- **DONE** — All eligible findings fixed, all gates passing.
- **DONE_WITH_CONCERNS** — Some findings fixed, others failed or skipped.
- **BLOCKED** — No findings.jsonl found, tests not runnable, or git not available.

Report final status, fixes applied count, and remaining unfixed count.
