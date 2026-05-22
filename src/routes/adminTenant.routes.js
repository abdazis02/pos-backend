const express = require('express');
const router = express.Router();
const AdminTenantController = require('../controllers/adminTenant.controllers');
const authMiddleware = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');

router.get('/stats', authMiddleware(['superadmin', 'superadmin2']), adminAuth, AdminTenantController.stats);
router.get('/', authMiddleware(['superadmin', 'superadmin2']), adminAuth, AdminTenantController.index);
router.post('/', authMiddleware(['superadmin', 'superadmin2']), adminAuth, AdminTenantController.create);
router.get('/:id', authMiddleware(['superadmin', 'superadmin2']), adminAuth, AdminTenantController.detail);
router.put('/:id', authMiddleware(['superadmin', 'superadmin2']), adminAuth, AdminTenantController.update);
router.delete('/:id', authMiddleware(['superadmin', 'superadmin2']), adminAuth, AdminTenantController.delete);

module.exports = router;