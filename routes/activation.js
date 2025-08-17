const express = require('express');
const router = express.Router();

module.exports = function (db) {
  router.get('/:token', async (req, res) => {
    try {
      const { token } = req.params;

      // Ищем юзера с валидным токеном (не истёк)
      const user = await db.collection('users').findOne({
        activationToken: token,
        activationExpires: { $gt: new Date() },
      });

      if (!user) {
        return res.status(400).send(`
          <h2>⛔ Ссылка активации недействительна или истекла</h2>
          <p>Запросите новое письмо активации или зарегистрируйтесь снова.</p>
        `);
      }

      // Помечаем активным и чистим поля токена
      await db.collection('users').updateOne(
        { _id: user._id },
        {
          $set: { isActive: true, updatedAt: new Date() }, // <<< ключевое: isActive
          $unset: { activationToken: "", activationExpires: "" },
        }
      );

      const redirectTo = process.env.CLIENT_URL || '/';

      return res.send(`
        <h2>✅ Аккаунт активирован!</h2>
        <p>Через 3 секунды вы будете перенаправлены на сайт.</p>
        <script>
          setTimeout(() => {
            window.location.href = "${redirectTo}";
          }, 3000);
        </script>
      `);
    } catch (err) {
      console.error('activate route error:', err);
      return res.status(500).send('Ошибка при активации аккаунта');
    }
  });

  return router;
};