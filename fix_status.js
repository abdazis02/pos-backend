require('dotenv').config();
const master = require('./src/config/knexMaster');
const { getTenantConnection } = require('./src/config/knexTenant');
const OwnerModel = require('./src/models/owner.model');

async function fixStatus() {
  const refId = 'INQ-63-1784612746015'; // Transaksi SYAHRAWI AHMAD
  console.log('Mencari transaksi dengan ref_id:', refId);

  try {
    const tenantId = 63;
    const tenantConfig = await OwnerModel.getTenantByID(tenantId);
    if (!tenantConfig) {
      console.log('Tenant 63 tidak ditemukan!');
      process.exit(1);
    }

    const tenantDb = getTenantConnection(tenantConfig);
    const order = await tenantDb('ppob_orders')
      .where({
        customer_no: '021400639',
        buyer_sku_code: 'pdtte',
      })
      .orderBy('created_at', 'desc')
      .first();

    if (!order) {
      console.log('Pesanan tidak ditemukan di database tenant!');
      process.exit(1);
    }

    if (order.status === 'success') {
      console.log('Transaksi SUDAH sukses!');
      process.exit(0);
    }

    await tenantDb('ppob_orders').where('ref_id', order.ref_id).update({ status: 'success' });
    console.log('BERHASIL: Status transaksi telah diubah menjadi success!');
    process.exit(0);
  } catch (err) {
    console.error('Terjadi kesalahan:', err);
    process.exit(1);
  }
}

fixStatus();
