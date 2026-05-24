const express = require('express');
const router = express.Router();
const checkStore = require('../middleware/checkStore');
const tenantResolver = require('../middleware/tenantResolver');
const authMiddleware = require('../middleware/auth');
const StoreController = require('../controllers/store.controllers');

// GET /api/stores - Get all stores for current owner
router.get(
  '/',
  authMiddleware(['owner']),
  tenantResolver,
  StoreController.list
);

const upload = require('../middleware/upload');

// POST /api/stores - Create new store (owner only)
router.post(
  '/',
  authMiddleware(['owner']),
  tenantResolver,
  upload.single('image'),
  StoreController.create
);

// PUT /api/stores/:id - Update store (owner only)
router.put(
  '/:id',
  authMiddleware(['owner']),
  tenantResolver,
  upload.single('image'),
  StoreController.update
);

// DELETE /api/stores/:id - Delete store (owner only)
router.delete(
  '/:id',
  authMiddleware(['owner']),
  tenantResolver,
  StoreController.delete
);

// Get store statistics
router.get(
  '/:store_id/stats',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  StoreController.getStats
);

module.exports = router;