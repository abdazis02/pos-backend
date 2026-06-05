const master = require('../config/knexMaster');

const PPOBProductModel = {
  async getAllProducts(filters = {}) {
    // 1. Ambil semua layanan yang sedang DIMATIKAN (is_active = 0) dari web
    const disabledServices = await master('services').where('is_active', 0);
    
    // 2. Samakan nama "Layanan" dengan nama "Kategori" di database produk
    const disabledCategories = disabledServices.map(s => {
       if (s.name === 'Paket Data') return 'Data';
       if (s.name === 'Token PLN') return 'PLN';
       if (s.name === 'FDAM') return 'PDAM'; // typo dari web Anda
       if (s.name === 'Telkom/IndiHome') return 'Telkom';
       return s.name; // Pulsa, BPJS, E-Money, Game
    });

    let query = master('ppob_products').where('is_active', true);

    // 3. BLOKIR SECARA OTOMATIS: Jangan ambil produk jika kategorinya sedang di-OFF-kan
    if (disabledCategories.length > 0) {
       query = query.whereNotIn('category', disabledCategories);
    }

    // Filter produk administratif yang tidak untuk dijual (Cek Nama/Inquiry)
    query = query.whereNot('product_name', 'like', '%Cek Nama%')
                 .whereNot('product_name', 'like', '%Inquiry%')
                 .whereNot('product_name', 'like', '%Cek Pengguna%');

    if (filters.type) {
      query = query.where('type', filters.type);
    }

    if (filters.category) {
      query = query.where(function() {
        this.where('category', 'like', `%${filters.category}%`)
            .orWhere('brand', 'like', `%${filters.category}%`);
      });
    }

    return query.orderBy('price', 'asc').orderBy('product_name', 'asc');
  },

  async createOrUpdateProducts(products) {
    const trx = await master.transaction();
    try {
      console.log(`💾 Memulai Sinkronisasi Database (${products.length} produk)...`);

      // 🔥 LANGKAH KRITIS: Matikan SEMUA produk terlebih dahulu.
      // Produk yang masih aktif di seller baru akan dihidupkan kembali oleh upsert di bawah.
      // Produk dari seller LAMA yang tidak ada di seller baru akan tetap mati (is_active = 0).
      await trx('ppob_products').update({ is_active: false });

      for (const product of products) {
        const isPostpaid = product.type === 'postpaid';

        // 🔥 SKU FALLBACK: Digiflazz Postpaid kadang pakai 'product_code' atau 'code'
        const sku = product.buyer_sku_code || product.product_code || product.code || '';
        if (!sku) continue;

        let category = product.category;
        if (isPostpaid && ['DANA', 'GOPAY', 'OVO', 'SHOPEE PAY', 'LINKAJA'].includes(String(product.brand).toUpperCase())) {
          category = 'E-Money';
        }

        const data = {
          product_name: product.product_name,
          category: category,
          brand: product.brand,
          // Jika pasca, gunakan admin fee sebagai 'harga beli dasar'
          price: isPostpaid ? (parseFloat(product.admin) || 0) : (parseFloat(product.price) || 0),
          buyer_sku_code: sku,
          type: product.type || 'prepaid',
          is_active: Boolean(product.buyer_product_status && product.seller_product_status),
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
