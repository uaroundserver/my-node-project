// scripts/migrate-roles.js
require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
  const DB_NAME = process.env.DB_NAME || 'DBUA';
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // Добавляем роль/флаги всем, у кого их нет
  await db.collection('users').updateMany(
    { role: { $exists: false } },
    { $set: { role: 'user', isBanned: false, isMuted: false } }
  );

  // Индексы
  try { await db.collection('users').createIndex({ email: 1 }, { unique: true }); } catch {}
  try { await db.collection('users').createIndex({ createdAt: -1 }); } catch {}
  try { await db.collection('messages').createIndex({ createdAt: -1 }); } catch {}

  console.log('Migration done');
  await client.close();
})().catch(e => { console.error(e); process.exit(1); });