// chat/index.js
// Маршруты и Socket.IO-логика чата с учетом бан/мут и совместимости JWT (sub|userId)

const express = require('express');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth'); // декодирует JWT -> req.user

// === Настройки загрузки вложений ===
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const name = path.basename(file.originalname || 'file', ext).slice(0, 64);
    cb(null, `${Date.now()}_${name}${ext}`);
  }
});

// Базовая фильтрация типов (при необходимости расширь)
const fileFilter = (req, file, cb) => {
  const ok = [
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf', 'text/plain', 'audio/mpeg', 'audio/wav', 'audio/x-wav'
  ].includes(file.mimetype);
  cb(ok ? null : new Error('Недопустимый тип файла'), ok);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// === Вспомогалки ===
function pickUserId(userPayload) {
  return userPayload?.sub || userPayload?.userId || null;
}

function publicMessageFields(msg) {
  // проекция полей сообщения наружу
  /* предполагаем структура:
     { _id, senderId, text, files[], createdAt, roomId?, ... } */
  if (!msg) return null;
  return {
    _id: msg._id,
    senderId: msg.senderId,
    text: msg.text || '',
    files: Array.isArray(msg.files) ? msg.files : [],
    createdAt: msg.createdAt,
    roomId: msg.roomId || null
  };
}

/**
 * Экспортируем фабрику: получаем db и io, возвращаем Express Router
 * Используй в server.js:
 *   const chatRouter = require('./chat')(db, io);
 *   app.use('/api/chat', chatRouter);
 */
module.exports = function createChatModule(db, io) {
  const router = express.Router();
  const messagesCol = () => db.collection('messages');
  const usersCol = () => db.collection('users');

  // Глобальная защита чата: нужен токен + не бан
  router.use(auth, guardNotBanned);

  // === REST: получить последние сообщения ===
  router.get('/messages', async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
      const q = {};
      if (req.query.roomId) q.roomId = String(req.query.roomId);
      const list = await messagesCol()
        .find(q)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      res.json(list.reverse().map(publicMessageFields));
    } catch (e) {
      console.error('GET /messages error:', e);
      res.status(500).json({ error: 'Не удалось получить сообщения' });
    }
  });

  // === REST: отправить сообщение (учтём mute) ===
  router.post('/messages', upload.array('files', 5), async (req, res) => {
    try {
      // guardNotBanned уже положил флаг mute
      if (req.__userFlags?.isMuted) {
        return res.status(403).json({ error: 'Вы замьючены' });
      }
      const uid = pickUserId(req.user);
      const text = (req.body?.text || '').toString().slice(0, 4000);
      const roomId = req.body?.roomId ? String(req.body.roomId) : null;

      const files = (req.files || []).map(f => ({
        name: f.originalname,
        path: '/uploads/' + path.basename(f.path),
        mimetype: f.mimetype,
        size: f.size
      }));

      if (!text && files.length === 0) {
        return res.status(400).json({ error: 'Пустое сообщение' });
      }

      const doc = {
        senderId: uid,
        text,
        files,
        roomId,
        createdAt: new Date()
      };
      const ins = await messagesCol().insertOne(doc);

      const out = { ...doc, _id: ins.insertedId };
      // Шлём событие в сокет всем (или в комнату)
      if (roomId) io.to(roomId).emit('chat:new', publicMessageFields(out));
      else io.emit('chat:new', publicMessageFields(out));

      res.status(201).json(publicMessageFields(out));
    } catch (e) {
      console.error('POST /messages error:', e);
      res.status(500).json({ error: 'Не удалось отправить сообщение' });
    }
  });

  // === REST: удалить своё сообщение (или админом/модератором) ===
  router.delete('/messages/:id', async (req, res) => {
    try {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'bad id' });

      const uid = pickUserId(req.user);
      const me = await usersCol().findOne(
        { _id: new ObjectId(uid) },
        { projection: { role: 1 } }
      );
      const msg = await messagesCol().findOne({ _id: new ObjectId(id) });
      if (!msg) return res.status(404).json({ error: 'Сообщение не найдено' });

      const isOwner = String(msg.senderId) === String(uid);
      const canModerate = ['moderator', 'admin', 'superadmin'].includes(me?.role);

      if (!isOwner && !canModerate) {
        return res.status(403).json({ error: 'Недостаточно прав' });
      }

      await messagesCol().deleteOne({ _id: new ObjectId(id) });
      io.emit('chat:delete', { _id: msg._id });
      res.json({ ok: true });
    } catch (e) {
      console.error('DELETE /messages/:id error:', e);
      res.status(500).json({ error: 'Не удалось удалить сообщение' });
    }
  });

  // === Socket.IO интеграция ===
  // Примечание: сервер сокетов настраивается в server.js; здесь — обработчики.
  io.use(socketJwtAuth(db)); // middleware авторизации на уровне сокета

  io.on('connection', (socket) => {
    // В socket.user уже положили { _id, role, isBanned, isMuted }
    const { user } = socket;
    const uid = user?._id?.toString();

    if (!user || user.isBanned) {
      socket.emit('error', 'Доступ запрещён');
      socket.disconnect(true);
      return;
    }

    // Вступление в комнату (по запросу клиента)
    socket.on('chat:join', (roomId) => {
      if (!roomId) return;
      socket.join(String(roomId));
    });

    // Отправка сообщения через сокеты
    socket.on('chat:send', async (payload, cb) => {
      try {
        if (user.isMuted) {
          return cb?.({ ok: false, error: 'Вы замьючены' });
        }
        const text = (payload?.text || '').toString().slice(0, 4000);
        const roomId = payload?.roomId ? String(payload.roomId) : null;
        if (!text) return cb?.({ ok: false, error: 'Пустое сообщение' });

        const doc = {
          senderId: uid,
          text,
          files: [],
          roomId,
          createdAt: new Date()
        };
        const ins = await messagesCol().insertOne(doc);
        const out = { ...doc, _id: ins.insertedId };

        if (roomId) io.to(roomId).emit('chat:new', publicMessageFields(out));
        else io.emit('chat:new', publicMessageFields(out));

        cb?.({ ok: true, message: publicMessageFields(out) });
      } catch (e) {
        console.error('socket chat:send error:', e);
        cb?.({ ok: false, error: 'Ошибка отправки' });
      }
    });

    socket.on('disconnect', () => {
      // noop
    });
  });

  // === Middleware: бан/мут для REST ===
  async function guardNotBanned(req, res, next) {
    try {
      const uid = pickUserId(req.user);
      if (!uid) return res.status(401).json({ error: 'Нет токена' });

      const user = await usersCol().findOne(
        { _id: new ObjectId(uid) },
        { projection: { isBanned: 1, isMuted: 1 } }
      );
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      if (user.isBanned) return res.status(403).json({ error: 'Пользователь забанен' });
      req.__userFlags = { isMuted: !!user.isMuted };
      next();
    } catch (e) {
      console.error('guardNotBanned error:', e);
      res.status(500).json({ error: 'Ошибка проверки статуса' });
    }
  }

  // === Socket.IO JWT auth middleware ===
  function socketJwtAuth(db) {
    const jwt = require('jsonwebtoken');
    return async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          (socket.handshake.headers?.authorization || '').replace(/^Bearer /i, '');

        if (!token) return next(new Error('No token'));
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const uid = pickUserId(payload);
        if (!uid) return next(new Error('Bad token'));

        const user = await usersCol().findOne(
          { _id: new ObjectId(uid) },
          { projection: { role: 1, isBanned: 1, isMuted: 1 } }
        );
        if (!user) return next(new Error('Unauthorized'));

        socket.user = { _id: new ObjectId(uid), role: user.role || 'user', isBanned: !!user.isBanned, isMuted: !!user.isMuted };
        next();
      } catch (e) {
        next(new Error('Auth failed'));
      }
    };
  }

  return router;
};