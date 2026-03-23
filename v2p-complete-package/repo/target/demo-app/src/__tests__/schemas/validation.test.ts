import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  createTaskSchema,
  updateTaskSchema,
  bulkUpdateSchema,
  webhookPayloadSchema,
  syncSchema,
} from '../../schemas/validation';

describe('registerSchema', () => {
  it('accepts valid registration data', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'password123',
      name: 'Test User',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
      name: 'Test',
    });
    expect(result.success).toBe(false);
  });

  it('rejects short password (< 8 chars)', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'short',
      name: 'Test',
    });
    expect(result.success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts valid login data', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'any',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing password', () => {
    const result = loginSchema.safeParse({ email: 'user@example.com' });
    expect(result.success).toBe(false);
  });
});

describe('createTaskSchema', () => {
  it('accepts minimal task (title only) and defaults priority', () => {
    const result = createTaskSchema.safeParse({ title: 'My task' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('medium');
    }
  });

  it('rejects empty title', () => {
    const result = createTaskSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });
});

describe('updateTaskSchema', () => {
  it('accepts partial updates', () => {
    const result = updateTaskSchema.safeParse({ status: 'completed' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid priority value', () => {
    const result = updateTaskSchema.safeParse({ priority: 'urgent' });
    expect(result.success).toBe(false);
  });
});

describe('bulkUpdateSchema', () => {
  it('accepts valid bulk update', () => {
    const result = bulkUpdateSchema.safeParse({
      task_ids: ['id1', 'id2'],
      new_status: 'completed',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty task_ids array', () => {
    const result = bulkUpdateSchema.safeParse({
      task_ids: [],
      new_status: 'completed',
    });
    expect(result.success).toBe(false);
  });
});

describe('webhookPayloadSchema', () => {
  it('accepts valid webhook payload', () => {
    const result = webhookPayloadSchema.safeParse({
      event: 'payment.completed',
      data: { user_id: 'u1', paid_until: '2025-12-31' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects payload without event', () => {
    const result = webhookPayloadSchema.safeParse({
      data: { user_id: 'u1' },
    });
    expect(result.success).toBe(false);
  });
});

describe('syncSchema', () => {
  it('accepts valid sync payload', () => {
    const result = syncSchema.safeParse({ task_ids: ['t1'] });
    expect(result.success).toBe(true);
  });

  it('rejects empty task_ids', () => {
    const result = syncSchema.safeParse({ task_ids: [] });
    expect(result.success).toBe(false);
  });
});
