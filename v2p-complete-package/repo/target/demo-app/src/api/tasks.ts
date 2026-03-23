import { Router } from 'express';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { createTaskSchema, updateTaskSchema, bulkUpdateSchema } from '../schemas/validation';

const router = Router();

// Get all tasks for the authenticated user
router.get('/', requireAuth, async (req, res) => {
  try {
    const tasks = await db.query(
      'SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user!.userId]
    );
    res.json(tasks.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Create a task
router.post('/', requireAuth, async (req, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { title, description, priority, due_date } = parsed.data;

  try {
    const result = await db.query(
      `INSERT INTO tasks (user_id, title, description, priority, due_date, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [req.user!.userId, title, description ?? null, priority, due_date ?? null]
    );

    // Notify via webhook (non-blocking, with error handling)
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackWebhookUrl) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      fetch(slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `New task created: ${title}` }),
        signal: controller.signal,
      }).catch(() => {
        // Non-critical: log failure but don't fail the request
      }).finally(() => clearTimeout(timeout));
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update a task (with ownership check)
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, description, priority, status, due_date } = req.body;

  try {
    // Verify ownership before updating
    const existing = await db.query(
      'SELECT * FROM tasks WHERE id = $1 AND user_id = $2',
      [id, req.user!.userId]
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const result = await db.query(
      `UPDATE tasks SET
        title = COALESCE($1, title),
        description = COALESCE($2, description),
        priority = COALESCE($3, priority),
        status = COALESCE($4, status),
        due_date = COALESCE($5, due_date),
        updated_at = NOW()
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [title, description, priority, status, due_date, id, req.user!.userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete a task (with auth + ownership check)
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      'DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Bulk status update — wrapped in transaction to prevent race conditions
router.post('/bulk-update', requireAuth, async (req, res) => {
  const parsed = bulkUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { task_ids, new_status } = parsed.data;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const placeholders = task_ids.map((_: string, i: number) => `$${i + 3}`).join(',');
    const result = await client.query(
      `UPDATE tasks SET status = $1, updated_at = NOW()
       WHERE id IN (${placeholders}) AND user_id = $2
       RETURNING id`,
      [new_status, req.user!.userId, ...task_ids]
    );

    await client.query('COMMIT');
    res.json({ updated: result.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to bulk update tasks' });
  } finally {
    client.release();
  }
});

// Search tasks — parameterized query
router.get('/search', requireAuth, async (req, res) => {
  const q = req.query.q;
  if (!q || typeof q !== 'string') {
    res.status(400).json({ error: 'Search query is required' });
    return;
  }

  try {
    const searchPattern = `%${q}%`;
    const results = await db.query(
      'SELECT * FROM tasks WHERE user_id = $1 AND (title ILIKE $2 OR description ILIKE $2)',
      [req.user!.userId, searchPattern]
    );
    res.json(results.rows);
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

export { router as taskRouter };
