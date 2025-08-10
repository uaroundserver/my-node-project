const express = require('express');
const auth = require('../middleware/auth');
const { getProfile, updateProfile, updateAvatar } = require('../controllers/userController');

module.exports = function(db){
  const router = express.Router();

  router.get('/profile', auth, (req, res) => getProfile(req, res, db));
  router.put('/profile', auth, (req, res) => updateProfile(req, res, db));
  router.put('/avatar', auth, (req, res) => updateAvatar(req, res, db));

  return router;
};