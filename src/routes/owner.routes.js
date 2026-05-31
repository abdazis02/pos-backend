const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');
const OwnerController = require('../controllers/owner.controllers');

// 🔒 Hanya owner (data ini memuat saldo dompet)
router.get('/', auth(['owner']), OwnerController.getOwner);
router.put('/', auth(['owner']), tenantResolver, OwnerController.updateOwner);

module.exports = router;