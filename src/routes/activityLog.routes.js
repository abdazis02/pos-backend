const express = require('express');
const router = express.Router();
const checkStore = require('../middleware/checkStore');
const authMiddleware = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');
const ActivityLogController = require('../controllers/activityLog.controllers');

router.get(
  '/:store_id/activity-logs',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  ActivityLogController.list
);

module.exports = router;