const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const checkTenant = require('../middleware/tenantResolver');
const WalletTransactionController = require('../controllers/walletTransaction.controllers');

router.get(
  '/transactions',
  authMiddleware(['owner']),
  checkTenant,
  WalletTransactionController.list
);

router.get(
  '/bank-info',
  authMiddleware(['owner']),
  checkTenant,
  WalletTransactionController.getBankInfo
);

router.post(
  '/topup',
  authMiddleware(['owner']),
  checkTenant,
  WalletTransactionController.topup
);

router.get(
  '/topup/history',
  authMiddleware(['owner']),
  checkTenant,
  WalletTransactionController.topupHistory
);

router.post(
  '/webhook/midtrans',
  WalletTransactionController.midtransWebhook
);

module.exports = router