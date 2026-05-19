/**
 * 🔄 PPOB Auto-Sync Job
 * Sinkronisasi produk Digiflazz secara terjadwal.
 * Menggunakan node-cron jika tersedia, fallback ke setInterval.
 */

const Digiflazz = require('../utils/digiflazz');
const PPOBProductModel = require('../models/ppobProduct.model');

// Interval fallback: setiap 6 jam
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 15 * 1000;

async function runSync() {
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' });
  console.log(`🔄 [PPOB Auto-Sync] Dimulai pada ${now} WIT...`);

  try {
    const allProducts = await Digiflazz.productList();

    if (!allProducts || allProducts.length === 0) {
      console.warn('⚠️ [PPOB Auto-Sync] Tidak ada produk dari Digiflazz. Sync dilewati.');
      return;
    }

    await PPOBProductModel.createOrUpdateProducts(allProducts);
    console.log(`✅ [PPOB Auto-Sync] Selesai. ${allProducts.length} produk berhasil disinkronkan.`);
  } catch (err) {
    console.error('❌ [PPOB Auto-Sync] Gagal:', err.message);
  }
}

function startPpobSyncJob() {
  // Sync pertama saat startup
  setTimeout(() => {
    console.log('🔄 [PPOB Auto-Sync] Menjalankan sync awal saat startup...');
    runSync();
  }, INITIAL_DELAY_MS);

  // Coba gunakan node-cron jika tersedia
  try {
    const cron = require('node-cron');
    // Jam 03:00 WIT setiap hari
    cron.schedule('0 3 * * *', () => {
      console.log('⏰ [PPOB Auto-Sync] Cron 03:00 WIT');
      runSync();
    }, { timezone: 'Asia/Jayapura' });
    // Jam 15:00 WIT setiap hari
    cron.schedule('0 15 * * *', () => {
      console.log('⏰ [PPOB Auto-Sync] Cron 15:00 WIT');
      runSync();
    }, { timezone: 'Asia/Jayapura' });
    console.log('📅 [PPOB Auto-Sync] node-cron aktif: jam 03:00 & 15:00 WIT setiap hari.');
  } catch (e) {
    // Fallback: setInterval setiap 6 jam
    setInterval(runSync, SYNC_INTERVAL_MS);
    console.log('📅 [PPOB Auto-Sync] Fallback setInterval aktif: setiap 6 jam.');
  }
}

module.exports = { startPpobSyncJob, runSync };
