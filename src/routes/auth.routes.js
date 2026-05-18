const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');
const AuthController = require('../controllers/auth.controllers');

// Public
router.post('/login', AuthController.login);

// Protected
router.get('/profile', authMiddleware(), tenantResolver, AuthController.getProfile);
router.post('/logout', authMiddleware(), AuthController.logout);

module.exports = router;
