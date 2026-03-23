import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Mock pg before importing anything that touches database.ts
vi.mock('pg', () => {
  const pool = { query: vi.fn(), connect: vi.fn() };
  return { default: { Pool: vi.fn(() => pool) } };
});

import { requireAuth, requireRole } from '../../middleware/auth';
import type { Request, Response, NextFunction } from 'express';

function mockReqResNext(overrides: Partial<Request> = {}) {
  const req = {
    headers: {},
    ...overrides,
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('requireAuth middleware', () => {
  it('returns 401 when no Authorization header is present', () => {
    const { req, res, next } = mockReqResNext();

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when token is invalid', () => {
    const { req, res, next } = mockReqResNext({
      headers: { authorization: 'Bearer invalid.token.here' } as any,
    });

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sets req.user and calls next() for a valid token', () => {
    const payload = { userId: 'u1', email: 'a@b.com', role: 'user' };
    const token = jwt.sign(payload, process.env.JWT_SECRET!);
    const { req, res, next } = mockReqResNext({
      headers: { authorization: `Bearer ${token}` } as any,
    });

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject(payload);
  });

  it('returns 401 for an expired token', () => {
    const token = jwt.sign(
      { userId: 'u1', email: 'a@b.com' },
      process.env.JWT_SECRET!,
      { expiresIn: '0s' },
    );
    const { req, res, next } = mockReqResNext({
      headers: { authorization: `Bearer ${token}` } as any,
    });

    // Token is already expired at sign time with 0s
    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('requireRole middleware', () => {
  it('returns 401 when req.user is not set', () => {
    const { req, res, next } = mockReqResNext();

    requireRole('admin')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when user has wrong role', () => {
    const { req, res, next } = mockReqResNext();
    req.user = { userId: 'u1', email: 'a@b.com', role: 'user' };

    requireRole('admin')(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when user has the required role', () => {
    const { req, res, next } = mockReqResNext();
    req.user = { userId: 'u1', email: 'a@b.com', role: 'admin' };

    requireRole('admin')(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});
