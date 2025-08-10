require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

const createAuthRoutes = require('./routes/auth');
const createUserRoutes = require('./routes/user');
const { activate } = require('./controllers/authController');

const app = express();

// Security & common middlewares
app.use(helmet());
app.use(express.json({ limit: '6mb' }));

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: allowedOrigins.length ? allowedOrigins : '*',
}));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
}));

// Static
app.use(express.static(path.join(__dirname, 'public')));

// Mongo
const mongoUrl = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const dbName = process.env.DB_NAME || 'mydb';
let db;

// Helper to convert string ID to ObjectId consistently
function userIdToObjectId(id) {
  try { return new ObjectId(String(id)); } catch { return null; }
}

MongoClient.connect(mongoUrl).then(async (client) => {
  db = client.db(dbName);

  // Ensure indexes
  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true });
  await users.createIndex({ activationToken: 1 }, { sparse: true });
  await users.createIndex({ activationExpires: 1 }, { sparse: true });

  // Routes
  app.use('/api/auth', createAuthRoutes(db));
  app.use('/api/user', createUserRoutes(db));

  // Legacy endpoints for backward compatibility
  const { register, login } = require('./controllers/authController');
  app.post('/register', (req, res) => register(req, res, db));
  app.post('/login', (req, res) => login(req, res, db));
  app.get('/activate/:token', (req, res) => activate(req, res, db));

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log('Server running on port ' + port);
  });
}).catch(err => {
  console.error('Mongo connect error:', err);
  process.exit(1);
});

module.exports = app;