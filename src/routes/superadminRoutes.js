const express = require('express');
const router = express.Router();
const superadminController = require('../controllers/superadminController');

// 1. Impor Middleware Keamanan Anda
const authMiddleware = require('../middleware/auth');

// 2. Buat "Satpam" khusus untuk role Superadmin
const requireSuperadmin = authMiddleware(['superadmin']);

// --- SEMUA RUTE DI BAWAH INI SEKARANG AMAN & TERLINDUNGI ---

// --- MANAJEMEN KLIEN / MITRA ---
router.get('/clients', requireSuperadmin, superadminController.getClients);
router.post('/clients', requireSuperadmin, superadminController.createClient);
router.put('/clients/:id/status', requireSuperadmin, superadminController.updateClientStatus);
router.put('/clients/:id', requireSuperadmin, superadminController.updateClient);
router.delete('/clients/:id', requireSuperadmin, superadminController.deleteClient);

// --- DASHBOARD (STATISTIK & GRAFIK) ---
router.get('/dashboard/stats', requireSuperadmin, superadminController.getDashboardStats);
router.get('/dashboard/chart', requireSuperadmin, superadminController.getDashboardChart);

// --- RIWAYAT TRANSAKSI ---
router.get('/transactions', requireSuperadmin, superadminController.getTransactions);
router.get('/transactions/recent', requireSuperadmin, superadminController.getTransactions);

// --- MANAJEMEN LAYANAN GLOBAL ---
router.get('/services', requireSuperadmin, superadminController.getServices);
router.put('/services/:id/toggle', requireSuperadmin, superadminController.updateServiceStatus);

// --- MANAJEMEN MARGIN PRODUK PPOB ---
router.get('/products', requireSuperadmin, superadminController.getProducts);
router.put('/products/:id/margin', requireSuperadmin, superadminController.updateProductMargin);

// --- PENGATURAN BIAYA POS ---
router.get('/settings/pos-fee', requireSuperadmin, superadminController.getPosFee);
router.put('/settings/pos-fee', requireSuperadmin, superadminController.updatePosFee);

// --- MANAJEMEN PROFIL SUPERADMIN ---
router.get('/profile', requireSuperadmin, superadminController.getProfile);
router.put('/profile', requireSuperadmin, superadminController.updateProfile);
router.put('/profile/password', requireSuperadmin, superadminController.updatePassword);

module.exports = router;