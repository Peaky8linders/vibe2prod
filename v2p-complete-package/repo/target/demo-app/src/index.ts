import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { taskRouter } from './api/tasks';
import { userRouter } from './api/users';
import { webhookRouter } from './api/webhooks';
import { csrfProtection, csrfTokenIssuer } from './middleware/csrf';

const app = express();

// Restrict CORS to configured origins
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Preserve raw body for webhook signature verification
app.use(express.json({
  limit: '1mb',
  verify: (req: Request, _res, buf) => {
    (req as Request & { rawBody?: Buffer }).rawBody = buf;
  },
}));

// Cookie parser (needed for CSRF)
app.use(cookieParser());

// CSRF protection — issue tokens on GET, validate on state-changing methods
app.use(csrfTokenIssuer);
app.use(csrfProtection);

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  next();
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Serve static test UI in dev mode
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/test-ui', express.static(path.join(__dirname, '..', 'public')));

app.use('/api/tasks', taskRouter);
app.use('/api/users', userRouter);
app.use('/api/webhooks', webhookRouter);

// Global error handler — no stack trace leakage
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  // Log error details server-side only
  const errorId = Date.now().toString(36);
  process.stderr.write(`[${errorId}] ${err.stack || err.message}\n`);

  res.status(500).json({
    error: 'Internal server error',
    errorId,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  process.stdout.write(`Server running on port ${PORT}\n`);
});

export { app };
