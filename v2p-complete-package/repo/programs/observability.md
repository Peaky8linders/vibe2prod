# Observability Hardening

## Target Scope
target/src/**/*.ts

## Fixed Budget
90 seconds per fix attempt

## Primary Metric
observability_coverage = count(handlers_with_structured_logging) / count(total_handlers)
Must be > current baseline.

## Defect Selection
Filter `evals/defect-taxonomy.json` to dimension: `observability`. One defect per attempt.

## Hard Gates (L1)
- All existing tests pass
- `tsc --noEmit` zero errors
- No secrets in diff
- No `console.log` in production code (replace, don't add)

## Soft Gates (L2)
LLM judge: "Can a production incident on this endpoint be debugged from logs alone?"
- Uses structured logger (pino, winston, bunyan — not console.*)?
- Logs on handler entry with request context (method, path, request ID)?
- Logs on handler exit with response status and duration?
- Logs on error with error type, message, and relevant business context?
- No PII in logs (no raw email, no raw user input, no tokens)?

Required: ≥ 85% pass rate.

## Patterns to Apply

### Replace console.log with structured logger
```typescript
import pino from 'pino';
const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Before: console.log('User created', user)
// After:
logger.info({ userId: user.id, action: 'user_created' }, 'User created');
```

### Request context middleware
```typescript
import { randomUUID } from 'node:crypto';

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] ?? randomUUID();
  req.logger = logger.child({ requestId: req.requestId });
  const start = Date.now();
  res.on('finish', () => {
    req.logger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    }, 'request completed');
  });
  next();
});
```

### Health endpoint
```typescript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});
```

## Experiment Protocol
1. Read defect taxonomy — pick highest-priority unfixed OB-* defect
2. If no structured logger exists yet, first fix = add logger setup + request middleware
3. Then replace console.* calls one handler at a time
4. Run: `bash scripts/run-fix.sh --defect-id <id>`
