// server.js
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MongoClient } = require('mongodb');
const { Server } = require('socket.io');

// Роуты и контроллеры
const { register, activate, login } = require('./controllers/authController');
const userRoutesFactory = require('./routes/user');   // r = userRoutesFactory(db)
const adminRoutesFactory = require('./routes/admin'); // r = adminRoutesFactory(db)
const createChatModule = require('./chat');           // r = createChatModule(db, io)

// === Конфиг ===
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'DBUA';
const CLIENT_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// === App/Server/IO ===
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGINS.length ? CLIENT_ORIGINS : true
  }
});

// === Middlewares (глобальные) ===
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' } // чтобы картинки из /uploads нормально отдавались
}));
app.use(cors({
  origin: CLIENT_ORIGINS.length ? CLIENT_ORIGINS : true
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limit только на чувствительные маршруты
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 минут
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false
});

// === Статика ===
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

// Отдаём папку загрузок (для вложений чата)
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// === Подключение к Mongo ===
let db;
(async () => {
  const client = new MongoClient(MONGO_URI, { ignoreUndefined: true });
  await client.connect();
  db = client.db(DB_NAME);
  console.log('[mongo] connected');

  // Базовые индексы (не критично, но полезно)
  try { await db.collection('users').createIndex({ email: 1 }, { unique: true }); } catch {}
  try { await db.collection('users').createIndex({ createdAt: -1 }); } catch {}
  try { await db.collection('messages').createIndex({ createdAt: -1 }); } catch {}

  // === Маршруты зависят от db, поэтому монтируем после подключения ===

  // Аутентификация
  app.post('/api/register', authLimiter, (req, res) => register(req, res, db));
  app.get('/activate/:token', (req, res) => activate(req, res, db));
  app.post('/api/login', authLimiter, (req, res) => login(req, res, db));

  // Пользовательские маршруты (/api/user/*)
  app.use('/api/user', userRoutesFactory(db));

  // Админка (/api/admin/*) — закрыта мидлами внутри самого роутера
  app.use('/api/admin', adminRoutesFactory(db));

  // Чат REST + Socket.IO
  const chatRouter = createChatModule(db, io);
  app.use('/api/chat', chatRouter);

  // Фронтовые странички админки уже лежат в /public/admin/*
  // Никакой дополнительной статики не требуется.

  // 404 для API
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Глобальный обработчик ошибок (на крайняк)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  // Стартуем сервер
  server.listen(PORT, () => {
    console.log(`[http] listening on :${PORT}`);
  });
})().catch((e) => {
  console.error('Bootstrap failed:', e);
  process.exit(1);
}); 