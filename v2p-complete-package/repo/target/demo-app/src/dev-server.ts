/**
 * Dev server with in-memory database for E2E testing without PostgreSQL.
 * Run: npx tsx src/dev-server.ts
 */
import crypto from 'crypto';
import { v4 as uuidv4 } from 'crypto';

// ---- In-memory database ----

interface Row { [key: string]: unknown }

const tables: {
  users: Row[];
  tasks: Row[];
  subscriptions: Row[];
} = {
  users: [],
  tasks: [],
  subscriptions: [],
};

function generateUUID(): string {
  return crypto.randomUUID();
}

function parseSQL(text: string, params: unknown[] = []): { rows: Row[]; rowCount: number } {
  // Replace $1, $2, etc. with actual values for matching
  let resolvedText = text;
  const p = [...params];

  // Normalize whitespace
  resolvedText = resolvedText.replace(/\s+/g, ' ').trim();

  // INSERT INTO users
  if (/INSERT INTO users/i.test(resolvedText)) {
    const id = generateUUID();
    const now = new Date().toISOString();
    const user: Row = {
      id, email: p[0], password_hash: p[1], password_salt: p[2], name: p[3],
      role: 'user', created_at: now, updated_at: now, deleted_at: null,
    };
    // Check unique email
    if (tables.users.find(u => u.email === p[0])) {
      const err: any = new Error('duplicate key');
      err.code = '23505';
      throw err;
    }
    tables.users.push(user);
    // Return only requested columns
    if (/RETURNING id, email, name/i.test(resolvedText)) {
      return { rows: [{ id: user.id, email: user.email, name: user.name }], rowCount: 1 };
    }
    return { rows: [user], rowCount: 1 };
  }

  // SELECT from users WHERE email = $1 (login query)
  if (/SELECT .* FROM users WHERE email = \$1/i.test(resolvedText) && !resolvedText.includes('admin')) {
    const email = (p[0] as string).toLowerCase().trim();
    const user = tables.users.find(u => u.email === email && !u.deleted_at);
    return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
  }

  // SELECT from users WHERE id = $1 (profile)
  if (/SELECT .* FROM users WHERE id = \$1/i.test(resolvedText)) {
    const user = tables.users.find(u => u.id === p[0] && !u.deleted_at);
    if (user) {
      if (/SELECT id, email, name, role, created_at/i.test(resolvedText)) {
        return { rows: [{ id: user.id, email: user.email, name: user.name, role: user.role, created_at: user.created_at }], rowCount: 1 };
      }
      return { rows: [user], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // SELECT all users (admin)
  if (/SELECT id, email, name, role, created_at FROM users$/i.test(resolvedText)) {
    const rows = tables.users.filter(u => !u.deleted_at).map(u => ({
      id: u.id, email: u.email, name: u.name, role: u.role, created_at: u.created_at,
    }));
    return { rows, rowCount: rows.length };
  }

  // UPDATE users SET deleted_at (soft delete)
  if (/UPDATE users SET deleted_at/i.test(resolvedText)) {
    const user = tables.users.find(u => u.id === p[0] && !u.deleted_at);
    if (user) {
      user.deleted_at = new Date().toISOString();
      return { rows: [{ id: user.id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // INSERT INTO tasks
  if (/INSERT INTO tasks/i.test(resolvedText)) {
    const id = generateUUID();
    const now = new Date().toISOString();
    const task: Row = {
      id, user_id: p[0], title: p[1], description: p[2], priority: p[3],
      due_date: p[4], status: 'pending', created_at: now, updated_at: now,
      assignee_id: null, version: 1,
    };
    tables.tasks.push(task);
    return { rows: [task], rowCount: 1 };
  }

  // SELECT tasks WHERE user_id = $1 ORDER BY
  if (/SELECT \* FROM tasks WHERE user_id = \$1 ORDER BY/i.test(resolvedText)) {
    const rows = tables.tasks.filter(t => t.user_id === p[0]).reverse();
    return { rows, rowCount: rows.length };
  }

  // SELECT tasks WHERE id AND user_id (ownership check)
  if (/SELECT \* FROM tasks WHERE id = \$1 AND user_id = \$2/i.test(resolvedText)) {
    const task = tables.tasks.find(t => t.id === p[0] && t.user_id === p[1]);
    return { rows: task ? [task] : [], rowCount: task ? 1 : 0 };
  }

  // UPDATE tasks SET ... WHERE id AND user_id (update with COALESCE)
  if (/UPDATE tasks SET.*COALESCE/i.test(resolvedText)) {
    const id = p[5]; const userId = p[6];
    const task = tables.tasks.find(t => t.id === id && t.user_id === userId);
    if (task) {
      if (p[0] != null) task.title = p[0];
      if (p[1] != null) task.description = p[1];
      if (p[2] != null) task.priority = p[2];
      if (p[3] != null) task.status = p[3];
      if (p[4] != null) task.due_date = p[4];
      task.updated_at = new Date().toISOString();
      return { rows: [task], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // DELETE tasks WHERE id AND user_id
  if (/DELETE FROM tasks WHERE id = \$1 AND user_id = \$2/i.test(resolvedText)) {
    const idx = tables.tasks.findIndex(t => t.id === p[0] && t.user_id === p[1]);
    if (idx >= 0) {
      const removed = tables.tasks.splice(idx, 1);
      return { rows: [{ id: removed[0].id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // UPDATE tasks SET status (bulk update)
  if (/UPDATE tasks SET status = \$1.*WHERE id IN/i.test(resolvedText)) {
    const status = p[0]; const userId = p[1];
    const ids = p.slice(2);
    let count = 0;
    for (const task of tables.tasks) {
      if (ids.includes(task.id) && task.user_id === userId) {
        task.status = status;
        task.updated_at = new Date().toISOString();
        count++;
      }
    }
    return { rows: tables.tasks.filter(t => ids.includes(t.id)), rowCount: count };
  }

  // SELECT tasks ILIKE (search)
  if (/ILIKE/i.test(resolvedText)) {
    const userId = p[0];
    const pattern = (p[1] as string).replace(/%/g, '').toLowerCase();
    const rows = tables.tasks.filter(t =>
      t.user_id === userId &&
      ((t.title as string).toLowerCase().includes(pattern) ||
       (t.description as string || '').toLowerCase().includes(pattern))
    );
    return { rows, rowCount: rows.length };
  }

  // UPDATE subscriptions (payment webhook)
  if (/UPDATE subscriptions SET status = 'active'/i.test(resolvedText)) {
    const sub = tables.subscriptions.find(s => s.user_id === p[1]);
    if (sub) {
      sub.status = 'active';
      sub.paid_until = p[0];
    }
    return { rows: [], rowCount: sub ? 1 : 0 };
  }

  if (/UPDATE subscriptions SET status = 'past_due'/i.test(resolvedText)) {
    const sub = tables.subscriptions.find(s => s.user_id === p[0]);
    if (sub) {
      sub.status = 'past_due';
    }
    return { rows: [], rowCount: sub ? 1 : 0 };
  }

  // SELECT tasks for export/cursor
  if (/SELECT id, title, description, status, priority, due_date FROM tasks WHERE user_id/i.test(resolvedText)) {
    const rows = tables.tasks.filter(t => t.user_id === p[0]).map(t => ({
      id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, due_date: t.due_date,
    }));
    return { rows, rowCount: rows.length };
  }

  // SELECT tasks by stats
  if (/COUNT\(\*\) as total/i.test(resolvedText)) {
    const userTasks = tables.tasks.filter(t => t.user_id === p[0]);
    return {
      rows: [{
        total: userTasks.length,
        completed: userTasks.filter(t => t.status === 'completed').length,
        pending: userTasks.filter(t => t.status === 'pending').length,
        overdue: 0,
      }],
      rowCount: 1,
    };
  }

  // DECLARE CURSOR / FETCH / CLOSE / BEGIN / COMMIT / ROLLBACK
  if (/^(BEGIN|COMMIT|ROLLBACK|CLOSE|DECLARE)/i.test(resolvedText)) {
    return { rows: [], rowCount: 0 };
  }
  if (/^FETCH/i.test(resolvedText)) {
    // Return empty for cursor — the CSV export won't work perfectly with in-memory but won't crash
    return { rows: [], rowCount: 0 };
  }

  // Default fallback
  console.log('[in-memory DB] Unhandled query:', resolvedText.substring(0, 80));
  return { rows: [], rowCount: 0 };
}

// Mock the db module by monkey-patching before importing the app
const mockClient = {
  query: (text: string, params?: unknown[]) => Promise.resolve(parseSQL(text, params)),
  release: () => {},
};

// Set env vars BEFORE importing anything — use env vars if available, fallback to dev defaults
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://mock:mock@localhost:5432/mock';
process.env.JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
process.env.ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001';
process.env.PORT = process.env.PORT || '3001';

// Now patch the pg module
import pg from 'pg';
const originalPool = pg.Pool;
(pg as any).Pool = class MockPool {
  query(text: string, params?: unknown[]) {
    return Promise.resolve(parseSQL(text, params));
  }
  connect() {
    return Promise.resolve(mockClient);
  }
  on() { return this; }
  end() { return Promise.resolve(); }
};

// Import and start the app
import('./index.js').then(() => {
  console.log('\n🚀 Dev server running at http://localhost:3001');
  console.log('📄 Test UI at http://localhost:3001/test-ui');
  console.log('💾 Using in-memory database (no PostgreSQL needed)\n');
});
