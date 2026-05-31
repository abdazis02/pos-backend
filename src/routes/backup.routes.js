const express = require('express');
const router = express.Router();
const backupController = require('../controllers/backup.controllers');
const authMiddleware = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() }); // untuk upload file JSON

router.get('/export', authMiddleware(['owner', 'admin']), tenantResolver, backupController.exportData);
router.post('/import', authMiddleware(['owner', 'admin']), tenantResolver, upload.single('file'), backupController.importData);
router.delete('/reset', authMiddleware(['owner']), tenantResolver, backupController.resetData);
router.get('/import/history', authMiddleware(), tenantResolver, backupController.importHistory);
router.get('/import/stats', authMiddleware(), tenantResolver, backupController.importStats);

module.exports = router;