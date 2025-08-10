const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const { z } = require('zod');
const transporter = require('../config/nodemailer');

const RegisterDto = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  country: z.string().min(1)
});

const LoginDto = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

// helper to sign JWT with standard 'sub'
function signToken(user){
  return jwt.sign(
    { sub: String(user._id), email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES || '7d' }
  );
}

// Регистрация
async function register(req, res, db) {
  try {
    const body = RegisterDto.parse(req.body || {});
    const email = body.email.toLowerCase();
    const { password, country } = body;

    const users = db.collection('users');
    const existing = await users.findOne({ email });
    if (existing) return res.status(409).json({ error: 'Пользователь с таким email уже существует' });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const activationToken = crypto.randomBytes(32).toString('hex');
    const activationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { insertedId } = await users.insertOne({
      email,
      password: hashedPassword,
      isActive: false,
      country,
      activationToken,
      activationExpires,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const activationLink = `${process.env.SERVER_URL || (req.protocol + '://' + req.get('host'))}/activate/${activationToken}`;

    await transporter.sendMail({
      from: `MyApp <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Подтверждение регистрации',
      html: `<h3>Спасибо за регистрацию!</h3>
        <p>Пожалуйста, активируйте аккаунт по ссылке ниже (24 часа):</p>
        <p><a href="${activationLink}">${activationLink}</a></p>`
    });

    res.json({ message: 'Проверьте почту для активации аккаунта', userId: String(insertedId) });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Неверные данные регистрации' });
    }
    console.error('Ошибка при регистрации:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

// Активация
async function activate(req, res, db) {
  try {
    const { token } = req.params;

    const users = db.collection('users');
    const user = await users.findOne({ activationToken: token });
    if (!user) return res.status(400).json({ error: 'Неверная или просроченная ссылка активации' });

    if (new Date() > new Date(user.activationExpires)) {
      return res.status(400).json({ error: 'Срок действия ссылки активации истёк' });
    }

    await users.updateOne({ _id: user._id }, { $set: { isActive: true }, $unset: { activationToken: "", activationExpires: "" } });

    res.json({ message: 'Аккаунт успешно активирован. Теперь вы можете войти.' });
  } catch (err) {
    console.error('Ошибка при активации:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

// Логин
async function login(req, res, db) {
  try {
    const body = LoginDto.parse(req.body || {});
    const email = body.email.toLowerCase();
    const { password } = body;

    const users = db.collection('users');
    const user = await users.findOne({ email });
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });
    if (!user.isActive) return res.status(403).json({ error: 'Подтвердите email перед входом' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Неверный email или пароль' });

    const token = signToken(user);
    res.json({ token });
  } catch (err) {
    if (err.name === 'ZodError') {
      return res.status(400).json({ error: 'Неверные данные' });
    }
    console.error('Ошибка при логине:', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
}

module.exports = { register, activate, login };
