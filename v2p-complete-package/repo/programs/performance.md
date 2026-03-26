# Performance Hardening

## Target Scope
target/src/**/*.ts
target/src/**/*.js

## Fixed Budget
90 seconds per fix attempt

## Primary Metric
performance_score = count(performance_checks_passing) / count(total_performance_checks)
Must be > current baseline.

## Defect Selection
Filter `evals/defect-taxonomy.json` to dimension: `performance`. One defect per attempt.
P0 defects (N+1 queries, sync blocking) get worked first — always.

## Hard Gates (L1)
- All existing tests pass
- No new synchronous file I/O in async handlers
- No unbounded database queries (missing LIMIT)
- No N+1 query patterns in loops
- Request timeouts on all external calls

## Soft Gates (L2)
LLM judge: "Does this code handle scale and latency correctly?"
- Database queries are batched, not per-iteration?
- External calls have timeout and error handling?
- Large datasets paginated, not returned in full?
- Connection pooling configured?
- Response payloads are reasonably sized?

## Common Fixes
1. **N+1 → Batch**: Collect IDs in loop, query with `WHERE id IN (...)`
2. **Sync → Async**: Replace readFileSync with fs/promises
3. **Unbounded → Paginated**: Add LIMIT/OFFSET or cursor-based pagination
4. **No timeout → Timeout**: Add AbortSignal.timeout() to fetch calls
5. **Sequential → Parallel**: Collect promises, use Promise.all()
6. **No pool → Pool**: Configure min/max connections
7. **No compression → Compression**: Add compression middleware
8. **No cache headers → Cache**: Set Cache-Control for static assets
