const express = require('express');
const cors = require('cors');
const path = require('path');
const { router: authRouter } = require('./routes/auth');
const postsRouter = require('./routes/posts');
const attendanceRouter = require('./routes/attendance');

const app = express();
const rootDir = path.join(__dirname, '..');

app.use(cors());
app.use(express.json());
app.use(express.static(rootDir));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);
app.use('/posts', postsRouter);
app.use('/attendance', attendanceRouter);

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Server running on http://localhost:${port}`));