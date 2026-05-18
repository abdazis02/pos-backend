const express = require('express');
const router = express.Router();
const AdminTenantController = require('../controllers/adminTenant.controllers');
const authMiddleware = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

router.get('/stats', authMiddleware(['superadmin']), adminAuth, AdminTenantController.stats);
router.get('/', authMiddleware(['superadmin']), adminAuth, AdminTenantController.index);
router.post('/', authMiddleware(['superadmin']), adminAuth, AdminTenantController.create);
router.get('/:id', authMiddleware(['superadmin']), adminAuth, AdminTenantController.detail);
router.put('/:id', authMiddleware(['superadmin']), adminAuth, AdminTenantController.update);
router.delete('/:id', authMiddleware(['superadmin']), adminAuth, AdminTenantController.delete);

module.exports = router;