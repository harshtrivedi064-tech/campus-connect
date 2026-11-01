const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const asyncHandler = require('../async-handler');
const { verifyToken } = require('./auth');

const router = express.Router();

router.get('/', verifyToken, asyncHandler(async (req, res) => {
  const data = await db.read();
  res.json(data.posts.map(post => {
    const { likes, dislikes, ...visiblePost } = post;
    return {
      ...visiblePost,
      likeCount: likes.length,
      dislikeCount: dislikes.length,
      userVote: likes.includes(req.user.id)
        ? 'like'
        : dislikes.includes(req.user.id) ? 'dislike' : null
    };
  }));
}));

router.post('/', verifyToken, asyncHandler(async (req, res) => {
  const text = String(req.body?.text || '').trim();

  if (!text) {
    return res.status(400).json({ error: 'Post cannot be empty.' });
  }

  if (text.length > 300) {
    return res.status(400).json({ error: 'Post is too long (max 300 characters).' });
  }

  const post = {
    id: Date.now(),
    userId: req.user.id,
    name: req.user.name,
    text,
    time: new Date().toISOString(),
    likes: [],
    dislikes: [],
    comments: []
  };
  await db.update(data => data.posts.unshift(post));

  res.json(post);
}));

router.post('/:id/vote', verifyToken, asyncHandler(async (req, res) => {
  const { vote } = req.body || {};
  if (!['like', 'dislike', 'none'].includes(vote)) {
    return res.status(400).json({ error: 'Choose like or dislike.' });
  }

  const outcome = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post) return null;

    post.likes = post.likes.filter(userId => userId !== req.user.id);
    post.dislikes = post.dislikes.filter(userId => userId !== req.user.id);
    if (vote === 'like') post.likes.push(req.user.id);
    if (vote === 'dislike') post.dislikes.push(req.user.id);

    return {
      likeCount: post.likes.length,
      dislikeCount: post.dislikes.length,
      userVote: vote === 'none' ? null : vote
    };
  });

  if (!outcome) return res.status(404).json({ error: 'Post not found.' });
  res.json(outcome);
}));

router.post('/:id/comments', verifyToken, asyncHandler(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) {
    return res.status(400).json({ error: 'Comment cannot be empty.' });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: 'Comment is too long (max 500 characters).' });
  }

  const comment = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    name: req.user.name,
    text,
    time: new Date().toISOString()
  };
  const created = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post) return false;
    post.comments.push(comment);
    return true;
  });
  if (!created) return res.status(404).json({ error: 'Post not found.' });
  res.status(201).json(comment);
}));

router.delete('/:id/comments/:commentId', verifyToken, asyncHandler(async (req, res) => {
  const outcome = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post) return 'post';
    const comment = post.comments.find(entry => entry.id === req.params.commentId);
    if (!comment) return 'comment';
    if (comment.userId !== req.user.id && post.userId !== req.user.id) return 'forbidden';
    post.comments = post.comments.filter(entry => entry.id !== req.params.commentId);
    return 'deleted';
  });

  if (outcome === 'post') return res.status(404).json({ error: 'Post not found.' });
  if (outcome === 'comment') return res.status(404).json({ error: 'Comment not found.' });
  if (outcome === 'forbidden') {
    return res.status(403).json({ error: 'You cannot delete this comment.' });
  }
  res.json({ message: 'Comment deleted.' });
}));

router.delete('/:id', verifyToken, asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const outcome = await db.update(data => {
    const post = data.posts.find(entry => entry.id === id);
    if (!post) return 'missing';
    if (post.userId !== req.user.id) return 'forbidden';
    data.posts = data.posts.filter(entry => entry.id !== id);
    return 'deleted';
  });

  if (outcome === 'missing') {
    return res.status(404).json({ error: 'Post not found.' });
  }
  if (outcome === 'forbidden') {
    return res.status(403).json({ error: 'You can only delete your own posts.' });
  }

  res.json({ message: 'Post deleted.' });
}));

module.exports = router;
