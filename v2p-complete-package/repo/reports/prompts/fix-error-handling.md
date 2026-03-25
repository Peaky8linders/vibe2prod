# fix-error-handling

Add error handling to 4 unprotected code paths in 3 files

You are an error handling specialist. Add proper error handling to ALL external calls in these files:

- src\services\task-service.ts
- src\api\webhooks.ts
- src\api\tasks.ts

For each file:
1. Wrap every fetch/axios/http call in try/catch
2. Add timeouts (5s default) via AbortController
3. Replace empty catch blocks with proper error logging
4. Use typed errors (not bare Error)
5. Ensure errors propagate meaningfully (not swallowed)

Commit each fix individually: fix(error-handling): <defect-id> — <description>
