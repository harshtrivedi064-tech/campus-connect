const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const SECRET = 'change-this-secret-before-deploying';

router.post('/signup', async (req, res) => {
  const { name, email, password, role } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Please fill in all fields.' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  if (!['student', 'instructor'].includes(role)) {
    return res.status(400).json({ error: 'Choose whether you are a student or instructor.' });
  }

  const data = db.load();
  const cleanEmail = String(email).trim().toLowerCase();

  if (data.users.some((user) => user.email === cleanEmail)) {
    return res.status(400).json({ error: 'This email is already registered.' });
  }

  const hash = await bcrypt.hash(String(password), 10);
  data.users.push({
    id: Date.now(),
    name: String(name).trim(),
    email: cleanEmail,
    password: hash,
    role
  });
  db.save(data);

  res.json({ message: 'Account created! Please log in.' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const data = db.load();
  const user = data.users.find((entry) => entry.email === String(email || '').trim().toLowerCase());

  if (!user || !(await bcrypt.compare(String(password || ''), user.password))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role || 'student' }
  });
});

function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Please log in again.' });
  }

  try {
    const payload = jwt.verify(token, SECRET);
    const data = db.load();
    const user = data.users.find((entry) => entry.id === payload.id);

    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    req.user = { ...user, role: user.role || 'student' };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please log in again.' });
  }
}

module.exports = { router, verifyToken };
