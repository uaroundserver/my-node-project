// routes/admin.js
const express = require('express');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

module.exports = function (db) {
  const r = express.Router();

  // Все admin endpoints защищаем: нужен токен + роль admin/superadmin
  r.use(auth, requireRole('admin', 'superadmin'));

  // Проверка своих прав (для фронта)
  r.get('/me', (req, res) => {
    res.json({ ok: true, role: req.user.role });
  });

  // Простая статистика
  r.get('/stats', async (req, res) => {
    try {
      const users = await db.collection('users').countDocuments();
      let msgs = 0;
      try { msgs = await db.collection('messages').countDocuments(); } catch {}
      const recent7d = await db.collection('users').countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 864e5) }
      });
      res.json({ users, messages: msgs, recent7d });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Список пользователей с поиском по email (q=)
  r.get('/users', async (req, res) => {
    const q = (req.query.q || '').trim();
    const filter = q ? { email: { $regex: q, $options: 'i' } } : {};
    const projection = {
      password: 0, activationToken: 0, activationExpires: 0
    };
    const list = await db.collection('users')
      .find(filter, { projection })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    res.json(list);
  });

  // Обновление ролей/бан/мут/страна
  r.patch('/users/:id', async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'bad id' });

    const allowedRoles = ['user', 'moderator', 'admin', 'superadmin'];
    const toSet = {};
    if (typeof req.body.isBanned === 'boolean') toSet.isBanned = !!req.body.isBanned;
    if (typeof req.body.isMuted === 'boolean') toSet.isMuted = !!req.body.isMuted;
    if (typeof req.body.country === 'string') toSet.country = req.body.country.trim().slice(0, 60);
    if (typeof req.body.role === 'string') {
      if (!allowedRoles.includes(req.body.role)) return res.status(400).json({ error: 'bad role' });
      toSet.role = req.body.role;
    }
    if (!Object.keys(toSet).length) return res.status(400).json({ error: 'no changes' });

    await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: { ...toSet, updatedAt: new Date() } }
    );

    res.json({ ok: true });
  });

  // Удаление сообщения (если есть коллекция messages)
  r.delete('/messages/:id', async (req, res) => {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'bad id' });
    try {
      await db.collection('messages').deleteOne({ _id: new ObjectId(id) });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Создание рассылки (запись в коллекцию broadcasts)
  r.post('/broadcasts', async (req, res) => {
    const title = (req.body?.title || '').trim();
    const body = (req.body?.body || '').trim();
    const country = (req.body?.country || '').trim();
    if (!title || !body) return res.status(400).json({ error: 'title/body required' });

    await db.collection('broadcasts').insertOne({
      title: title.slice(0, 140),
      body: body.slice(0, 2000),
      country: country ? country.slice(0, 60) : null,
      createdAt: new Date(),
      by: req.user.sub || req.user.userId
    });
    res.json({ ok: true });
  });

  return r;
};