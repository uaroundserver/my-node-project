// routes/user.js
const express = require('express');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');

module.exports = function (db) {
  const r = express.Router();

  r.get('/profile', auth, async (req, res) => {
    const uid = req?.user?.sub || req?.user?.userId;
    if (!uid) return res.status(401).json({ error: 'Нет токена' });

    const user = await db.collection('users').findOne(
      { _id: new ObjectId(uid) },
      { projection: { password: 0, activationToken: 0, activationExpires: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    res.json({
      email: user.email,
      fullName: user.fullName || '',
      phone: user.phone || '',
      country: user.country || '',
      role: user.role || 'user',
      isBanned: !!user.isBanned,
      isMuted: !!user.isMuted,
      createdAt: user.createdAt || null,
      lastSeen: user.lastSeen || null,
      avatar: user.avatar || null
    });
  });

  // простое обновление профиля (без смены роли)
  r.put('/profile', auth, async (req, res) => {
    const uid = req?.user?.sub || req?.user?.userId;
    if (!uid) return res.status(401).json({ error: 'Нет токена' });

    const { fullName, email, phone, country } = req.body || {};
    const toSet = {};
    if (typeof fullName === 'string') toSet.fullName = fullName.trim().slice(0, 120);
    if (typeof email === 'string') toSet.email = email.trim().toLowerCase();
    if (typeof phone === 'string') toSet.phone = phone.trim().slice(0, 40);
    if (typeof country === 'string') toSet.country = country.trim().slice(0, 60);

    if (!Object.keys(toSet).length) return res.status(400).json({ error: 'no changes' });

    await db.collection('users').updateOne(
      { _id: new ObjectId(uid) },
      { $set: { ...toSet, updatedAt: new Date() } }
    );
    res.json({ ok: true });
  });

  return r;
};