// chat/index.js
// Socket.IO + REST setup for a single global chat room for all registered users

const { Server } = require('socket.io');
const { ObjectId } = require('mongodb');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../middleware/auth');

// Simple disk storage for attachments. Swap to GridFS if needed.
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

/**
 * Initialize chat (routes + socket.io)
 * @param {import('http').Server} httpServer
 * @param {import('mongodb').Db} db
 * @param {import('express').Express} app
 */
function initChat(httpServer, db, app) {
  // Serve uploaded files
  app.use('/uploads', require('express').static(uploadDir));

  // --- REST endpoints ---
  const router = require('express').Router();

  // fetch chat list (currently one global chat)
  router.get('/chats', auth, async (req, res) => {
    try {
      const userId = req?.user?.userId; // 🔧 токен содержит userId
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
          lastMessage: null,
        };
        await chatsCol.insertOne(chat);
      }

      // unread count for this user
      const messagesCol = db.collection('messages');
      const unreadCount = await messagesCol.countDocuments({
        chatId: chat._id,
        'reads.userId': { $ne: new ObjectId(userId) },
        senderId: { $ne: new ObjectId(userId) },
        deleted: { $ne: true },
      });

      res.json([{
        _id: chat._id,
        title: chat.title,
        avatar: chat.avatar,
        lastMessage: chat.lastMessage || null,
        unread: unreadCount,
      }]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load chats' });
    }
  });

  // fetch messages with pagination
  router.get('/messages', auth, async (req, res) => {
    try {
      const { chatId, before, limit = 30 } = req.query;
      if (!chatId) return res.status(400).json({ error: 'chatId required' });
      const messagesCol = db.collection('messages');
      const q = { chatId: new ObjectId(chatId), deleted: { $ne: true } };
      if (before) q.createdAt = { $lt: new Date(before) };

      const cursor = messagesCol.find(q).sort({ createdAt: -1 }).limit(Number(limit));
      const items = await cursor.toArray();
      res.json(items.reverse());
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load messages' });
    }
  });

  // upload attachment(s)
  router.post('/attachments', auth, upload.array('files', 10), async (req, res) => {
    try {
      const files = (req.files || []).map(f => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        url: `/uploads/${f.filename}`,
      }));
      res.json({ files });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // search messages by text or user
  router.get('/search', auth, async (req, res) => {
    try {
      const { chatId, q, userId, limit = 50 } = req.query;
      if (!chatId) return res.status(400).json({ error: 'chatId required' });
      const messagesCol = db.collection('messages');
      const mquery = { chatId: new ObjectId(chatId), deleted: { $ne: true } };
      if (q) mquery.text = { $regex: q, $options: 'i' };
      if (userId) mquery.senderId = new ObjectId(userId);
      const items = await messagesCol.find(mquery).sort({ createdAt: 1 }).limit(Number(limit)).toArray();
      res.json(items);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  app.use('/api/chat', router);

  // --- Socket.IO real-time ---
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
  });

  // userId(string) -> Set(socketId)
  const onlineMap = new Map();

  io.use((socket, next) => {
    try {
      // token can be in handshake.auth.token or query.token
      const raw = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!raw) return next(new Error('no token'));
      const jwt = require('jsonwebtoken');
      const token = String(raw).replace(/^Bearer\s+/i, '');
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      // 🔧 наш сервер создаёт токен с полем userId
      socket.user = { id: String(payload.userId) };
      next();
    } catch (e) {
      next(new Error('auth failed'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;

    // Join global room (create if missing)
    const chatsCol = db.collection('chats');
    let chat = await chatsCol.findOne({ key: 'global' });
    if (!chat) {
      chat = {
        _id: new ObjectId(),
        key: 'global',
        title: 'General chat',
        createdAt: new Date(),
      };
      await chatsCol.insertOne(chat);
    }
    const room = String(chat._id);
    socket.join(room);

    // mark online
    if (!onlineMap.has(userId)) onlineMap.set(userId, new Set());
    onlineMap.get(userId).add(socket.id);
    io.to(room).emit('presence:update', { userId, online: true });

    // SEND MESSAGE (with replyToOwnerId for notifications)
    socket.on('message:send', async (payload, cb) => {
      try {
        const messagesCol = db.collection('messages');
        const usersCol = db.collection('users');

        const sender = await usersCol.findOne({ _id: new ObjectId(userId) });

        // If it's a reply, find original to capture owner id
        let replyToMsg = null;
        if (payload?.replyTo) {
          try {
            replyToMsg = await messagesCol.findOne({ _id: new ObjectId(payload.replyTo) });
          } catch {}
        }

        const msg = {
          _id: new ObjectId(),
          chatId: chat._id,
          senderId: new ObjectId(userId),
          senderName: sender?.email?.split('@')[0] || 'user',
          senderAvatar: sender?.avatar || null,
          text: (payload?.text || '').slice(0, 5000),
          attachments: Array.isArray(payload?.attachments) ? payload.attachments : [],
          replyTo: replyToMsg ? replyToMsg._id : null,

          // 🔔 NEW: who owns the original message (for header badge)
          replyToOwnerId: replyToMsg ? replyToMsg.senderId : null,

          reactions: [],
          createdAt: new Date(),
          editedAt: null,
          deleted: false,
          deliveries: [],
          reads: [],
        };

        await messagesCol.insertOne(msg);
        await chatsCol.updateOne(
            { _id: chat._id },
            {
              $set: {
                lastMessage: {
                  _id: msg._id,
                  text: msg.text,
                  senderName: msg.senderName,
                  createdAt: msg.createdAt,
                },
              },
            }
        );

        // emit to room
        io.to(room).emit('message:new', msg);

        // delivery ack back
        cb && cb({ ok: true, id: msg._id, delivered: true });
      } catch (e) {
        cb && cb({ ok: false, error: e.message });
      }
    });

    // EDIT
    socket.on('message:edit', async ({ id, text }, cb) => {
      try {
        const messagesCol = db.collection('messages');
        const _id = new ObjectId(id);
        await messagesCol.updateOne(
            { _id, senderId: new ObjectId(userId) },
            { $set: { text: String(text).slice(0, 5000), editedAt: new Date() } }
        );
        const updated = await messagesCol.findOne({ _id });
        io.to(room).emit('message:edited', { id, text: updated.text, editedAt: updated.editedAt });
        cb && cb({ ok: true });
      } catch (e) { cb && cb({ ok: false, error: e.message }); }
    });

    // DELETE
    socket.on('message:delete', async ({ id }, cb) => {
      try {
        const _id = new ObjectId(id);
        const messagesCol = db.collection('messages');
        await messagesCol.updateOne(
            { _id, senderId: new ObjectId(userId) },
            { $set: { deleted: true, text: '' } }
        );
        io.to(room).emit('message:deleted', { id });
        cb && cb({ ok: true });
      } catch (e) { cb && cb({ ok: false, error: e.message }); }
    });

    // REACT
    socket.on('message:react', async ({ id, emoji }, cb) => {
      try {
        const messagesCol = db.collection('messages');
        const _id = new ObjectId(id);
        const msg = await messagesCol.findOne({ _id });
        const exists = (msg.reactions || []).find(r => String(r.userId) === String(userId) && r.emoji === emoji);
        if (exists) {
          await messagesCol.updateOne({ _id }, { $pull: { reactions: { userId: new ObjectId(userId), emoji } } });
        } else {
          await messagesCol.updateOne({ _id }, { $addToSet: { reactions: { userId: new ObjectId(userId), emoji } } });
        }
        const updated = await messagesCol.findOne({ _id });
        io.to(room).emit('message:reactions', { id, reactions: updated.reactions || [] });
        cb && cb({ ok: true });
      } catch (e) { cb && cb({ ok: false, error: e.message }); }
    });

    // READ
    socket.on('message:read', async ({ ids }, cb) => {
      try {
        const messagesCol = db.collection('messages');
        const uid = new ObjectId(userId);
        await messagesCol.updateMany(
            { _id: { $in: (ids || []).map(id => new ObjectId(id)) }, 'reads.userId': { $ne: uid } },
            { $push: { reads: { userId: uid, at: new Date() } } }
        );
        io.to(room).emit('message:reads', { ids, userId });
        cb && cb({ ok: true });
      } catch (e) { cb && cb({ ok: false, error: e.message }); }
    });

    // TYPING
    socket.on('typing', ({ isTyping }) => {
      socket.to(room).emit('typing', { userId, isTyping: !!isTyping });
    });

    // DISCONNECT
    socket.on('disconnect', async () => {
      const set = onlineMap.get(userId);
      if (set) {
        set.delete(socket.id);
        if (set.size === 0) {
          onlineMap.delete(userId);
          io.to(room).emit('presence:update', { userId, online: false });
          try {
            await db.collection('users').updateOne(
                { _id: new ObjectId(userId) },
                { $set: { lastSeen: new Date() } }
            );
          } catch {}
        }
      }
    });
  });

  return { io };
}

module.exports = { initChat };
