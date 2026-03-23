# Test Coverage Hardening

## Target Scope
target/src/**/*.ts
target/tests/**/*.ts (may create new test files)

## Fixed Budget
120 seconds per fix attempt (tests take longer to write + validate)

## Primary Metric
test_coverage = count(modules_with_tests) / count(total_exported_modules)
Must be > current baseline. Ratchet only.

## Defect Selection
Filter `evals/defect-taxonomy.json` to dimension: `test-coverage`. One defect per attempt.

## Hard Gates (L1)
- All existing tests still pass (never break existing tests)
- `tsc --noEmit` zero errors
- New test files must follow existing naming convention
- No `any` types in test files

## Soft Gates (L2)
LLM judge: "Does this test file adequately cover the module?"
- Tests the documented happy path?
- Tests at least one error/edge case?
- Uses descriptive test names that explain the scenario?
- Mocks external dependencies (no real network calls in tests)?
- Assertions check specific values (not just `toBeDefined`)?

Required: ≥ 85% pass rate.

## Rules
- Write tests for EXISTING behavior, not for behavior you wish existed
- If a function has unclear behavior, write a test that captures what it actually does
- Tests are behavioral contracts — they document and protect the prototype's current behavior
- Prefer integration-style tests (test the API endpoint, not internal helpers)
- One test file per source module

## Patterns

### API endpoint test
```typescript
import { describe, it, expect } from 'vitest'; // or jest
import request from 'supertest';
import { app } from '../src/app';

describe('GET /users/:id', () => {
  it('returns user by id', async () => {
    const res = await request(app).get('/users/1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 1);
  });

  it('returns 404 for missing user', async () => {
    const res = await request(app).get('/users/99999');
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid id', async () => {
    const res = await request(app).get('/users/not-a-number');
    expect(res.status).toBe(400);
  });
});
```

### Utility function test
```typescript
describe('parseConfig', () => {
  it('parses valid config', () => {
    const result = parseConfig({ port: '3000', host: 'localhost' });
    expect(result.port).toBe(3000);
    expect(result.host).toBe('localhost');
  });

  it('throws on missing required field', () => {
    expect(() => parseConfig({})).toThrow();
  });
});
```

## Experiment Protocol
1. Read defect taxonomy — pick highest-priority unfixed TC-* defect
2. Read the source module that needs tests
3. Understand what the module DOES (not what it should do)
4. Write tests that capture current behavior
5. Run: `bash scripts/run-fix.sh --defect-id <id>`
