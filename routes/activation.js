const express = require('express');
const router = express.Router();

module.exports = function(db) {
  router.get('/:token', async (req, res) => {
    try {
      const { token } = req.params;

      // проверяем, что токен существует и ещё не истёк
      const user = await db.collection('users').findOne({
        activationToken: token,
        activationExpires: { $gt: new Date() }
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
          $unset: { activationToken: "", activationExpires: "" },
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

  return router;
};