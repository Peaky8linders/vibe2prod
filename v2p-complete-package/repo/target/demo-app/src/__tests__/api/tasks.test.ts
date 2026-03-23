import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Use vi.hoisted so these are available when vi.mock factory runs (hoisted above imports)
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
const userPayload = { userId: 'u1', email: 'user@test.com', role: 'user' };
const token = jwt.sign(userPayload, SECRET, { expiresIn: '1h' });

function authHeader() {
  return { Authorization: `Bearer ${token}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
});

// ---- GET /api/tasks ----
describe('GET /api/tasks', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('returns tasks for authenticated user', async () => {
    const rows = [{ id: 't1', title: 'Task 1' }];
    mockQuery.mockResolvedValueOnce({ rows });

    const res = await request(app).get('/api/tasks').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE user_id = $1'),
      ['u1'],
    );
  });
});

// ---- POST /api/tasks ----
describe('POST /api/tasks', () => {
  it('returns 400 for invalid body (missing title)', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set(authHeader())
      .send({ description: 'no title' });
    expect(res.status).toBe(400);
  });

  it('creates a task with valid data', async () => {
    const created = { id: 't1', title: 'New task', status: 'pending' };
    mockQuery.mockResolvedValueOnce({ rows: [created] });

    const res = await request(app)
      .post('/api/tasks')
      .set(authHeader())
      .send({ title: 'New task', priority: 'high' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual(created);
  });
});

// ---- PUT /api/tasks/:id ----
describe('PUT /api/tasks/:id', () => {
  it('returns 404 when task is not owned by user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .put('/api/tasks/t1')
      .set(authHeader())
      .send({ title: 'Updated' });

    expect(res.status).toBe(404);
  });

  it('updates task when user is owner', async () => {
    const existing = { id: 't1', user_id: 'u1', title: 'Old' };
    const updated = { id: 't1', title: 'New' };
    mockQuery
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValueOnce({ rows: [updated] });

    const res = await request(app)
      .put('/api/tasks/t1')
      .set(authHeader())
      .send({ title: 'New' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(updated);
  });
});

// ---- DELETE /api/tasks/:id ----
describe('DELETE /api/tasks/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/api/tasks/t1');
    expect(res.status).toBe(401);
  });

  it('returns 404 when task not found or not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).delete('/api/tasks/t1').set(authHeader());
    expect(res.status).toBe(404);
  });

  it('deletes task when owned by user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] });

    const res = await request(app).delete('/api/tasks/t1').set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
  });
});

// ---- POST /api/tasks/bulk-update ----
describe('POST /api/tasks/bulk-update', () => {
  it('returns 400 for invalid payload (empty task_ids)', async () => {
    const res = await request(app)
      .post('/api/tasks/bulk-update')
      .set(authHeader())
      .send({ task_ids: [], new_status: 'completed' });

    expect(res.status).toBe(400);
  });

  it('performs transactional bulk update', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 2 }) // UPDATE
      .mockResolvedValueOnce(undefined); // COMMIT

    const res = await request(app)
      .post('/api/tasks/bulk-update')
      .set(authHeader())
      .send({ task_ids: ['t1', 't2'], new_status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: 2 });
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ---- GET /api/tasks/search ----
describe('GET /api/tasks/search', () => {
  it('returns 400 when q parameter is missing', async () => {
    const res = await request(app).get('/api/tasks/search').set(authHeader());
    expect(res.status).toBe(400);
  });

  it('returns search results using parameterized ILIKE query', async () => {
    const rows = [{ id: 't1', title: 'Meeting notes' }];
    mockQuery.mockResolvedValueOnce({ rows });

    const res = await request(app)
      .get('/api/tasks/search?q=meeting')
      .set(authHeader());

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ILIKE $2'),
      ['u1', '%meeting%'],
    );
  });
});
