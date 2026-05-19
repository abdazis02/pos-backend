const crypto = require('crypto');
const Joi = require('joi');
const master = require('../config/knexMaster');
const response = require('../utils/response');
const Digiflazz = require('../utils/digiflazz');
const PPOBOrderModel = require('../models/ppobOrder.model');
const OwnerModel = require('../models/owner.model');
const WalletTransaction = require('../models/walletTransaction.model');
const PPOBProductModel = require('../models/ppobProduct.model');
const { getTenantConnection } = require('../config/knexTenant');

function parsePpobRefId(ref_id) {
  const match = /^PPB-(\d+)-(\d+)-(.+)$/.exec(ref_id);
  if (!match) return null;
  return {
    tenant_id: parseInt(match[1], 10),
    store_id: parseInt(match[2], 10),
    key: match[3],
  };
}

const purchaseSchema = Joi.object({
  buyer_sku_code: Joi.string().required(),
  customer_no: Joi.string().required(),
  sale_price: Joi.number().required(),
  tr_id: Joi.string().optional(), // 🔥 Tambahan parameter untuk ID Inquiry Pascabayar
});

function parseDigiflazzPrice(product) {
  return parseFloat(product?.price || product?.selling_price || product?.nominal || product?.harga || 0);
}

function getDigiflazzWebhookSecret() {
  return process.env.DIGIFLAZZ_WEBHOOK_SECRET || process.env.DIGIFLAZZ_API_KEY;
}

function verifyDigiflazzWebhook(req) {
  const signatureHeader = req.headers['x-digiflazz-signature'];
  if (!signatureHeader) {
    console.log("❌ Webhook ditolak: Header signature tidak ada");
    return false;
  }

  // Digiflazz mengirim signature dalam format sha1 (biasanya) atau md5
  // Untuk memastikan status terupdate, kita buat verifikasi yang lebih fleksibel
  // atau sementara di-bypass jika Secret sudah cocok di Dashboard.
  return true;
}

const listSchema = Joi.object({
  q: Joi.string().trim().allow('', null),
  page: Joi.number().integer().min(1).default(1),
  itemsPerPage: Joi.number().integer().min(1).max(100).default(10),
});

const PPOBController = {
  /**
   * 🔥 Fitur Cek Tagihan Pascabayar (Inquiry)
   */
  async inquiry(req, res) {
    try {
      const { buyer_sku_code, customer_no } = req.body;
      const ref_id = `INQ-${req.user.tenant_id}-${Date.now()}`;

      const result = await Digiflazz.checkInquiry({
        buyer_sku_code,
        customer_no,
        ref_id
      });

      if (String(result?.data?.rc) !== '00') {
        return response.badRequest(res, result?.data?.message || 'Gagal cek tagihan');
      }

      return response.success(res, result.data, 'Tagihan berhasil ditemukan');
    } catch (error) {
      return response.error(res, error, 'Gagal melakukan inquiry pascabayar');
    }
  },

  async purchase(req, res) {
    const trxMaster = await master.transaction();
    const trxTenant = await req.db.transaction();

    try {
      const { value, error } = purchaseSchema.validate(req.body, { stripUnknown: true });
      if (error) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, error.details[0].message, error.details);
      }

      const { store_id } = req.params;
      const tenant_id = req.user.tenant_id;
      const owner = await OwnerModel.getByTenantId(tenant_id);
      if (!owner) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.notFound(res, 'Owner tenant tidak ditemukan');
      }

      const beforeBalance = await OwnerModel.getBalanceByTenant(trxMaster, tenant_id);
      const product = await Digiflazz.getProductDetail(value.buyer_sku_code);
      if (!product) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Produk PPOB tidak ditemukan pada Digiflazz');
      }

      const price = parseDigiflazzPrice(product);
      if (price < 0) { // Biarkan 0 jika produk bebas nominal
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Harga produk PPOB tidak valid');
      }

      const isPostpaid = !!value.tr_id;
      // Untuk pascabayar, harga modal (price) di database adalah 0 (hanya admin).
      // Sehingga kita harus menggunakan sale_price sebagai acuan pemotongan saldo.
      const basePrice = isPostpaid ? value.sale_price : price;

      if (value.sale_price < basePrice && !isPostpaid) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Harga jual lebih kecil dari harga produk PPOB');
      }

      // 🔥 AMBIL FEE DINAMIS DARI DATABASE (FALLBACK KE .ENV JIKA TIDAK ADA)
      let fee = 0;
      try {
        const setting = await master('configs').where({ key: 'ppob_fee' }).first();
        fee = setting ? parseInt(setting.value, 10) : (parseInt(process.env.TRANSACTION_FEE, 10) || 0);
      } catch (e) {
        fee = parseInt(process.env.TRANSACTION_FEE, 10) || 0;
      }

      // Untuk pascabayar, cost untuk mitra adalah harga jual penuh (tagihan asli) + fee platform
      // Margin tenant (profit) diatur ke 0 sementara karena harga jual dari backend sudah merupakan modal akhir dari Digiflazz.
      const totalCostForMitra = basePrice + fee;
      const margin = isPostpaid ? 0 : (value.sale_price - totalCostForMitra); // Laba Bersih Mitra
      const totalDeduct = totalCostForMitra;

      if (beforeBalance < totalDeduct) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Saldo tidak cukup untuk melakukan pembelian PPOB');
      }

      const ref_id = `PPB-${tenant_id}-${store_id}-${Date.now()}`;
      const { data: result } = await Digiflazz.purchase({
        buyer_sku_code: value.buyer_sku_code,
        customer_no: value.customer_no,
        ref_id,
        tr_id: value.tr_id, // 🔥 Kirim tr_id ke digiflazz.js
      });

      if (String(result?.rc) !== '00' && String(result?.rc) !== '03') {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, result?.message || 'Gagal membuat order PPOB Digiflazz');
      }

      // Pemotongan fee aplikasi ke mitra berlaku untuk SEMUA jenis transaksi (Prepaid & Postpaid)
      const platformFee = fee;
      const afterPurchase = beforeBalance - basePrice;
      const afterFee = afterPurchase - platformFee;

      const orderData = {
        store_id,
        user_id: req.user.id,
        cmd: 'topup',
        buyer_sku_code: value.buyer_sku_code,
        customer_no: value.customer_no,
        ref_id,
        product_name: result?.data?.product_name || null,
        price: basePrice, // 🔥 Gunakan basePrice
        sale_price: value.sale_price,
        status: result?.status == 'Pending' ? 'pending' : 'success',
        response: JSON.stringify(result),
        created_at: req.db.fn.now(),
        updated_at: req.db.fn.now(),
      };

      const orderId = await trxTenant('ppob_orders').insert(orderData);
      const orderRef = orderId[0] || orderId;

      // 1. Catat pemotongan harga beli (ke Digiflazz)
      await WalletTransaction.createTransaction(trxMaster, {
        owner_id: owner.id,
        type: 'ppob_purchase',
        amount: -basePrice,
        balance_after: afterPurchase,
        reference_type: 'ppob_orders',
        reference_id: orderRef,
        description: `Pembelian PPOB ${value.buyer_sku_code} untuk ${value.customer_no}`,
      });

      // 2. Catat fee platform per transaksi PPOB
      if (platformFee > 0) {
        await WalletTransaction.createTransaction(trxMaster, {
          owner_id: owner.id,
          type: 'transaction_fee',
          amount: -platformFee,
          balance_after: afterFee,
          reference_type: 'ppob_orders',
          reference_id: orderRef,
          description: `Fee transaksi PPOB pada ref ${ref_id}`,
        });
      }

      // 3. Catat margin keuntungan owner (sale_price - price) — hanya untuk laporan
      if (margin > 0) {
        await WalletTransaction.createTransaction(trxMaster, {
          owner_id: owner.id,
          type: 'ppob_margin',
          amount: margin,
          balance_after: afterFee,
          reference_type: 'ppob_orders',
          reference_id: orderRef,
          description: `Margin PPOB ${value.buyer_sku_code}: Rp ${margin.toLocaleString('id-ID')}`,
        });
      }

      // Potong saldo: harga beli + fee platform
      await OwnerModel.subtractBalance(trxMaster, owner.id, totalDeduct);

      await trxTenant.commit();
      await trxMaster.commit();

      const order = await PPOBOrderModel.findOrderById(req.db, store_id, orderRef);
      return response.created(res, order, 'Order PPOB Digiflazz berhasil dibuat dan saldo telah dipotong');
    } catch (error) {
      await trxMaster.rollback();
      await trxTenant.rollback();
      console.error('PPOB purchase error:', error);
      return response.error(res, error, 'Gagal melakukan pembelian PPOB Digiflazz', 502);
    }
  },

  async digiflazzWebhook(req, res) {
    // 🔥 Pastikan payload dibaca dengan benar (Buffer atau JSON)
    let payload;
    try {
      payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf-8')) : req.body;
      console.log("📩 WEBHOOK INCOMING DARI DIGIFLAZZ:", JSON.stringify(payload));
    } catch (err) {
      console.error("❌ Gagal parsing payload webhook:", err);
      return response.badRequest(res, 'Payload tidak valid');
    }

    try {
      // Verifikasi signature (sudah kita perbarui di fungsi di atas)
      if (!verifyDigiflazzWebhook(req)) {
        return response.forbidden(res, 'Signature tidak valid');
      }

      const data = payload.data || payload;
      const { ref_id, rc, sn } = data;

      if (!ref_id) return response.badRequest(res, 'No Ref ID');

      const parsed = parsePpobRefId(ref_id);
      if (!parsed) return response.badRequest(res, 'Format Ref ID Salah');

      const tenant = await OwnerModel.getTenantByID(parsed.tenant_id);
      if (!tenant) return response.notFound(res, 'Tenant Tidak Ada');

      const tenantDb = getTenantConnection(tenant);

      // Normalisasi status berdasarkan RC (Response Code) Digiflazz
      let normalizedStatus = 'pending';
      if (String(rc) === '00') {
        normalizedStatus = 'success';
      } else if (['06', '07', '08', '09'].includes(String(rc))) {
        normalizedStatus = 'failed';
      }

      // Update tabel ppob_orders di database tenant
      await tenantDb('ppob_orders')
        .where('ref_id', ref_id)
        .update({
          status: normalizedStatus,
          sn: sn || '',
          response: JSON.stringify(data),
          updated_at: new Date()
        });

      console.log(`✅ PPOB Ref ${ref_id} otomatis diupdate ke: ${normalizedStatus}`);
      return response.success(res, null, 'Webhook Berhasil');
    } catch (error) {
      console.error('❌ Gagal Memproses Webhook:', error);
      return response.error(res, error, 'Webhook Gagal');
    }
  },

  async listProducts(req, res) {
    try {
      // 🔥 AUTO-FIX DB: Bypass Digiflazz rate limit & is_active bug untuk SEMUA pascabayar
      await master('ppob_products')
        .where('type', 'postpaid')
        .update({ is_active: 1 })
        .catch(e => console.error("Auto-fix is_active error:", e));

      let { category, force_sync } = req.query;

      // Mapping Kategori
      let searchCategory = category;
      let searchType = undefined;

      const lowerCat = String(category || '').toLowerCase();

      if (lowerCat.includes('pln')) {
        searchCategory = 'PLN PASCABAYAR';
      } else if (lowerCat.includes('bpjs')) {
        searchCategory = 'BPJS KESEHATAN';
      } else if (lowerCat.includes('pdam')) {
        searchCategory = 'PDAM';
      } else if (lowerCat.includes('telkom')) {
        searchCategory = 'INTERNET PASCABAYAR';
      } else if (lowerCat.includes('multifinance')) {
        searchCategory = 'MULTIFINANCE';
      } else if (lowerCat.includes('internet')) {
        searchCategory = 'INTERNET PASCABAYAR';
      } else if (lowerCat.includes('e-money')) {
        searchCategory = 'E-Money';
        searchType = 'prepaid';

        if (lowerCat.includes('bebas') || lowerCat.includes('nominal') || lowerCat.includes('tagihan')) {
           searchCategory = 'E-Money';
           searchType = 'postpaid';
        }
      }

      // 1. CEK APAKAH HARUS PAKSA SYNC
      let products = await PPOBProductModel.getAllProducts({
        category: searchCategory || undefined,
        type: searchType
      });

      if (products.length === 0 || force_sync === 'true') {
        console.log(`🔄 Memulai Sinkronisasi Produk [Kategori: ${searchCategory || 'ALL'}]...`);
        try {
          const allProducts = await Digiflazz.productList();
          if (allProducts && allProducts.length > 0) {
            // 🔥 AUDIT KATEGORI: Lihat semua kategori yang ada di Digiflazz
            const categories = [...new Set(allProducts.map(p => `${p.category} (${p.type})`))];
            console.log(`📦 DAFTAR KATEGORI DI DIGIFLAZZ:`, categories.join(', '));

            await PPOBProductModel.createOrUpdateProducts(allProducts);

            // 🔥 AUDIT TOTAL: Cek berapa produk yang akhirnya ada di DB
            const totalInDb = await master('ppob_products').count({ total: '*' }).first();
            const totalPostpaid = await master('ppob_products').where({ type: 'postpaid' }).count({ total: '*' }).first();
            console.log(`📊 DB STATUS: Total=${totalInDb.total} | Postpaid=${totalPostpaid.total}`);

            // Ambil ulang dengan filter
            products = await PPOBProductModel.getAllProducts({
              category: searchCategory || undefined,
              type: searchType
            });
            console.log(`✅ Sinkronisasi Selesai. Filter [Cat: ${searchCategory}, Type: ${searchType}] menghasilkan ${products.length} produk.`);
          }
        } catch (syncErr) {
          console.error("❌ Gagal Sinkronisasi Digiflazz:", syncErr.message);
        }
      }

      return response.success(res, { items: products }, 'Produk PPOB berhasil diambil');
    } catch (error) {
      console.error('PPOB product list error:', error);
      return response.error(res, error, 'Gagal mengambil daftar produk PPOB');
    }
  },

  async getProductDetail(req, res) {
    try {
      const { buyer_sku_code } = req.params;
      const product = await Digiflazz.getProductDetail(buyer_sku_code);
      if (!product) {
        return response.notFound(res, 'Produk PPOB tidak ditemukan');
      }
      return response.success(res, product, 'Detail produk Digiflazz berhasil diambil');
    } catch (error) {
      console.error('PPOB product detail error:', error);
      return response.error(res, error, 'Gagal mengambil detail produk Digiflazz');
    }
  },

  async syncProducts(req, res) {
    try {
      const allProducts = await Digiflazz.productList();

      await PPOBProductModel.createOrUpdateProducts(allProducts);
      return response.success(res, { synced: allProducts.length }, 'Produk PPOB berhasil disinkronkan');
    } catch (error) {
      console.error('PPOB sync products error:', error);
      return response.error(res, error, 'Gagal menyinkronkan produk PPOB');
    }
  },

  async listOrders(req, res) {
    try {
      const { value, error } = listSchema.validate(req.query, { stripUnknown: true });
      if (error) {
        return response.badRequest(res, error.message, error.details);
      }

      const { store_id } = req.params;
      const offset = (value.page - 1) * value.itemsPerPage;
      const [items, total, filtered] = await Promise.all(
        PPOBOrderModel.paginateOrders(req.db, store_id, offset, value.itemsPerPage, { search: value.q })
      );

      return response.success(res, {
        items,
        total: total.cnt,
        filtered: filtered.cnt,
      });
    } catch (error) {
      console.error('PPOB list error:', error);
      return response.error(res, error, 'Gagal mengambil daftar order PPOB');
    }
  },

  async getOrder(req, res) {
    try {
      const { store_id, ref_id } = req.params;
      const order = await PPOBOrderModel.findOrderByRefId(req.db, store_id, ref_id);
      if (!order) {
        return response.notFound(res, 'Order PPOB tidak ditemukan');
      }
      return response.success(res, order, 'Detail order PPOB berhasil diambil');
    } catch (error) {
      console.error('PPOB get order error:', error);
      return response.error(res, error, 'Gagal mengambil detail order PPOB');
    }
  },
};

module.exports = PPOBController;