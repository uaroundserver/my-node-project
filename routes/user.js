const express = require('express');
const { ObjectId } = require('mongodb');
const auth = require('../middleware/auth');

module.exports = function(db) {
  const r = express.Router();

  r.get('/profile', auth, async (req, res) => {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.user.sub) },
      { projection: { password: 0, activationToken: 0, activationExpires: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({
      fullName: user.fullName || '',
      email: user.email,
      phone: user.phone || '',
      country: user.country || ''
    });
  });

  r.put('/profile', auth, async (req, res) => {
    const { fullName, email, phone } = req.body || {};
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.sub) },
      { $set: { fullName, email: (email||'').toLowerCase(), phone } }
    );
    res.json({ message: 'OK' });
  });

  return r;
};