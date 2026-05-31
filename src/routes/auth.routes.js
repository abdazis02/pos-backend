const express = require('express');
const router = express.Router();

const authMiddleware = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');
const rateLimit = require('../middleware/rateLimit');
const AuthController = require('../controllers/auth.controllers');

// 🔒 Batasi brute-force pada endpoint login (per IP)
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

// Public
router.post('/login', loginLimiter, AuthController.login);
router.post('/google', AuthController.googleAuth);
router.post('/register-google', AuthController.registerGoogle);

// Protected
router.get('/profile', authMiddleware(), tenantResolver, AuthController.getProfile);
router.post('/logout', authMiddleware(), AuthController.logout);

module.exports = router;
