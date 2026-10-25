const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db/db');
const { HttpError, asyncHandler } = require('../middleware/errors');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, please try again later' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email });

router.post('/signup', limiter, asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!name || name.length > 80) throw new HttpError(400, 'Please enter your name');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Please enter a valid email');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with this email already exists');
  }
  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)').run(name, email, hash);
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(info.lastInsertRowid);
  const user = { id: Number(info.lastInsertRowid), name, email };
  res.status(201).json({ token: signToken(user), user });
}));

router.post('/login', limiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = u && (await bcrypt.compare(password, u.password_hash));
  if (!ok) throw new HttpError(401, 'Invalid email or password');
  res.json({ token: signToken(u), user: publicUser(u) });
}));

router.get('/me', requireAuth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!u) throw new HttpError(401, 'Account no longer exists');
  res.json(publicUser(u));
});

module.exports = router;
