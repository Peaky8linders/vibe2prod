import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

const { mockQuery, mockPool } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  const mockQuery = vi.fn();
  const mockPool = { query: mockQuery, connect: vi.fn().mockResolvedValue(mockClient) };
  return { mockClient, mockQuery, mockPool };
});

vi.mock('pg', () => ({
  default: { Pool: vi.fn(() => mockPool) },
}));

import { app } from '../../index';
import request from 'supertest';
import { hashPassword } from '../../utils/crypto';

const SECRET = process.env.JWT_SECRET!;

function makeToken(payload: object) {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' });
}

const userPayload = { userId: 'u1', email: 'user@test.com', role: 'user' };
const adminPayload = { userId: 'a1', email: 'admin@test.com', role: 'admin' };
const userToken = makeToken(userPayload);
const adminToken = makeToken(adminPayload);

beforeEach(() => vi.clearAllMocks());

// ---- POST /api/users/register ----
describe('POST /api/users/register', () => {
  it('returns 400 for invalid registration (short password)', async () => {
    const res = await request(app)
      .post('/api/users/register')
      .send({ email: 'a@b.com', password: 'short', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email', async () => {
    const res = await request(app)
      .post('/api/users/register')
      .send({ email: 'bad', password: 'longenough', name: 'Test' });
    expect(res.status).toBe(400);
  });

  it('returns 409 for duplicate email (unique constraint violation)', async () => {
    const err = new Error('duplicate') as Error & { code: string };
    err.code = '23505';
    mockQuery.mockRejectedValueOnce(err);

    const res = await request(app)
      .post('/api/users/register')
      .send({ email: 'dup@test.com', password: 'password123', name: 'Dup' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Email already registered');
  });

  it('registers a new user and returns token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'new@test.com', name: 'New' }],
    });

    const res = await request(app)
      .post('/api/users/register')
      .send({ email: 'new@test.com', password: 'password123', name: 'New' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe('new@test.com');
  });
});

// ---- POST /api/users/login ----
describe('POST /api/users/login', () => {
  it('returns 401 for non-existent user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/users/login')
      .send({ email: 'nobody@test.com', password: 'password123' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('returns 401 for wrong password', async () => {
    const { hash, salt } = await hashPassword('realpassword');
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'user@test.com', name: 'User', role: 'user', password_hash: hash, password_salt: salt }],
    });

    const res = await request(app)
      .post('/api/users/login')
      .send({ email: 'user@test.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid credentials');
  });

  it('returns token on valid login', async () => {
    const { hash, salt } = await hashPassword('correctpassword');
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'user@test.com', name: 'User', role: 'user', password_hash: hash, password_salt: salt }],
    });

    const res = await request(app)
      .post('/api/users/login')
      .send({ email: 'user@test.com', password: 'correctpassword' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body.user.email).toBe('user@test.com');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });
});

// ---- GET /api/users/profile ----
describe('GET /api/users/profile', () => {
  it('returns safe profile fields (no password_hash)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', email: 'user@test.com', name: 'User', role: 'user', created_at: '2024-01-01' }],
    });

    const res = await request(app)
      .get('/api/users/profile')
      .set({ Authorization: `Bearer ${userToken}` });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('email');
    expect(res.body).not.toHaveProperty('password_hash');
    expect(res.body).not.toHaveProperty('password_salt');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/users/profile');
    expect(res.status).toBe(401);
  });
});

// ---- GET /api/users/admin/all ----
describe('GET /api/users/admin/all', () => {
  it('returns 403 for non-admin user', async () => {
    const res = await request(app)
      .get('/api/users/admin/all')
      .set({ Authorization: `Bearer ${userToken}` });

    expect(res.status).toBe(403);
  });

  it('returns user list for admin', async () => {
    const rows = [{ id: 'u1', email: 'a@b.com', name: 'A', role: 'user', created_at: '2024-01-01' }];
    mockQuery.mockResolvedValueOnce({ rows });

    const res = await request(app)
      .get('/api/users/admin/all')
      .set({ Authorization: `Bearer ${adminToken}` });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
  });
});

// ---- DELETE /api/users/:id ----
describe('DELETE /api/users/:id', () => {
  it('allows user to delete own account', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1' }] });

    const res = await request(app)
      .delete('/api/users/u1')
      .set({ Authorization: `Bearer ${userToken}` });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
  });

  it('returns 403 when non-admin tries to delete another user', async () => {
    const res = await request(app)
      .delete('/api/users/other-user')
      .set({ Authorization: `Bearer ${userToken}` });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient permissions');
  });
});
