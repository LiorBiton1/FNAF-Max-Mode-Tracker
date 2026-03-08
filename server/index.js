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

let db;
let usersCol;
let completionsCol;

async function initDb() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI missing in .env');
  }
  const client = await MongoClient.connect(MONGODB_URI);
  db = client.db();
  usersCol = db.collection('users');
  completionsCol = db.collection('completions');
  await usersCol.createIndex({ username: 1 }, { unique: true });
  await completionsCol.createIndex({ userId: 1 });
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

app.get('/api/health', (_, res) => res.json({ ok: true }));

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
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  });
