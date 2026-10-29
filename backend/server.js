const express = require('express');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const rootDir = path.join(__dirname, '..');

// ---------- Keep the server alive on unexpected errors ----------
process.on('uncaughtException', err => console.error('Uncaught error:', err));
process.on('unhandledRejection', err => console.error('Unhandled promise error:', err));

// ---------- Load routes (the MCQ route will not crash the whole server) ----------
const { router: authRouter } = require('./routes/auth');
const postsRouter = require('./routes/posts');
const attendanceRouter = require('./routes/attendance');
const eventsRouter = require('./routes/events');
const aiRouter = require('./routes/ai');

let mcqRouter = null;
try {
  mcqRouter = require('./routes/mcq');
} catch (err) {
  console.error('\n[!] MCQ feature is disabled: ' + err.message);
  console.error('    Fix: inside the backend folder run: npm install multer pdf-parse@1.1.1\n');
}

// Production serves the frontend and API from one origin; local development may use Live Server.
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({
    origin: function (origin, callback) {
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    }
  }));
}

// ---------- Basic security headers ----------
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// ---------- Body parsing with a size limit ----------
app.use(express.json({ limit: '100kb' }));

// ---------- Request logger ----------
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const requestUrl = req.path === '/auth/google/callback'
      ? req.path
      : req.originalUrl;
    console.log(req.method + ' ' + requestUrl + ' -> ' + res.statusCode + ' (' + (Date.now() - start) + 'ms)');
  });
  next();
});

// ---------- Simple rate limiter (protects login from brute force) ----------
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.reset) hits.delete(key);
    }
  }, windowMs).unref();

  return function (req, res, next) {
    const now = Date.now();
    const entry = hits.get(req.ip);

    if (!entry || now > entry.reset) {
      hits.set(req.ip, { count: 1, reset: now + windowMs });
      return next();
    }

    entry.count++;
    if (entry.count > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many attempts. Please try again in a few minutes.'
});

// ---------- Serve the frontend and API ----------
app.use(express.static(rootDir, { index: ['index.html'] }));

app.get('/', (req, res) => {
  res.sendFile(path.join(rootDir, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', mcq: mcqRouter !== null });
});

app.use('/auth', authLimiter, authRouter);
app.use('/posts', postsRouter);
app.use('/attendance', attendanceRouter);
app.use('/events', eventsRouter);
app.use('/ai', aiRouter);

if (mcqRouter) {
  app.use('/mcq', mcqRouter);
} else {
  app.use('/mcq', (req, res) => {
    res.status(503).json({ error: 'MCQ feature is not installed on the server.' });
  });
}

// ---------- 404 for unknown routes ----------
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// ---------- Central error handler ----------
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request.' });
  }
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  console.error('Server error:', err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

// ---------- Start ----------
const server = app.listen(PORT, () => {
  console.log('Server running on http://localhost:' + PORT);
  console.log('MCQ feature: ' + (mcqRouter ? 'enabled' : 'DISABLED (see message above)'));
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error('\nPort ' + PORT + ' is already in use.');
    console.error('Close the other terminal running the server, then try again.\n');
  } else {
    console.error('Server failed to start:', err);
  }
  process.exit(1);
});

// ---------- Clean shutdown with Ctrl + C ----------
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => process.exit(0));
});