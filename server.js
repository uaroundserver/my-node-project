require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // статика

let db;
const client = new MongoClient(process.env.MONGO_URI);

async function connectDB() {
    try {
        await client.connect();
        db = client.db('DBUA');
        console.log('✅ MongoDB подключена');
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

// Регистрация
app.post('/register', async (req, res) => {
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

        //await transporter.sendMail({
        //    from: `"MyApp" <${process.env.EMAIL_USER}>`,
        //    to: email,
        //    subject: 'Подтверждение регистрации',
        //    html: `
        //        <h3>Спасибо за регистрацию!</h3>
        //        <p>Пожалуйста, активируйте свой аккаунт, перейдя по ссылке ниже:</p>
        //        <a href="${activationLink}">${activationLink}</a>
        //        <p><b>Срок действия:</b> 24 часа</p>
        //    `,
        //});

        res.status(201).json({
            message: 'Регистрация успешна! Проверьте почту для активации.',
            userId: result.insertedId,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка сервера при регистрации' });
    }
});

// Активация аккаунта
app.get('/activate/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const user = await db.collection('users').findOne({ activationToken: token });

        if (!user) {
            return res.status(400).send(`
                <h2>⛔ Ссылка активации недействительна</h2>
                <p>Попробуйте зарегистрироваться снова.</p>
            `);
        }

        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: { activated: true },
                $unset: { activationToken: "" },
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

// Вход
app.post('/login', async (req, res) => {
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

        // В идеале — создавай JWT, но для простоты отправим userId и токен (fake)
        res.json({ message: 'Успешный вход!', userId: user._id, token: 'fake-jwt-token' });
    } catch (err) {
        console.error('Ошибка при логине:', err);
        res.status(500).json({ error: 'Ошибка сервера при входе' });
    }
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🔊 Сервер запущен на порту ${PORT}`);
});
