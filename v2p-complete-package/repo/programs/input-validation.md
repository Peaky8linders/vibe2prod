# Input Validation Hardening

## Target Scope
target/src/**/*.ts — agent may modify any source file in target/src/

## Fixed Budget
90 seconds per fix attempt

## Primary Metric
validation_coverage = count(endpoints_with_runtime_schema_validation) / count(total_endpoints)
Must be > current baseline. Monotonic ratchet.

## Defect Selection
Read `evals/defect-taxonomy.json`. Filter to dimension: `input-validation`.
Pick highest-priority unfixed defect. One defect per attempt.

## Hard Gates (L1)
- All existing tests pass
- `tsc --noEmit` zero errors
- No secrets in diff
- No new `any` types — in fact, this pass should REMOVE `any` types
- No `@ts-ignore` or type assertions (`as any`, `as unknown as X`)

## Soft Gates (L2)
LLM judge evaluates: "Does this endpoint validate inputs correctly?"
- External input parsed with runtime schema (Zod, Joi, Yup)?
- Schema rejects invalid input with descriptive 4xx error?
- Validated output is typed (no `any` downstream)?
- URL params, query params, body, and headers each validated where used?
- No string concatenation in SQL/NoSQL queries (parameterized only)?

Required: ≥ 85% pass rate.

## Patterns to Apply

### API request bodies → Zod schema
```typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['admin', 'user', 'viewer']),
});

app.post('/users', async (req, res) => {
  const result = CreateUserSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Validation failed', details: result.error.flatten() });
  }
  const { email, name, role } = result.data;
  // ...
});
```

### Environment variables → validated at startup
```typescript
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_KEY: z.string().min(20),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

export const env = EnvSchema.parse(process.env);
```

### URL/query params → parsed before use
```typescript
const ParamsSchema = z.object({ id: z.string().uuid() });
const QuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
```

## Experiment Protocol
1. Read defect taxonomy — pick highest-priority unfixed IV-* defect
2. Read the target file
3. Determine the right validation approach (Zod schema, param parsing, etc.)
4. Apply minimal fix — add validation without changing the endpoint's behavior
5. Run: `bash scripts/run-fix.sh --defect-id <id>`
6. If committed → next defect. If reverted → retry (max 3), then skip.
