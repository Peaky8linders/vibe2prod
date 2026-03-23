---
name: audit-full
version: 1.0.0
description: |
  Meta-skill that orchestrates a full compliance audit by dispatching audit-sec,
  audit-priv, and audit-quality as parallel Agent subagents. Aggregates all
  findings, computes a weighted compliance score across all 10 ISO/IEC 42001
  domains, and presents a summary dashboard to the user.
  Use when: "full audit", "compliance scan", "run all scanners",
  "comprehensive audit", "compliance score".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# audit-full — Full Compliance Audit Orchestrator

Dispatch all three scanner skills in parallel, aggregate findings, compute
compliance score, and present a unified summary.

## Phase 1 — Pre-flight

1. Read `program.md` (or the active program file) to identify the target directory.
2. Verify the target directory exists and contains source files.
3. Initialize (or clear) a session-scoped findings buffer.
4. Record scan start timestamp.

## Phase 2 — Parallel Scanner Dispatch

Spawn three **Agent** subagents in parallel, each executing one scanner skill:

1. **Agent: audit-sec** — Security scanner covering Domains 3, 5, 6, 7, 9.
   Instruction: "Run the audit-sec skill against `<target-dir>`. Write findings to `findings.jsonl`. Return the finding count by severity and completion status."

2. **Agent: audit-priv** — Privacy scanner covering Domains 4, 8, 10.
   Instruction: "Run the audit-priv skill against `<target-dir>`. Write findings to `findings.jsonl`. Return the finding count by severity and completion status."

3. **Agent: audit-quality** — Quality scanner covering Domains 1, 2, 3.
   Instruction: "Run the audit-quality skill against `<target-dir>`. Write findings to `findings.jsonl`. Return the finding count by severity and completion status."

Wait for all three to complete. If any agent reports BLOCKED, note it but continue with available results.

## Phase 3 — Findings Aggregation

1. Read the full `findings.jsonl` file.
2. Deduplicate entries by `{scanner, file, line, control}` tuple.
3. Group findings by:
   - **Domain** (1-10)
   - **Severity** (P0, P1, P2, P3)
   - **Scanner** (audit-sec, audit-priv, audit-quality)
4. Compute counts:
   - `total_findings`
   - `p0_count`, `p1_count`, `p2_count`, `p3_count`
   - `findings_by_domain` (dict of domain_id -> count)
   - `findings_by_scanner` (dict of scanner -> count)

## Phase 4 — Compliance Score Computation

Compute a weighted compliance score using domain weights from the preset YAML files.

For each domain (1-10):
1. Load the domain preset to get the control count and weight.
2. Count findings for that domain.
3. Compute domain score: `max(0, 100 - (p0_count * 25 + p1_count * 10 + p2_count * 5 + p3_count * 1))`
4. Apply domain weight.

Overall score: `sum(domain_score * domain_weight) / sum(domain_weights)`

Score thresholds:
- **90-100**: Production Ready
- **70-89**: Needs Remediation (minor gaps)
- **50-69**: Significant Gaps (major remediation needed)
- **0-49**: Not Ready (critical defects)

## Phase 5 — Summary Presentation

Use **AskUserQuestion** to present the final audit summary:

```
=== AI COMPLIANCE AUDIT SUMMARY ===

Target: <target-dir>
Scan duration: <elapsed>
Scanners: audit-sec (DONE), audit-priv (DONE), audit-quality (DONE)

COMPLIANCE SCORE: <score>/100 — <threshold label>

FINDINGS BY SEVERITY:
  P0 (Critical): <n>
  P1 (High):     <n>
  P2 (Medium):   <n>
  P3 (Low):      <n>
  Total:         <n>

DOMAIN BREAKDOWN:
  D1  Governance:       <score>/100  (<n> findings)
  D2  Risk Management:  <score>/100  (<n> findings)
  D3  Model Lifecycle:  <score>/100  (<n> findings)
  D4  Data Security:    <score>/100  (<n> findings)
  D5  Model Integrity:  <score>/100  (<n> findings)
  D6  Access Control:   <score>/100  (<n> findings)
  D7  Infrastructure:   <score>/100  (<n> findings)
  D8  Monitoring:       <score>/100  (<n> findings)
  D9  Supply Chain:     <score>/100  (<n> findings)
  D10 Compliance:       <score>/100  (<n> findings)

TOP P0 FINDINGS (up to 5):
  1. <control-id> — <file>:<line> — <evidence summary>
  ...

Would you like to:
  (a) Run audit-fix to auto-remediate findings
  (b) Export full report
  (c) Launch dashboard
  (d) Done for now
```

## Phase 6 — Post-Audit Actions

Based on user response:
- **(a)** Suggest running the `audit-fix` skill.
- **(b)** Write a Markdown report to `reports/audit-<timestamp>.md`.
- **(c)** Suggest running the `audit-dashboard` skill.
- **(d)** Finalize.

## Completion Protocol

- **DONE** — All three scanners completed, compliance score >= 90.
- **DONE_WITH_CONCERNS** — All scanners completed, score < 90 or P0 findings exist.
- **BLOCKED** — One or more scanners returned BLOCKED with no findings.

Report final status and the path to `findings.jsonl`.
