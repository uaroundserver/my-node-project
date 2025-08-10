require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
// Для base64-аватара до ~5 МБ
app.use(express.json({ limit: '6mb' }));

let db;
const client = new MongoClient(process.env.MONGO_URI);

async function connectDB() {
  try {
    await client.connect();
    db = client.db('DBUA');
    // уникальность email
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    console.log('✅ MongoDB подключена');
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

// Активация
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
      { $set: { activated: true }, $unset: { activationToken: '', activationExpires: '' } }
    );

    res.send(`
      <h2>✅ Аккаунт активирован!</h2>
      <p>Через 3 секунды вы будете перенаправлены на сайт.</p>
      <script>setTimeout(()=>{window.location.href="${process.env.CLIENT_URL}"},3000)</script>
    `);
  } catch (err) {
    console.error(err);
    res.status(500).send('Ошибка при активации аккаунта');
  }
});

// Статика
app.use(express.static('public'));
app.get('/', (_, res) => res.send('Сервер работает, добро пожаловать!'));

// Регистрация
app.post('/register', async (req, res) => {
  try {
    let { email, password, country } = req.body;
    if (!email || !password || !country) {
      return res.status(400).json({ error: 'Заполните email, пароль и страну проживания' });
    }

    email = String(email).trim().toLowerCase(); // ← нормализация

    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const activationToken = crypto.randomBytes(16).toString('hex');
    const activationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const result = await db.collection('users').insertOne({
      email, // сохраняем уже в нижнем регистре
      password: hashedPassword,
      country,
      activated: false,
      activationToken,
      activationExpires,
      createdAt: new Date(),
    });

    const activationLink = `${process.env.SERVER_URL}/activate/${activationToken}`;
    await transporter.sendMail({
      from: `"MyApp" <${process.env.EMAIL_USER}>`,
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

// Логин (JWT)
app.post('/login', async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email и пароль обязательны' });
    }

    email = String(email).trim().toLowerCase(); // ← нормализация

    const user = await db.collection('users').findOne({ email });
    if (!user) return res.status(400).json({ error: 'Пользователь не найден' });

    if (!user.activated) {
      return res.status(403).json({ error: 'Аккаунт не активирован. Проверьте почту.' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Неверный пароль' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: user._id });
  } catch (err) {
    console.error('Ошибка при логине:', err);
    res.status(500).json({ error: 'Ошибка сервера при входе' });
  }
});

// Профиль: получить
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

// Профиль: обновить (email здесь НЕ меняем)
app.put('/api/user/profile', authMiddleware, async (req, res) => {
  try {
    const { fullName, phone } = req.body; // email намеренно не принимаем
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

// Аватар: обновить (base64 data URL)
app.put('/api/user/avatar', authMiddleware, async (req, res) => {
  try {
    const { avatar } = req.body;
    if (!avatar || typeof avatar !== 'string' || !avatar.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Неверный формат изображения' });
    }

    // разрешим только jpg/png
    const isOkType = /^data:image\/(png|jpeg|jpg);base64,/i.test(avatar);
    if (!isOkType) {
      return res.status(400).json({ error: 'Допустимы только JPG/PNG' });
    }

    // до 5 МБ
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

app.listen(PORT, () => {
  console.log(`🔊 Сервер запущен на порту ${PORT}`);
});