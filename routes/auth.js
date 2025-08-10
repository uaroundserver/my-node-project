const express = require('express');
const { register, activate, login } = require('../controllers/authController');

module.exports = function(db){
  const router = express.Router();

  router.post('/register', (req, res) => register(req, res, db));
  router.post('/login', (req, res) => login(req, res, db));

  // For activation we expose as /activate/:token on app level; also provide here for /api/auth/activate/:token
  router.get('/activate/:token', (req, res) => activate(req, res, db));

  return router;
};