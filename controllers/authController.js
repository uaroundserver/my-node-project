// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const transporter = require('../config/nodemailer');

function makeActivationLink(req, token) {
  const base =
    process.env.SERVER_URL ||
    `${req.protocol}://${req.get('host')}` ||
    'http://localhost:5000';
  return `${base}/activate/${token}`;
}

// === Регистрация ===
async function register(req, res) {
  try {
    const { email, password, country } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    const db = req.app.locals.db;
    const normalizedEmail = String(email).toLowerCase();

    const exists = await db.collection('users').findOne({ email: normalizedEmail });
    if (exists) return res.status(400).json({ error: 'Пользователь уже зарегистрирован' });

    const hash = await bcrypt.hash(password, 10);

    const activationToken = crypto.randomBytes(24).toString('hex');
    const activationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.collection('users').insertOne({
      _id: new ObjectId(),
      email: normalizedEmail,
      password: hash,
      isActive: false,
      country: country || null,
      activationToken,
      activationExpires,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const link = makeActivationLink(req, activationToken);

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: normalizedEmail,
      subject: 'Подтверждение аккаунта',
      html: `
        <p>Здравствуйте!</p>
        <p>Для активации аккаунта перейдите по ссылке (действительна 24 часа):</p>
        <p><a href="${link}">${link}</a></p>
        <p>Если вы не регистрировались — просто игнорируйте это письмо.</p>
      `
    });

    return res.json({ message: 'Регистрация успешна! Проверьте почту и подтвердите аккаунт.' });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
}

// === Активация === (на случай, если этот контроллер используется напрямую)
async function activate(req, res) {
  try {
    const { token } = req.params;
    const db = req.app.locals.db;

    const user = await db.collection('users').findOne({
      activationToken: token,
      activationExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).send(`
        <h2>Ссылка недействительна или истекла</h2>
        <p>Запросите новое письмо активации и попробуйте снова.</p>
      `);
    }

    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { isActive: true, updatedAt: new Date() }, $unset: { activationToken: "", activationExpires: "" } }
    );

    const redirect = process.env.CLIENT_URL || '/';
    return res.send(`
      <h2>✅ Аккаунт активирован!</h2>
      <p>Сейчас перенаправим вас на сайт…</p>
      <script>setTimeout(()=>{window.location.href="${redirect}"}, 2000)</script>
    `);
  } catch (err) {
    console.error('activate error:', err);
    return res.status(500).send('Ошибка при активации аккаунта');
  }
}

// === Логин ===
async function login(req, res) {
  try {
    const { email, password } = req.body;
    const db = req.app.locals.db;

    const normalizedEmail = String(email).toLowerCase();
    const user = await db.collection('users').findOne({ email: normalizedEmail });
    if (!user) return res.status(400).json({ error: 'Неверный email или пароль' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Неверный email или пароль' });

    if (!user.isActive) {
      return res.status(403).json({ error: 'Подтвердите e-mail. Мы отправили письмо при регистрации.' });
    }

    const payload = { userId: user._id, email: user.email };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES || '7d'
    });

    return res.json({ token });
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

module.exports = { register, activate, login };