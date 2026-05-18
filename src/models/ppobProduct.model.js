const master = require('../config/knexMaster');

const PPOBProductModel = {
  async getAllProducts(filters = {}) {
    let query = master('ppob_products').where('is_active', true);

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
      for (const product of products) {
        const data = {
          product_name: product.product_name,
          category: product.category,
          brand: product.brand,
          price: product.price,
          buyer_sku_code: product.buyer_sku_code,
          type: product.type,
          is_active: product.buyer_product_status && product.seller_product_status,
          updated_at: trx.fn.now(),
        }

        await trx('ppob_products')
          .insert(data)
          .onConflict('buyer_sku_code')
          .merge(data);
      }
      await trx.commit();
    } catch (error) {
      await trx.rollback();
      throw error;
    }
  },
};

module.exports = PPOBProductModel;