const { ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const transporter = require('../config/nodemailer');

// Регистрация
async function register(req, res, db) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Заполните email и пароль' });
        }

        const existingUser = await db.collection('users').findOne({ email });
        if (existingUser) {
            return res.status(400).json({ error: 'Пользователь с таким email уже существует' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const activationToken = crypto.randomBytes(16).toString('hex');

        const result = await db.collection('users').insertOne({
            email,
            password: hashedPassword,
            activated: false,
            activationToken,
            createdAt: new Date(),
        });

        const activationLink = `${process.env.SERVER_URL}/activate/${activationToken}`;

        await transporter.sendMail({
            from: `"MyApp" <${process.env.EMAIL_USER}>`,
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
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
}

// Активация аккаунта
async function activate(req, res, db) {
    try {
        const { token } = req.params;

        const user = await db.collection('users').findOne({ activationToken: token });
        if (!user) {
            return res.status(400).send(`
        <h2>⛔ Неверный или устаревший токен</h2>
        <p>Попробуйте зарегистрироваться снова.</p>
      `);
        }

        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: { activated: true },
                $unset: { activationToken: '' },
            }
        );

        res.send(`
      <h2>✅ Аккаунт успешно активирован!</h2>
      <p>Теперь вы можете войти.</p>
      <a href="${process.env.CLIENT_URL}" style="color: blue; font-weight: bold;">Перейти на сайт</a>
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
}

// Логин
async function login(req, res, db) {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email и пароль обязательны' });
        }

        const user = await db.collection('users').findOne({ email });
        if (!user) {
            return res.status(400).json({ error: 'Пользователь не найден' });
        }

        if (!user.activated) {
            return res.status(403).json({ error: 'Аккаунт не активирован. Проверьте почту.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ error: 'Неверный пароль' });
        }

        res.json({ message: 'Успешный вход!', userId: user._id });
    } catch (err) {
        console.error('Ошибка при логине:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
}

module.exports = {
    register,
    activate,
    login,
};
