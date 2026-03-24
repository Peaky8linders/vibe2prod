# Subtraction — Via Negativa Hardening

## Target Scope
target/src/**/*.ts
target/package.json
target/.env*

## Fixed Budget
60 seconds per fix attempt

## Primary Metric
attack_surface_removed = count(subtraction_defects_fixed) / count(total_subtraction_defects)
Must be > current baseline.

## Defect Selection
Filter `evals/defect-taxonomy.json` to dimension: `subtraction`. One defect per attempt.

## Core Principle
**Improve by removing, not adding.** The most secure code is code that doesn't exist.
Every unused endpoint, unnecessary dependency, overly broad permission, and dead code
path is attack surface — an opportunity for an attacker and a liability for the defender.

Removing one unused endpoint is more impactful than adding ten security checks.

## Hard Gates (L1)
- All existing tests pass
- No new network calls
- No auth middleware removed (intentional removal must be via subtraction defect)
- Existing API contracts unchanged (only removing genuinely unused endpoints)

## Soft Gates (L2)
LLM judge: "Does this removal reduce attack surface without breaking functionality?"
- Was the removed code genuinely unused (no callers, no test coverage)?
- Does removal break any existing import chain?
- Is the removal safe to deploy (no hidden dependencies)?
- Were permissions correctly narrowed (not removed entirely)?

Required: >= 85% pass rate.

## Priority Order
1. **P1: Remove unused dependencies** → `npm uninstall <dep>` — supply chain risk
2. **P1: Restrict overly broad CORS** → specific origins only
3. **P1: Remove error detail exposure** → generic error responses
4. **P2: Remove unreferenced endpoints** → dead API routes
5. **P2: Remove unused env vars** → reduce configuration surface
6. **P2: Strip health endpoint internals** → return only `{status: 'ok'}`
7. **P3: Clean debug markers** → remove TODO/FIXME/HACK in production code

## Patterns to Apply

### Remove unused dependency
```bash
npm uninstall <package-name>
# Verify: no imports reference it, tests still pass
```

### Restrict CORS
```typescript
// Before: app.use(cors())
// After:
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
  credentials: true,
}));
```

### Sanitize error responses
```typescript
// Before: res.status(500).json({ error: err.message, stack: err.stack })
// After:
res.status(500).json({ error: 'Internal server error' });
logger.error('Unhandled error', { error: err.message, stack: err.stack });
```

### Remove dead endpoint
```typescript
// Before: router.get('/api/debug/state', (req, res) => { ... })
// After: (delete the entire route definition)
// Verify: no tests reference this path, no client code calls it
```

### Strip health endpoint details
```typescript
// Before: res.json({ status: 'ok', uptime: process.uptime(), memory: process.memoryUsage() })
// After:
res.json({ status: 'ok' });
```

## Experiment Protocol
1. Read defect taxonomy — pick highest-priority unfixed SUB-* defect
2. Verify the code/config is genuinely unused (grep for references)
3. Remove it — smallest possible diff
4. Run: `bash scripts/run-fix.sh --defect-id <id>`
