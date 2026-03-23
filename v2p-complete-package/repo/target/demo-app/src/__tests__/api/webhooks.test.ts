import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const { mockClient, mockQuery, mockPool } = vi.hoisted(() => {
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

const SECRET = process.env.JWT_SECRET!;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET!;

const userPayload = { userId: 'u1', email: 'user@test.com', role: 'user' };
const adminPayload = { userId: 'a1', email: 'admin@test.com', role: 'admin' };
const userToken = jwt.sign(userPayload, SECRET, { expiresIn: '1h' });
const adminToken = jwt.sign(adminPayload, SECRET, { expiresIn: '1h' });

function signPayload(body: object): string {
  const raw = JSON.stringify(body);
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(raw)).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
});

// ---- POST /api/webhooks/payment ----
describe('POST /api/webhooks/payment', () => {
  it('returns 401 for missing webhook signature', async () => {
    const res = await request(app)
      .post('/api/webhooks/payment')
      .send({ event: 'payment.completed', data: { user_id: 'u1', paid_until: '2025-12-31' } });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid webhook signature');
  });

  it('returns 401 for invalid webhook signature', async () => {
    const body = { event: 'payment.completed', data: { user_id: 'u1', paid_until: '2025-12-31' } };
    const res = await request(app)
      .post('/api/webhooks/payment')
      .set('x-webhook-signature', 'bad-signature')
      .send(body);

    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid payload schema', async () => {
    const body = { invalid: true };
    const sig = signPayload(body);

    const res = await request(app)
      .post('/api/webhooks/payment')
      .set('x-webhook-signature', sig)
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid webhook payload');
  });

  it('processes payment.completed event and updates subscription', async () => {
    const body = { event: 'payment.completed', data: { user_id: 'u1', paid_until: '2025-12-31' } };
    const sig = signPayload(body);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/webhooks/payment')
      .set('x-webhook-signature', sig)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      ['2025-12-31', 'u1'],
    );
  });

  it('processes payment.failed event and sets past_due', async () => {
    const body = { event: 'payment.failed', data: { user_id: 'u1' } };
    const sig = signPayload(body);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/webhooks/payment')
      .set('x-webhook-signature', sig)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'past_due'"),
      ['u1'],
    );
  });
});

// ---- POST /api/webhooks/sync/:provider ----
describe('POST /api/webhooks/sync/:provider', () => {
  it('returns 400 for unsupported provider (SSRF prevention)', async () => {
    const res = await request(app)
      .post('/api/webhooks/sync/evil-host')
      .set({ Authorization: `Bearer ${userToken}` })
      .send({ task_ids: ['t1'] });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Unsupported provider');
  });

  it('accepts allowed providers and calls the correct API URL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', title: 'Task' }] });
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ synced: true }), { status: 200 }),
    );

    const res = await request(app)
      .post('/api/webhooks/sync/jira')
      .set({ Authorization: `Bearer ${userToken}` })
      .send({ task_ids: ['t1'] });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://jira.example.com/api/import',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });
});

// ---- GET /api/webhooks/export/:userId ----
describe('GET /api/webhooks/export/:userId', () => {
  it('returns 403 when non-admin tries to export another user data', async () => {
    const res = await request(app)
      .get('/api/webhooks/export/other-user')
      .set({ Authorization: `Bearer ${userToken}` });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Insufficient permissions');
  });
});
