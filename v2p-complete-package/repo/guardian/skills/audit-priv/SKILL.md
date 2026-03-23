---
name: audit-priv
version: 1.0.0
description: |
  AI privacy audit scanner covering PII detection, GDPR compliance patterns,
  consent management, data retention, right-to-erasure support, and logging
  hygiene. Maps to EU AI Act and ISO/IEC 42001 Domains 4 (Data Security &
  Privacy), 8 (Monitoring & Logging), and 10 (Regulatory Compliance).
  Produces findings with severity, evidence, and remediation specs.
  Use when: "privacy audit", "GDPR check", "PII scan", "data protection review",
  "check consent management", "logging audit".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# audit-priv — Privacy Scanner

Scan the target codebase for privacy defects across three compliance domains.
Output is append-only `findings.jsonl` entries with structured evidence.

## Phase 1 — Discovery & Data Flow Mapping

1. Read `program.md` (or the active program file) to identify the target directory and tech stack.
2. Glob for all source files. Build a file manifest.
3. Identify data ingestion points: form handlers, API endpoints accepting user data, file uploads.
4. Identify data storage points: database models/schemas, file writes, cache usage.
5. Identify data egress points: API responses, logging calls, analytics/telemetry, third-party SDKs.

## Phase 2 — PII Detection Scanning (Domain 4)

1. Grep source code for PII patterns handled without encryption or masking:
   - Email regex patterns in plaintext storage
   - Phone number handling without masking
   - SSN / national ID patterns
   - Credit card number patterns (Luhn-adjacent)
   - IP address logging
   - Geolocation data storage
   - Biometric data references
2. Check database schemas for PII columns missing encryption-at-rest annotations.
3. Check for PII in URL parameters or query strings.
4. Check for PII in error messages or stack traces returned to clients.
5. Emit findings with `scanner: "pii-scanner"`, domain 4:
   ```json
   {"scanner":"pii-scanner","domain":4,"control":"DATA-*","severity":"P1",
    "file":"<path>","line":<n>,"evidence":"<PII type> stored/transmitted without protection",
    "remediation":"Apply encryption, masking, or pseudonymization."}
   ```

## Phase 3 — GDPR Compliance Patterns (Domain 10)

1. Check for consent collection mechanisms:
   - Cookie consent banners or middleware
   - Terms acceptance tracking before data processing
   - Opt-in vs. opt-out defaults (GDPR requires opt-in)
2. Check for data subject rights implementation:
   - **Right to access** — endpoint or mechanism to export user data
   - **Right to erasure** — deletion endpoint or soft-delete with purge
   - **Right to portability** — data export in machine-readable format
   - **Right to rectification** — user data update endpoints
3. Check for lawful basis documentation in code comments or config.
4. Check for Data Protection Impact Assessment (DPIA) references for high-risk processing.
5. Emit findings with `scanner: "gdpr-scanner"`, domain 10.

## Phase 4 — Data Retention & Minimization (Domain 4)

1. Check for data retention policies in code or config:
   - TTL settings on database records
   - Scheduled cleanup jobs or cron tasks
   - Archive-then-delete patterns
2. Check for data minimization:
   - Are only necessary fields collected? (compare form fields vs. schema fields)
   - Are data fields pruned before long-term storage?
3. Check for purpose limitation: is collected data used only for its stated purpose?
4. Emit findings with `scanner: "retention-scanner"`, domain 4.

## Phase 5 — Logging & Monitoring Hygiene (Domain 8)

1. Grep all logging statements (`console.log`, `logger.*`, `print`, `logging.*`) for PII leakage:
   - User emails, names, or IDs in log messages
   - Request bodies logged in full (may contain PII)
   - Authentication tokens or session IDs in logs
2. Check for structured logging (JSON) vs. unstructured string concatenation.
3. Check for log level discipline: PII should never appear at INFO or DEBUG level.
4. Check for audit trail implementation: who accessed what data, when.
5. Check for log retention configuration and rotation.
6. Emit findings with `scanner: "logging-scanner"`, domain 8.

## Phase 6 — Findings Consolidation & Human Review

1. Read all emitted findings from this scan session.
2. Deduplicate findings by file + line + control.
3. Sort by severity: P0 > P1 > P2 > P3.
4. For any P0 finding (e.g., plaintext PII in logs, no consent mechanism), use **AskUserQuestion**:
   ```
   [P0 PRIVACY FINDING] <control-id>
   File: <path>:<line>
   Evidence: <description>
   Regulatory risk: <GDPR article or principle violated>
   Recommended action: <remediation>
   Should this be flagged for immediate fix? (yes/skip/false-positive)
   ```
5. Append all confirmed findings to `findings.jsonl`.

## Completion Protocol

- **DONE** — All scanners completed, zero P0 findings, GDPR basics present.
- **DONE_WITH_CONCERNS** — Scanners completed, privacy gaps exist and are logged.
- **BLOCKED** — Target directory unreadable or no data-handling code found.

Report the final status, total finding count by severity, and the path to `findings.jsonl`.
