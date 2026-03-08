require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const MONGODB_URI = process.env.MONGODB_URI;
const FNAF_API = 'https://fnafmml.com/api';
const PAGE_SIZE = 50;

let db;
let usersCol;
let completionsCol;
let listCacheCol;
let motwCacheCol;

async function fetchFromFnafmml(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fnafmml API: ${res.status}`);
  return res.json();
}

async function refreshMaxmodeCache() {
  for (const list of ['ml', 'ul']) {
    const all = [];
    let page = 1;
    let total = 1;
    while (page <= total) {
      const data = await fetchFromFnafmml(`${FNAF_API}/maxmodes/list?list=${list}&page=${page}`);
      all.push(...(data.maxmodes || []));
      total = data.totalPages ?? 1;
      page++;
    }
    await listCacheCol.updateOne(
      { list },
      { $set: { list, maxmodes: all, totalCount: all.length, totalPages: Math.ceil(all.length / PAGE_SIZE), lastFetched: new Date() } },
      { upsert: true }
    );
    console.log(`Cached ${all.length} maxmodes for ${list}`);
  }
}

async function refreshMotwCache() {
  const data = await fetchFromFnafmml(`${FNAF_API}/motw`);
  await motwCacheCol.updateOne(
    {},
    { $set: { motw: data.motw, lastFetched: new Date() } },
    { upsert: true }
  );
  console.log('Cached MOTW');
}

async function refreshCache() {
  await refreshMaxmodeCache();
  await refreshMotwCache();
}

async function initDb() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI missing in .env');
  }
  const client = await MongoClient.connect(MONGODB_URI);
  db = client.db();
  usersCol = db.collection('users');
  completionsCol = db.collection('completions');
  listCacheCol = db.collection('listCache');
  motwCacheCol = db.collection('motwCache');
  await usersCol.createIndex({ username: 1 }, { unique: true });
  await completionsCol.createIndex({ userId: 1 });
  await listCacheCol.createIndex({ list: 1 }, { unique: true });
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/api/maxmodes/list', async (req, res) => {
  try {
    const list = req.query.list === 'ul' ? 'ul' : 'ml';
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const search = (req.query.search || '').trim().toLowerCase();
    const doc = await listCacheCol.findOne({ list });
    if (!doc?.maxmodes?.length) {
      return res.status(503).json({ error: 'List cache empty. Click Refresh list to fetch from fnafmml.com' });
    }
    let maxmodes = doc.maxmodes;
    if (search) {
      maxmodes = maxmodes.filter(
        (m) =>
          (m.title || '').toLowerCase().includes(search) ||
          (m.game?.title || '').toLowerCase().includes(search) ||
          (m.creator_name || '').toLowerCase().includes(search)
      );
    }
    const totalCount = maxmodes.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const start = (page - 1) * PAGE_SIZE;
    const pageMaxmodes = maxmodes.slice(start, start + PAGE_SIZE);
    res.json({ maxmodes: pageMaxmodes, totalCount, totalPages });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/motw', async (req, res) => {
  try {
    const doc = await motwCacheCol.findOne({});
    if (doc?.motw) {
      return res.json(doc);
    }
    const data = await fetchFromFnafmml(`${FNAF_API}/motw`);
    res.json({ motw: data.motw });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/refresh-cache', async (req, res) => {
  try {
    await refreshCache();
    res.json({ ok: true, message: 'Cache refreshed from fnafmml.com' });
  } catch (e) {
    console.error('Refresh cache failed:', e);
    res.status(500).json({ error: e.message });
  }
});

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing token' });
  }
  try {
    const token = auth.slice(7);
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = username.trim().toLowerCase();
  if (user.length < 2) return res.status(400).json({ error: 'Username too short' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await usersCol.insertOne({ username: user, password_hash: hash, createdAt: new Date() });
    const id = result.insertedId.toString();
    const token = jwt.sign({ id, username: user }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, username: user } });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Username taken' });
    throw e;
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = username.trim().toLowerCase();
  const r = await usersCol.findOne({ username: user });
  if (!r) return res.status(401).json({ error: 'Invalid username or password' });
  const ok = await bcrypt.compare(password, r.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
  const id = r._id.toString();
  const token = jwt.sign({ id, username: r.username }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id, username: r.username } });
});

app.get('/api/completions', authMiddleware, async (req, res) => {
  const doc = await completionsCol.findOne({ userId: req.user.id });
  res.json({ completions: doc?.maxmodeIds || [] });
});

app.put('/api/completions', authMiddleware, async (req, res) => {
  const { completions: list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'completions must be an array' });
  const ids = list.filter((id) => typeof id === 'string' && id.length > 0);
  await completionsCol.updateOne(
    { userId: req.user.id },
    { $set: { userId: req.user.id, maxmodeIds: ids } },
    { upsert: true }
  );
  res.json({ ok: true });
});

initDb()
  .then(async () => {
    const ml = await listCacheCol.findOne({ list: 'ml' });
    if (!ml?.maxmodes?.length) {
      console.log('List cache empty, fetching from fnafmml.com...');
      refreshCache().catch((e) => console.error('Initial cache fetch failed:', e.message));
    }
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
