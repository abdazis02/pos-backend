/**
 * Job biaya admin bulanan.
 * Memotong Rp 10.000 (default) dari wallet_balance setiap owner pada tanggal 1 tiap bulan.
 *
 * Sifat:
 * - Idempoten: satu owner hanya ditagih sekali per bulan.
 * - Catch-up saat startup: bila server mati tepat tanggal 1, tagihan tetap diproses saat server hidup kembali.
 * - Owner dengan saldo > 0 tetap ditagih walau hasil akhirnya negatif.
 * - Owner dengan saldo 0 atau negatif dilewati.
 * - Owner berstatus suspended dilewati.
 */
const master = require('../config/knexMaster');

const INITIAL_DELAY_MS = 25 * 1000;

let running = false;

// Prioritas fee: setting DB monthly_admin_fee -> env MONTHLY_ADMIN_FEE -> default 10000.
async function getMonthlyFee() {
  try {
    const row = await master('settings')
      .where('setting_key', 'monthly_admin_fee')
      .first();

    if (row && row.setting_value != null && String(row.setting_value).trim() !== '') {
      const value = parseInt(row.setting_value, 10);
      if (!Number.isNaN(value) && value >= 0) {
        return value;
      }
    }
  } catch (_) {
    // Tabel settings mungkin belum ada.
  }

  const envValue = parseInt(process.env.MONTHLY_ADMIN_FEE || '', 10);
  if (!Number.isNaN(envValue) && envValue >= 0) {
    return envValue;
  }

  return 10000;
}

// Periode YYYY-MM menurut waktu DB agar konsisten dengan created_at.
async function getDbPeriod() {
  const res = await master.raw("SELECT DATE_FORMAT(NOW(), '%Y-%m') AS period");
  const rows = Array.isArray(res) ? res[0] : res;
  return rows[0].period;
}

async function chargeMonthlyFee() {
  if (running) return;
  running = true;

  try {
    const fee = await getMonthlyFee();
    if (!fee || fee <= 0) {
      console.warn('[MonthlyFee] Biaya admin bulanan <= 0, dilewati.');
      return;
    }

    const period = await getDbPeriod();
    console.log(`[MonthlyFee] Mulai tagih biaya admin bulanan periode ${period} (Rp ${fee})...`);

    const owners = await master('owners')
      .whereRaw("(status IS NULL OR status <> 'suspended')")
      .whereRaw("created_at < DATE_FORMAT(NOW(), '%Y-%m-01 00:00:00')")
      .select('id');

    let charged = 0;
    let alreadyDone = 0;
    let zeroBalance = 0;
    let failed = 0;

    for (const owner of owners) {
      const trx = await master.transaction();

      try {
        const row = await trx('owners')
          .forUpdate()
          .where('id', owner.id)
          .first('wallet_balance');

        if (!row) {
          await trx.rollback();
          continue;
        }

        const exists = await trx('wallet_transactions')
          .where({ owner_id: owner.id, type: 'admin_fee' })
          .whereRaw("DATE_FORMAT(created_at, '%Y-%m') = ?", [period])
          .first();

        if (exists) {
          await trx.rollback();
          alreadyDone++;
          continue;
        }

        const balance = parseFloat(row.wallet_balance || 0);
        if (balance <= 0) {
          await trx.rollback();
          zeroBalance++;
          continue;
        }

        const after = balance - fee;

        await trx('wallet_transactions').insert({
          owner_id: owner.id,
          type: 'admin_fee',
          amount: -fee,
          balance_after: after,
          reference_type: 'admin_fee',
          reference_id: 0,
          description: `Biaya admin bulanan ${period}`,
        });

        await trx('owners').where('id', owner.id).update({
          wallet_balance: after,
        });

        await trx.commit();
        charged++;
      } catch (error) {
        await trx.rollback();
        failed++;
        console.error(`[MonthlyFee] Gagal tagih owner ${owner.id}:`, error.message);
      }
    }

    console.log(
      `[MonthlyFee] Selesai ${period}. Ditagih: ${charged}, sudah sebelumnya: ${alreadyDone}, saldo nol/non-positif: ${zeroBalance}, gagal: ${failed}`,
    );
  } catch (error) {
    console.error('[MonthlyFee] Error:', error.message);
  } finally {
    running = false;
  }
}

function startMonthlyFeeJob() {
  setTimeout(() => {
    // Hanya lakukan catch-up jika server di-restart pada tanggal 1-3 awal bulan
    if (new Date().getDate() <= 3) {
      console.log('[MonthlyFee] Cek tagihan bulan ini saat startup (tgl 1-3)...');
      chargeMonthlyFee();
    }
  }, INITIAL_DELAY_MS);

  try {
    const cron = require('node-cron');

    // Tanggal 1 jam 01:00 WIT.
    cron.schedule(
      '0 1 1 * *',
      () => {
        console.log('[MonthlyFee] Cron tanggal 1, 01:00 WIT');
        chargeMonthlyFee();
      },
      { timezone: 'Asia/Jayapura' },
    );

    console.log('[MonthlyFee] node-cron aktif: tanggal 1 jam 01:00 WIT.');
  } catch (error) {
    // Fallback: cek tiap 12 jam. Aman karena idempoten.
    setInterval(chargeMonthlyFee, 12 * 60 * 60 * 1000);
    console.log('[MonthlyFee] Fallback setInterval 12 jam.');
  }
}

module.exports = { startMonthlyFeeJob, chargeMonthlyFee };
