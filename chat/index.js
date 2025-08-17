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
    reactions: m.reactions || [],
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
        // можно задать дефолтную аву для списка:
        avatar: chat?.avatar ?? null, // оставим как есть; см. фронт ниже для fallback
        createdAt: new Date(),
        lastMessage: null,
      };
      await chatsCol.insertOne(chat);
    }

    // считаем непрочитанные
    const messagesCol = db.collection('messages');
    const meId = asId(userId);
    const unreadCount = await messagesCol.countDocuments({
      chatId: chat._id,
      deleted: { $ne: true },
      'reads.userId': { $ne: meId },
      senderId: { $ne: meId },
    });

    // берём самый свежий message
    const latest = await messagesCol
      .find({ chatId: chat._id, deleted: { $ne: true } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(1)
      .toArray();

    let lastMessage = null;
    if (latest[0]) {
      const u = await db.collection('users')
        .findOne({ _id: latest[0].senderId }, { projection: { fullName:1, name:1, email:1, avatar:1 } });
      lastMessage = {
        _id: latest[0]._id,
        text: latest[0].text || '',
        createdAt: latest[0].createdAt,
        senderId: latest[0].senderId,
        senderName: displayName(u) || 'user',
      };
    }

    res.json([{
      _id: chat._id,
      title: chat.title,
      avatar: chat.avatar || null,
      lastMessage,
      unread: unreadCount,
    }]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

  // fetch messages with pagination (Telegram style)
// fetch messages with pagination (Telegram style) + нормализация с именами/аватарами
router.get('/messages', auth, async (req, res) => {
  try {
    const { chatId, before, limit = 50 } = req.query;
    if (!chatId) return res.status(400).json({ error: 'chatId required' });

    const q = { chatId: asId(chatId), deleted: { $ne: true } };
    if (!q.chatId) return res.status(400).json({ error: 'bad chatId' });

    if (before) {
      const dt = new Date(before);
      if (!isNaN(+dt)) q.createdAt = { $lt: dt };
    }

    // берём сырьё
    const items = await db.collection('messages')
      .find(q)
      .sort({ createdAt: -1, _id: -1 })
      .limit(Number(limit))
      .toArray();

    // документы для цитат (reply)
    const replyIds = items.filter(x => x.replyTo).map(x => x.replyTo).filter(Boolean);
    const replyDocs = replyIds.length
      ? await db.collection('messages')
          .find({ _id: { $in: replyIds } }, { projection: { text: 1, attachments: 1, senderId: 1, userId: 1, createdAt: 1 } })
          .toArray()
      : [];

    // карту пользователей (отправители + отправители цитат)
    const senders = [
      ...items.map(x => (x.senderId || x.userId)).filter(Boolean),
      ...replyDocs.map(x => x.senderId || x.userId).filter(Boolean),
    ];
    const userMap = await buildUserMap(db, senders);

    // нормализуем
    const replyMap = {};
    replyDocs.forEach(d => { replyMap[d._id.toString()] = d; });

    const ordered = items.reverse().map(m =>
      normalizeMessage(m, userMap, m.replyTo ? replyMap[m.replyTo.toString()] : null)
    );

    res.json(ordered);
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
        io.to(room).emit('message:edited', { _id, text, editedAt: new Date() });
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

    socket.on('message:react', async ({ id, reaction }, cb) => {
      try {
        const _id = asId(id);
        if (!_id) return;
        await db.collection('messages').updateOne(
          { _id },
          { $addToSet: { reactions: { userId: asId(userId), reaction } } }
        );
        io.to(room).emit('message:reacted', { _id, userId, reaction });
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