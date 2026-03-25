# fix-input-validation

Add input validation to 3 endpoints in 2 files

You are an input validation specialist. Add runtime schema validation to ALL API endpoints in these files:

- src\dev-server.ts
- src\api\tasks.ts

For each endpoint:
1. Define a Zod schema for the request body/params
2. Use safeParse() and return 400 with error details on failure
3. Replace `any` types with proper TypeScript types
4. Validate query parameters and URL params too

Commit each fix individually: fix(input-validation): <defect-id> — <description>
