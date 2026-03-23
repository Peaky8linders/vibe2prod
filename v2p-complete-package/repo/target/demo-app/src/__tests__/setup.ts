// Set environment variables before any module imports
process.env.JWT_SECRET = 'test-jwt-secret-for-vitest';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
process.env.WEBHOOK_SECRET = 'test-webhook-secret';
process.env.SYNC_API_KEY = 'test-sync-api-key';
// Use port 0 so each listen() gets a random available port (avoids EADDRINUSE)
process.env.PORT = '0';
