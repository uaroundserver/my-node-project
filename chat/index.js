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

function asId(id) {
  try { return new ObjectId(id); } catch { return null; }
}
function displayName(u) {
  if (!u) return 'Unknown';
  return u.name || u.email?.split?.('@')?.[0] || 'User';
}

async function buildUserMap(db, ids) {
  const uniq = [...new Set(ids.filter(Boolean))].map((x) => asId(x)).filter(Boolean);
  if (!uniq.length) return {};
  const users = await db.collection('users')
    .find({ _id: { $in: uniq } }, { projection: { name: 1, email: 1, avatar: 1 } })
    .toArray();
  const map = {};
  users.forEach((u) => {
    map[u._id.toString()] = {
      name: displayName(u),
      avatar: u.avatar || null,
    };
  });
  return map;
}

function normalizeMessage(m, userMap, replyDoc) {
  const senderKey = (m.senderId || m.userId)?.toString?.();
  const from = userMap[senderKey] || { name: 'Unknown', avatar: null };
  const base = {
    _id: m._id?.toString?.() || m._id,
    chatId: m.chatId?.toString?.() || m.chatId,
    text: m.text || '',
    createdAt: m.createdAt,
    senderId: m.senderId || m.userId,
    attachments: m.attachments || [],
    replyTo: m.replyTo || null,
    deleted: !!m.deleted,
    from,
  };
  if (replyDoc) {
    base.reply = {
      _id: replyDoc._id?.toString?.(),
      text: replyDoc.text || '',
      createdAt: replyDoc.createdAt,
      senderId: replyDoc.senderId,
      attachments: replyDoc.attachments || [],
      from: userMap[replyDoc.senderId?.toString?.()] || { name: 'Unknown', avatar: null },
    };
  }
  return base;
}

function initChat({ httpServer, app, db }) {
  const router = express.Router();

  // fetch chat list (one global chat)
  router.get('/chats', auth, async (req, res) => {
    try {
      const userId = req?.user?.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const chatsCol = db.collection('chats');
      let chat = await chatsCol.findOne({ key: 'global' });
      if (!chat) {
        const ins = await chatsCol.insertOne({
          key: 'global',
          title: 'Global Chat',
          avatar: null,
          lastMessage: null,
          createdAt: new Date(),
        });
        chat = await chatsCol.findOne({ _id: ins.insertedId });
      }

      const unreadCount = 0; // placeholder
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

  // ------- GET /messages  (полная история без .limit) -------
  router.get('/messages', auth, async (req, res) => {
    try {
      const { chatId, before } = req.query; // limit удалён
      if (!chatId) return res.status(400).json({ error: 'chatId required' });

      const q = { chatId: asId(chatId), deleted: { $ne: true } };
      if (!q.chatId) return res.status(400).json({ error: 'bad chatId' });
      if (before) {
        const dt = new Date(before);
        if (!isNaN(+dt)) q.createdAt = { $lt: dt };
      }

      const items = await db.collection('messages')
        .find(q)
        .sort({ createdAt: -1, _id: -1 })
        .toArray();

      const replyIds = items.filter((x) => x.replyTo).map((x) => x.replyTo);
      const replyDocs = replyIds.length
        ? await db.collection('messages')
            .find({ _id: { $in: replyIds } }, { projection: { text: 1, attachments: 1, senderId: 1, createdAt: 1 } })
            .toArray()
        : [];

      const senders = [
        ...items.map((x) => (x.senderId || x.userId)?.toString?.()).filter(Boolean),
        ...replyDocs.map((x) => x.senderId?.toString?.()).filter(Boolean),
      ];
      const userMap = await buildUserMap(db, senders);

      const replyMap = {};
      replyDocs.forEach((d) => { replyMap[d._id.toString()] = d; });

      const ordered = items.reverse().map((m) =>
        normalizeMessage(m, userMap, m.replyTo ? replyMap[m.replyTo.toString()] : null)
      );
      res.json(ordered);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to load messages' });
    }
  });

  // get minimal message meta by id (for jump/reply toast)
  router.get('/message/:id', async (req, res) => {
    try {
      const _id = asId(req.params.id);
      if (!_id) return res.status(404).json({ error: 'Not found' });
      const doc = await db.collection('messages').findOne({ _id });
      if (!doc) return res.status(404).json({ error: 'Not found' });
      res.json({ _id: doc._id, createdAt: doc.createdAt });
    } catch (e) {
      res.status(500).json({ error: 'Failed' });
    }
  });

  // ------- send message -------
  router.post('/send', auth, upload.array('files'), async (req, res) => {
    try {
      const userId = req?.user?.userId;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { chatId, text, replyTo } = req.body;

      const msg = {
        chatId: asId(chatId),
        text: text || '',
        senderId: asId(userId),
        attachments: [],
        replyTo: replyTo ? asId(replyTo) : null,
        createdAt: new Date(),
        deleted: false,
      };

      // handle files
      for (const f of (req.files || [])) {
        msg.attachments.push({
          name: f.originalname,
          mime: f.mimetype,
          size: f.size,
          path: f.filename,
          url: `/uploads/${f.filename}`,
        });
      }

      const ins = await db.collection('messages').insertOne(msg);
      const stored = await db.collection('messages').findOne({ _id: ins.insertedId });

      // broadcast
      io.emit('message', {
        type: 'message',
        data: {
          ...stored,
          _id: stored._id.toString(),
          chatId: stored.chatId.toString(),
        }
      });

      res.json({ ok: true, _id: ins.insertedId });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Failed to send' });
    }
  });

  app.use('/api/chat', router);

  // ---------- socket.io ----------
  const io = new Server(httpServer, { cors: { origin: '*'} });
  io.on('connection', (socket) => {
    socket.on('auth', async (token) => {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded?.userId;
      } catch {}
    });

    socket.on('disconnect', async () => {
      if (socket.userId) {
        try {
          await db.collection('users').updateOne(
            { _id: asId(socket.userId) },
            { $set: { lastSeen: new Date() } }
          );
        } catch {}
      }
    });
  });

  return { io };
}

module.exports = { initChat };