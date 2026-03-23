# Error Handling Hardening

## Target Scope
target/src/**/*.ts — agent may modify any source file in target/src/

## Fixed Budget
90 seconds per fix attempt (apply fix + run full eval suite)

## Primary Metric
error_handling_coverage = count(external_calls_with_proper_error_handling) / count(total_external_calls)
Must be > current baseline. Monotonic ratchet.

## Defect Selection
Read `evals/defect-taxonomy.json`. Filter to dimension: `error-handling`.
Pick highest-priority unfixed defect. Work on exactly ONE defect per attempt.

## Hard Gates (L1)
- All existing tests pass (behavioral preservation)
- `tsc --noEmit` passes with zero errors
- No secrets in diff
- No new `any` types introduced
- No `console.log` in production code
- No `@ts-ignore` or `eslint-disable` added

## Soft Gates (L2)
LLM judge evaluates: "Does this error handler:"
- Catch specific error types (not bare `catch(e)`)?
- Return appropriate HTTP status codes?
- Log structured error context (not just `console.error(e)`)?
- Not leak internal details (stack traces, file paths) to the caller?
- Include retry logic for transient failures (network, timeout)?

Binary pass/fail per endpoint. Required: ≥ 85% pass rate.

## What "Fixed" Looks Like

### Before (vibe code)
```typescript
app.get('/users/:id', async (req, res) => {
  const user = await db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);
  const enriched = await fetch(`https://api.external.com/enrich/${user.email}`);
  res.json({ ...user, ...enriched });
});
```

### After (production)
```typescript
app.get('/users/:id', async (req, res) => {
  try {
    const id = UserIdSchema.parse(req.params.id);
    const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let enriched = {};
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`https://api.external.com/enrich/${user.email}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      enriched = await response.json();
    } catch (enrichError) {
      logger.warn({ userId: id, error: enrichError }, 'Enrichment failed — returning base user');
      // Graceful degradation: return user without enrichment
    }

    res.json({ ...user, ...enriched });
  } catch (error) {
    logger.error({ error, params: req.params }, 'Failed to fetch user');
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

## Experiment Protocol
1. Read defect taxonomy — pick highest-priority unfixed EH-* defect
2. Read the target file containing the defect
3. Form hypothesis: what's the minimal fix? (log it)
4. Apply fix — smallest diff that resolves the defect
5. Run: `bash scripts/run-fix.sh --defect-id <id>`
6. If committed → mark defect as fixed in taxonomy, move to next
7. If reverted → try different approach (max 3 attempts), then skip
