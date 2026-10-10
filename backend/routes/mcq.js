const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { verifyToken } = require('./auth');
const { generateMCQs } = require('../mcqgenerator');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function handleUpload(req, res, next) {
  upload.single('pdf')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'PDF is too large (max 10 MB).'
        : 'Upload failed. Please try again.';
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

router.post('/', verifyToken, handleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Please choose a PDF file.' });
  }

  if (req.file.buffer.slice(0, 4).toString() !== '%PDF') {
    return res.status(400).json({ error: 'This file is not a valid PDF.' });
  }

  let count = parseInt(req.body.count, 10);
  if (Number.isNaN(count) || count < 1) count = 10;
  if (count > 30) count = 30;

  try {
    const result = await pdfParse(Uint8Array.from(req.file.buffer));
    const text = result.text || '';

    if (text.trim().length < 200) {
      return res.status(400).json({
        error: 'No readable text found. This may be a scanned PDF (images) or a password-protected file.'
      });
    }

    const questions = generateMCQs(text, count);
    res.json({ questions, pages: result.numpages || 1 });
  } catch (err) {
    console.error('MCQ error:', err.message);
    res.status(400).json({ error: err.message || 'Could not read this PDF.' });
  }
});

module.exports = router;
