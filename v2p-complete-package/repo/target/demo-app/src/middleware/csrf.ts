import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = '__Host-csrf';

/**
 * CSRF protection middleware for state-changing requests.
 * Validates that the X-CSRF-Token header matches the __Host-csrf cookie
 * using constant-time comparison to prevent timing side-channels.
 * GET/HEAD/OPTIONS are exempt (safe methods).
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe methods don't need CSRF protection
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Only the payment webhook uses its own HMAC signature verification.
  // Other webhook routes (e.g. /sync) use requireAuth and need CSRF.
  if (req.path === '/api/webhooks/payment') {
    return next();
  }

  const token = req.headers[CSRF_HEADER] as string | undefined;
  const cookie = req.cookies?.[CSRF_COOKIE];

  // Constant-time comparison to prevent timing attacks
  if (!token || !cookie) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }

  const tokenBuf = Buffer.from(token);
  const cookieBuf = Buffer.from(cookie);
  if (tokenBuf.length !== cookieBuf.length || !crypto.timingSafeEqual(tokenBuf, cookieBuf)) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }

  next();
}

/**
 * Issue a CSRF token cookie on GET requests.
 * The client reads this cookie and sends it back as X-CSRF-Token header.
 * Uses __Host- prefix to prevent subdomain cookie injection.
 */
export function csrfTokenIssuer(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' && !req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // Client JS needs to read it for the double-submit pattern
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  next();
}
