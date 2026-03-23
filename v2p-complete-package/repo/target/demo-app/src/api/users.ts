import { Router } from 'express';
import { db } from '../config/database';
import jwt from 'jsonwebtoken';
import { JWT_SECRET, requireAuth, requireRole } from '../middleware/auth';
import { hashPassword, verifyPassword } from '../utils/crypto';
import { registerSchema, loginSchema } from '../schemas/validation';

const router = Router();

// Register
router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { email, password, name } = parsed.data;

  try {
    const { hash, salt } = await hashPassword(password);

    const result = await db.query(
      'INSERT INTO users (email, password_hash, password_salt, name) VALUES ($1, $2, $3, $4) RETURNING id, email, name',
      [email.toLowerCase().trim(), hash, salt, name]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET!,
      { expiresIn: '24h' }
    );
    res.status(201).json({ user, token });
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { email, password } = parsed.data;

  try {
    const result = await db.query(
      'SELECT id, email, name, role, password_hash, password_salt FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const user = result.rows[0];
    const validPassword = await verifyPassword(password, user.password_hash, user.password_salt);
    if (!validPassword) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET!,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get profile — returns safe fields only (no password_hash)
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, name, role, created_at FROM users WHERE id = $1',
      [req.user!.userId]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Admin: list all users (requires admin role, excludes sensitive fields)
router.get('/admin/all', requireAuth, requireRole('admin'), async (req, res) => {
  try {
    const result = await db.query('SELECT id, email, name, role, created_at FROM users');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Delete account (requires auth, soft delete to preserve referential integrity)
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user!.userId !== req.params.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }

  try {
    const result = await db.query(
      'UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id',
      [req.params.id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export { router as userRouter };
