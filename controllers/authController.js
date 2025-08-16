// controllers/authController.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const transporter = require('../config/nodemailer');

function makeActivationLink(req, token) {
  // Пытаемся взять из .env, иначе — из запроса
  const base =
    process.env.SERVER_URL ||
    `${req.protocol}://${req.get('host')}` ||
    'http://localhost:3000';
  return `${base}/activate/${token}`;
}

// Регистрация
async function register(req, res, db) {
  try {
    let { email, password, country } = req.body || {};
    email = (email || '').toLowerCase().trim();
    country = (country || '').trim();

    if (!email || !password || !country) {
      return res.status(400).json({ error: 'Укажите email, пароль и страну' });
    }

    const users = db.collection('users');
    const exists = await users.findOne({ email });
    if (exists) return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const hash = await bcrypt.hash(password, 10);
    const activationToken = crypto.randomBytes(32).toString('hex');
    const activationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const doc = {
      email,
      password: hash,
      country,
      role: 'user',
      isActive: false,
      isBanned: false,
      isMuted: false,
      activationToken,
      activationExpires,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await users.insertOne(doc);

    // Отправка письма
    const link = makeActivationLink(req, activationToken);
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Подтверждение аккаунта',
        html: `<p>Здравствуйте!</p>
               <p>Для активации аккаунта перейдите по ссылке:</p>
               <p><a href="${link}">${link}</a></p>
               <p>Ссылка действительна 24 часа.</p>`
      });
    } catch (e) {
      // Письмо не улетело — но регистрацию не валим
      console.error('sendMail error:', e.message);
    }

    res.status(201).json({
      message: 'Регистрация успешна! Проверьте почту для активации аккаунта.',
      userId: result.insertedId
    });
  } catch (err) {
    console.error('register error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

// Активация аккаунта
async function activate(req, res, db) {
  try {
    const token = req.params?.token || req.query?.token;
    if (!token) return res.status(400).send('Нет токена');

    const users = db.collection('users');
    const user = await users.findOne({
      activationToken: token,
      activationExpires: { $gt: new Date() }
    });
    if (!user) return res.status(400).send('Токен недействителен или истек');

    await users.updateOne(
      { _id: user._id },
      {
        $set: { isActive: true, updatedAt: new Date() },
        $unset: { activationToken: '', activationExpires: '' }
      }
    );

    // Можно редиректнуть на фронт
    res.send('Аккаунт активирован! Теперь можно войти.');
  } catch (err) {
    console.error('activate error:', err);
    res.status(500).send('Ошибка активации');
  }
}

// Логин
async function login(req, res, db) {
  try {
    let { email, password } = req.body || {};
    email = (email || '').toLowerCase().trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Укажите email и пароль' });
    }

    const users = db.collection('users');
    const user = await users.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Неверные учетные данные' });

    // Требуем активный аккаунт
    if (!user.isActive) {
      return res.status(403).json({ error: 'Аккаунт не активирован' });
    }

    const ok = await bcrypt.compare(password, user.password || '');
    if (!ok) return res.status(401).json({ error: 'Неверные учетные данные' });

    // ВАЖНО: JWT теперь с ролью; сохраняем совместимость с legacy (userId)
    const payload = {
      sub: user._id.toString(),
      userId: user._id.toString(), // чтобы старые места, где ждут userId, не отвалились
      role: user.role || 'user',
      email: user.email
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES || '7d'
    });

    res.json({ token });
  } catch (err) {
    console.error('login error:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

module.exports = { register, activate, login };