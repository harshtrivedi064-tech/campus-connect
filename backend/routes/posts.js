const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const asyncHandler = require('../async-handler');
const { verifyToken } = require('./auth');

const router = express.Router();
const categories = ['Technology', 'Placement', 'Events', 'Study Material', 'General'];
const attachmentTypes = {
  'image/jpeg': {
    extension: 'jpg',
    matches: buffer => buffer.length >= 3 &&
      buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  },
  'image/png': {
    extension: 'png',
    matches: buffer => buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  'image/webp': {
    extension: 'webp',
    matches: buffer => buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
  },
  'application/pdf': {
    extension: 'pdf',
    matches: buffer => buffer.length >= 5 && buffer.subarray(0, 5).toString() === '%PDF-'
  }
};
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4, fieldSize: 4096 },
  fileFilter: (req, file, callback) => {
    if (!attachmentTypes[file.mimetype]) {
      return callback(new Error('Choose a JPG, PNG, WEBP image, or PDF under 10 MB.'));
    }
    callback(null, true);
  }
});

router.use(verifyToken);

function parseAttachment(req, res, next) {
  attachmentUpload.single('attachment')(req, res, error => {
    if (!error) {
      if (req.file && !attachmentTypes[req.file.mimetype].matches(req.file.buffer)) {
        return res.status(400).json({ error: 'The uploaded file does not match its file type.' });
      }
      return next();
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Attachments must be 10 MB or smaller.' });
    }
    if (error instanceof multer.MulterError || error.message.startsWith('Choose a ')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  });
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validatePost(body, hasAttachment, res) {
  const text = cleanText(body.text);
  const category = cleanText(body.category || 'General');
  if (!text && !hasAttachment) {
    res.status(400).json({ error: 'Add a message or attach a file before publishing.' });
    return null;
  }
  if (text.length > 2000) {
    res.status(400).json({ error: 'Post text must be 2,000 characters or fewer.' });
    return null;
  }
  if (!categories.includes(category)) {
    res.status(400).json({ error: 'Choose a valid post category.' });
    return null;
  }
  return { text, category };
}

function countLikes(post) {
  return Array.isArray(post.likes) ? post.likes.length : 0;
}

function visibleAttachment(attachment) {
  if (!attachment || typeof attachment.filename !== 'string') return null;
  return {
    url: `/posts/attachments/${encodeURIComponent(attachment.filename)}`,
    name: attachment.name,
    type: attachment.type,
    size: attachment.size
  };
}

function serializePost(post, data, userId) {
  const author = data.users.find(user => String(user.id) === String(post.userId));
  const likes = Array.isArray(post.likes) ? post.likes : [];
  const dislikes = Array.isArray(post.dislikes) ? post.dislikes : [];
  const comments = Array.isArray(post.comments) ? post.comments : [];
  const reports = Array.isArray(post.reports) ? post.reports : [];
  const { likes: ignoredLikes, dislikes: ignoredDislikes, savedBy, reports: ignoredReports,
    attachment: ignoredAttachment, ...visiblePost } = post;
  return {
    ...visiblePost,
    category: categories.includes(post.category) ? post.category : 'General',
    ...(typeof author?.profilePicture === 'string' ? { profilePicture: author.profilePicture } : {}),
    attachment: visibleAttachment(post.attachment),
    comments,
    likeCount: likes.length,
    dislikeCount: dislikes.length,
    commentCount: comments.length,
    userVote: likes.some(id => String(id) === String(userId))
      ? 'like' : dislikes.some(id => String(id) === String(userId)) ? 'dislike' : null,
    isSaved: Array.isArray(post.savedBy) &&
      post.savedBy.some(id => String(id) === String(userId)),
    reportCount: reports.filter(report => !report.resolvedAt).length
  };
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only administrators can moderate posts.' });
  }
  next();
}

async function storeAttachment(file) {
  const type = attachmentTypes[file.mimetype];
  if (!type || !type.matches(file.buffer)) {
    throw new Error('The uploaded file does not match its file type.');
  }
  const filename = `${crypto.randomUUID()}.${type.extension}`;
  await db.savePostAttachment(filename, file.mimetype, file.buffer);
  return {
    filename,
    name: file.originalname.replace(/[\\/\u0000-\u001f]/g, '').slice(0, 150) || `attachment.${type.extension}`,
    type: file.mimetype.startsWith('image/') ? 'image' : 'pdf',
    size: file.size
  };
}

async function removeAttachment(attachment) {
  if (!attachment?.filename) return;
  await db.deletePostAttachment(attachment.filename);
}

router.get('/moderation/reports', requireAdmin, asyncHandler(async (req, res) => {
  const data = await db.read();
  const reports = data.posts.flatMap(post =>
    (Array.isArray(post.reports) ? post.reports : [])
      .filter(report => !report.resolvedAt)
      .map(report => ({
        id: report.id,
        postId: post.id,
        postText: post.text,
        category: post.category || 'General',
        reason: report.reason,
        details: report.details,
        reportedAt: report.createdAt,
        reporterName: data.users.find(user =>
          String(user.id) === String(report.userId))?.name || 'Campus member'
      }))
  ).sort((a, b) => String(b.reportedAt).localeCompare(String(a.reportedAt)));
  res.json(reports);
}));

router.post('/moderation/reports/:reportId/resolve', requireAdmin, asyncHandler(async (req, res) => {
  const outcome = await db.update(data => {
    for (const post of data.posts) {
      const report = (Array.isArray(post.reports) ? post.reports : [])
        .find(entry => entry.id === req.params.reportId);
      if (report) {
        report.resolvedAt = new Date().toISOString();
        report.resolvedBy = req.user.id;
        return true;
      }
    }
    return false;
  });
  if (!outcome) return res.status(404).json({ error: 'Report not found.' });
  res.json({ message: 'Report marked as reviewed.' });
}));

router.get('/attachments/:filename', asyncHandler(async (req, res) => {
  const data = await db.read();
  const post = data.posts.find(entry =>
    entry.attachment?.filename === req.params.filename && entry.status !== 'removed');
  if (!post) return res.status(404).json({ error: 'Attachment not found.' });
  const attachment = await db.readPostAttachment(req.params.filename);
  if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Disposition', `inline; filename="${req.params.filename}"`);
  res.type(attachment.content_type).send(attachment.data);
}));

router.get('/:id/likes', asyncHandler(async (req, res) => {
  const data = await db.read();
  const post = data.posts.find(entry => String(entry.id) === req.params.id);
  if (!post || post.status === 'removed') {
    return res.status(404).json({ error: 'Post not found.' });
  }
  const likes = (Array.isArray(post.likes) ? post.likes : [])
    .map(id => data.users.find(user => String(user.id) === String(id)))
    .filter(Boolean)
    .map(user => ({ id: user.id, name: user.name }));
  res.json(likes);
}));

router.get('/', asyncHandler(async (req, res) => {
  const data = await db.read();
  if (['search', 'category', 'author', 'sort', 'page', 'limit', 'saved']
    .some(key => req.query[key] !== undefined && typeof req.query[key] !== 'string')) {
    return res.status(400).json({ error: 'Feed filters must be single text values.' });
  }
  const query = cleanText(req.query.search).toLocaleLowerCase();
  const category = cleanText(req.query.category);
  const author = cleanText(req.query.author).toLocaleLowerCase();
  const sort = req.query.sort || 'newest';
  if (query.length > 120 || author.length > 100) {
    return res.status(400).json({ error: 'Search text must be 120 and author filters 100 characters or fewer.' });
  }
  if (category && !categories.includes(category)) {
    return res.status(400).json({ error: 'Choose a valid feed category.' });
  }
  if (!['newest', 'oldest', 'trending', 'most-liked'].includes(sort)) {
    return res.status(400).json({ error: 'Choose a valid feed sort order.' });
  }
  const requestedPage = req.query.page === undefined ? null : Number(req.query.page);
  const requestedLimit = req.query.limit === undefined ? 10 : Number(req.query.limit);
  if ((requestedPage !== null &&
      (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 100000)) ||
      !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 30) {
    return res.status(400).json({ error: 'Choose a valid feed page and page size (1–30).' });
  }
  if (req.query.saved !== undefined && !['true', 'false'].includes(req.query.saved)) {
    return res.status(400).json({ error: 'Choose a valid saved-post filter.' });
  }
  let posts = data.posts.filter(post => post.status !== 'removed');

  if (req.query.saved === 'true') {
    posts = posts.filter(post => Array.isArray(post.savedBy) &&
      post.savedBy.some(id => String(id) === String(req.user.id)));
  }
  if (categories.includes(category)) posts = posts.filter(post => (post.category || 'General') === category);
  if (query) posts = posts.filter(post =>
    `${post.text || ''} ${post.name || ''} ${post.category || ''} ${post.attachment?.name || ''}`
      .toLocaleLowerCase().includes(query));
  if (author) posts = posts.filter(post =>
    String(post.name || '').toLocaleLowerCase().includes(author));

  posts.sort((first, second) => {
    if (sort === 'most-liked') return countLikes(second) - countLikes(first);
    if (sort === 'trending') {
      const score = post => countLikes(post) * 2 +
        (Array.isArray(post.comments) ? post.comments.length : 0);
      return score(second) - score(first) ||
        String(second.time).localeCompare(String(first.time));
    }
    const time = String(first.time || '').localeCompare(String(second.time || ''));
    return sort === 'oldest' ? time : -time;
  });

  const total = posts.length;
  const page = requestedPage || 0;
  if (page > 0) {
    const limit = requestedLimit;
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('X-Has-More', String(page * limit < total));
    posts = posts.slice((page - 1) * limit, page * limit);
  }
  res.json(posts.map(post => serializePost(post, data, req.user.id)));
}));

router.post('/', parseAttachment, asyncHandler(async (req, res) => {
  const values = validatePost(req.body || {}, Boolean(req.file), res);
  if (!values) return;
  let attachment = null;
  try {
    if (req.file) attachment = await storeAttachment(req.file);
    const post = {
      id: crypto.randomUUID(),
      userId: req.user.id,
      name: req.user.name,
      ...(typeof req.user.profilePicture === 'string'
        ? { profilePicture: req.user.profilePicture } : {}),
      text: values.text,
      category: values.category,
      attachment,
      time: new Date().toISOString(),
      likes: [],
      dislikes: [],
      comments: [],
      savedBy: [],
      reports: []
    };
    const data = await db.update(state => {
      state.posts.unshift(post);
      return state;
    });
    res.status(201).json(serializePost(post, data, req.user.id));
  } catch (error) {
    if (attachment) {
      try {
        await removeAttachment(attachment);
      } catch (cleanupError) {
        console.error('Unable to remove unsaved post attachment:', cleanupError);
      }
    }
    throw error;
  }
}));

router.put('/:id', parseAttachment, asyncHandler(async (req, res) => {
  const data = await db.read();
  const existing = data.posts.find(post => String(post.id) === req.params.id);
  if (!existing || existing.status === 'removed') {
    return res.status(404).json({ error: 'Post not found.' });
  }
  if (String(existing.userId) !== String(req.user.id)) {
    return res.status(403).json({ error: 'You can only edit your own posts.' });
  }
  const values = validatePost(
    req.body || {},
    Boolean(req.file) || (!['true', '1'].includes(String(req.body?.removeAttachment)) &&
      Boolean(existing.attachment)),
    res
  );
  if (!values) return;

  let replacement = null;
  try {
    if (req.file) replacement = await storeAttachment(req.file);
    const updated = await db.update(state => {
      const post = state.posts.find(entry => String(entry.id) === req.params.id);
      if (!post || String(post.userId) !== String(req.user.id)) return null;
      post.text = values.text;
      post.category = values.category;
      if (replacement) post.attachment = replacement;
      else if (['true', '1'].includes(String(req.body?.removeAttachment))) {
        post.attachment = null;
      }
      post.editedAt = new Date().toISOString();
      return post;
    });
    if (!updated) {
      if (replacement) await removeAttachment(replacement);
      return res.status(404).json({ error: 'Post not found.' });
    }
    if (existing.attachment && updated.attachment?.filename !== existing.attachment.filename) {
      await removeAttachment(existing.attachment);
    }
    res.json(serializePost(updated, data, req.user.id));
  } catch (error) {
    if (replacement) {
      try {
        await removeAttachment(replacement);
      } catch (cleanupError) {
        console.error('Unable to remove unsaved replacement attachment:', cleanupError);
      }
    }
    throw error;
  }
}));

router.post('/:id/vote', asyncHandler(async (req, res) => {
  const vote = req.body?.vote;
  if (!['like', 'dislike', 'none'].includes(vote)) {
    return res.status(400).json({ error: 'Choose like, dislike, or none.' });
  }
  const outcome = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post || post.status === 'removed') return null;
    post.likes = (Array.isArray(post.likes) ? post.likes : [])
      .filter(id => String(id) !== String(req.user.id));
    post.dislikes = (Array.isArray(post.dislikes) ? post.dislikes : [])
      .filter(id => String(id) !== String(req.user.id));
    if (vote === 'like') post.likes.push(req.user.id);
    if (vote === 'dislike') post.dislikes.push(req.user.id);
    return { likeCount: post.likes.length, dislikeCount: post.dislikes.length, userVote: vote === 'none' ? null : vote };
  });
  if (!outcome) return res.status(404).json({ error: 'Post not found.' });
  res.json(outcome);
}));

router.post('/:id/save', asyncHandler(async (req, res) => {
  if (req.body?.saved !== undefined && typeof req.body.saved !== 'boolean') {
    return res.status(400).json({ error: 'Saved state must be true or false.' });
  }
  const saved = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post || post.status === 'removed') return null;
    post.savedBy = Array.isArray(post.savedBy) ? post.savedBy : [];
    const alreadySaved = post.savedBy.some(id => String(id) === String(req.user.id));
    const shouldSave = typeof req.body?.saved === 'boolean' ? req.body.saved : !alreadySaved;
    post.savedBy = post.savedBy.filter(id => String(id) !== String(req.user.id));
    if (shouldSave) post.savedBy.push(req.user.id);
    return shouldSave;
  });
  if (saved === null) return res.status(404).json({ error: 'Post not found.' });
  res.json({ saved });
}));

router.post('/:id/report', asyncHandler(async (req, res) => {
  const reason = cleanText(req.body?.reason);
  const details = cleanText(req.body?.details);
  if (!['spam', 'harassment', 'misinformation', 'inappropriate', 'other'].includes(reason)) {
    return res.status(400).json({ error: 'Choose a valid report reason.' });
  }
  if (details.length > 500) {
    return res.status(400).json({ error: 'Report details must be 500 characters or fewer.' });
  }
  const outcome = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post || post.status === 'removed') return 'missing';
    post.reports = Array.isArray(post.reports) ? post.reports : [];
    if (post.reports.some(report => String(report.userId) === String(req.user.id))) return 'duplicate';
    post.reports.push({
      id: crypto.randomUUID(),
      userId: req.user.id,
      reason,
      details,
      createdAt: new Date().toISOString(),
      resolvedAt: null
    });
    return 'reported';
  });
  if (outcome === 'missing') return res.status(404).json({ error: 'Post not found.' });
  if (outcome === 'duplicate') return res.status(409).json({ error: 'You already reported this post.' });
  res.status(201).json({ message: 'Thanks. Your report was sent to campus moderators.' });
}));

router.post('/:id/comments', asyncHandler(async (req, res) => {
  const text = cleanText(req.body?.text);
  const parentCommentId = cleanText(req.body?.parentCommentId);
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty.' });
  if (text.length > 500) return res.status(400).json({ error: 'Comment must be 500 characters or fewer.' });

  const comment = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    name: req.user.name,
    text,
    time: new Date().toISOString(),
    ...(parentCommentId ? { parentCommentId } : {})
  };
  const outcome = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post || post.status === 'removed') return 'post';
    post.comments = Array.isArray(post.comments) ? post.comments : [];
    if (parentCommentId) {
      const parent = post.comments.find(entry => entry.id === parentCommentId);
      if (!parent || parent.parentCommentId) return 'parent';
    }
    post.comments.push(comment);
    return 'created';
  });
  if (outcome === 'post') return res.status(404).json({ error: 'Post not found.' });
  if (outcome === 'parent') return res.status(400).json({ error: 'Replies must reference an existing top-level comment.' });
  res.status(201).json(comment);
}));

router.delete('/:id/comments/:commentId', asyncHandler(async (req, res) => {
  const outcome = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post) return 'post';
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const comment = comments.find(entry => entry.id === req.params.commentId);
    if (!comment) return 'comment';
    if (String(comment.userId) !== String(req.user.id) &&
        String(post.userId) !== String(req.user.id) && req.user.role !== 'admin') return 'forbidden';
    post.comments = comments.filter(entry =>
      entry.id !== req.params.commentId && entry.parentCommentId !== req.params.commentId);
    return 'deleted';
  });
  if (outcome === 'post') return res.status(404).json({ error: 'Post not found.' });
  if (outcome === 'comment') return res.status(404).json({ error: 'Comment not found.' });
  if (outcome === 'forbidden') return res.status(403).json({ error: 'You cannot delete this comment.' });
  res.json({ message: 'Comment deleted.' });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const outcome = await db.update(data => {
    const post = data.posts.find(entry => String(entry.id) === req.params.id);
    if (!post) return { status: 404 };
    if (String(post.userId) !== String(req.user.id) && req.user.role !== 'admin') {
      return { status: 403 };
    }
    data.posts = data.posts.filter(entry => String(entry.id) !== req.params.id);
    return { attachment: post.attachment };
  });
  if (outcome.status) {
    return res.status(outcome.status).json({
      error: outcome.status === 403 ? 'You can only delete your own posts.' : 'Post not found.'
    });
  }
  await removeAttachment(outcome.attachment);
  res.json({ message: 'Post deleted.' });
}));

module.exports = router;
