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
    userId: m.senderId || m.userId, // совместимость с разными версиями
    text: m.text || (first ? '(вложение)' : ''),
    attachments: first ? [first] : [],
    createdAt: m.createdAt,
  };
}

function displayName(u) {
  if (!u) return 'user';
  if (u.name && String(u.name).trim()) return u.name;
  if (u.email && String(u.email).includes('@')) return String(u.email).split('@')[0];
  return 'user';
}

async function buildUserMap(db, usersIdsArr) {
  const ids = Array.from(new Set(usersIdsArr.map(String)))
    .map((s) => asId(s))
    .filter(Boolean);
  if (!ids.length) return {};
  const users = await db.collection('users')
    .find({ _id: { $in: ids } }, { projection: { name: 1, email: 1, avatar: 1 } })
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
  const senderKey = (m.senderId || m.userId || '').toString();
  const base = {
    _id: m._id,
    chatId: m.chatId,
    senderId: m.senderId || m.userId,
    senderName: userMap[senderKey]?.name || m.senderName || 'user',
    senderAvatar: userMap[senderKey]?.avatar || m.senderAvatar || null,
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
          lastMessage: null,
        };
        await chatsCol.insertOne(chat);
      }

      const messagesCol = db.collection('messages');
      const unreadCount = await messagesCol.countDocuments({
        chatId: chat._id,
        deleted: { $ne: true },
        'reads.userId': { $ne: asId(userId) },
        senderId: { $ne: asId(userId) },
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

  // fetch messages with pagination + enriched replies/senders
  router.get('/messages', auth, async (req, res) => {
    try {
      const { chatId, before, limit = 30 } = req.query;
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
        .limit(Number(limit))
        .toArray();

      // gather reply targets & user ids
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

      // map reply id -> doc
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

  // upload attachment(s)
  router.post('/attachments', auth, upload.array('files', 10), async (req, res) => {
    try {
      const files = (req.files || []).map((f) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        originalName: f.originalname, // фронту удобно и так, и так
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

  // search messages by text or user
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
     