# Project refactor summary

- Routes mounted under `/api/auth` and `/api/user`. Legacy `/register`, `/login`, `/activate/:token` kept.
- Security: `helmet`, `express-rate-limit`, `cors` with env CORS_ORIGINS.
- Validation via `zod`.
- Unified JWT payload: `{ sub: <userId>, email }`. Middleware sets `req.user.sub`.
- Avatars: accept base64 DataURL on PUT `/api/user/avatar`, convert to JPEG via `sharp`, saved in `public/uploads/avatars`, old avatar removed, DB stores absolute URL.
- Frontend: API_BASE is derived from `window.API_BASE` or same origin, removed hardcoded domain in JS.
- Nodemailer config in `config/nodemailer.js`. Set `EMAIL_USER`, `EMAIL_PASS`, `SERVER_URL` in `.env`.

## Environment
```
MONGO_URI=mongodb://127.0.0.1:27017
DB_NAME=mydb
JWT_SECRET=<random-64-char>
JWT_EXPIRES=7d
EMAIL_USER=you@gmail.com
EMAIL_PASS=app_password
SERVER_URL=https://your-domain.tld
CORS_ORIGINS=https://your-frontend-origin
PORT=3000
```