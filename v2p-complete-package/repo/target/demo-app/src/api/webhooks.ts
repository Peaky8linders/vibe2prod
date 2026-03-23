import { Router, Request } from 'express';
import crypto from 'crypto';
import { db } from '../config/database';
import { requireAuth } from '../middleware/auth';
import { webhookPayloadSchema, syncSchema } from '../schemas/validation';

const router = Router();

// Verify webhook signature from payment provider using raw body bytes
function verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !signature || !rawBody) return false;

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  // Guard against different-length buffers (timingSafeEqual throws on mismatch)
  if (sigBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

// Receive webhook from payment provider
router.post('/payment', async (req, res) => {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  const signature = req.headers['x-webhook-signature'] as string | undefined;

  if (!verifyWebhookSignature(rawBody, signature)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const parsed = webhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid webhook payload' });
    return;
  }
  const { event, data } = parsed.data;

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

  const parsed2 = syncSchema.safeParse(req.body);
  if (!parsed2.success) {
    res.status(400).json({ error: parsed2.error.issues[0].message });
    return;
  }
  const { task_ids } = parsed2.data;

  try {
    // Build parameterized query — placeholders are $2, $3, ... (never user input)
    const params: unknown[] = [req.user!.userId, ...task_ids];
    const placeholders = task_ids.map((_: string, i: number) => '$' + (i + 2)).join(',');
    const sql = 'SELECT * FROM tasks WHERE id IN (' + placeholders + ') AND user_id = $1';
    const tasks = await db.query(sql, params);

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

// Export tasks as CSV (requires auth, batched cursor for memory efficiency, ownership check)
router.get('/export/:userId', requireAuth, async (req, res) => {
  // Users can only export their own tasks
  if (req.user!.userId !== req.params.userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }

  const client = await db.pool.connect();
  try {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
    res.write('id,title,description,status,priority,due_date\n');

    const escapeCsv = (val: string | null) => {
      if (val == null) return '';
      return `"${String(val).replace(/"/g, '""')}"`;
    };

    // Use server-side cursor to avoid loading all rows into memory at once
    await client.query('BEGIN');
    await client.query(
      "DECLARE task_cursor CURSOR FOR SELECT id, title, description, status, priority, due_date FROM tasks WHERE user_id = $1",
      [req.params.userId]
    );

    const BATCH_SIZE = 100;
    let hasMore = true;
    while (hasMore) {
      const batch = await client.query('FETCH ' + BATCH_SIZE + ' FROM task_cursor');
      for (const task of batch.rows) {
        res.write(`${task.id},${escapeCsv(task.title)},${escapeCsv(task.description)},${task.status},${task.priority},${task.due_date}\n`);
      }
      hasMore = batch.rows.length === BATCH_SIZE;
    }

    await client.query('CLOSE task_cursor');
    await client.query('COMMIT');
    res.end();
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: 'Export failed' });
  } finally {
    client.release();
  }
});

export { router as webhookRouter };
