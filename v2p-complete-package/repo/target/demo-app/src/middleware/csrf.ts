import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

const CSRF_HEADER = 'x-csrf-token';
const CSRF_COOKIE = '_csrf';

/**
 * CSRF protection middleware for state-changing requests.
 * Validates that the X-CSRF-Token header matches the _csrf cookie.
 * GET/HEAD/OPTIONS are exempt (safe methods).
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Safe methods don't need CSRF protection
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Webhook endpoints use their own signature verification
  if (req.path.startsWith('/api/webhooks/')) {
    return next();
  }

  const token = req.headers[CSRF_HEADER] as string | undefined;
  const cookie = req.cookies?.[CSRF_COOKIE];

  if (!token || !cookie || token !== cookie) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }

  next();
}

/**
 * Issue a CSRF token cookie on GET requests.
 * The client reads this cookie and sends it back as X-CSRF-Token header.
 */
export function csrfTokenIssuer(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' && !req.cookies?.[CSRF_COOKIE]) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false, // Client JS needs to read it
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
    });
  }
  next();
}
