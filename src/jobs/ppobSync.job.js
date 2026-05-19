/**
 * 🔄 PPOB Auto-Sync Job
 * Sinkronisasi produk Digiflazz secara terjadwal menggunakan node-cron.
 * Jadwal: setiap jam 03:00 dan 15:00 WIT (UTC+9) setiap hari.
 */

const cron = require('node-cron');
const Digiflazz = require('../utils/digiflazz');
const PPOBProductModel = require('../models/ppobProduct.model');

async function runSync() {
  const now = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jayapura' });
  console.log(`🔄 [PPOB Auto-Sync] Dimulai pada ${now} WIT...`);

  try {
    const allProducts = await Digiflazz.productList();

    if (!allProducts || allProducts.length === 0) {
      console.warn('⚠️ [PPOB Auto-Sync] Tidak ada produk yang diterima dari Digiflazz. Sync dilewati.');
      return;
    }

    await PPOBProductModel.createOrUpdateProducts(allProducts);
    console.log(`✅ [PPOB Auto-Sync] Selesai. ${allProducts.length} produk berhasil disinkronkan.`);
  } catch (err) {
    console.error('❌ [PPOB Auto-Sync] Gagal:', err.message);
  }
}

function startPpobSyncJob() {
  // Sync pertama saat server startup (delay 15 detik agar koneksi DB siap)
  setTimeout(() => {
    console.log('🔄 [PPOB Auto-Sync] Menjalankan sync awal saat startup...');
    runSync();
  }, 15 * 1000);

  // Jadwal: setiap hari jam 03:00 dan 15:00 WIT (UTC+9 → UTC: 18:00 dan 06:00)
  // Format cron: detik(opsional) menit jam hari bulan hari-minggu
  cron.schedule('0 18 * * *', () => {
    console.log('⏰ [PPOB Auto-Sync] Cron job jam 03:00 WIT...');
    runSync();
  }, { timezone: 'Asia/Jayapura' });

  cron.schedule('0 6 * * *', () => {
    console.log('⏰ [PPOB Auto-Sync] Cron job jam 15:00 WIT...');
    runSync();
  }, { timezone: 'Asia/Jayapura' });

  console.log('📅 [PPOB Auto-Sync] Job terdaftar: startup (15 detik), jam 03:00 & 15:00 WIT setiap hari.');
}

module.exports = { startPpobSyncJob, runSync };
