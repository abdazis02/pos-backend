const Joi = require('joi');
const response = require('../utils/response');
const ProductModel = require('../models/product.model');
const ActivityLogModel = require('../models/activityLog.model');
const { move, remove } = require('../utils/uploaded_file');
const { pageValidations } = require('../validations/page.validation');
const { productValidation } = require('../validations/product.validation');

const validation = pageValidations.keys({
  category: Joi.string().allow(null, ''),
  status: Joi.number().allow(null, ''),
})

const ProductController = {
    // Get all products (tenant)
  async list(req, res) {
    try {
      const { value, error } = validation.validate(req.query)
      if (error) {
        return response.badRequest(res, error.details[0].message, error.details)
      }

      const { store_id } = req.params;

      // ✅ GUNAKAN LOGIKA INI:
      // Ambil category langsung dari hasil validasi (string murni dari frontend)
      const categoryFilter = (value.category && value.category !== '') ? value.category : null;

      const offset = (value.page - 1) * value.itemsPerPage;
      
      const [products, total, filtered] = await Promise.all(
        ProductModel.paginateProducts(req.db, store_id, offset, value.itemsPerPage, { 
          ...value, 
          category: categoryFilter, // Masukkan string kategori asli ke sini
          search: value.q 
        })
      );

      return response.success(res, {
        items: products,
        total: total.cnt,
        filtered: filtered.cnt
      });
    } catch (error) {
      console.error('GetAll Products Error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengambil produk');
    }
  },

  // Create new product with discount logic
  async create(req, res) {
    try {
      const { store_id } = req.params;

      const { value, error } = productValidation.validate(req.body, { abortEarly: true, stripUnknown: true })
      if (error) {
        return response.badRequest(res, error.details[0].message, error.details)
      }

      // Validasi barcode unik per store
      if (value.barcode) {
        const existing = await ProductModel.findProductByBarcode(req.db, store_id, value.barcode);
        if (!!existing) return response.badRequest(res, 'Barcode sudah terdaftar di toko ini');
      }

      // Ambil path gambar dari upload jika ada
      if (req.file) {
        value.image_url = move(req.file, req.user.tenant_id);
      }

      value.store_id = store_id

      // 🔥 CLEANUP: Pastikan string kosong dikonversi ke null agar database tidak error
      const cleanupFields = ['expired_date', 'batch_number', 'wholesale_price', 'min_wholesale_qty', 'sku', 'barcode', 'description', 'category'];
      cleanupFields.forEach(field => {
        if (value[field] === '') value[field] = null;
      });

      const product_id = await ProductModel.createProduct(req.db, value);
      const product = await ProductModel.findProductById(req.db, store_id, product_id);

      // Log aktivitas
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: store_id,
        action: 'add_product',
        detail: `Tambah produk: ${product.name}`
      });

      return response.created(res, product, 'Produk berhasil ditambahkan');
    } catch (error) {
      console.error("❌ ERROR CREATE PRODUK:", error);
      return response.error(res, error, 'Terjadi kesalahan saat membuat produk');
    }
  },

  // Get single product
  async getById(req, res) {
    try {
      const { store_id, id } = req.params;

      const product = await ProductModel.findProductById(req.db, store_id, id);
      if (!product) return response.notFound(res, 'Produk tidak ditemukan');

      // === Tambahkan simulasi harga final untuk bundle ===
      let finalPrice = product.price;
      if (product.discount_type === 'percentage' && product.discount_value) {
        finalPrice -= (finalPrice * product.discount_value / 100);
      } else if (product.discount_type === 'nominal' && product.discount_value) {
        finalPrice -= product.discount_value;
      } else if (product.discount_type === 'bundle' && product.discount_bundle_min_qty && product.discount_bundle_value) {
        // Simulasi: jika beli sebanyak bundle min qty, harga total = bundle value
        finalPrice = Number(product.discount_bundle_value);
      }
      product.final_price = finalPrice;

      return response.success(res, product, 'Data produk berhasil diambil');
    } catch (error) {
      return response.error(res, error, 'Terjadi kesalahan saat mengambil data produk');
    }
  },

  async update(req, res) {
    try {
      const { store_id, id } = req.params;

      const { value, error } = productValidation.validate(req.body, { abortEarly: true, stripUnknown: true })
      if (error) {
        return response.badRequest(res, error.details[0].message, error.details)
      }

      const product = await ProductModel.findProductById(req.db, store_id, id);
      if (!product) return response.notFound(res, 'Produk tidak ditemukan');

      // Jika ada file gambar baru
      if (req.file) {
        value.image_url = move(req.file, req.user.tenant_id);
      }

      // Normalisasi input dari query validation yang ter-strip
      const cleanupFields = ['expired_date', 'batch_number', 'wholesale_price', 'min_wholesale_qty', 'sku', 'barcode', 'description', 'category', 'discount_value', 'discount_bundle_min_qty', 'discount_bundle_value', 'buy_qty', 'free_qty'];
      cleanupFields.forEach(field => {
        if (value[field] === '' || value[field] === undefined) {
          value[field] = null;
        }
      });

      if (product.barcode != value.barcode) {
        const existing = await ProductModel.findProductByBarcode(req.db, store_id, value.barcode);
        if (!!existing) return response.badRequest(res, 'Barcode sudah terdaftar di toko ini');
      }

      const isUpdated = await ProductModel.updateProduct(req.db, store_id, id, value);
      if (!isUpdated) return response.badRequest(res, 'Gagal mengupdate produk');

      const updatedProduct = await ProductModel.findProductById(req.db, store_id, id);

      // Log aktivitas
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: store_id,
        action: 'edit_product',
        detail: `Edit produk: ${updatedProduct.name}`
      });

      if (product.image_url != updatedProduct.image_url) {
        remove(product.image_url)
      }

      return response.success(res, updatedProduct, 'Produk berhasil diupdate');
    } catch (error) {
      console.error('❌ ERROR UPDATE PRODUK:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengupdate produk');
    }
  },

  // Delete product
  async delete(req, res) {
    try {
      const { store_id, id } = req.params;

      const product = await ProductModel.findProductById(req.db, store_id, id);
      if (!product) return response.notFound(res, 'Produk tidak ditemukan');

      const isDeleted = await ProductModel.deleteProduct(req.db, store_id, id);
      if (!isDeleted) return response.badRequest(res, 'Gagal menghapus produk');

      // Log aktivitas
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: store_id,
        action: 'delete_product',
        detail: `Hapus produk: ${id} -> ${product.name}`
      });

      remove(product.image_url)

      return response.success(res, null, 'Produk berhasil dihapus');
    } catch (error) {
      return response.error(res, error, 'Terjadi kesalahan saat menghapus produk');
    }
  },

  async getLowStock(req, res) {
    try {
      const { store_id } = req.params;
      const threshold = parseInt(req.query.threshold || '10', 10);
      const storeId = parseInt(store_id, 10);

      const lowStockProducts = await ProductModel.getLowStock(req.db, storeId, threshold);
      const safeProducts = lowStockProducts.map(p => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        barcode: p.barcode,
        stock: p.stock,
        category: p.category,
        image_url: p.image_url,
        price: p.price,
        // Jangan kirim cost_price ke kasir!
      }));

      return response.success(res, { products: safeProducts, count: safeProducts.length, threshold }, 'Produk dengan stok rendah');
    } catch (error) {
      return response.error(res, 'Terjadi kesalahan saat mengambil produk stok rendah', 500, error);
    }
  },

  async addStock(req, res) {
    try {
      const { store_id, id } = req.params;
      const { quantity } = req.body;
      const storeId = parseInt(store_id, 10);
      const productId = parseInt(id, 10);

      const existsInStore = await ProductModel.findProductById(req.db, storeId, productId);
      if (!existsInStore) return response.notFound(res, 'Produk tidak ditemukan');

      const isUpdated = await ProductModel.addProductStock(req.db, storeId, productId, quantity);
      if (!isUpdated) return response.error(res, 'Gagal mengupdate stok produk', 400);

      const updatedProduct = await ProductModel.findProductById(req.db, storeId, productId);
      return response.success(res, updatedProduct, 'Stok produk berhasil diupdate');
    } catch (error) {
      return response.error(res, error, 'Terjadi kesalahan saat mengupdate stok produk');
    }
  },

  async getStats(req, res) {
    try {
      const { store_id } = req.params;
      const storeId = parseInt(store_id, 10);

      const [stats, low_stock_items, recent_products] = await Promise.all(ProductModel.getProductStats(req.db, storeId));

      stats.average_price = stats.sum_price / stats.total_products;
      delete stats.sum_price

      stats.low_stock_items = low_stock_items
      stats.recent_products = recent_products

      return response.success(res, stats, 'Statistik produk berhasil diambil');
    } catch (error) {
      return response.error(res, error, 'Terjadi kesalahan saat mengambil statistik produk');
    }
  },
};

module.exports = ProductController;
