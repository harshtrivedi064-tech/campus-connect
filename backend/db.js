const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

const FILE = process.env.CAMPUS_CONNECT_DATA_FILE || path.join(__dirname, 'data.json');
const PHOTO_DIRECTORY = path.join(__dirname, 'uploads', 'events');
const DATABASE_URL = process.env.DATABASE_URL;
const INITIAL_DATA = {
  users: [],
  posts: [],
  attendanceSessions: [],
  attendanceReports: [],
  events: []
};

if (process.env.NODE_ENV === 'production' && !DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured in production for persistent storage.');
}

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : null;

let databaseReady;
let fileUpdateQueue = Promise.resolve();

function normalize(data) {
  data.users = Array.isArray(data.users) ? data.users : [];
  data.posts = Array.isArray(data.posts) ? data.posts : [];
  data.posts.forEach(post => {
    post.likes = Array.isArray(post.likes) ? post.likes : [];
    post.dislikes = Array.isArray(post.dislikes) ? post.dislikes : [];
    post.comments = Array.isArray(post.comments) ? post.comments : [];
  });
  data.attendanceSessions = Array.isArray(data.attendanceSessions) ? data.attendanceSessions : [];
  data.attendanceReports = Array.isArray(data.attendanceReports) ? data.attendanceReports : [];
  data.events = Array.isArray(data.events) ? data.events : [];
  return data;
}

async function ensureDatabase() {
  if (!databaseReady) {
    databaseReady = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS campus_loop_state (
          id SMALLINT PRIMARY KEY CHECK (id = 1),
          data JSONB NOT NULL
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS campus_loop_event_photos (
          filename TEXT PRIMARY KEY,
          content_type TEXT NOT NULL,
          data BYTEA NOT NULL
        )
      `);
      await pool.query('ALTER TABLE campus_loop_state ENABLE ROW LEVEL SECURITY');
      await pool.query('ALTER TABLE campus_loop_event_photos ENABLE ROW LEVEL SECURITY');
      await pool.query(
        'INSERT INTO campus_loop_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING',
        [JSON.stringify(INITIAL_DATA)]
      );
    })().catch(error => {
      databaseReady = null;
      throw error;
    });
  }
  await databaseReady;
}

async function readFileData() {
  try {
    return normalize(JSON.parse(await fs.readFile(FILE, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(INITIAL_DATA, null, 2), { flag: 'wx' });
    return { ...INITIAL_DATA, users: [], posts: [], attendanceSessions: [], events: [] };
  }
}

async function read() {
  if (!pool) {
    await fileUpdateQueue;
    return readFileData();
  }

  await ensureDatabase();
  const { rows } = await pool.query('SELECT data FROM campus_loop_state WHERE id = 1');
  if (!rows[0]) {
    throw new Error('Persistent application data row is missing.');
  }
  return normalize(rows[0].data);
}

async function updateFile(mutator) {
  const operation = fileUpdateQueue.then(async () => {
    const data = await readFileData();
    const result = mutator(data);
    const temporaryFile = `${FILE}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(data, null, 2), { flag: 'wx' });
    await fs.rename(temporaryFile, FILE);
    return result;
  });
  fileUpdateQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

async function update(mutator) {
  if (!pool) return updateFile(mutator);

  await ensureDatabase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT data FROM campus_loop_state WHERE id = 1 FOR UPDATE'
    );
    if (!rows[0]) {
      throw new Error('Persistent application data row is missing.');
    }

    const data = normalize(rows[0].data);
    const result = mutator(data);
    await client.query(
      'UPDATE campus_loop_state SET data = $1::jsonb WHERE id = 1',
      [JSON.stringify(data)]
    );
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function savePhoto(filename, contentType, data) {
  if (!/^[0-9a-f-]+\.(jpg|png|webp|gif)$/i.test(filename)) {
    throw new Error('Invalid event photo filename.');
  }
  if (pool) {
    await ensureDatabase();
    await pool.query(
      'INSERT INTO campus_loop_event_photos (filename, content_type, data) VALUES ($1, $2, $3)',
      [filename, contentType, data]
    );
    return;
  }

  await fs.mkdir(PHOTO_DIRECTORY, { recursive: true });
  await fs.writeFile(path.join(PHOTO_DIRECTORY, filename), data, { flag: 'wx' });
}

async function readPhoto(filename) {
  if (!/^[0-9a-f-]+\.(jpg|png|webp|gif)$/i.test(filename)) {
    return null;
  }
  if (pool) {
    await ensureDatabase();
    const { rows } = await pool.query(
      'SELECT content_type, data FROM campus_loop_event_photos WHERE filename = $1',
      [filename]
    );
    return rows[0] || null;
  }

  try {
    const data = await fs.readFile(path.join(PHOTO_DIRECTORY, filename));
    const extension = path.extname(filename).slice(1).toLowerCase();
    const contentType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`;
    return { content_type: contentType, data };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function deletePhoto(filename) {
  if (!/^[0-9a-f-]+\.(jpg|png|webp|gif)$/i.test(filename)) {
    throw new Error('Invalid event photo filename.');
  }
  if (pool) {
    await ensureDatabase();
    await pool.query('DELETE FROM campus_loop_event_photos WHERE filename = $1', [filename]);
    return;
  }

  try {
    await fs.unlink(path.join(PHOTO_DIRECTORY, filename));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function close() {
  if (pool) await pool.end();
}

async function initialize() {
  if (pool) await ensureDatabase();
}

module.exports = { read, update, savePhoto, readPhoto, deletePhoto, initialize, close };
