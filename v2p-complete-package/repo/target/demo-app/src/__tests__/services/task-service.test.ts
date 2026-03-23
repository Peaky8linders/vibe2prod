import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockClient, mockQuery, mockPool } = vi.hoisted(() => {
  const mockClient = { query: vi.fn(), release: vi.fn() };
  const mockQuery = vi.fn();
  const mockPool = { query: mockQuery, connect: vi.fn().mockResolvedValue(mockClient) };
  return { mockClient, mockQuery, mockPool };
});

vi.mock('pg', () => ({
  default: { Pool: vi.fn(() => mockPool) },
}));

import {
  calculatePriorityScore,
  getUserTaskStats,
  assignTask,
  archiveOldTasks,
} from '../../services/task-service';

beforeEach(() => {
  vi.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
});

// ---- calculatePriorityScore (pure function) ----
describe('calculatePriorityScore', () => {
  it('returns higher score for critical priority', () => {
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const critical = calculatePriorityScore({ priority: 'critical', due_date: future });
    const low = calculatePriorityScore({ priority: 'low', due_date: future });
    expect(critical).toBeGreaterThan(low);
    expect(critical).toBe(100);
    expect(low).toBe(25);
  });

  it('boosts score when due date is within 1 day', () => {
    const soon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const score = calculatePriorityScore({ priority: 'medium', due_date: soon });
    expect(score).toBe(100); // medium (50) + due <1 day (50)
  });

  it('boosts score when due date is within 3 days', () => {
    const in2days = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const score = calculatePriorityScore({ priority: 'low', due_date: in2days });
    expect(score).toBe(50); // low (25) + due <3 days (25)
  });
});

// ---- getUserTaskStats ----
describe('getUserTaskStats', () => {
  it('returns aggregated task stats from db', async () => {
    const stats = { total: '10', completed: '3', pending: '5', overdue: '2' };
    mockQuery.mockResolvedValueOnce({ rows: [stats] });

    const result = await getUserTaskStats('u1');
    expect(result).toEqual(stats);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('COUNT(*)'), ['u1']);
  });
});

// ---- assignTask ----
describe('assignTask', () => {
  it('assigns task within a transaction and returns success', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 't1', title: 'Task' }] }) // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'u2', email: 'assignee@test.com' }] }) // SELECT user
      .mockResolvedValueOnce(undefined) // UPDATE
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await assignTask('t1', 'u2');

    expect(result).toEqual({ assigned: true });
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('throws and rolls back when task not found', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }); // no task found

    await expect(assignTask('nonexistent', 'u2')).rejects.toThrow('Task not found');
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClient.release).toHaveBeenCalled();
  });
});

// ---- archiveOldTasks ----
describe('archiveOldTasks', () => {
  it('deletes completed tasks older than 30 days and returns count', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 5 });

    const count = await archiveOldTasks();
    expect(count).toBe(5);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status = 'completed'"),
      undefined,
    );
  });
});
