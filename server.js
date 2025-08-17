require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const app = express();


// http + чат (Socket.IO)
const http = require('http');
const { initChat } = require('./chat');


const PORT = process.env.PORT || 5000;

// http-сервер (важно для socket.io)
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '6mb' })); // для base64 аватаров

let db;
const client = new MongoClient(process.env.MONGO_URI);

// подключение к БД и старт сервера/чата
async function connectDB() {
  try {
    await client.connect();
    db = client.db('DBUA');
    // === elevate admin (one-shot) ===
    await elevateAdminOnce(db);
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    console.log('✅ MongoDB подключена');

// после подключения к Mongo:
app.locals.db = db;





    // инициализируем чат (routes + socket.io)
    initChat(server, db, app);

    // запускаем http-сервер
    server.listen(PORT, () => {
      console.log(`🔊 Сервер запущен на порту ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Ошибка подключения к MongoDB:', err);
  }
}
connectDB();

// Почта
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// JWT middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'Токен отсутствует' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Токен отсутствует' });

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Неверный или истекший токен' });
    req.userId = decoded.userId;
    next();
  });
}

// 🔑 Админ middleware
async function adminMiddleware(req, res, next) {
  try {
    const user = await db.collection('users').findOne({ _id: new ObjectId(req.userId) });
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Нет доступа (admin only)' });
    }
    next();
  } catch (err) {
    console.error('Ошибка adminMiddleware:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// === Админ маршруты ===
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await db.collection('users')
      .find({}, { projection: { password: 0 } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении списка пользователей' });
  }
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('users').deleteOne({ _id: new ObjectId(id) });
    res.json({ message: 'Пользователь удалён' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при удалении пользователя' });
  }
});

app.put('/api/admin/users/:id/role', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: { role } }
    );
    res.json({ message: 'Роль обновлена' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при обновлении роли' });
  }
});

// === Активация ===
app.get('/activate/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const user = await db.collection('users').findOne({
      activationToken: token,
      activationExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).send(`
        <h2>⛔ Ссылка активации недействительна или истекла</h2>
        <p>Попробуйте зарегистрироваться снова.</p>
      `);
    }

    await db.collection('users').updateOne(
      { _id: user._id },
      { $set: { isActive: true }, $unset: { activationToken: '', activationExpires: '' } }
    );

    res.send(`
      <h2>✅ Аккаунт активирован!</h2>
      <p>Через 3 секунды вы будете перенаправлены на сайт.</p>
      <script>setTimeout(()=>{window.location.href="${loginPage}"},2000)</script>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при активации аккаунта');
  }
});

// === Статика ===
app.use(express.static('public'));
app.get('/', (_, res) => res.send('Сервер работает, добро пожаловать!'));

// === Регистрация ===
app.post('/register', async (req, res) => {
  try {
    let { email, password, country } = req.body;
    if (!email || !password || !country) {
      return res.status(400).json({ error: 'Заполните email, пароль и страну проживания' });
    }

    email = String(email).trim().toLowerCase();

    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const activationToken = crypto.randomBytes(16).toString('hex');
    const activationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await db.collection('users').insertOne({
      email,
      password: hashedPassword,
      country,
      isActive: false,
      activationToken,
      activationExpires,
      role: 'user', // 👈 по умолчанию обычный пользователь
      createdAt: new Date(),
    });

    const activationLink = `${process.env.SERVER_URL}/activate/${activationToken}`;
    await transporter.sendMail({
      from: `"UAround" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Подтверждение регистрации',
      html: `
        <h3>Спасибо за регистрацию!</h3>
        <p>Пожалуйста, активируйте аккаунт по ссылке ниже:</p>
        <a href="${activationLink}">${activationLink}</a>
        <p><b>Срок действия:</b> 24 часа</p>
      `,
    });

    res.status(201).json({
      message: 'Регистрация успешна! Проверьте почту для активации.',
      userId: result.insertedId,
    });
  } catch (err) {
    if (err.code === 11000 && err.keyPattern?.email) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

// === Логин (JWT) ===
app.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    email = String(email).trim().toLowerCase();

    const user = await db.collection('users').findOne({ email });
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

    if (!user.isActive) {
      return res.status(403).json({ error: 'Аккаунт не активирован. Проверьте почту.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Неверный пароль' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: user._id, role: user.role });
  } catch (err) {
    console.error('Ошибка при логине:', err);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// === Профиль: получить ===
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const user = await db.collection('users').findOne(
      { _id: new ObjectId(req.userId) },
      { projection: { password: 0, activationToken: 0, activationExpires: 0 } }
    );
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при получении профиля' });
  }
});

// === Профиль: обновить ===
app.put('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const { fullName, phone } = req.body;
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.userId) },
      { $set: { fullName: fullName || '', phone: phone || '' } }
    );
    res.json({ message: 'Профиль обновлён' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при обновлении профиля' });
  }
});

// === Аватар: base64 JPG/PNG до 5 МБ ===
app.put('/api/user/avatar', authMiddleware, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar || typeof avatar !== 'string' || !avatar.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Неверный формат изображения' });
    }

    const isOkType = /^data:image\/(png|jpeg|jpg);base64,/i.test(avatar);
    if (!isOkType) {
      return res.status(400).json({ error: 'Допустимы только JPG/PNG' });
    }

    const approxBytes = Math.ceil((avatar.length * 3) / 4);
    if (approxBytes > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Изображение слишком большое (макс. 5 МБ)' });
    }

    await db.collection('users').updateOne(
      { _id: new ObjectId(req.userId) },
      { $set: { avatar } }
    );

    res.json({ avatar });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при обновлении аватара' });
  }
});

// Одноразовое повышение прав: берёт email из ENV и делает роль admin
async function elevateAdminOnce(db) {
  try {
    const email = (process.env.SEED_ADMIN_EMAIL || '').trim().toLowerCase();
    if (!email) {
      console.log('[seed-admin] SEED_ADMIN_EMAIL не задан — пропускаю');
      return;
    }

    const u = await db.collection('users').findOne({ email });
    if (!u) {
      console.log(`[seed-admin] Пользователь с email ${email} не найден`);
      return;
    }

    const update = {
      role: 'admin',
      isBanned: false,
      isMuted: false,
      updatedAt: new Date()
    };

    const r = await db.collection('users').updateOne(
      { _id: u._id },
      { $set: update }
    );

    if (r.modifiedCount === 1) {
      console.log(`[seed-admin] OK: ${email} теперь admin`);
    } else {
      console.log(`[seed-admin] Нет изменений (возможно, уже admin)`);
    }

    // ⚠️ РЕКОМЕНДАЦИЯ: после удачного запуска УДАЛИ переменную SEED_ADMIN_EMAIL в Render/ENV
    // чтобы при следующих деплоях это больше не выполнялось.
  } catch (e) {
    console.error('[seed-admin] Ошибка:', e);
  }
}

// === Админка: проверка и статистика ===
app.get('/api/admin/me', authMiddleware, adminMiddleware, async (req, res) => {
  res.json({ ok: true, userId: req.userId });
});

app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const users = await db.collection('users').countDocuments();
    const messages = await db.collection('messages').countDocuments({ deleted: { $ne: true } });
    const recent7d = await db.collection('users').countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    });

    res.json({ users, messages, recent7d });
  } catch (err) {
    console.error('Ошибка admin/stats:', err);
    res.status(500).json({ error: 'Ошибка при получении статистики' });
  }
});


// === Админ: ban / unban / mute / unmute ===
// (добавочный код; существующее не меняем)

function ensureValidId(id, res) {
  if (!ObjectId.isValid(id)) {
    res.status(400).json({ error: 'bad id' });
    return false;
  }
  return true;
}

// BAN
app.post('/api/admin/users/:id/ban', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!ensureValidId(id, res)) return;
  try {
    const r = await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: { isBanned: true } }
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'user not found' });
    res.json({ ok: true, userId: id, isBanned: true });
  } catch (e) {
    console.error('admin ban error:', e);
    res.status(500).json({ error: 'ban failed' });
  }
});

// UNBAN
app.delete('/api/admin/users/:id/ban', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!ensureValidId(id, res)) return;
  try {
    const r = await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: { isBanned: false } }
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'user not found' });
    res.json({ ok: true, userId: id, isBanned: false });
  } catch (e) {
    console.error('admin unban error:', e);
    res.status(500).json({ error: 'unban failed' });
  }
});

// MUTE
app.post('/api/admin/users/:id/mute', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!ensureValidId(id, res)) return;
  try {
    const r = await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: { isMuted: true } }
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'user not found' });
    res.json({ ok: true, userId: id, isMuted: true });
  } catch (e) {
    console.error('admin mute error:', e);
    res.status(500).json({ error: 'mute failed' });
  }
});

// UNMUTE
app.delete('/api/admin/users/:id/mute', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  if (!ensureValidId(id, res)) return;
  try {
    const r = await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: { isMuted: false } }
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'user not found' });
    res.json({ ok: true, userId: id, isMuted: false });
  } catch (e) {
    console.error('admin unmute error:', e);
    res.status(500).json({ error: 'unmute failed' });
  }
});

// (опционально) универсальная ручка, если фронт шлёт action в одном запросе
app.patch('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const { id } = req.params;
  const { action } = req.body || {};
  if (!ensureValidId(id, res)) return;

  const map = {
    ban:   { isBanned: true },
    unban: { isBanned: false },
    mute:  { isMuted: true },
    unmute:{ isMuted: false },
  };
  if (!map[action]) return res.status(400).json({ error: 'bad action' });

  try {
    const r = await db.collection('users').updateOne(
      { _id: new ObjectId(id) },
      { $set: map[action] }
    );
    if (!r.matchedCount) return res.status(404).json({ error: 'user not found' });
    res.json({ ok: true, userId: id, ...map[action] });
  } catch (e) {
    console.error('admin action error:', e);
    res.status(500).json({ error: 'action failed' });
  }
});