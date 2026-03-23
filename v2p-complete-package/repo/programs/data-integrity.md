# Data Integrity Hardening

## Target Scope
target/src/**/*.ts
target/migrations/**/*.ts (may create new migration files)
target/prisma/schema.prisma or equivalent ORM config

## Fixed Budget
120 seconds per fix attempt

## Primary Metric
data_integrity_score = count(data_checks_passing) / count(total_data_checks)
Must be > current baseline.

## Defect Selection
Filter `evals/defect-taxonomy.json` to dimension: `data-integrity`. One defect per attempt.

## Hard Gates (L1)
- All existing tests pass
- `tsc --noEmit` zero errors
- Migrations are reversible (up + down)
- Schema matches ORM models

## Soft Gates (L2)
LLM judge: "Does this data operation maintain integrity?"
- Foreign key constraints defined for relationships?
- Indices on columns used in WHERE/JOIN clauses?
- Concurrent write paths use transactions or optimistic locking?
- No orphaned records possible (cascade delete or restrict)?
- Input data sanitized before persistence?

Required: ≥ 85% pass rate.

## Priority Order
1. **P0: Race conditions** on concurrent writes (double-spend, duplicate creation)
2. **P1: Missing constraints** (foreign keys, unique, not-null)
3. **P1: Missing indices** on query patterns
4. **P2: Missing transactions** for multi-step operations
5. **P2: No backup/recovery** strategy documented

## Patterns

### Add transaction for multi-step operation
```typescript
// Before: two separate writes that can partially fail
await db.insert(orders).values(order);
await db.update(inventory).set({ quantity: sql`quantity - ${qty}` });

// After: atomic transaction
await db.transaction(async (tx) => {
  await tx.insert(orders).values(order);
  await tx.update(inventory).set({ quantity: sql`quantity - ${qty}` });
});
```

### Add optimistic locking
```typescript
const result = await db.update(accounts)
  .set({ balance: newBalance, version: sql`version + 1` })
  .where(and(eq(accounts.id, id), eq(accounts.version, currentVersion)));

if (result.rowCount === 0) {
  throw new ConflictError('Account was modified concurrently');
}
```

### Add missing index
```sql
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
```

## Experiment Protocol
1. Read defect taxonomy — pick highest-priority unfixed DI-* defect
2. Identify the data operation and its failure mode
3. Apply minimal fix (add constraint, transaction, or index)
4. Run: `bash scripts/run-fix.sh --defect-id <id>`
