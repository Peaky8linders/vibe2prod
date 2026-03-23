---
name: audit-quality
version: 1.0.0
description: |
  AI code quality audit scanner covering error handling, input validation,
  test coverage, documentation, API versioning, and change management.
  Maps to EU AI Act and ISO/IEC 42001 Domains 1 (Governance & Accountability),
  2 (Risk Management), and 3 (Model Lifecycle Management).
  Produces findings with severity, evidence, and remediation specs.
  Use when: "quality audit", "code review", "check error handling",
  "test coverage check", "documentation audit", "lint check".
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# audit-quality — Code Quality Scanner

Scan the target codebase for quality defects across three compliance domains.
Output is append-only `findings.jsonl` entries with structured evidence.

## Phase 1 — Discovery & Project Structure

1. Read `program.md` (or the active program file) to identify the target directory and tech stack.
2. Glob for all source files. Build a file manifest with file counts by type.
3. Identify the build system: `tsconfig.json`, `package.json` scripts, `Makefile`, etc.
4. Identify the test framework: Jest, Vitest, pytest, Go test, etc.
5. Identify linting config: `.eslintrc`, `biome.json`, `ruff.toml`, `.prettierrc`, etc.

## Phase 2 — Error Handling Patterns (Domain 2)

1. Grep for bare catch blocks that swallow errors:
   - `catch (e) {}` or `catch {}` with empty bodies
   - `catch` blocks that only log but don't re-throw or handle
   - `.catch(() => {})` promise swallowing
2. Check for unhandled promise rejections: async functions without try/catch or `.catch()`.
3. Check for global error handlers: `process.on('uncaughtException')`, `window.onerror`.
4. Check for graceful shutdown handlers: `SIGTERM`, `SIGINT` handling.
5. Check for timeout configuration on external calls (HTTP, DB, LLM API).
6. Emit findings with `scanner: "error-handling-scanner"`, domain 2:
   ```json
   {"scanner":"error-handling-scanner","domain":2,"control":"RISK-*","severity":"P1",
    "file":"<path>","line":<n>,"evidence":"<pattern description>",
    "remediation":"<specific fix>"}
   ```

## Phase 3 — Input Validation (Domain 2)

1. Grep for API route handlers and check for input validation:
   - Zod, Joi, yup, or class-validator schemas on request bodies
   - Type narrowing or runtime type checks
   - Size limits on request bodies and file uploads
2. Check for SQL parameterization (no string interpolation in queries).
3. Check for path traversal protection on file operations.
4. Check for content-type validation on incoming requests.
5. Emit findings with `scanner: "validation-scanner"`, domain 2.

## Phase 4 — Test Coverage & Quality (Domain 3)

1. Check for test files: `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`.
2. Compute test-to-source ratio (number of test files vs. source files).
3. If available, run test coverage command and parse the output.
4. Check for critical path coverage: do API handlers, auth logic, and data mutation functions have tests?
5. Check for integration/e2e tests vs. only unit tests.
6. Check for test quality antipatterns:
   - Tests with no assertions
   - Tests that only check truthiness (`expect(result).toBeTruthy()`)
   - Snapshot tests without meaningful structure
7. Emit findings with `scanner: "test-coverage-scanner"`, domain 3.

## Phase 5 — TypeScript Strict Mode & Lint (Domain 1)

1. Read `tsconfig.json` and check for strict mode settings:
   - `strict: true` or individual flags (`noImplicitAny`, `strictNullChecks`, etc.)
   - `noUncheckedIndexedAccess`
   - `exactOptionalPropertyTypes`
2. Run `npx tsc --noEmit` and capture type errors. Count and categorize them.
3. Run the project linter (`eslint`, `biome check`, etc.) and capture violations.
4. Check for `@ts-ignore`, `@ts-expect-error`, `any` type usage, `eslint-disable` comments.
5. Emit findings with `scanner: "strictness-scanner"`, domain 1.

## Phase 6 — Documentation & API Versioning (Domain 1)

1. Check for API documentation: OpenAPI/Swagger spec, JSDoc on handlers, README with API section.
2. Check for API versioning: `/v1/`, version headers, or versioned module structure.
3. Check for change management artifacts: CHANGELOG, migration scripts, deprecation notices.
4. Check for inline documentation density: ratio of JSDoc/docstring comments to exported functions.
5. Emit findings with `scanner: "documentation-scanner"`, domain 1.

## Phase 7 — Findings Consolidation & Human Review

1. Read all emitted findings from this scan session.
2. Deduplicate findings by file + line + control.
3. Sort by severity: P0 > P1 > P2 > P3.
4. For any P0 finding (e.g., TypeScript strict mode off, zero test coverage), use **AskUserQuestion**:
   ```
   [P0 QUALITY FINDING] <control-id>
   File: <path>:<line>
   Evidence: <description>
   Impact: <what breaks or degrades without this>
   Recommended action: <remediation>
   Should this be flagged for immediate fix? (yes/skip/false-positive)
   ```
5. Append all confirmed findings to `findings.jsonl`.

## Completion Protocol

- **DONE** — All scanners completed, strict mode on, tests exist, zero P0 findings.
- **DONE_WITH_CONCERNS** — Scanners completed, quality gaps exist and are logged.
- **BLOCKED** — Target directory unreadable, no recognized project structure.

Report the final status, total finding count by severity, and the path to `findings.jsonl`.
