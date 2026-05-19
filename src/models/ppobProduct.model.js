const master = require('../config/knexMaster');

const PPOBProductModel = {
  async getAllProducts(filters = {}) {
    let query = master('ppob_products').where('is_active', true);

    // 🔥 FIX: Filter produk administratif yang tidak untuk dijual (Cek Nama/Inquiry)
    query = query.whereNot('product_name', 'like', '%Cek Nama%')
                 .whereNot('product_name', 'like', '%Inquiry%')
                 .whereNot('product_name', 'like', '%Cek Pengguna%');

    if (filters.type) {
      query = query.where('type', filters.type);
    }

    if (filters.category) {
      // 🔥 Gunakan WHERE LIKE agar pencarian kategori lebih fleksibel (misal: E-Money vs E-MONEY)
      query = query.where('category', 'like', `%${filters.category}%`);
    }

    return query.orderBy('product_name');
  },

  async createOrUpdateProducts(products) {
    const trx = await master.transaction();
    try {
      console.log(`💾 Starting DB Sync for ${products.length} products...`);
      for (const product of products) {
        // 🔥 FIX: Digiflazz Postpaid menggunakan field berbeda (admin, commission, status)
        const isPostpaid = product.type === 'postpaid';

        const data = {
          product_name: product.product_name,
          category: product.category,
          brand: product.brand,
          // Jika pasca, harga 'beli' awal kita set 0 atau admin, karena nominal diisi manual
          price: isPostpaid ? (parseFloat(product.admin) || 0) : (parseFloat(product.price) || 0),
          buyer_sku_code: product.buyer_sku_code,
          type: product.type,
          is_active: isPostpaid
            ? (product.status === 1 || product.status === '1') // Field 'status' di Postpaid
            : (product.buyer_product_status && product.seller_product_status), // Field di Prepaid
          updated_at: trx.fn.now(),
        }

        await trx('ppob_products')
          .insert(data)
          .onConflict('buyer_sku_code')
          .merge(data);
      }
      await trx.commit();
      console.log(`✅ DB Sync Completed.`);
    } catch (error) {
      await trx.rollback();
      console.error(`❌ DB Sync Error:`, error.message);
      throw error;
    }
  },
};

module.exports = PPOBProductModel;