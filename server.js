require('dotenv').config(); // Загрузка переменных окружения

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS — при желании можно ограничить доменом клиента:
// app.use(cors({ origin: process.env.CLIENT_URL }));
app.use(cors());
app.use(express.json());

let db;
const client = new MongoClient(process.env.MONGO_URI);

async function connectDB() {
  try {
    await client.connect();
    db = client.db('DBUA');
    console.log('✅ MongoDB подключена');
    // Рекомендуется один раз создать уникальный индекс email:
    // await db.collection('users').createIndex({ email: 1 }, { unique: true });
  } catch (err) {
    console.error('❌ Ошибка подключения к MongoDB:', err);
  }
}
connectDB();

// Настройка почты
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// --- JWT middleware для защищённых маршрутов ---
function authMiddleware(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Неверный или истёкший токен' });
  }
}

/**
 * Активация аккаунта — проверка истечения 24 часа
 * (ставим ДО статики!)
 */
app.get('/activate/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await db.collection('users').findOne({
      activationToken: token,
      activationExpires: { $gt: new Date() }, // ссылка ещё действительна
    });

    if (!user) {
      return res.status(400).send(`
        <h2>⛔ Ссылка активации недействительна или истекла</h2>
        <p>Попробуйте зарегистрироваться снова.</p>
      `);
    }

    await db.collection('users').updateOne(
      { _id: user._id },
      {
        $set: { activated: true },
        $unset: { activationToken: '', activationExpires: '' },
      }
    );

    res.send(`
      <h2>✅ Аккаунт активирован!</h2>
      <p>Через 3 секунды вы будете перенаправлены на сайт.</p>
      <script>
        setTimeout(() => {
          window.location.href = "${process.env.CLIENT_URL}";
        }, 3000);
      </script>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при активации аккаунта');
  }
});

// Статика (после активации)
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('Сервер работает, добро пожаловать!');
});

/**
 * Регистрация — email в нижний регистр + токен активации с истечением 24 часа
 */
app.post('/register', async (req, res) => {
  try {
    let { email, password, country } = req.body;
    email = (email || '').toLowerCase();

    if (!email || !password || !country) {
      return res.status(400).json({ error: 'Заполните email, пароль и страну проживания' });
    }

    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const activationToken = crypto.randomBytes(16).toString('hex');
    const activationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 часа

    const result = await db.collection('users').insertOne({
      email,
      password: hashedPassword,
      country,
      activated: false,
      activationToken,
      activationExpires,
      createdAt: new Date(),
    });

    const activationLink = `${process.env.SERVER_URL}/activate/${activationToken}`;

    await transporter.sendMail({
      from: `"UAround" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Подтверждение регистрации',
      html: `
        <h3>Спасибо за регистрацию!</h3>
        <p>Активируйте аккаунт по ссылке ниже:</p>
        <a href="${activationLink}">${activationLink}</a>
        <p><b>Срок действия ссылки:</b> 24 часа</p>
      `,
    });

    res.status(201).json({
      message: 'Регистрация прошла успешно! Проверьте почту для активации аккаунта.',
      userId: result.insertedId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера при регистрации' });
  }
});

/**
 * Вход — возвращаем реальный JWT
 */
app.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    email = (email || '').toLowerCase();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Неверные учётные данные' });
    }

    if (!user.activated) {
      return res.status(403).json({ error: 'Аккаунт не активирован. Проверьте почту.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Неверные учётные данные' });
    }

    const token = jwt.sign(
      { sub: user._id.toString(), email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || '7d' }
    );

    res.json({ token }); // фронт сохраняет это как userToken
  } catch (err) {
    console.error('Ошибка при логине:', err);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

/**
 * Профиль пользователя (GET/PUT)
 * Требует заголовок: Authorization: Bearer <token>
 */
app.get('/api/user/profile', authMiddleware, async (req, res) => {
  try {
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера при получении профиля' });
  }
});

app.put('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const { fullName, email, phone } = req.body || {};
    await db.collection('users').updateOne(
      { _id: new ObjectId(req.user.sub) },
      {
        $set: {
          fullName: fullName || '',
          email: (email || '').toLowerCase() || undefined,
          phone: phone || ''
        }
      }
    );
    res.json({ message: 'OK' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера при сохранении профиля' });
  }
});

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🔊 Сервер запущен на порту ${PORT}`);
});