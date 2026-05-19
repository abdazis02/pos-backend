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
      console.log(`💾 Memulai Sinkronisasi Database (${products.length} produk)...`);
      for (const product of products) {
        const isPostpaid = product.type === 'postpaid';

        // 🔥 SKU FALLBACK: Digiflazz Postpaid kadang pakai 'product_code' atau 'code'
        const sku = product.buyer_sku_code || product.product_code || product.code || '';
        if (!sku) continue;

        const data = {
          product_name: product.product_name,
          category: product.category,
          brand: product.brand,
          // Jika pasca, gunakan admin fee sebagai 'harga beli dasar'
          price: isPostpaid ? (parseFloat(product.admin) || 0) : (parseFloat(product.price) || 0),
          buyer_sku_code: sku,
          type: product.type || 'prepaid',
          is_active: isPostpaid
            ? (product.status === 1 || product.status === '1' || String(product.status).toLowerCase() === 'aktif' || String(product.status).toLowerCase() === 'on')
            : (product.buyer_product_status && product.seller_product_status),
          updated_at: trx.fn.now(),
        }

        await trx('ppob_products')
          .insert(data)
          .onConflict('buyer_sku_code')
          .merge(data);
      }
      await trx.commit();
      console.log(`✅ Sinkronisasi Database Selesai.`);
    } catch (error) {
      await trx.rollback();
      console.error(`❌ Sinkronisasi Database Gagal:`, error.message);
      throw error;
    }
  },
};

module.exports = PPOBProductModel;