import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Verify webhook signature from payment provider
function verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !signature) return false;

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Receive webhook from payment provider
router.post('/payment', async (req, res) => {
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-webhook-signature'] as string | undefined;

  if (!verifyWebhookSignature(rawBody, signature)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const { event, data } = req.body;

  if (!event || !data?.user_id) {
    res.status(400).json({ error: 'Invalid webhook payload' });
    return;
  }

  try {
    if (event === 'payment.completed') {
      if (!data.paid_until) {
        res.status(400).json({ error: 'Missing paid_until field' });
        return;
      }
      await db.query(
        "UPDATE subscriptions SET status = 'active', paid_until = $1 WHERE user_id = $2",
        [data.paid_until, data.user_id]
      );
    }

    if (event === 'payment.failed') {
      await db.query(
        "UPDATE subscriptions SET status = 'past_due' WHERE user_id = $1",
        [data.user_id]
      );
    }

    res.json({ received: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Sync tasks to external project management tool (requires auth, validated providers)
const ALLOWED_PROVIDERS = ['jira', 'asana', 'linear', 'trello'];

router.post('/sync/:provider', requireAuth, async (req, res) => {
  const { provider } = req.params;

  // Validate provider to prevent SSRF
  if (!ALLOWED_PROVIDERS.includes(provider)) {
    res.status(400).json({ error: 'Unsupported provider' });
    return;
  }

  const { task_ids } = req.body;
  if (!Array.isArray(task_ids) || task_ids.length === 0) {
    res.status(400).json({ error: 'task_ids must be a non-empty array' });
    return;
  }

  try {
    const placeholders = task_ids.map((_: string, i: number) => `$${i + 2}`).join(',');
    const tasks = await db.query(
      `SELECT * FROM tasks WHERE id IN (${placeholders}) AND user_id = $1`,
      [req.user!.userId, ...task_ids]
    );

    const syncApiKey = process.env.SYNC_API_KEY;
    if (!syncApiKey) {
      res.status(500).json({ error: 'Sync API key not configured' });
      return;
    }

    const apiUrl = `https://${provider}.example.com/api/import`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${syncApiKey}`,
        },
        body: JSON.stringify({ tasks: tasks.rows }),
        signal: controller.signal,
      });

      if (!response.ok) {
        res.status(502).json({ error: 'Sync provider returned an error' });
        return;
      }

      const result = await response.json();
      res.json(result);
    } catch (fetchErr) {
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        res.status(504).json({ error: 'Sync request timed out' });
      } else {
        res.status(502).json({ error: 'Failed to reach sync provider' });
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Export tasks as CSV (requires auth, streams data, ownership check)
router.get('/export/:userId', requireAuth, async (req, res) => {
  // Users can only export their own tasks
  if (req.user!.userId !== req.params.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }

  try {
    const tasks = await db.query(
      'SELECT id, title, description, status, priority, due_date FROM tasks WHERE user_id = $1',
      [req.params.userId]
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');

    // Write header
    res.write('id,title,description,status,priority,due_date\n');

    // Stream rows to avoid loading everything in memory for large datasets
    for (const task of tasks.rows) {
      const escapeCsv = (val: string | null) => {
        if (val == null) return '';
        return `"${String(val).replace(/"/g, '""')}"`;
      };
      res.write(`${task.id},${escapeCsv(task.title)},${escapeCsv(task.description)},${task.status},${task.priority},${task.due_date}\n`);
    }

    res.end();
  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

export { router as webhookRouter };
