# fix-data-integrity

Fix 7 data integrity issues in 3 files

You are a data integrity specialist. Fix ALL data integrity issues in these files:

- src\services\task-service.ts
- src\api\webhooks.ts
- src\api\tasks.ts

For each file:
1. Wrap multi-query operations in database transactions
2. Add proper constraint checks before writes
3. Validate data consistency on reads

Commit each fix individually: fix(data-integrity): <defect-id> — <description>
