const express = require('express');
const auditLog = require('../middleware/auditLog');
const router = express.Router();
const superadminController = require('../controllers/superadminController');

// --- DITAMBAHKAN UNTUK UPLOAD ---
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// PENTING: Ganti path ini ke folder "downloads" di frontend (Nginx) Anda!
// Misalnya jika frontend Nginx diarahkan ke /var/www/adminpos/dist
const uploadDir = '/var/www/adminpos.kamunara.com/dist/downloads'; 

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const type = req.body.type;
    let fileName = file.originalname;
    // Mengubah nama file agar sesuai dengan link di Login.tsx
    if (type === 'apk') fileName = 'Pipos_v1.2.4.apk';
    if (type === 'exe') fileName = 'Pipos_Setup_v1.2.4.exe';
    cb(null, fileName);
  }
});
const upload = multer({ storage: storage });
// ----------------------------------

// 1. Impor Middleware Keamanan Anda
const authMiddleware = require('../middleware/auth');

// 2. Buat "Satpam" khusus untuk role Superadmin
const requireSuperadmin = authMiddleware(['superadmin', 'superadmin2']);
router.get('/dashboard/leaderboard', requireSuperadmin, superadminController.getLeaderboard);
router.get('/reconciliation', requireSuperadmin, superadminController.getReconciliation);
router.get('/audit-logs', requireSuperadmin, superadminController.getAuditLogs);
router.get('/reports/monthly', requireSuperadmin, superadminController.getMonthlyReport);

// --- SEMUA RUTE DI BAWAH INI SEKARANG AMAN & TERLINDUNGI ---

// --- MANAJEMEN KLIEN / MITRA ---
router.get('/clients', requireSuperadmin, superadminController.getClients);
router.post('/clients', requireSuperadmin, auditLog('CREATE_CLIENT', 'client', (req) => `Mitra baru: ${req.body.business_name||''}`), superadminController.createClient);
router.put('/clients/:id/status', requireSuperadmin, auditLog('UPDATE_STATUS', 'client', (req) => `Status mitra ID ${req.params.id}: ${req.body.status||''}`), superadminController.updateClientStatus);
router.put('/clients/:id', requireSuperadmin, auditLog('UPDATE_CLIENT', 'client', (req) => `Data mitra ID ${req.params.id} diperbarui`), superadminController.updateClient);
router.delete('/clients/:id', requireSuperadmin, auditLog('DELETE_CLIENT', 'client', (req) => `Mitra ID ${req.params.id} dihapus`), superadminController.deleteClient);

// --- DASHBOARD (STATISTIK & GRAFIK) ---
router.get('/dashboard/stats', requireSuperadmin, superadminController.getDashboardStats);
router.get('/dashboard/chart', requireSuperadmin, superadminController.getDashboardChart);

// --- RIWAYAT TRANSAKSI ---
router.get('/transactions', requireSuperadmin, superadminController.getTransactions);
router.get('/transactions/recent', requireSuperadmin, superadminController.getTransactions);

// --- TOPUP MANUAL ---
const adminTenantController = require('../controllers/adminTenant.controllers');
router.get('/topups/pending', requireSuperadmin, adminTenantController.getPendingTopups);
router.put('/topups/:id/approve', requireSuperadmin, adminTenantController.approveTopup);

// --- MANAJEMEN LAYANAN GLOBAL ---
router.get('/services', requireSuperadmin, superadminController.getServices);
router.put('/services/:id/toggle', requireSuperadmin, superadminController.updateServiceStatus);

// --- MANAJEMEN MARGIN PRODUK PPOB ---
router.get('/products', requireSuperadmin, superadminController.getProducts);
router.put('/products/:id/margin', requireSuperadmin, auditLog('UPDATE_MARGIN', 'margin', (req) => `Margin produk ID ${req.params.id} diubah: ${JSON.stringify(req.body)}`), superadminController.updateProductMargin);

// --- PENGATURAN BIAYA POS ---
router.get('/settings/pos-fee', requireSuperadmin, superadminController.getPosFee);
router.put('/settings/pos-fee', requireSuperadmin, auditLog('UPDATE_POS_FEE', 'settings', (req) => `Biaya POS diubah: ${JSON.stringify(req.body)}`), superadminController.updatePosFee);

// --- UPLOAD APK & EXE DARI FRONTEND ---
router.post('/settings/upload-app', requireSuperadmin, upload.single('file'), auditLog('UPLOAD_APP', 'settings', (req) => `Aplikasi Klien (${req.body.type}) diperbarui`), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah' });
  }
  res.json({ success: true, message: 'Aplikasi berhasil diunggah' });
});

// --- MANAJEMEN PROFIL SUPERADMIN ---
router.get('/profile', requireSuperadmin, superadminController.getProfile);
router.put('/profile', requireSuperadmin, auditLog('UPDATE_PROFILE', 'auth', 'Profil admin diperbarui'), superadminController.updateProfile);
router.put('/profile/password', requireSuperadmin, superadminController.updatePassword);

module.exports = router;
