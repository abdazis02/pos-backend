const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const master = require('../src/config/knexMaster');
const { getTenantConnection } = require('../src/config/knexTenant');

async function fixMissingRefunds() {
  console.log("🔍 Memulai pemindaian transaksi gagal yang belum di-refund...");

  try {
    const tenants = await master('tenants')
      .join('owners', 'tenants.owner_id', 'owners.id')
      .select('tenants.id as tenant_id', 'owners.id as owner_id', 'tenants.db_name');

    for (const t of tenants) {
      console.log(`\n📂 Memeriksa Tenant ID: ${t.tenant_id} (Owner ID: ${t.owner_id})`);
      const tenantDb = getTenantConnection(t);

      // Ambil semua transaksi yang statusnya 'failed'
      const failedOrders = await tenantDb('ppob_orders').where('status', 'failed');
      
      let refundedCount = 0;

      for (const order of failedOrders) {
        const trx = await master.transaction();
        try {
          // Kunci baris saldo owner
          const row = await trx('owners').forUpdate().where('id', t.owner_id).first('wallet_balance');
          if (!row) {
            await trx.rollback();
            continue;
          }

          // Cek apakah SUDAH di-refund sebelumnya
          const existingRefund = await trx('wallet_transactions')
            .where({ 
              owner_id: t.owner_id, 
              reference_type: 'ppob_orders', 
              reference_id: order.id, 
              type: 'ppob_refund' 
            })
            .first();

          // Jika sudah di-refund (atau over-refund karena bug lama), lewati
          if (existingRefund) { 
            await trx.rollback(); 
            continue; 
          }

          // Hitung total potongan (modal + margin) untuk order ini
          const deductions = await trx('wallet_transactions')
            .where({ 
              owner_id: t.owner_id, 
              reference_type: 'ppob_orders', 
              reference_id: order.id 
            })
            .whereIn('type', ['ppob_purchase', 'transaction_fee'])
            .sum({ total: 'amount' })
            .first();

          const refundAmount = Math.abs(parseFloat(deductions?.total || 0));
          if (refundAmount <= 0) { 
            await trx.rollback(); 
            continue; 
          }

          // Lakukan refund!
          const balance = parseFloat(row.wallet_balance || 0);
          const after = balance + refundAmount;

          await trx('owners').where('id', t.owner_id).update({ wallet_balance: after });
          await trx('wallet_transactions').insert({
            owner_id: t.owner_id,
            type: 'ppob_refund',
            amount: refundAmount,
            balance_after: after,
            reference_type: 'ppob_orders',
            reference_id: order.id,
            description: `Refund Susulan PPOB gagal (ref ${order.ref_id})`,
          });

          await trx.commit();
          refundedCount++;
          console.log(`   ✅ [REFUNDED] Ref: ${order.ref_id} | Jumlah: +${refundAmount} | Saldo Akhir: ${after}`);
        } catch (err) {
          await trx.rollback();
          console.error(`   ❌ Gagal refund order ${order.ref_id}:`, err.message);
        }
      }

      console.log(`   🏁 Selesai memeriksa tenant ${t.tenant_id}. Total di-refund susulan: ${refundedCount}`);
    }

    console.log("\n🎉 SEMUA PENGECEKAN SELESAI!");
  } catch (error) {
    console.error("Terjadi kesalahan sistem:", error);
  } finally {
    process.exit(0);
  }
}

fixMissingRefunds();
