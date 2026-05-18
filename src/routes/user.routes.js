const express = require('express');
const router = express.Router();
const UserController = require('../controllers/user.controllers');
const authMiddleware = require('../middleware/auth');
const checkTenant = require('../middleware/tenantResolver');
const checkStore = require('../middleware/checkStore');

router.get(
  '/:store_id/users',
  authMiddleware(['owner', 'admin']),
  checkTenant,
  checkStore,
  UserController.listByStore
);

router.post(
  '/:store_id/users',
  authMiddleware(['owner', 'admin']),
  checkTenant,
  checkStore,
  UserController.create
);

router.put(
  '/:store_id/users/:id',
  authMiddleware(['owner', 'admin']),
  checkTenant,
  checkStore,
  UserController.update
);

router.delete(
  '/:store_id/users/:id',
  authMiddleware(['owner', 'admin']),
  checkTenant,
  checkStore,
  UserController.delete
);

module.exports = router;