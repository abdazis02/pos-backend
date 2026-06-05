const { createServer } = require('http');
const { init } = require('./socket');
const express = require('express');
const cors = require('cors');
const path = require('path');

// Import routes
const authRoutes = require('./routes/auth.routes');
const adminTenantRoutes = require('./routes/adminTenant.routes');
const storeRoutes = require('./routes/store.routes');
const userRoutes = require('./routes/user.routes');
const productRoutes = require('./routes/product.routes');
const transactionRoutes = require('./routes/transaction.routes'); // Tambahkan ini
const reportRoutes = require('./routes/report.routes');
const activityLogRoutes = require('./routes/activityLog.routes');
const backupRoutes = require('./routes/backup.routes');
const ownerRoutes = require('./routes/owner.routes');
const tableRoutes = require('./routes/table.routes'); // 🔥
const walletTransactionRoutes = require('./routes/walletTransaction.routes');
const productReturnRoutes = require('./routes/productReturn.routes');
const ppobRoutes = require('./routes/ppob.routes');
const recipeRoutes = require('./routes/recipe.routes'); // Bahan baku & resep (F&B)
const webhookRoutes = require('./routes/webhook.routes');
// ⛔ DINONAKTIFKAN: const syncRoutes = require('./routes/sync.routes'); — lihat catatan di bawah
const superadminRoutes = require('./routes/superadminRoutes');

const app = express();
// 🔒 Di belakang reverse proxy (Nginx), percayai 1 hop agar req.ip = IP klien asli
// (X-Forwarded-For), bukan IP proxy. Tanpa ini rate-limit login keliru memakai 1 IP untuk
// semua mitra → bisa mengunci semua orang. Sesuaikan angka jika ada >1 proxy di depan.
app.set('trust proxy', 1);
const httpServer = createServer(app);
init(httpServer);

// 🔥 Webhook route HARUS sebelum express.json() agar body diterima sebagai raw Buffer
// (signature Digiflazz dihitung dari raw string, bukan re-stringify JSON object)
app.use('/api', webhookRoutes);

// Middleware
app.use(cors({
    origin: '*', // Untuk development, allow semua origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/tenant', adminTenantRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/stores', userRoutes);
app.use('/api/stores', productRoutes);
app.use('/api/stores', transactionRoutes);
app.use('/api/stores', reportRoutes);
app.use('/api/stores', activityLogRoutes);
app.use('/api/stores', productReturnRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/owner', ownerRoutes);
app.use('/api/stores', tableRoutes); // 🔥
app.use('/api/wallet', walletTransactionRoutes);
app.use('/api/stores', ppobRoutes);
app.use('/api/stores', recipeRoutes);
// webhookRoutes sudah dipindah ke atas (sebelum express.json())
// ⛔ DINONAKTIFKAN (keamanan): /sync tanpa autentikasi, membocorkan data (termasuk hash
// password), dan skemanya usang (`pool` tak terdefinisi). Sinkronisasi offline aplikasi memakai
// endpoint ber-auth biasa. Jangan diaktifkan tanpa auth + tenant scope.
// app.use('/sync', syncRoutes);
app.use('/api/superadmin', superadminRoutes);

// Default route
app.get('/', (req, res) => {
    res.json({
        message: 'Kasir Multi-Tenant API',
        version: '1.2.2',
        endpoints: {
            auth: {
                login: 'POST /api/auth/login',
                profile: 'GET /api/auth/profile',
                test_protected: 'GET /api/auth/test-protected',
                admin_only: 'GET /api/auth/admin-only',
                owner_only: 'GET /api/auth/owner-only',
                cashier_only: 'GET /api/auth/cashier-only'
            },
            stores: {
                get_all: 'GET /api/stores',
                get_single: 'GET /api/stores/:id',
                search: 'GET /api/stores/search?q=keyword',
                create: 'POST /api/stores',
                update: 'PUT /api/stores/:id',
                delete: 'DELETE /api/stores/:id',
                stats: 'GET /api/stores/stats',
                bulk_update: 'POST /api/stores/bulk-update'
            },
            products: {
                get_all: 'GET /api/stores/:store_id/products',
                get_single: 'GET /api/stores/:store_id/products/:id',
                search: 'GET /api/stores/:store_id/products/search?q=keyword',
                create: 'POST /api/stores/:store_id/products',
                update: 'PUT /api/stores/:store_id/products/:id',
                delete: 'DELETE /api/stores/:store_id/products/:id',
                stats: 'GET /api/stores/:store_id/products/stats',
                low_stock: 'GET /api/stores/:store_id/products/low-stock?threshold=10',
                bulk_update: 'POST /api/stores/:store_id/products/bulk-update',
                update_stock: 'PUT /api/stores/:store_id/products/:id/stock',
                upload_image: 'POST /api/stores/upload-image'
            },
            ppob: {
                purchase: 'POST /api/stores/:store_id/ppob/purchase',
                list_orders: 'GET /api/stores/:store_id/ppob/orders',
                order_detail: 'GET /api/stores/:store_id/ppob/orders/:ref_id'
            },
        },
        documentation: 'API menggunakan JWT authentication. Include header: Authorization: Bearer <token>'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint tidak ditemukan',
        requested_url: req.originalUrl
    });
});

// Error handler
app.use((err, req, res, next) => {
    // Tangkap error upload khusus agar tidak memuntahkan stack trace yang menakutkan
    if (err.message === 'File harus berupa gambar' || err.name === 'MulterError') {
        console.error(`⚠️ Peringatan Upload: ${err.message}`);
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan server',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

module.exports = httpServer;