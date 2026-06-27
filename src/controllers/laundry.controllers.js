const Joi = require('joi');
const moment = require('moment');
const master = require('../config/knexMaster');
const response = require('../utils/response');
const LaundryOrderModel = require('../models/laundryOrder.model');
const OwnerModel = require('../models/owner.model');
const WalletTransaction = require('../models/walletTransaction.model');
const { pageValidations } = require('../validations/page.validation');
const TransactionModel = require('../models/transaction.model');

const itemSchema = Joi.object({
  product_id: Joi.number().integer().allow(null),
  name: Joi.string().required().trim().max(255),
  unit: Joi.string().valid('pcs', 'kg').default('pcs'),
  qty: Joi.number().greater(0).required(),
  price: Joi.number().min(0).required(),
});

const createSchema = Joi.object({
  customer_name: Joi.string().required().trim().max(255),
  customer_phone: Joi.string().allow('', null).max(30),
  items: Joi.array().items(itemSchema).min(1).required(),
  estimated_done_at: Joi.date().iso().allow(null, ''),
  notes: Joi.string().allow('', null),
  pay_now: Joi.boolean().default(false),
});

const statusSchema = Joi.object({
  status: Joi.string().valid('diterima', 'dikerjakan', 'selesai', 'diambil', 'batal').required(),
});

const listValidations = pageValidations.keys({
  status: Joi.string().valid('', 'diterima', 'dikerjakan', 'selesai', 'diambil', 'batal'),
  payment_status: Joi.string().valid('', 'unpaid', 'paid'),
});

// Potong biaya PiPos (TRANSACTION_FEE) dari saldo owner saat pesanan LUNAS.
// Konsisten dengan POS: bila saldo tidak cukup, pembayaran ditolak.
async function chargeLaundryFee(tenant_id, orderId) {
  const fee = parseInt(process.env.TRANSACTION_FEE, 10) || 0;
  if (fee <= 0) return { ok: true, fee: 0 };

  const owner = await OwnerModel.getByTenantId(tenant_id);
  if (!owner) return { ok: true, fee: 0 };

  const trxMaster = await master.transaction();
  try {
    const before = parseFloat((await OwnerModel.getBalanceByTenant(trxMaster, tenant_id)) || 0);
    const after = before - fee;
    if (after < 0) {
      await trxMaster.rollback();
      return { ok: false, reason: 'insufficient' };
    }
    await WalletTransaction.createTransaction(trxMaster, {
      owner_id: owner.id,
      type: 'transaction_fee',
      amount: -fee,
      balance_after: after,
      reference_type: 'transactions',
      reference_id: orderId,
      description: `Biaya transaksi pesanan laundry #${orderId}`,
    });
    await OwnerModel.subtractBalance(trxMaster, owner.id, fee);
    await trxMaster.commit();
    return { ok: true, fee };
  } catch (e) {
    await trxMaster.rollback();
    throw e;
  }
}

const LaundryController = {
  // GET /:store_id/laundry/orders
  async list(req, res) {
    try {
      const { store_id } = req.params;
      const { value, error } = listValidations.validate(req.query);
      if (error) return response.badRequest(res, error.details[0].message, error.details);

      const offset = (value.page - 1) * value.itemsPerPage;
      const [query, total] = LaundryOrderModel.paginate(req.db, store_id, offset, value.itemsPerPage, {
        status: value.status,
        payment_status: value.payment_status,
        search: value.q,
      });
      const [items, totalRow] = await Promise.all([query, total]);
      return response.success(res, { items, total: totalRow.cnt }, 'Daftar pesanan laundry');
    } catch (e) {
      console.error('❌ ERROR LIST LAUNDRY:', e);
      return response.error(res, e, 'Gagal memuat pesanan');
    }
  },

  // GET /:store_id/laundry/orders/:id
  async getById(req, res) {
    try {
      const { store_id, id } = req.params;
      const order = await LaundryOrderModel.getById(req.db, store_id, id);
      if (!order) return response.notFound(res, 'Pesanan tidak ditemukan');
      order.items = await LaundryOrderModel.getItems(req.db, id);
      return response.success(res, order, 'Detail pesanan');
    } catch (e) {
      console.error('❌ ERROR GET LAUNDRY:', e);
      return response.error(res, e, 'Gagal memuat detail pesanan');
    }
  },

  // POST /:store_id/laundry/orders
  async create(req, res) {
    try {
      const { store_id } = req.params;
      const { tenant_id, id: userId } = req.user;
      const { value, error } = createSchema.validate(req.body, { stripUnknown: true });
      if (error) return response.badRequest(res, error.details[0].message, error.details);

      const items = value.items.map((it) => {
        const subtotal = Number(it.qty) * Number(it.price);
        return {
          product_id: it.product_id || null,
          name: it.name,
          unit: it.unit || 'pcs',
          qty: it.qty,
          price: it.price,
          subtotal,
        };
      });
      const total = items.reduce((s, it) => s + Number(it.subtotal), 0);

      const order = {
        store_id: parseInt(store_id),
        customer_name: value.customer_name,
        customer_phone: value.customer_phone || null,
        total,
        paid_amount: value.pay_now ? total : 0,
        payment_status: value.pay_now ? 'paid' : 'unpaid',
        status: 'diterima',
        estimated_done_at: value.estimated_done_at ? moment(value.estimated_done_at).format('YYYY-MM-DD HH:mm:ss') : null,
        received_at: req.db.fn.now(),
        notes: value.notes || null,
        created_by: userId || null,
      };

      const orderId = await LaundryOrderModel.create(req.db, order, items);

      // Lunas di muka → potong fee sekarang.
      if (value.pay_now) {
        const feeRes = await chargeLaundryFee(tenant_id, orderId);
        if (!feeRes.ok) {
          // Batalkan status lunas bila saldo mitra tidak cukup untuk fee.
          await LaundryOrderModel.update(req.db, store_id, orderId, {
            payment_status: 'unpaid',
            paid_amount: 0,
          });
          const created = await LaundryOrderModel.getById(req.db, store_id, orderId);
          created.items = await LaundryOrderModel.getItems(req.db, orderId);
          return response.success(res, created,
            'Pesanan dibuat, tapi saldo mitra tidak cukup untuk biaya transaksi — status dibuat BELUM LUNAS. Top up saldo lalu lunasi.');
        } else {
          // 🔥 CATAT KE LAPORAN (HEADER ONLY) - Aman dari isu qty desimal
          await TransactionModel.create(req.db, {
            store_id: parseInt(store_id),
            user_id: userId,
            total_cost: total,
            payment_method: 'cash',
            received_amount: total,
            change_amount: 0,
            payment_status: 'paid',
            subtotal: total,
            discount_total: 0,
            tax: 0,
            notes: `Laundry Order: LDY-${String(orderId).padStart(5, '0')}`,
          });
        }
      }

      const created = await LaundryOrderModel.getById(req.db, store_id, orderId);
      created.items = await LaundryOrderModel.getItems(req.db, orderId);
      return response.created(res, created, 'Pesanan laundry dibuat');
    } catch (e) {
      console.error('❌ ERROR CREATE LAUNDRY:', e);
      return response.error(res, e, 'Gagal membuat pesanan');
    }
  },

  // PUT /:store_id/laundry/orders/:id/status
  async updateStatus(req, res) {
    try {
      const { store_id, id } = req.params;
      const { value, error } = statusSchema.validate(req.body);
      if (error) return response.badRequest(res, error.details[0].message, error.details);

      const order = await LaundryOrderModel.getById(req.db, store_id, id);
      if (!order) return response.notFound(res, 'Pesanan tidak ditemukan');

      // 'diambil' wajib sudah lunas.
      if (value.status === 'diambil' && order.payment_status !== 'paid') {
        return response.badRequest(res, 'Lunasi pembayaran dulu sebelum menandai pesanan diambil');
      }

      const data = { status: value.status };
      if (value.status === 'selesai' && !order.done_at) data.done_at = req.db.fn.now();
      if (value.status === 'diambil') data.picked_up_at = req.db.fn.now();

      await LaundryOrderModel.update(req.db, store_id, id, data);
      const updated = await LaundryOrderModel.getById(req.db, store_id, id);
      updated.items = await LaundryOrderModel.getItems(req.db, id);
      return response.success(res, updated, 'Status pesanan diperbarui');
    } catch (e) {
      console.error('❌ ERROR STATUS LAUNDRY:', e);
      return response.error(res, e, 'Gagal memperbarui status');
    }
  },

  // PUT /:store_id/laundry/orders/:id/pay  → lunasi (potong fee)
  async pay(req, res) {
    try {
      const { store_id, id } = req.params;
      const { tenant_id } = req.user;

      const order = await LaundryOrderModel.getById(req.db, store_id, id);
      if (!order) return response.notFound(res, 'Pesanan tidak ditemukan');
      if (order.status === 'batal') return response.badRequest(res, 'Pesanan sudah dibatalkan');
      if (order.payment_status === 'paid') return response.badRequest(res, 'Pesanan sudah lunas');

      // Tandai lunas secara bersyarat (cegah dobel-bayar).
      const affected = await LaundryOrderModel.updateWhere(
        req.db, store_id, id, { payment_status: 'unpaid' },
        { payment_status: 'paid', paid_amount: order.total }
      );
      if (!affected) return response.badRequest(res, 'Pesanan sudah diproses sebelumnya');

      const feeRes = await chargeLaundryFee(tenant_id, id);
      if (!feeRes.ok) {
        // Rollback status lunas bila saldo tidak cukup.
        await LaundryOrderModel.update(req.db, store_id, id, { payment_status: 'unpaid', paid_amount: 0 });
        return response.badRequest(res, 'Saldo mitra tidak cukup untuk biaya transaksi. Top up saldo dulu.');
      }

      // 🔥 CATAT KE LAPORAN (HEADER ONLY) - Aman dari isu qty desimal
      await TransactionModel.create(req.db, {
        store_id: parseInt(store_id),
        user_id: req.user.id,
        total_cost: order.total,
        payment_method: 'cash',
        received_amount: order.total,
        change_amount: 0,
        payment_status: 'paid',
        subtotal: order.total,
        discount_total: 0,
        tax: 0,
        notes: `Laundry Order: ${order.order_no || `LDY-${String(id).padStart(5, '0')}`}`,
      });

      const updated = await LaundryOrderModel.getById(req.db, store_id, id);
      updated.items = await LaundryOrderModel.getItems(req.db, id);
      return response.success(res, updated, 'Pembayaran berhasil dilunasi');
    } catch (e) {
      console.error('❌ ERROR PAY LAUNDRY:', e);
      return response.error(res, e, 'Gagal melunasi pembayaran');
    }
  },
};

module.exports = LaundryController;
