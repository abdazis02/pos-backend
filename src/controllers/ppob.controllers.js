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
  tr_id: Joi.string().optional(),
  mitra_markup: Joi.number().optional().default(0), // 🔥 Tambahan: Menangkap Keuntungan Kasir dari Frontend
});

function parseDigiflazzPrice(product) {
  return parseFloat(product?.price || product?.selling_price || product?.nominal || product?.harga || 0);
}

function getDigiflazzWebhookSecret() {
  const raw = process.env.DIGIFLAZZ_WEBHOOK_SECRET || process.env.DIGIFLAZZ_API_KEY || '';
  return raw.replace(/^["']|["']$/g, '').trim();
}

function verifyDigiflazzWebhook(req, body) {
  // Digiflazz umumnya pakai header 'x-hub-signature' (format: "sha1=<hex>")
  let signatureHeader = req.headers['x-hub-signature'] || req.headers['x-digiflazz-signature'];
  if (!signatureHeader) {
    console.warn('⚠️ Webhook tanpa header signature, diproses tanpa verifikasi...');
    return true;
  }

  const secret = getDigiflazzWebhookSecret();
  if (!secret) {
    console.warn('⚠️ DIGIFLAZZ_WEBHOOK_SECRET tidak dikonfigurasi, skip verifikasi');
    return true;
  }

  const crypto = require('crypto');
  // HMAC harus atas RAW body (bukan hasil re-stringify yang byte-nya bisa berbeda)
  const rawBody = Buffer.isBuffer(body)
    ? body.toString('utf-8')
    : (typeof body === 'string' ? body : JSON.stringify(body));

  // Header bisa berformat "sha1=<hex>"
  let algo = null;
  if (signatureHeader.includes('=')) {
    const parts = signatureHeader.split('=');
    algo = parts[0].toLowerCase();
    signatureHeader = parts[1];
  }
  const algos = (algo && ['sha256', 'sha1', 'md5'].includes(algo)) ? [algo] : ['sha256', 'sha1', 'md5'];
  for (const a of algos) {
    const h = crypto.createHmac(a, secret).update(rawBody).digest('hex');
    if (signatureHeader === h) return true;
  }

  console.error(`❌ Signature webhook tidak cocok! Got: ${signatureHeader}`);
  return false;
}

// 🔁 Refund saldo owner untuk order PPOB gagal. Idempoten: lock baris saldo owner +
// cek apakah refund sudah pernah dicatat untuk order tsb.
async function refundPpobOrder(tenant_id, order_id, ref_id) {
  const owner = await OwnerModel.getByTenantId(tenant_id);
  if (!owner) return;

  const trx = await master.transaction();
  try {
    const before = await OwnerModel.getBalanceByTenant(trx, tenant_id); // forUpdate lock

    const existingRefund = await trx('wallet_transactions')
      .where({ reference_type: 'ppob_orders', reference_id: order_id, type: 'ppob_refund' })
      .first();
    if (existingRefund) { await trx.rollback(); return; }

    const deductions = await trx('wallet_transactions')
      .where({ owner_id: owner.id, reference_type: 'ppob_orders', reference_id: order_id })
      .whereIn('type', ['ppob_purchase', 'transaction_fee'])
      .sum({ total: 'amount' })
      .first();
    const refundAmount = Math.abs(parseFloat(deductions?.total || 0));
    if (refundAmount <= 0) { await trx.rollback(); return; }

    await OwnerModel.addBalance(trx, owner.id, refundAmount);
    await WalletTransaction.createTransaction(trx, {
      owner_id: owner.id,
      type: 'ppob_refund',
      amount: refundAmount,
      balance_after: parseFloat(before || 0) + refundAmount,
      reference_type: 'ppob_orders',
      reference_id: order_id,
      description: `Refund PPOB gagal (ref ${ref_id})`,
    });
    await trx.commit();
    console.log(`💸 Refund PPOB ${ref_id}: +${refundAmount} ke owner ${owner.id}`);
  } catch (e) {
    await trx.rollback();
    console.error(`❌ Gagal refund PPOB ${ref_id}:`, e.message);
  }
}

const listSchema = Joi.object({
  q: Joi.string().trim().allow('', null),
  page: Joi.number().integer().min(1).default(1),
  itemsPerPage: Joi.number().integer().min(1).max(100).default(10),
});

const PPOBController = {
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

      const duplicateCheck = await trxTenant('ppob_orders')
        .where({ store_id, customer_no: value.customer_no, buyer_sku_code: value.buyer_sku_code })
        .whereRaw('created_at > NOW() - INTERVAL 2 MINUTE')
        .first();

      if (duplicateCheck) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Transaksi sedang diproses. Mohon tunggu 2 menit untuk mencoba nomor yang sama.');
      }

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

      const dbProduct = await master('ppob_products').where('buyer_sku_code', value.buyer_sku_code).first();
      if (!dbProduct) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Produk tidak tersinkronisasi di database');
      }

      const price = parseDigiflazzPrice(product);
      if (price < 0) { 
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Harga produk PPOB tidak valid');
      }

      const isPostpaid = !!value.tr_id;
      // 🔥 LOGIKA BARU PEMOTONGAN SALDO (TANPA FEE 150)
      let piposMargin = parseFloat(dbProduct.margin || 0); // 👈 DIJADIKAN ANGKA
      let beforeBalanceNum = parseFloat(beforeBalance || 0); // 👈 DIJADIKAN ANGKA
      let totalCostForMitra = 0;
      let purchaseModal = 0; // Modal dasar (ke Digiflazz)

      if (isPostpaid) {
        // Tagihan Pascabayar: Potongan Saldo Mitra = Harga Jual di Struk - Laba Kasir (Mitra)
        totalCostForMitra = parseFloat(value.sale_price) - parseFloat(value.mitra_markup || 0);
        purchaseModal = totalCostForMitra - piposMargin; // Modal tagihan asli dari Biller
      } else {
        // Pulsa/Data: Potongan Saldo Mitra = Modal Digiflazz + Keuntungan PIPos
        totalCostForMitra = price + piposMargin;
        purchaseModal = price;
      }

      const totalDeduct = totalCostForMitra;

      if (beforeBalanceNum < totalDeduct) { // 👈 MENGGUNAKAN ANGKA MURNI
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Saldo deposit tidak mencukupi untuk memproses transaksi PPOB ini');
      }

      const ref_id = `PPB-${tenant_id}-${store_id}-${Date.now()}`;
      const { data: result } = await Digiflazz.purchase({
        buyer_sku_code: value.buyer_sku_code,
        customer_no: value.customer_no,
        ref_id,
        tr_id: value.tr_id,
      });

      if (String(result?.rc) !== '00' && String(result?.rc) !== '03') {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, result?.message || 'Gagal membuat order PPOB Digiflazz');
      }

      const afterPurchase = beforeBalance - purchaseModal;
      const afterFee = afterPurchase - piposMargin;

      const orderData = {
        store_id,
        user_id: req.user.id,
        cmd: 'topup',
        buyer_sku_code: value.buyer_sku_code,
        customer_no: value.customer_no,
        ref_id,
        product_name: result?.data?.product_name || product.product_name || value.buyer_sku_code,
        // 💡 Simpan MODAL RIIL MITRA (= modal Digiflazz + margin PIPos), bukan modal Digiflazz saja.
        // Laporan mitra menghitung laba = sale_price - price, jadi `price` harus = total yang dibayar
        // mitra (totalCostForMitra). Sebelumnya memakai purchaseModal (tanpa margin PIPos) → laba mitra
        // keliru ikut menghitung margin PIPos. Potongan saldo & catatan wallet TIDAK berubah.
        price: totalCostForMitra,
        sale_price: value.sale_price,
        status: (() => {
          const rc = String(result?.rc || '');
          if (rc === '00') return 'success';       
          if (rc === '03') return 'pending';        
          if (['06','07','08','09'].includes(rc)) return 'failed'; 
          return result?.status === 'Sukses' ? 'success' : 'pending';
        })(),
        response: JSON.stringify(result),
        created_at: req.db.fn.now(),
        updated_at: req.db.fn.now(),
      };

      const orderId = await trxTenant('ppob_orders').insert(orderData);
      const orderRef = orderId[0] || orderId;

      // 1. Catat pemotongan harga modal
      await WalletTransaction.createTransaction(trxMaster, {
        owner_id: owner.id,
        type: 'ppob_purchase',
        amount: -purchaseModal,
        balance_after: afterPurchase,
        reference_type: 'ppob_orders',
        reference_id: orderRef,
        description: `Pembelian PPOB ${value.buyer_sku_code} untuk ${value.customer_no}`,
      });

      // 2. Catat margin PIPos (sebagai pengganti fee aplikasi)
      if (piposMargin > 0) {
        await WalletTransaction.createTransaction(trxMaster, {
          owner_id: owner.id,
          type: 'transaction_fee',
          amount: -piposMargin,
          balance_after: afterFee,
          reference_type: 'ppob_orders',
          reference_id: orderRef,
          description: `Margin aplikasi PIPos pada ref ${ref_id}`,
        });
      }

      // Potong saldo
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
    console.log("📩 WEBHOOK HEADERS:", JSON.stringify(req.headers));

    let payload;
    try {
      payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf-8')) : req.body;
      console.log("📩 WEBHOOK PAYLOAD:", JSON.stringify(payload));
    } catch (err) {
      console.error("❌ Gagal parsing payload webhook:", err);
      return response.badRequest(res, 'Payload tidak valid');
    }

    try {
      // 🔒 Verifikasi signature (opt-in; aktifkan via DIGIFLAZZ_VERIFY_WEBHOOK=true setelah
      // memastikan DIGIFLAZZ_WEBHOOK_SECRET sama dengan yang di dashboard Digiflazz).
      if (process.env.DIGIFLAZZ_VERIFY_WEBHOOK === 'true' && !verifyDigiflazzWebhook(req, req.body)) {
        return response.unauthorized(res, 'Signature webhook tidak valid');
      }

      const data = payload.data || payload;
      const { ref_id, rc, sn, status } = data;

      if (!ref_id) {
        console.warn("⚠️ Webhook ignored: No Ref ID found");
        return response.badRequest(res, 'No Ref ID');
      }

      console.log(`📡 Processing Webhook for Ref: ${ref_id} | Status: ${status} | RC: ${rc}`);

      const parsed = parsePpobRefId(ref_id);
      if (!parsed) {
        console.error(`❌ Webhook error: Format Ref ID invalid [${ref_id}]`);
        return response.badRequest(res, 'Format Ref ID Salah');
      }

      const tenant = await OwnerModel.getTenantByID(parsed.tenant_id);
      if (!tenant) return response.notFound(res, 'Tenant Tidak Ada');

      const tenantDb = getTenantConnection(tenant);

      let normalizedStatus = 'pending';
      const statusLower = String(status || '').toLowerCase();

      if (String(rc) === '00' || statusLower === 'sukses') {
        normalizedStatus = 'success';
      } else if (['06', '07', '08', '09'].includes(String(rc)) || statusLower === 'gagal') {
        normalizedStatus = 'failed';
      }

      const finalSn = sn || (statusLower === 'sukses' ? data.message : '');

      // Ambil status lama dulu (untuk refund idempoten saat transisi pending -> failed)
      const prevOrder = await tenantDb('ppob_orders').where('ref_id', ref_id).first();

      await tenantDb('ppob_orders')
        .where('ref_id', ref_id)
        .update({
          status: normalizedStatus,
          sn: finalSn || '',
          response: JSON.stringify(data),
          updated_at: new Date()
        });

      // 🔁 Refund saldo bila transaksi gagal (hanya saat transisi dari pending)
      if (normalizedStatus === 'failed' && prevOrder && prevOrder.status === 'pending') {
        await refundPpobOrder(parsed.tenant_id, prevOrder.id, ref_id);
      }

      console.log(`✅ PPOB Ref ${ref_id} otomatis diupdate ke: ${normalizedStatus}`);
      return response.success(res, null, 'Webhook Berhasil');
    } catch (error) {
      console.error('❌ Gagal Memproses Webhook:', error);
      return response.error(res, error, 'Webhook Gagal');
    }
  },

  async listProducts(req, res) {
    try {
      await master('ppob_products')
        .where('type', 'postpaid')
        .update({ is_active: 1 })
        .catch(e => console.error("Auto-fix is_active error:", e));

      let { category, force_sync } = req.query;

      let searchCategory = category;
      let searchType = undefined;

      const lowerCat = String(category || '').toLowerCase();

      // TAMBAHKAN 4 BARIS INI:
      if (lowerCat.includes('pln token') || lowerCat.includes('token pln')) {
        searchCategory = 'PLN';
        searchType = 'prepaid';
      // UBAH 'if' di bawah ini menjadi 'else if':
      } else if (lowerCat.includes('pln')) {
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
      }

      let products = await PPOBProductModel.getAllProducts({
        category: searchCategory || undefined,
        type: searchType
      });

      if (products.length === 0 || force_sync === 'true') {
        console.log(`🔄 Memulai Sinkronisasi Produk [Kategori: ${searchCategory || 'ALL'}]...`);
        try {
          const allProducts = await Digiflazz.productList();
          if (allProducts && allProducts.length > 0) {
            const categories = [...new Set(allProducts.map(p => `${p.category} (${p.type})`))];
            console.log(`📦 DAFTAR KATEGORI DI DIGIFLAZZ:`, categories.join(', '));

            await PPOBProductModel.createOrUpdateProducts(allProducts);

            const totalInDb = await master('ppob_products').count({ total: '*' }).first();
            const totalPostpaid = await master('ppob_products').where({ type: 'postpaid' }).count({ total: '*' }).first();
            console.log(`📊 DB STATUS: Total=${totalInDb.total} | Postpaid=${totalPostpaid.total}`);

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
      if (!allProducts || allProducts.length === 0) {
        return response.badRequest(res, 'Tidak ada produk yang diterima dari Digiflazz');
      }
      await PPOBProductModel.createOrUpdateProducts(allProducts);
      return response.success(res, { synced: allProducts.length }, `${allProducts.length} produk PPOB berhasil disinkronkan dari Digiflazz`);
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

      const skus = [...new Set(items.filter(i => !i.product_name || i.product_name === i.buyer_sku_code).map(i => i.buyer_sku_code))];
      if (skus.length > 0) {
        const productRows = await master('ppob_products').whereIn('buyer_sku_code', skus).select('buyer_sku_code', 'product_name');
        const nameMap = Object.fromEntries(productRows.map(p => [p.buyer_sku_code, p.product_name]));
        items.forEach(i => {
          if ((!i.product_name || i.product_name === i.buyer_sku_code) && nameMap[i.buyer_sku_code]) {
            i.product_name = nameMap[i.buyer_sku_code];
          }
        });
      }

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
      let order = await PPOBOrderModel.findOrderByRefId(req.db, store_id, ref_id);
      if (!order) {
        return response.notFound(res, 'Order PPOB tidak ditemukan');
      }

      if (!order.product_name || order.product_name === order.buyer_sku_code) {
        const prod = await master('ppob_products').where('buyer_sku_code', order.buyer_sku_code).first();
        if (prod) order.product_name = prod.product_name;
      }

      if (order.status === 'pending') {
        try {
          const digiResult = await Digiflazz.checkTransactionStatus(order.ref_id);
          const digiData = digiResult?.data || digiResult;

          const rc = String(digiData?.rc || '');
          const statusLower = String(digiData?.status || '').toLowerCase();

          let newStatus = order.status;
          if (rc === '00' || statusLower === 'sukses') {
            newStatus = 'success';
          } else if (['06', '07', '08', '09'].includes(rc) || statusLower === 'gagal') {
            newStatus = 'failed';
          }

          if (newStatus !== order.status) {
            const prevStatus = order.status;
            await req.db('ppob_orders')
              .where('ref_id', ref_id)
              .update({
                status: newStatus,
                sn: digiData?.sn || order.sn || '',
                updated_at: new Date(),
              });
            // 🔁 Refund jika gagal (transisi dari pending)
            if (newStatus === 'failed' && prevStatus === 'pending') {
              await refundPpobOrder(req.user.tenant_id, order.id, ref_id);
            }
            console.log(`✅ [AutoCheck] Order ${ref_id} updated: ${prevStatus} → ${newStatus}`);
            order = await PPOBOrderModel.findOrderByRefId(req.db, store_id, ref_id);
          }
        } catch (checkErr) {
          console.warn(`⚠️ [AutoCheck] Gagal poll status ${ref_id}:`, checkErr.message);
        }
      }

      return response.success(res, order, 'Detail order PPOB berhasil diambil');
    } catch (error) {
      console.error('PPOB get order error:', error);
      return response.error(res, error, 'Gagal mengambil detail order PPOB');
    }
  },

  async checkStatus(req, res) {
    try {
      const { store_id, ref_id } = req.params;
      const order = await PPOBOrderModel.findOrderByRefId(req.db, store_id, ref_id);
      if (!order) {
        return response.notFound(res, 'Order PPOB tidak ditemukan');
      }

      if (!order.product_name || order.product_name === order.buyer_sku_code) {
        const prod = await master('ppob_products').where('buyer_sku_code', order.buyer_sku_code).first();
        if (prod) order.product_name = prod.product_name;
      }

      const digiResult = await Digiflazz.checkTransactionStatus(order.ref_id);
      const digiData = digiResult?.data || digiResult;

      const rc = String(digiData?.rc || '');
      const statusLower = String(digiData?.status || '').toLowerCase();

      let newStatus = 'pending';
      if (rc === '00' || statusLower === 'sukses') {
        newStatus = 'success';
      } else if (['06', '07', '08', '09'].includes(rc) || statusLower === 'gagal') {
        newStatus = 'failed';
      }

      const prevStatus = order.status;
      await req.db('ppob_orders')
        .where('ref_id', ref_id)
        .update({
          status: newStatus,
          sn: digiData?.sn || order.sn || '',
          updated_at: new Date(),
        });

      // 🔁 Refund jika gagal (transisi dari pending)
      if (newStatus === 'failed' && prevStatus === 'pending') {
        await refundPpobOrder(req.user.tenant_id, order.id, ref_id);
      }

      const updatedOrder = await PPOBOrderModel.findOrderByRefId(req.db, store_id, ref_id);
      console.log(`🔄 [ManualCheck] Order ${ref_id} result: ${newStatus} (rc=${rc})`);
      return response.success(res, updatedOrder, `Status diperbarui ke: ${newStatus}`);
    } catch (error) {
      console.error('PPOB check-status error:', error);
      return response.error(res, error, 'Gagal memeriksa status ke Digiflazz');
    }
  },
};

module.exports = PPOBController;
