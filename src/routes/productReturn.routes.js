const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const checkStore = require('../middleware/checkStore');
const tenantResolver = require('../middleware/tenantResolver');
const authMiddleware = require('../middleware/auth');
const ProductReturnController = require('../controllers/productReturn.controllers');

// Get all returns for a store
router.get(
  '/:store_id/returns',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  ProductReturnController.list
);

// Get return by ID
router.get(
  '/:store_id/returns/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  ProductReturnController.getById
);

// Get returns by product ID
router.get(
  '/:store_id/products/:product_id/returns',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  ProductReturnController.getByProductId
);

// Create new return request
router.post(
  '/:store_id/returns',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  upload.array('photos', 5), // Support max 5 photos
  ProductReturnController.create
);

// Update return status (approve/reject)
router.put(
  '/:store_id/returns/:id/status',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  ProductReturnController.updateStatus
);

// Delete return
router.delete(
  '/:store_id/returns/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  ProductReturnController.delete
);

module.exports = router;