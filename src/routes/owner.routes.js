const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');
const OwnerController = require('../controllers/owner.controllers');

router.get('/', auth(), OwnerController.getOwner);
router.put('/', auth(['owner']), tenantResolver, OwnerController.updateOwner);

module.exports = router;