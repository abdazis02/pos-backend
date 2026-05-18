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
});

function parseDigiflazzPrice(product) {
  return parseFloat(product?.price || product?.selling_price || product?.nominal || product?.harga || 0);
}

function getDigiflazzWebhookSecret() {
  return process.env.DIGIFLAZZ_WEBHOOK_SECRET || process.env.DIGIFLAZZ_API_KEY;
}

function verifyDigiflazzWebhook(req) {
  const signatureHeader = req.headers['x-hub-signature'];
  if (!signatureHeader) return false;

  const [algo, signature] = signatureHeader.split('=');
  if (!algo || !signature || algo.toLowerCase() !== 'sha1') {
    return false;
  }

  const secret = getDigiflazzWebhookSecret();
  if (!secret) return false;

  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
  const computed = crypto.createHmac('sha1', secret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(computed, 'hex'));
  } catch (error) {
    return false;
  }
}

const listSchema = Joi.object({
  q: Joi.string().trim().allow('', null),
  page: Joi.number().integer().min(1).default(1),
  itemsPerPage: Joi.number().integer().min(1).max(100).default(10),
});

const PPOBController = {
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
      if (!price || price <= 0) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Harga produk PPOB tidak valid');
      }

      if (value.sale_price < price) {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, 'Harga jual lebih kecil dari harga produk PPOB');
      }

      const fee = parseInt(process.env.TRANSACTION_FEE, 10) || 0;
      const margin = value.sale_price - price;
      const totalDeduct = price + fee;

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
      });

      if (String(result?.rc) !== '00' && String(result?.rc) !== '03') {
        await trxMaster.rollback();
        await trxTenant.rollback();
        return response.badRequest(res, result?.message || 'Gagal membuat order PPOB Digiflazz');
      }

      const afterPurchase = beforeBalance - price;
      const afterFee = afterPurchase - fee;

      const orderData = {
        store_id,
        user_id: req.user.id,
        cmd: 'topup',
        buyer_sku_code: value.buyer_sku_code,
        customer_no: value.customer_no,
        ref_id,
        product_name: result?.data?.product_name || null,
        price,
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
        amount: -price,
        balance_after: afterPurchase,
        reference_type: 'ppob_orders',
        reference_id: orderRef,
        description: `Pembelian PPOB ${value.buyer_sku_code} untuk ${value.customer_no}`,
      });

      // 2. Catat fee platform per transaksi PPOB
      if (fee > 0) {
        await WalletTransaction.createTransaction(trxMaster, {
          owner_id: owner.id,
          type: 'transaction_fee',
          amount: -fee,
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
    if (req.headers['x-digiflazz-event'] != 'update') return response.success(res, null, 'Berhasil menerima webhook!');

    try {
      if (!verifyDigiflazzWebhook(req)) {
        return response.forbidden(res, 'Signature webhook Digiflazz tidak valid');
      }

      let payload;
      try {
        payload = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8')) : req.body;
      } catch (err) {
        return response.badRequest(res, 'Payload webhook Digiflazz tidak valid');
      }

      const { ref_id, status, rc } = payload.data || payload;
      if (!ref_id) {
        return response.badRequest(res, 'ref_id wajib dikirim Digiflazz');
      }

      const parsed = parsePpobRefId(ref_id);
      if (!parsed) {
        return response.badRequest(res, 'ref_id Digiflazz tidak valid');
      }

      const tenant = await OwnerModel.getTenantByID(parsed.tenant_id);
      if (!tenant) {
        return response.notFound(res, 'Tenant tidak ditemukan');
      }

      const tenantDb = getTenantConnection(tenant);
      const order = await PPOBOrderModel.findOrderByRefId(tenantDb, parsed.store_id, ref_id);
      if (!order) {
        return response.notFound(res, 'Order PPOB tidak ditemukan');
      }

      let normalizedStatus = 'failed';
      if (String(status).toLowerCase().includes('success') || String(rc) === '00') {
        normalizedStatus = 'success';
      } else if (String(status).toLowerCase().includes('pending')) {
        normalizedStatus = 'pending';
      }

      const trxMaster = await master.transaction();
      try {
        const orderUpdateData = {
          status: normalizedStatus,
          response: JSON.stringify(payload.data || payload),
        };

        if (normalizedStatus === 'failed' && order.status !== 'failed') {
          const owner = await OwnerModel.getByTenantId(parsed.tenant_id);
          if (!owner) {
            await trxMaster.rollback();
            return response.notFound(res, 'Owner tenant tidak ditemukan');
          }

          const beforeBalance = await OwnerModel.getBalanceByTenant(trxMaster, parsed.tenant_id);
          const afterBalance = beforeBalance + order.price;

          await OwnerModel.addBalance(trxMaster, owner.id, order.price);
          await WalletTransaction.createTransaction(trxMaster, {
            owner_id: owner.id,
            type: 'ppob_refund',
            amount: order.price,
            balance_after: afterBalance,
            reference_type: 'ppob_orders',
            reference_id: order.id,
            description: `Refund PPOB ${order.buyer_sku_code} untuk ${order.customer_no}`,
          });
        }

        await PPOBOrderModel.updateOrder(tenantDb, order.id, orderUpdateData);
        await trxMaster.commit();
      } catch (error) {
        await trxMaster.rollback();
        throw error;
      }

      return response.success(res, null, 'Webhook Digiflazz diterima');
    } catch (error) {
      console.error('PPOB Digiflazz webhook error:', error);
      return response.error(res, error, 'Gagal memproses webhook Digiflazz');
    }
  },

  async listProducts(req, res) {
    try {
      const { category } = req.query;
      const products = await PPOBProductModel.getAllProducts({ category: category || undefined });
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