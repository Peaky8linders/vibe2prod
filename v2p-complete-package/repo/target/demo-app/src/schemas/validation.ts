import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').transform(s => s.trim()),
});

export const loginSchema = z.object({
  email: z.string().email('Valid email is required'),
  password: z.string().min(1, 'Password is required'),
});

export const createTaskSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional().default('medium'),
  due_date: z.string().optional().nullable(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  due_date: z.string().optional().nullable(),
});

export const bulkUpdateSchema = z.object({
  task_ids: z.array(z.string()).min(1, 'task_ids must be a non-empty array'),
  new_status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
});

export const webhookPayloadSchema = z.object({
  event: z.string().min(1),
  data: z.object({
    user_id: z.string().min(1),
    paid_until: z.string().optional(),
  }),
});

export const syncSchema = z.object({
  task_ids: z.array(z.string()).min(1, 'task_ids must be a non-empty array'),
});
