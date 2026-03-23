# Security Hardening

## Target Scope
target/src/**/*.ts
target/.env* (to move secrets to env vars)

## Fixed Budget
90 seconds per fix attempt

## Primary Metric
security_score = count(security_checks_passing) / count(total_security_checks)
Must be > current baseline.

## Defect Selection
Filter `evals/defect-taxonomy.json` to dimension: `security`. One defect per attempt.
P0 defects (secrets in source, SQL injection) get worked first — always.

## Hard Gates (L1)
- All existing tests pass
- No secrets in source (gitleaks patterns)
- No new network calls to non-allowlisted domains
- No auth middleware removed in diff
- Dependency audit clean (no critical/high vulns)

## Soft Gates (L2)
LLM judge: "Does this endpoint enforce security correctly?"
- Authentication required before any data access?
- Authorization checked (role/permission) for protected resources?
- No internal state leaked in error responses?
- Parameterized queries only (no string concatenation)?
- Rate limiting on mutation endpoints?
- CORS restricted to specific origins (not `*`)?

Required: ≥ 85% pass rate.

## Priority Order
1. **P0: Remove hardcoded secrets** → move to environment variables
2. **P0: Fix SQL injection** → parameterized queries
3. **P1: Add auth middleware** → to unprotected endpoints
4. **P1: Restrict CORS** → specific origins only
5. **P1: Add rate limiting** → to mutation endpoints
6. **P2: Add CSP headers** → helmet middleware
7. **P2: Error response sanitization** → no stack traces to client

## Patterns to Apply

### Move secrets to env vars
```typescript
// Before: const apiKey = 'sk-abc123...'
// After:
const apiKey = process.env.EXTERNAL_API_KEY;
if (!apiKey) throw new Error('EXTERNAL_API_KEY not set');
```

### Parameterized queries
```typescript
// Before: db.query(`SELECT * FROM users WHERE id = ${id}`)
// After:
db.query('SELECT * FROM users WHERE id = $1', [id]);
```

### Restrict CORS
```typescript
import cors from 'cors';
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
}));
```

## Experiment Protocol
1. Read defect taxonomy — pick highest-priority unfixed SEC-* defect
2. P0 defects MUST be fixed before any P1/P2 work
3. Apply minimal fix
4. Run: `bash scripts/run-fix.sh --defect-id <id>`
