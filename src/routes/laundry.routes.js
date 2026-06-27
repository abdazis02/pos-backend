const express = require('express');
const router = express.Router();
const checkStore = require('../middleware/checkStore');
const tenantResolver = require('../middleware/tenantResolver');
const authMiddleware = require('../middleware/auth');
const LaundryController = require('../controllers/laundry.controllers');

const roles = ['owner', 'admin', 'cashier'];

router.get(
  '/:store_id/laundry/orders',
  authMiddleware(roles), tenantResolver, checkStore,
  LaundryController.list
);

router.post(
  '/:store_id/laundry/orders',
  authMiddleware(roles), tenantResolver, checkStore,
  LaundryController.create
);

router.get(
  '/:store_id/laundry/orders/:id',
  authMiddleware(roles), tenantResolver, checkStore,
  LaundryController.getById
);

router.put(
  '/:store_id/laundry/orders/:id/status',
  authMiddleware(roles), tenantResolver, checkStore,
  LaundryController.updateStatus
);

router.put(
  '/:store_id/laundry/orders/:id/pay',
  authMiddleware(roles), tenantResolver, checkStore,
  LaundryController.pay
);

module.exports = router;
