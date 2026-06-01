/**
 * 💳 Job Biaya Admin Bulanan
 * Memotong Rp 10.000 (default) dari saldo (wallet_balance) setiap owner pada tanggal 1 tiap bulan.
 *
 * Sifat:
 * - IDEMPOTEN: satu owner hanya ditagih sekali per bulan (dicek lewat wallet_transactions
 *   bertipe 'admin_fee' pada periode YYYY-MM yang sama).
 * - CATCH-UP saat startup: bila server mati tepat tanggal 1, tagihan tetap diproses saat
 *   server hidup kembali (karena idempoten, tidak akan dobel).
 * - Tidak membuat saldo negatif: owner yang saldonya kurang dari biaya dilewati bulan ini.
 * - Owner berstatus 'suspended' dilewati.
 */
const master = require('../config/knexMaster');

const INITIAL_DELAY_MS = 25 * 1000; // beri jeda saat startup

let _running = false; // cegah job berjalan tumpang-tindih dalam 1 proses

// Besaran biaya: prioritas setting DB (monthly_admin_fee, diatur dari admin web) →
// env MONTHLY_ADMIN_FEE → default 10000.
async function getMonthlyFee() {
  try {
    const row = await master('settings').where('setting_key', 'monthly_admin_fee').first();
    if (row && row.setting_value != null && String(row.setting_value).trim() !== '') {
      const v = parseInt(row.setting_value, 10);
      if (!isNaN(v) && v >= 0) return v;
    }
  } catch (_) { /* tabel settings mungkin belum ada → pakai fallback */ }
  const envv = parseInt(process.env.MONTHLY_ADMIN_FEE || '', 10);
  if (!isNaN(envv) && envv >= 0) return envv;
  return 10000;
}

// Periode 'YYYY-MM' menurut waktu DB (WIT) agar konsisten dengan kolom created_at.
async function getDbPeriod() {
  const res = await master.raw("SELECT DATE_FORMAT(NOW(), '%Y-%m') AS period");
  const rows = Array.isArray(res) ? res[0] : res;
  return rows[0].period;
}

async function chargeMonthlyFee() {
  if (_running) return;
  _running = true;
  try {
    const fee = await getMonthlyFee();
    if (!fee || fee <= 0) {
      console.warn('⚠️ [MonthlyFee] Biaya admin bulanan <= 0, dilewati.');
      return;
    }
    const period = await getDbPeriod();
    console.log(`💳 [MonthlyFee] Mulai tagih biaya admin bulanan periode ${period} (Rp ${fee})...`);

    const owners = await master('owners')
      .whereRaw("(status IS NULL OR status <> 'suspended')")
      .select('id');

    let charged = 0, alreadyDone = 0, lowBalance = 0, failed = 0;

    for (const o of owners) {
      const trx = await master.transaction();
      try {
        // 🔒 Kunci baris owner dulu agar tidak balapan (forUpdate).
        const row = await trx('owners').forUpdate().where('id', o.id).first('wallet_balance');
        if (!row) { await trx.rollback(); continue; }

        // Idempoten: cek apakah sudah ditagih pada bulan ini.
        const exists = await trx('wallet_transactions')
          .where({ owner_id: o.id, type: 'admin_fee' })
          .whereRaw("DATE_FORMAT(created_at, '%Y-%m') = ?", [period])
          .first();
        if (exists) { await trx.rollback(); alreadyDone++; continue; }

        const balance = parseFloat(row.wallet_balance || 0);
        if (balance < fee) { await trx.rollback(); lowBalance++; continue; }

        const after = balance - fee;
        await trx('wallet_transactions').insert({
          owner_id: o.id,
          type: 'admin_fee',
          amount: -fee,
          balance_after: after,
          reference_type: 'admin_fee',
          reference_id: 0,
          description: `Biaya admin bulanan ${period}`,
        });
        await trx('owners').where('id', o.id).update({ wallet_balance: after });

        await trx.commit();
        charged++;
      } catch (e) {
        await trx.rollback();
        failed++;
        console.error(`❌ [MonthlyFee] Gagal tagih owner ${o.id}:`, e.message);
      }
    }

    console.log(`✅ [MonthlyFee] Selesai ${period}. Ditagih: ${charged}, sudah sebelumnya: ${alreadyDone}, saldo kurang: ${lowBalance}, gagal: ${failed}`);
  } catch (e) {
    console.error('❌ [MonthlyFee] Error:', e.message);
  } finally {
    _running = false;
  }
}

function startMonthlyFeeJob() {
  // Catch-up saat startup (idempoten) — menangani kasus server mati tepat tanggal 1.
  setTimeout(() => {
    console.log('💳 [MonthlyFee] Cek tagihan bulan ini saat startup...');
    chargeMonthlyFee();
  }, INITIAL_DELAY_MS);

  try {
    const cron = require('node-cron');
    // 01:00 WIT tanggal 1 setiap bulan.
    cron.schedule('0 1 1 * *', () => {
      console.log('⏰ [MonthlyFee] Cron tanggal 1, 01:00 WIT');
      chargeMonthlyFee();
    }, { timezone: 'Asia/Jayapura' });
    console.log('📅 [MonthlyFee] node-cron aktif: tanggal 1 jam 01:00 WIT.');
  } catch (e) {
    // Fallback: cek tiap 12 jam (idempoten, aman walau sering jalan).
    setInterval(chargeMonthlyFee, 12 * 60 * 60 * 1000);
    console.log('📅 [MonthlyFee] Fallback setInterval 12 jam.');
  }
}

module.exports = { startMonthlyFeeJob, chargeMonthlyFee };
