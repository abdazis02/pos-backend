const express = require('express');
const router = express.Router();
const PPOBController = require('../controllers/ppob.controllers');

router.post(
  '/webhook/digiflazz',
  express.raw({ type: 'application/json' }),
  PPOBController.digiflazzWebhook
);

module.exports = router;
