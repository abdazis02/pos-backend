const express = require('express');
const router = express.Router();
const PPOBController = require('../controllers/ppob.controllers');

router.post(
  '/webhook/digiflazz',
  express.raw({ type: 'application/json' }),
  PPOBController.digiflazzWebhook
);

// 🛠️ TOMBOL RAHASIA UNTUK MEMPERBAIKI REFUND NYANGKUT
// Bisa diakses melalui browser: http://domain-anda/api/webhook/fix-refunds
router.get('/webhook/fix-refunds', PPOBController.fixMissingRefunds);

module.exports = router;
