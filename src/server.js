require('dotenv').config();

// Import app yang sudah lengkap dari app.js
const server = require('./app');
const master = require('./config/knexMaster');
const { getTenantConnection } = require('./config/knexTenant');
const { startPpobSyncJob } = require('./jobs/ppobSync.job');

const PORT = process.env.PORT || 5000;

// 🛡️ Cegah 1 error async yang tidak tertangani menjatuhkan proses (yang melayani SEMUA tenant).
// Cukup catat; jangan exit agar layanan tetap hidup. Pantau log untuk akar masalahnya.
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ [uncaughtException]', err);
});

// Start server
server.listen(PORT, async () => {
    for (const tenant of await master("tenants").select('*')) {
        getTenantConnection(tenant)
    }

    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`🔗 API Documentation: http://localhost:${PORT}/`);

    console.log('\n📋 Available Routes:');
    console.log('├── /api/auth/* - Authentication endpoints');
    console.log('├── /api/stores/* - Store management');
    console.log('└── / - API Documentation');

    // 🔄 Mulai auto-sync produk PPOB dari Digiflazz
    startPpobSyncJob();
});