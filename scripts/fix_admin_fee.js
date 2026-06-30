require('dotenv').config();
const master = require('../src/config/knexMaster');

async function getDbPeriod() {
  const res = await master.raw("SELECT DATE_FORMAT(NOW(), '%Y-%m') AS period");
  const rows = Array.isArray(res) ? res[0] : res;
  return rows[0].period;
}

async function fixAdminFee() {
  try {
    const period = await getDbPeriod();
    console.log(`[Fix] Mencari transaksi admin_fee sebesar -60000 untuk periode ${period}...`);

    // 1. Ambil transaksi yang terpotong 60000
    const overchargedTransactions = await master('wallet_transactions')
      .where({ type: 'admin_fee', amount: -60000 })
      .whereRaw("DATE_FORMAT(created_at, '%Y-%m') = ?", [period]);

    console.log(`[Fix] Ditemukan ${overchargedTransactions.length} transaksi yang terpotong berlebih.`);

    let fixedCount = 0;

    for (const trxRecord of overchargedTransactions) {
      const trx = await master.transaction();
      try {
        const owner = await trx('owners')
          .forUpdate()
          .where('id', trxRecord.owner_id)
          .first('wallet_balance');

        if (!owner) {
          await trx.rollback();
          continue;
        }

        const currentBalance = parseFloat(owner.wallet_balance || 0);
        const refundAmount = 54000;
        const newBalance = currentBalance + refundAmount;

        // Tambah transaksi refund
        await trx('wallet_transactions').insert({
          owner_id: trxRecord.owner_id,
          type: 'admin_fee_refund',
          amount: refundAmount,
          balance_after: newBalance,
          reference_type: 'admin_fee',
          reference_id: trxRecord.id,
          description: `Pengembalian kelebihan biaya admin bulanan ${period}`,
        });

        // Update saldo owner
        await trx('owners').where('id', trxRecord.owner_id).update({
          wallet_balance: newBalance,
        });

        await trx.commit();
        fixedCount++;
        console.log(`[Fix] Berhasil mengembalikan Rp 54.000 ke owner ID ${trxRecord.owner_id}`);
      } catch (error) {
        await trx.rollback();
        console.error(`[Fix] Gagal memproses owner ID ${trxRecord.owner_id}:`, error.message);
      }
    }

    // 2. Kembalikan setting biaya admin ke 6000
    const settingExists = await master('settings').where('setting_key', 'monthly_admin_fee').first();
    if (settingExists) {
      await master('settings').where('setting_key', 'monthly_admin_fee').update({ setting_value: '6000' });
      console.log(`[Fix] Setting monthly_admin_fee berhasil diubah kembali menjadi 6000.`);
    } else {
      await master('settings').insert({ setting_key: 'monthly_admin_fee', setting_value: '6000' });
      console.log(`[Fix] Setting monthly_admin_fee berhasil ditambahkan dengan nilai 6000.`);
    }

    console.log(`[Fix] Selesai. Total owner yang dikembalikan saldonya: ${fixedCount}`);
  } catch (error) {
    console.error('[Fix] Terjadi kesalahan:', error);
  } finally {
    process.exit();
  }
}

fixAdminFee();
