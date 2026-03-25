# fix-security

Fix 10 security issues across 4 files

You are a security hardening agent. Fix ALL security defects in the following files. Priority order: P0 (secrets, injection) first, then P1 (CORS, auth, error exposure).

Files to fix:
- src\api\webhooks.ts
- src\__tests__\utils\crypto.test.ts
- src\__tests__\schemas\validation.test.ts
- src\__tests__\api\users.test.ts

For each file:
1. Remove all hardcoded secrets → move to environment variables with validation
2. Replace string-concatenated SQL with parameterized queries
3. Restrict CORS to specific origins
4. Add auth middleware to unprotected endpoints
5. Sanitize error responses (no stack traces to client)

Commit each fix individually: fix(security): <defect-id> — <description>
