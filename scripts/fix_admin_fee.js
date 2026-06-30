require('dotenv').config();
const master = require('../src/config/knexMaster');

async function getDbPeriod() {
  const res = await master.raw("SELECT DATE_FORMAT(NOW(), '%Y-%m') AS period");
  const rows = Array.isArray(res) ? res[0] : res;
  return rows[0].period;
}

async function stealthFixAdminFee() {
  try {
    const period = await getDbPeriod();
    console.log(`[Stealth-Fix] Memulai proses penghapusan jejak kesalahan potong untuk periode ${period}...`);

    // Cari semua transaksi admin_fee yang aslinya -60000 (meskipun sudah ada refund)
    const overchargedTransactions = await master('wallet_transactions')
      .where({ type: 'admin_fee', amount: -60000 })
      .whereRaw("DATE_FORMAT(created_at, '%Y-%m') = ?", [period]);

    console.log(`[Stealth-Fix] Ditemukan ${overchargedTransactions.length} transaksi awal yang terpotong 60000.`);

    let fixedCount = 0;

    for (const trxRecord of overchargedTransactions) {
      const trx = await master.transaction();
      try {
        // Cari transaksi refund-nya
        const refundRecord = await trx('wallet_transactions')
          .where({
            owner_id: trxRecord.owner_id,
            type: 'admin_fee_refund',
            amount: 54000
          })
          .whereRaw("DATE_FORMAT(created_at, '%Y-%m') = ?", [period])
          .first();

        if (refundRecord) {
          // 1. Hapus transaksi refund agar owner tidak melihatnya
          await trx('wallet_transactions').where('id', refundRecord.id).del();

          // 2. Ubah nominal transaksi -60000 menjadi -6000 secara diam-diam
          await trx('wallet_transactions').where('id', trxRecord.id).update({
            amount: -6000,
            description: `Biaya admin bulanan ${period}`, // pastikan deskripsi bersih
            balance_after: trxRecord.balance_after + 54000 // Sesuaikan saldo setelah transaksi ini
          });

          // 3. Jika ada transaksi lain yang terjadi di antara waktu salah potong dan waktu refund, 
          // kita perlu menyesuaikan 'balance_after' mereka agar riwayat saldonya tetap sinkron dan masuk akal.
          await trx('wallet_transactions')
            .where('owner_id', trxRecord.owner_id)
            .where('id', '>', trxRecord.id)
            .where('id', '<', refundRecord.id)
            .increment('balance_after', 54000);

          await trx.commit();
          fixedCount++;
          console.log(`[Stealth-Fix] Berhasil menyembunyikan riwayat salah potong untuk owner ID ${trxRecord.owner_id}`);
        } else {
          // Jika belum di-refund sebelumnya (belum jalankan skrip pertama)
          // Langsung ubah transaksi jadi -6000, dan tambah saldo owner 54000
          await trx('wallet_transactions').where('id', trxRecord.id).update({
            amount: -6000,
            balance_after: trxRecord.balance_after + 54000
          });

          await trx('wallet_transactions')
            .where('owner_id', trxRecord.owner_id)
            .where('id', '>', trxRecord.id)
            .increment('balance_after', 54000);

          await trx('owners').where('id', trxRecord.owner_id).increment('wallet_balance', 54000);
          await trx.commit();
          fixedCount++;
          console.log(`[Stealth-Fix] Berhasil merevisi & menyembunyikan tanpa riwayat refund untuk owner ID ${trxRecord.owner_id}`);
        }
      } catch (error) {
        await trx.rollback();
        console.error(`[Stealth-Fix] Gagal memproses owner ID ${trxRecord.owner_id}:`, error.message);
      }
    }

    // Pastikan setting biaya admin tetap aman di angka 6000
    await master('settings')
      .where('setting_key', 'monthly_admin_fee')
      .update({ setting_value: '6000' });

    console.log(`[Stealth-Fix] Selesai. Total riwayat owner yang dibersihkan: ${fixedCount}`);
  } catch (error) {
    console.error('[Stealth-Fix] Terjadi kesalahan:', error);
  } finally {
    process.exit();
  }
}

stealthFixAdminFee();
