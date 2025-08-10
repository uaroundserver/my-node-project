const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Нет токена' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || !payload.sub) return res.status(401).json({ error: 'Неверный токен' });
    req.user = { sub: payload.sub, email: payload.email || null };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Неверный или истёкший токен' });
  }
};