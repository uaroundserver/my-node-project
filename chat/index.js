// chat/index.js
// Socket.IO + REST setup for a single global chat room for all registered users
const express = require('express');
const { Server } = require('socket.io');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');
const jwt = require('jsonwebtoken');
 
// ---------- uploads ----------
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

// ---------- helpers ----------
const asId = (v) => { try { return new ObjectId(v); } catch { return null; } };

function pickReplyView(m) {
  if (!m) return null;
  const at = m.attachments || [];
  const first = at.length
    ? {
        url: at[0].url,
        mime: at[0].mimetype || at[0].mime || '',
        originalName: at[0].originalname || at[0].originalName || null,
        size: at[0].size || null,
      }
    : null;
  return {
    _id: m._id,
    userId: m.senderId || m.userId,
    text: m.text || (first ? '(вложение)' : ''),
    attachments: first ? [first] : [],
    createdAt: m.createdAt,
  };
}

function displayName(u) {
  if (!u) return 'anon';
  const full = (u.fullName ?? '').toString().trim();
  if (full) return full;
  const name = (u.name ?? '').toString().trim();
  if (name) return name;
  const email = (u.email ?? '').toString().trim();
  if (email && email.includes('@')) return email.split('@')[0];
  return u._id ? u._id.toString().slice(-6) : 'anon';
}

function toObjectIdSafe(v) {
  if (!v) return null;
  if (v instanceof ObjectId) return v;
  let s = String(v).trim();
  const m = s.match(/^new ObjectId\(["']?([0-9a-fA-F]{24})["']?\)$/i);
  if (m) s = m[1];
  if (/^[0-9a-fA-F]{24}$/.test(s)) {
    try { return new ObjectId(s); } catch {}
  }
  return null;
}

async function buildUserMap(db, usersIdsArr) {
  const hexSet = new Set(
    (usersIdsArr || [])
      .map(v => {
        const oid = toObjectIdSafe(v);
        return oid ? oid.toHexString() : null;
      })
      .filter(Boolean)
  );
  const ids = [...hexSet].map(h => new ObjectId(h));
  if (!ids.length) return {};

  const users = await db.collection('users')
    .find({ _id: { $in: ids } }, { projection: { fullName: 1, name: 1, email: 1, avatar: 1 } })
    .toArray();

  const map = {};
  users.forEach(u => {
    map[u._id.toHexString()] = {
      name: displayName(u),
      avatar: u.avatar || null,
    };
  });
  return map;
}

function groupReactionsForClient(raw = []) {
  const byEmoji = new Map();
  for (const r of raw) {
    const emoji = (r && (r.emoji || r.reaction)) || null; // поддержка старого поля reaction
    if (!emoji) continue;
    byEmoji.set(emoji, (byEmoji.get(emoji) || 0) + 1);
  }
  return [...byEmoji.entries()].map(([emoji, count]) => ({ emoji, count }));
}

function normalizeMessage(m, userMap, replyDoc) {
  const id = (m.senderId || m.userId);
  const senderKey =
    id instanceof ObjectId ? id.toHexString()
    : (toObjectIdSafe(id)?.toHexString() || '');
  // ... остальное без изменений
// 🔽 новое: аккуратно берём имя/аватар
  const fromMap = userMap[senderKey] || {};
  const senderName =
    (fromMap.name && String(fromMap.name).trim()) ||
    (m.senderName && String(m.senderName).trim()) ||
    (m.senderEmail && String(m.senderEmail).split('@')[0]) ||
    (m.email && String(m.email).split('@')[0]) ||
    (senderKey ? senderKey.slice(-6) : 'anon');

  const senderAvatar = fromMap.avatar || m.senderAvatar || null;

  const base = {
    _id: m._id,
    chatId: m.chatId,
    senderId: m.senderId || m.userId,
    senderName,                 // 🔄 здесь используем рассчитанное имя
    senderAvatar,               // 🔄 и аватар
    text: m.text || '',
    attachments: m.attachments || [],
    replyTo: m.replyTo || null,
    createdAt: m.createdAt,
    editedAt: m.editedAt || null,
    deleted: !!m.deleted,
  reactions: groupReactionsForClient(m.reactions || []),
    reads: m.reads || [],
    deliveries: m.deliveries || [],
  };

  if (m.replyTo && replyDoc) {
    const r = pickReplyView(replyDoc);
    if (r) {
      const rKey = (r.userId || '').toString();
      base.reply = {
        ...r,
        senderName: userMap[rKey]?.name || 'user',
        senderAvatar: userMap[rKey]?.avatar || null,
      };
    }
  }
  return base;
}

/**
 * Initialize chat (routes + socket.io)
 * @param {import('http').Server} httpServer
 * @param {import('mongodb').Db} db
 * @param {import('express').Express} app
 */
function initChat(httpServer, db, app) {
  // serve uploads
  app.use('/uploads', express.static(uploadDir));

  // --- REST ---
  const router = express.Router();

  // fetch chat list (one global chat)
  // fetch chat list (one global chat)
// fetch chat list (one global chat)
router.get('/chats', auth, async (req, res) => {
  try {
    const userId = req?.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const chatsCol = db.collection('chats');
    let chat = await chatsCol.findOne({ key: 'global' });
    if (!chat) {
      chat = {
        _id: new ObjectId(),
        key: 'global',
        title: 'General chat',
        avatar: null,
        createdAt: new Date(),
      };
      await chatsCol.insertOne(chat);
    }

    const messagesCol = db.collection('messages');

    // найдём самое свежее НЕ удалённое сообщение
    const lastDoc = await messagesCol
      .find({ chatId: chat._id, deleted: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(1)
      .next();

    // нормализуем: добавим senderName / senderAvatar
    let lastMessage = null;
    if (lastDoc) {
      const userMap = await buildUserMap(db, [lastDoc.senderId || lastDoc.userId]);
      const norm = normalizeMessage(lastDoc, userMap); // без reply
      // в список чатов достаточно «лёгкой» версии
      lastMessage = {
        _id: norm._id,
        createdAt: norm.createdAt,
        text: norm.text || (norm.attachments?.length ? 'Вложение' : ''),
        senderId: norm.senderId,
        senderName: norm.senderName,
        senderAvatar: norm.senderAvatar,
      };
    }

    // подсчёт непрочитанного для текущего пользователя
    const unreadCount = await messagesCol.countDocuments({
      chatId: chat._id,
      deleted: { $ne: true },
      senderId: { $ne: asId(userId) },
      'reads.userId': { $ne: asId(userId) },
    });

    res.json([{
      _id: chat._id,
      title: chat.title,
      avatar: chat.avatar,        // аватар чата, если есть
      lastMessage,                // ← уже нормализован и самый новый
      unread: unreadCount,
    }]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

  // fetch messages with pagination (Telegram style)
// fetch messages with pagination (Telegram style) + нормализация с именами/аватарами
// fetch ALL messages for chat (no pagination)
// fetch ALL messages (без пагинации)
// === MESSAGES: вернуть ВСЕ сообщения без пагинации ===
// fetch messages with pagination (limit+skip)
// /api/chat/messages — Пагинация через limit+skip
router.get('/messages', auth, async (req, res) => {
  try {
    const { chatId, limit = 30, skip = 0 } = req.query;
    if (!chatId) return res.status(400).json({ error: 'chatId required' });

    const chatObjectId = asId(chatId);
    if (!chatObjectId) return res.status(400).json({ error: 'bad chatId' });

    const q = { chatId: chatObjectId, deleted: { $ne: true } };

    const items = await db.collection('messages')
      .find(q)
      .sort({ createdAt: -1, _id: -1 })  // последние сверху
      .skip(Number(skip))
      .limit(Number(limit))
      .toArray();

    items.reverse(); // вернуть по возрастанию времени
    res.json(items);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

    

  // get minimal message meta
  router.get('/message/:id', async (req, res) => {
    try {
      const _id = asId(req.params.id);
      if (!_id) return res.status(404).json({ error: 'Not found' });
      const doc = await db.collection('messages').findOne({ _id });
      if (!doc) return res.status(404).json({ error: 'Not found' });

      let senderName = null, senderAvatar = null;
      try {
        const u = await db.collection('users').findOne({ _id: doc.senderId || doc.userId }, { projection: { name: 1, email: 1, avatar: 1 } });
        if (u) { senderName = displayName(u); senderAvatar = u.avatar || null; }
      } catch {}

      res.json({
        _id: doc._id,
        chatId: doc.chatId,
        userId: doc.senderId || doc.userId,
        senderId: doc.senderId || doc.userId,
        senderName, senderAvatar,
        text: doc.text || '',
        attachments: doc.attachments || [],
        replyTo: doc.replyTo || null,
        createdAt: doc.createdAt,
      });
    } catch (e) {
      res.status(404).json({ error: 'Not found' });
    }
  });

  // upload attachments
  router.post('/attachments', auth, upload.array('files', 10), async (req, res) => {
    try {
      const files = (req.files || []).map((f) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        originalName: f.originalname,
        mimetype: f.mimetype,
        mime: f.mimetype,
        size: f.size,
        url: `/uploads/${f.filename}`,
      }));
      res.json({ files });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // search messages
  router.get('/search', auth, async (req, res) => {
    try {
      const { chatId, q, userId, limit = 50 } = req.query;
      if (!chatId) return res.status(400).json({ error: 'chatId required' });
      const mquery = { chatId: asId(chatId), deleted: { $ne: true } };
      if (!mquery.chatId) return res.status(400).json({ error: 'bad chatId' });
      if (q) mquery.text = { $regex: q, $options: 'i' };
      if (userId) mquery.senderId = asId(userId);
      const items = await db.collection('messages')
        .find(mquery).sort({ createdAt: 1 }).limit(Number(limit)).toArray();
      res.json(items);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  app.use('/api/chat', router);

  // --- Socket.IO ---
  const io = new Server(httpServer, { cors: { origin: true, credentials: true } });
  const onlineMap = new Map();

  io.use((socket, next) => {
    try {
      const raw = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!raw) return next(new Error('no token'));
      const token = String(raw).replace(/^Bearer\s+/i, '');
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = { id: String(payload.userId) };
      next();
    } catch {
      next(new Error('auth failed'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;

    // ensure global chat
    const chatsCol = db.collection('chats');
    let chat = await chatsCol.findOne({ key: 'global' });
    if (!chat) {
      chat = { _id: new ObjectId(), key: 'global', title: 'General chat', createdAt: new Date() };
      await chatsCol.insertOne(chat);
    }
    const room = String(chat._id);
    socket.join(room);

    if (!onlineMap.has(userId)) onlineMap.set(userId, new Set());
    onlineMap.get(userId).add(socket.id);
    io.to(room).emit('presence:update', { userId, online: true });

    // --- ADMIN EVENTS ---
    socket.on('admin:ban', async ({ targetId }, cb) => {
      try {
        const me = await db.collection('users').findOne({ _id: asId(socket.user.id) }, { projection: { role: 1 } });
        if (!['admin', 'moderator', 'superadmin'].includes(me?.role)) {
          return cb?.({ ok: false, error: 'Недостаточно прав' });
        }
        await db.collection('users').updateOne({ _id: asId(targetId) }, { $set: { isBanned: true } });
        io.emit('admin:userBanned', { userId: targetId });
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('admin:unban', async ({ targetId }, cb) => {
      try {
        const me = await db.collection('users').findOne({ _id: asId(socket.user.id) }, { projection: { role: 1 } });
        if (!['admin', 'moderator', 'superadmin'].includes(me?.role)) {
          return cb?.({ ok: false, error: 'Недостаточно прав' });
        }
        await db.collection('users').updateOne({ _id: asId(targetId) }, { $set: { isBanned: false } });
        io.emit('admin:userUnbanned', { userId: targetId });
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('admin:mute', async ({ targetId }, cb) => {
      try {
        const me = await db.collection('users').findOne({ _id: asId(socket.user.id) }, { projection: { role: 1 } });
        if (!['admin', 'moderator', 'superadmin'].includes(me?.role)) {
          return cb?.({ ok: false, error: 'Недостаточно прав' });
        }
        await db.collection('users').updateOne({ _id: asId(targetId) }, { $set: { isMuted: true } });
        io.emit('admin:userMuted', { userId: targetId });
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('admin:unmute', async ({ targetId }, cb) => {
      try {
        const me = await db.collection('users').findOne({ _id: asId(socket.user.id) }, { projection: { role: 1 } });
        if (!['admin', 'moderator', 'superadmin'].includes(me?.role)) {
          return cb?.({ ok: false, error: 'Недостаточно прав' });
        }
        await db.collection('users').updateOne({ _id: asId(targetId) }, { $set: { isMuted: false } });
        io.emit('admin:userUnmuted', { userId: targetId });
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    // --- MESSAGE EVENTS ---
    socket.on('message:send', async (data, cb) => {
      try {
        const me = await db.collection('users').findOne({ _id: asId(userId) }, { projection: { isBanned: 1, isMuted: 1 } });
        if (me?.isBanned) return cb?.({ ok: false, error: 'Вы забанены' });
        if (me?.isMuted) return cb?.({ ok: false, error: 'Вы в муте' });

        const msg = {
          _id: new ObjectId(),
          chatId: chat._id,
          senderId: asId(userId),
          text: data.text || '',
          attachments: data.attachments || [],
          replyTo: asId(data.replyTo) || null,
          createdAt: new Date(),
          reactions: [],
          reads: [],
          deliveries: [],
        };
        await db.collection('messages').insertOne(msg);
        await db.collection('chats').updateOne(
  { _id: chat._id },
  { $set: { lastMessage: msg } }
);

        const userMap = await buildUserMap(db, [userId]);
        const norm = normalizeMessage(msg, userMap);
        await db.collection('chats').updateOne(
  { _id: chat._id },
  { $set: {
      lastMessage: {
        _id: msg._id,
        text: norm.text || '',
        createdAt: norm.createdAt,
        senderId: msg.senderId,
        senderName: norm.senderName || 'user',
      }
    }
  }
);
        io.to(room).emit('message:new', norm);

        cb?.({ ok: true, message: norm });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('message:edit', async ({ id, text }, cb) => {
      try {
        const _id = asId(id);
        if (!_id) return;
        const msg = await db.collection('messages').findOne({ _id });
        if (!msg) return;
        if (String(msg.senderId) !== userId) return cb?.({ ok: false, error: 'Нет прав' });

        await db.collection('messages').updateOne({ _id }, { $set: { text, editedAt: new Date() } });
        io.to(room).emit('message:edited', { id: _id, text, editedAt: new Date() });
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('message:delete', async ({ id }, cb) => {
      try {
        const _id = asId(id);
        if (!_id) return;
        const msg = await db.collection('messages').findOne({ _id });
        if (!msg) return;
        if (String(msg.senderId) !== userId) return cb?.({ ok: false, error: 'Нет прав' });

        await db.collection('messages').updateOne({ _id }, { $set: { deleted: true } });
        io.to(room).emit('message:deleted', { _id });
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('message:react', async ({ id, emoji }, cb) => {
  try {
    const _id = asId(id);
    if (!_id || !emoji) return cb?.({ ok: false, error: 'bad args' });

    // 1) достаём сообщение
    const msg = await db.collection('messages').findOne({ _id });
    if (!msg) return cb?.({ ok: false, error: 'not found' });

    // 2) текущий список реакций (поддержим старое поле reaction)
    const raw = Array.isArray(msg.reactions) ? msg.reactions.slice() : [];

    // 3) переключатель: если у пользователя уже есть эта emoji — снимаем,
    //    иначе — добавляем { userId, emoji }
    const uid = String(asId(userId));
    const had = raw.find(r => String(r.userId) === uid && (r.emoji || r.reaction) === emoji);

    let next;
    if (had) {
      next = raw.filter(r => !(String(r.userId) === uid && (r.emoji || r.reaction) === emoji));
    } else {
      next = raw.concat([{ userId: asId(userId), emoji }]);
    }

    // 4) сохраняем
    await db.collection('messages').updateOne({ _id }, { $set: { reactions: next } });

    // 5) шлём всем в комнате сгруппированный вид
    const normalized = groupReactionsForClient(next);
    io.to(room).emit('message:reactions', { id: _id, reactions: normalized });

    cb?.({ ok: true });
  } catch (e) {
    cb?.({ ok: false, error: e.message });
  }
});

    socket.on('message:read', async ({ id }, cb) => {
      try {
        const _id = asId(id);
        if (!_id) return;
        await db.collection('messages').updateOne(
          { _id },
          { $addToSet: { reads: { userId: asId(userId), at: new Date() } } }
        );
        io.to(room).emit('message:read', { _id, userId });
        cb?.({ ok: true });
      } catch (e) {
        cb?.({ ok: false, error: e.message });
      }
    });

    socket.on('typing', () => {
      io.to(room).emit('typing', { userId });
    });

    socket.on('disconnect', () => {
      if (onlineMap.has(userId)) {
        onlineMap.get(userId).delete(socket.id);
        if (!onlineMap.get(userId).size) {
          onlineMap.delete(userId);
          io.to(room).emit('presence:update', { userId, online: false });
        }
      }
    });
  });

  return { io };
}

module.exports = { initChat };