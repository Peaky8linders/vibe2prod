import { db } from '../config/database';

// Calculate task priority score
export function calculatePriorityScore(task: { priority: string; due_date: string }): number {
  let score = 0;

  if (task.priority === 'critical') score += 100;
  if (task.priority === 'high') score += 75;
  if (task.priority === 'medium') score += 50;
  if (task.priority === 'low') score += 25;

  // Boost if due soon
  const daysUntilDue = (new Date(task.due_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  if (daysUntilDue < 1) score += 50;
  else if (daysUntilDue < 3) score += 25;
  else if (daysUntilDue < 7) score += 10;

  return score;
}

// Get task stats for a user
export async function getUserTaskStats(userId: string) {
  const result = await db.query(
    `SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN due_date < NOW() AND status != 'completed' THEN 1 END) as overdue
    FROM tasks WHERE user_id = $1`,
    [userId]
  );

  return result.rows[0];
}

// Assign task — wrapped in transaction with conflict check
export async function assignTask(taskId: string, assigneeId: string) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row to prevent concurrent assignment
    const taskResult = await client.query(
      'SELECT * FROM tasks WHERE id = $1 FOR UPDATE',
      [taskId]
    );
    if (taskResult.rows.length === 0) {
      throw new Error('Task not found');
    }

    const assigneeResult = await client.query(
      'SELECT id, email FROM users WHERE id = $1',
      [assigneeId]
    );
    if (assigneeResult.rows.length === 0) {
      throw new Error('Assignee not found');
    }

    await client.query(
      'UPDATE tasks SET assignee_id = $1, updated_at = NOW() WHERE id = $2',
      [assigneeId, taskId]
    );

    await client.query('COMMIT');

    // Send notification (non-blocking, after commit)
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    if (sendgridApiKey) {
      const task = taskResult.rows[0];
      const assignee = assigneeResult.rows[0];
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sendgridApiKey}`,
        },
        body: JSON.stringify({
          to: assignee.email,
          subject: `Task assigned: ${task.title}`,
          text: `You've been assigned: ${task.title}`,
        }),
        signal: controller.signal,
      }).catch(() => {
        // Non-critical: notification failure shouldn't break assignment
      }).finally(() => clearTimeout(timeout));
    }

    return { assigned: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Archive completed tasks older than 30 days
export async function archiveOldTasks() {
  const result = await db.query(
    `DELETE FROM tasks
    WHERE status = 'completed'
    AND updated_at < NOW() - INTERVAL '30 days'`
  );

  return result.rowCount;
}
