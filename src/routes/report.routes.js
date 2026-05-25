const express = require('express');
const router = express.Router();
const ReportController = require('../controllers/report.controllers');
const authMiddleware = require('../middleware/auth');
const tenantResolver = require('../middleware/tenantResolver');

// Summary laporan keuangan
router.get(
  '/:store_id/reports/summary',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  ReportController.summary
);

// Laporan produk (top produk, stok menipis)
router.get(
  '/:store_id/reports/products',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  ReportController.products
);

router.get(
  '/:store_id/reports/cashiers',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  ReportController.cashiers
);

// Generate & simpan laporan harian (manual/cron)
router.post(
  '/:store_id/reports/daily/generate',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  ReportController.generateDailyReport
);

// Ambil laporan harian yang sudah disimpan
router.get(
  '/:store_id/reports/daily',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  ReportController.getDailyReport
);

// List laporan harian dalam rentang waktu
router.get(
  '/:store_id/reports/daily/list',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  ReportController.listDailyReports
);

// Laporan periodik (mingguan/bulanan/tahunan)
router.get(
  '/:store_id/reports/periodic',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  ReportController.periodicReport
);

// Detail penjualan (POS + PPOB) untuk export
router.get(
  '/:store_id/reports/sales-details',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  ReportController.detailedSalesReport
);

module.exports = router;