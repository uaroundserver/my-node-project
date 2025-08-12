const path = require('path');
const fs = require('fs/promises');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const sharp = require('sharp');

const PROFILE_SCHEMA = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  country: z.string().trim().max(60).optional(),
});

const AVATAR_DATAURL_RE = /^data:(image\/[^;]+);base64,(.+)$/i;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // 5MB limit

function publicUrl(req, p) {
  // Ensure absolute URL based on SERVER_URL if set, else derive from request
  const base = process.env.SERVER_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}${p.startsWith('/') ? '' : '/'}${p}`;
}

async function getProfile(req, res, db) {
  try {
    const users = db.collection('users');
    const user = await users.findOne({ _id: req.user.sub });
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    const { email, fullName = null, phone = null, country = null, avatarUrl = null } = user;
    res.json({ email, fullName, phone, country, avatar: avatarUrl });
  } catch (err) {
    console.error('getProfile error', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

async function updateProfile(req, res, db) {
  try {
    const dto = PROFILE_SCHEMA.parse(req.body || {});
    const users = db.collection('users');

    const upd = { updatedAt: new Date() };
    if (dto.fullName !== undefined) upd.fullName = dto.fullName;
    if (dto.phone !== undefined) upd.phone = dto.phone;
    if (dto.country !== undefined) upd.country = dto.country;

    await users.updateOne({ _id: req.user.sub }, { $set: upd });
    const u = await users.findOne({ _id: req.user.sub });
    res.json({
      ok: true,
      user: {
        email: u.email,
        fullName: u.fullName || null,
        phone: u.phone || null,
        country: u.country || null,
        avatar: u.avatarUrl || null
      }
    });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Неверные данные профиля' });
    }
    console.error('updateProfile error', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

async function updateAvatar(req, res, db) {
  try {
    const { avatar } = req.body || {};
    if (!avatar || typeof avatar !== 'string') {
      return res.status(400).json({ error: 'Нет данных изображения' });
    }

    const match = avatar.match(AVATAR_DATAURL_RE);
    if (!match) return res.status(400).json({ error: 'Неверный формат изображения' });

    const mime = match[1].toLowerCase();
    const b64 = match[2];
    const buf = Buffer.from(b64, 'base64');

    if (buf.length > MAX_AVATAR_BYTES) {
      return res.status(400).json({ error: 'Файл слишком большой (лимит 5 МБ)' });
    }

    // Convert/normalize to JPEG
    const jpeg = await sharp(buf, { failOnError: false })
      .rotate()
      .jpeg({ quality: 80 })
      .toBuffer();

    const users = db.collection('users');
    const u = await users.findOne({ _id: req.user.sub });
    if (!u) return res.status(404).json({ error: 'Пользователь не найден' });

    // Ensure upload dir
    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'avatars');
    await fs.mkdir(uploadDir, { recursive: true });

    // Remove old avatar if exists and within our uploads folder
    if (u.avatarUrl && u.avatarUrl.includes('/uploads/avatars/')) {
      const oldRel = u.avatarUrl.split('/uploads/avatars/')[1];
      if (oldRel) {
        const oldPath = path.join(uploadDir, oldRel);
        try { await fs.unlink(oldPath); } catch {}
      }
    }

    // Save new avatar
    const filename = `${String(req.user.sub)}-${Date.now()}.jpeg`;
    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, jpeg);

    const urlPath = `/uploads/avatars/${filename}`;
    const absUrl = publicUrl(req, urlPath);

    await users.updateOne(
      { _id: req.user.sub },
      { $set: { avatarUrl: absUrl, updatedAt: new Date() } }
    );

    res.json({ ok: true, avatar: absUrl });
  } catch (err) {
    console.error('updateAvatar error', err);
    res.status(500).json({ error: 'Не удалось сохранить аватар' });
  }
}

module.exports = { getProfile, updateProfile, updateAvatar };