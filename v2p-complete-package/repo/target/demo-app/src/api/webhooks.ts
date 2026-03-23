import { Router } from 'express';
import { db } from '../config/database';

const router = Router();

// Receive webhook from payment provider
router.post('/payment', async (req, res) => {
  // No signature verification!
  const { event, data } = req.body;

  console.log('Webhook received:', event, JSON.stringify(data));

  if (event === 'payment.completed') {
    await db.query(
      `UPDATE subscriptions SET status = 'active', paid_until = '${data.paid_until}' WHERE user_id = '${data.user_id}'`
    );
  }

  if (event === 'payment.failed') {
    await db.query(
      `UPDATE subscriptions SET status = 'past_due' WHERE user_id = '${data.user_id}'`
    );
    // Should notify user but... later
  }

  res.json({ received: true });
});

// Sync tasks to external project management tool
router.post('/sync/:provider', async (req, res) => {
  const { provider } = req.params;
  const { task_ids } = req.body;

  const tasks = await db.query(`SELECT * FROM tasks WHERE id IN (${task_ids.join(',')})`);

  // No validation on provider, no retry, no timeout
  const apiUrl = `https://${provider}.example.com/api/import`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SYNC_API_KEY}`,
    },
    body: JSON.stringify({ tasks: tasks.rows }),
  });

  const result = await response.json();
  res.json(result);
});

// Export tasks as CSV — no streaming, loads everything into memory
router.get('/export/:userId', async (req, res) => {
  const tasks = await db.query(`SELECT * FROM tasks WHERE user_id = '${req.params.userId}'`);

  let csv = 'id,title,description,status,priority,due_date\n';
  for (const task of tasks.rows) {
    csv += `${task.id},"${task.title}","${task.description}",${task.status},${task.priority},${task.due_date}\n`;
  }

  res.setHeader('Content-Type', 'text/csv');
  res.send(csv);
});

export { router as webhookRouter };
