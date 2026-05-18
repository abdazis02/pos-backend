const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');
const checkStore = require('../middleware/checkStore');
const PPOBController = require('../controllers/ppob.controllers');

router.post(
  '/:store_id/ppob/purchase',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  PPOBController.purchase
);

router.post(
  '/:store_id/ppob/inquiry', // 🔥 Route baru untuk Cek Tagihan
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  PPOBController.inquiry
);

router.get(
  '/:store_id/ppob/orders',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  PPOBController.listOrders
);

router.get(
  '/:store_id/ppob/products',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  PPOBController.listProducts
);

router.get(
  '/:store_id/ppob/products/:buyer_sku_code',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  PPOBController.getProductDetail
);

router.get(
  '/:store_id/ppob/orders/:ref_id',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  PPOBController.getOrder
);

router.post(
  '/admin/ppob/sync-products',
  authMiddleware(['superadmin']),
  PPOBController.syncProducts
);

module.exports = router;
