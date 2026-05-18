const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const checkStore = require('../middleware/checkStore');
const tenantResolver = require('../middleware/tenantResolver');
const authMiddleware = require('../middleware/auth');
const ProductController = require('../controllers/product.controllers');

// Get All Products for a Store
router.get(
  '/:store_id/products',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  ProductController.list
);

// Get Low Stock Products
router.get(
  '/:store_id/products/low-stock',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  ProductController.getLowStock
);

// Statistik produk
router.get(
  '/:store_id/products/stats',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  ProductController.getStats
);

// Create Product
router.post(
  '/:store_id/products',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  upload.single('image'),
  ProductController.create
);

// Get Single Product by ID
router.get(
  '/:store_id/products/:id',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  ProductController.getById
);

// Update Product
router.put(
  '/:store_id/products/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  upload.single('image'),
  ProductController.update
);

// Update Product Stock
router.put(
  '/:store_id/products/:id/add-stock',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  ProductController.addStock
);

// Delete Product
router.delete(
  '/:store_id/products/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  ProductController.delete
);

module.exports = router;
