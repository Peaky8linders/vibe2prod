import { Router } from 'express';
import { db } from '../config/database';
import jwt from 'jsonwebtoken';

const router = Router();

const JWT_SECRET = 'my-super-secret-jwt-key-dont-tell-anyone';

// Get all tasks for a user
router.get('/', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded: any = jwt.verify(token, JWT_SECRET);
  
  const userId = decoded.userId;
  const tasks = await db.query(`SELECT * FROM tasks WHERE user_id = '${userId}' ORDER BY created_at DESC`);
  
  res.json(tasks.rows);
});

// Create a task
router.post('/', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded: any = jwt.verify(token, JWT_SECRET);

  const { title, description, priority, due_date } = req.body;

  const result = await db.query(
    `INSERT INTO tasks (user_id, title, description, priority, due_date, status)
     VALUES ('${decoded.userId}', '${title}', '${description}', '${priority}', '${due_date}', 'pending')
     RETURNING *`
  );

  // Notify via webhook
  fetch('https://hooks.slack.com/services/T00000/B00000/XXXX', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: `New task: ${title}` }),
  });

  res.json(result.rows[0]);
});

// Update a task
router.put('/:id', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  const decoded: any = jwt.verify(token, JWT_SECRET);
  
  const { id } = req.params;
  const { title, description, priority, status, due_date } = req.body;

  // No check if user owns this task
  const result = await db.query(
    `UPDATE tasks SET 
      title = '${title}',
      description = '${description}', 
      priority = '${priority}',
      status = '${status}',
      due_date = '${due_date}',
      updated_at = NOW()
     WHERE id = '${id}'
     RETURNING *`
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  res.json(result.rows[0]);
});

// Delete a task
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  
  // No auth check at all on delete!
  await db.query(`DELETE FROM tasks WHERE id = '${id}'`);
  res.json({ deleted: true });
});

// Bulk status update — race condition city
router.post('/bulk-update', async (req, res) => {
  const { task_ids, new_status } = req.body;

  for (const id of task_ids) {
    await db.query(`UPDATE tasks SET status = '${new_status}' WHERE id = '${id}'`);
  }

  res.json({ updated: task_ids.length });
});

// Search tasks — injectable
router.get('/search', async (req, res) => {
  const q = req.query.q;
  const results = await db.query(`SELECT * FROM tasks WHERE title LIKE '%${q}%' OR description LIKE '%${q}%'`);
  res.json(results.rows);
});

export { router as taskRouter };
