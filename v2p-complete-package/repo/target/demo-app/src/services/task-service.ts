import { db } from '../config/database';

// Calculate task priority score
export function calculatePriorityScore(task: any): number {
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
  const result = await db.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
      COUNT(CASE WHEN due_date < NOW() AND status != 'completed' THEN 1 END) as overdue
    FROM tasks WHERE user_id = '${userId}'
  `);

  return result.rows[0];
}

// Assign task — no transaction, no conflict check
export async function assignTask(taskId: string, assigneeId: string) {
  await db.query(`UPDATE tasks SET assignee_id = '${assigneeId}' WHERE id = '${taskId}'`);
  
  // Send notification
  const task = await db.query(`SELECT * FROM tasks WHERE id = '${taskId}'`);
  const assignee = await db.query(`SELECT * FROM users WHERE id = '${assigneeId}'`);

  fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer SG.abc123xyz', // hardcoded API key
    },
    body: JSON.stringify({
      to: assignee.rows[0].email,
      subject: `Task assigned: ${task.rows[0].title}`,
      text: `You've been assigned: ${task.rows[0].title}`,
    }),
  });

  return { assigned: true };
}

// Archive completed tasks older than 30 days
export async function archiveOldTasks() {
  const result = await db.query(`
    DELETE FROM tasks 
    WHERE status = 'completed' 
    AND updated_at < NOW() - INTERVAL '30 days'
  `);

  console.log(`Archived ${result.rowCount} tasks`);
  return result.rowCount;
}
