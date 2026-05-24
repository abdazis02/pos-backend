const express = require('express');
const router = express.Router();
const checkStore = require('../middleware/checkStore');
const tenantResolver = require('../middleware/tenantResolver');
const authMiddleware = require('../middleware/auth');
const TableController = require('../controllers/table.controllers');

router.get(
  '/:store_id/tables',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  TableController.list
);

router.post(
  '/:store_id/tables',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  TableController.create
);

router.put(
  '/:store_id/tables/:id',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  TableController.update
);

router.delete(
  '/:store_id/tables/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  TableController.delete
);

module.exports = router;
