const express = require('express');
const db = require('../db');
const { verifyToken } = require('./auth');

const router = express.Router();

router.get('/', verifyToken, (req, res) => {
  const data = db.load();
  res.json(data.posts);
});

router.post('/', verifyToken, (req, res) => {
  const text = String(req.body?.text || '').trim();

  if (!text) {
    return res.status(400).json({ error: 'Post cannot be empty.' });
  }

  if (text.length > 300) {
    return res.status(400).json({ error: 'Post is too long (max 300 characters).' });
  }

  const data = db.load();
  const post = {
    id: Date.now(),
    userId: req.user.id,
    name: req.user.name,
    text,
    time: new Date().toISOString()
  };

  data.posts.unshift(post);
  db.save(data);

  res.json(post);
});

router.delete('/:id', verifyToken, (req, res) => {
  const id = Number(req.params.id);
  const data = db.load();
  const post = data.posts.find((entry) => entry.id === id);

  if (!post) {
    return res.status(404).json({ error: 'Post not found.' });
  }

  if (post.userId !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own posts.' });
  }

  data.posts = data.posts.filter((entry) => entry.id !== id);
  db.save(data);

  res.json({ message: 'Post deleted.' });
});

module.exports = router;
