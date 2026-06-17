const express = require('express');
const router = express.Router();
const checkStore = require('../middleware/checkStore');
const authMiddleware = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');
const TransactionController = require('../controllers/transaction.controllers');

// Get All Transactions for a Store (protected route)
router.get(
  '/:store_id/transactions',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  TransactionController.list
);

// Create Transaction (protected route)
router.post(
  '/:store_id/transactions',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  TransactionController.create
);

// Add Item to Cart (protected route)
// router.post(
//   '/:store_id/cart/add',
//   authMiddleware(['owner', 'admin', 'cashier']),
//   tenantResolver,
//   checkStore,
//   TransactionController.addItemToCart
// );

// Get Transaction by ID (protected route)
router.get(
  '/:store_id/transactions/:id',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  TransactionController.detail
);

// Pay pending dine-in transaction (protected route)
router.post(
  '/:store_id/transactions/:id/pay',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  TransactionController.payLater
);

// Update Transaction (protected route)
router.put(
  '/:store_id/transactions/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  TransactionController.update
);

// Batch Delete Transactions (protected route)
router.post(
  '/:store_id/transactions/batch-delete',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  TransactionController.batchDelete
);

// Delete Transaction (protected route)
router.delete(
  '/:store_id/transactions/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  TransactionController.delete
);

// Transaction Xendit QRIS Callback
router.post(
  '/:tenant_id/transaction-callback/:store_id',
  TransactionController.updateStatus
);

// Refund Transaction (protected route)
router.post(
  '/:store_id/transactions/:id/refund',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  TransactionController.refund
);

module.exports = router;
