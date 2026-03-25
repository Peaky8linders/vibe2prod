# fix-observability

Replace 8 console.log calls with structured logging in 5 files

You are an observability specialist. Replace ALL console.log/debug/info calls with structured logging:

- src\index.ts
- src\dev-server.ts
- src\api\webhooks.ts
- src\api\users.ts
- src\api\tasks.ts

For each file:
1. Import a structured logger (pino or winston)
2. Replace console.log with logger.info/error/warn
3. Add request context (requestId, userId) to log entries
4. Log on entry/exit/error for each API handler
5. Never log PII (passwords, tokens, SSN)

Commit each fix individually: fix(observability): <defect-id> — <description>
