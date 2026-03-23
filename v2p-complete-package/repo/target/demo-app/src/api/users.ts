import { Router } from 'express';
import { db } from '../config/database';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const router = Router();

const JWT_SECRET = 'my-super-secret-jwt-key-dont-tell-anyone';

// Register
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  // No validation on email format, password strength, nothing
  const hashedPassword = crypto.createHash('md5').update(password).digest('hex');

  const result = await db.query(
    `INSERT INTO users (email, password_hash, name) VALUES ('${email}', '${hashedPassword}', '${name}') RETURNING id, email, name`
  );

  const token = jwt.sign({ userId: result.rows[0].id, email }, JWT_SECRET);
  res.json({ user: result.rows[0], token });
});

// Login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const hashedPassword = crypto.createHash('md5').update(password).digest('hex');

  const result = await db.query(
    `SELECT * FROM users WHERE email = '${email}' AND password_hash = '${hashedPassword}'`
  );

  if (result.rows.length === 0) {
    // Leaks whether email exists
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const user = result.rows[0];
  const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, {
    expiresIn: '30d', // way too long
  });

  console.log(`User ${email} logged in`); // PII in logs

  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// Get profile — no auth middleware, just inline check
router.get('/profile', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.status(401).json({ error: 'No token' });
    return;
  }

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const result = await db.query(`SELECT * FROM users WHERE id = '${decoded.userId}'`);
    // Returns password_hash to client!
    res.json(result.rows[0]);
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Admin: list all users (no role check)
router.get('/admin/all', async (req, res) => {
  const result = await db.query('SELECT * FROM users');
  res.json(result.rows); // returns all fields including password_hash
});

// Delete account — no confirmation, no soft delete
router.delete('/:id', async (req, res) => {
  await db.query(`DELETE FROM users WHERE id = '${req.params.id}'`);
  // Orphaned tasks — no cascade
  res.json({ deleted: true });
});

export { router as userRouter };
