const Joi = require("joi");
const moment = require("moment");
const master = require("../config/knexMaster");
const response = require("../utils/response");
const OwnerModel = require("../models/owner.model");
const WalletModel = require("../models/walletTopup.model");
const WalletTransaction = require("../models/walletTransaction.model");
const { getIO } = require("../socket");
const { pageValidations } = require("../validations/page.validation");
const { coreApi, getQRISUrl } = require("../utils/midtrans");

const topupValidation = Joi.object({
  amount: Joi.number().required().min(10000) // 🔥 Minimal topup 10rb, tidak kaku ke 50/100rb
})
const listValidations = pageValidations.keys({
  type: Joi.string().valid('', 'topup', 'transaction_fee')
})
const historyValidations = pageValidations.keys({
  status: Joi.string().valid('', 'success', 'pending', 'failed')
})

const WalletTopupController = {
  async list(req, res) {
    const { value, error } = listValidations.validate(req.query)
    if (error) {
      return response.badRequest()
    }

    const owner = await OwnerModel.getByTenantId(req.user.tenant_id);

    const offset = (value.page - 1) * value.itemsPerPage;
    const query = WalletTransaction.paginateWalletTransactions(owner.id, offset, value.itemsPerPage, { ...value, search: value.q });
    const [items, total, filtered] = await Promise.all(query);

    return response.success(res, {
      items: items,
      total: total.cnt,
      filtered: filtered.cnt,
    });
  },

  async topup(req, res) {
    const { value, error } = topupValidation.validate(req.body, { stripUnknown: true });
    if (error) {
      return response.badRequest(res, error.message, error.details);
    }

    const trx = await master.transaction();
    try {
      const owner = await OwnerModel.getByTenantId(req.user.tenant_id)

      coreApi.httpClient.http_client.defaults.headers.common['X-Override-Notification'] = `${process.env.URL}/api/wallet/webhook/midtrans`;
      const transaction = await coreApi.charge({
        payment_type: 'qris',
        transaction_details: {
          order_id: 'TOPUP-' + moment().unix(),
          gross_amount: value.amount
        },
        custom_expiry: {
          expiry_duration: 60,
          unit: "minute"
        }
      });

      const data = {
        owner_id: owner.id,
        midtrans_transaction_id: transaction.transaction_id,
        amount: value.amount,
        status: 'pending',
        payment_method: 'qris',
        expired_at: moment().add(60, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
      }

      const [id] = await trx("wallet_topups").insert(data);
      const topup = await trx("wallet_topups").where({ id }).first();

      topup.qris_url = getQRISUrl(topup.midtrans_transaction_id)

      await trx.commit();

      return response.created(res, topup, 'Topup saldo berhasil dibuat, silahkan melakukan pembayaran dalam kurun waktu 60 menit');
    } catch (e) {
      await trx.rollback();

      return response.error(res, e, 'Server error');
    }
  },

  async topupHistory(req, res) {
    const { value, error } = historyValidations.validate(req.query)
    if (error) {
      return response.badRequest(res, error.message, error.details)
    }

    const owner = await OwnerModel.getByTenantId(req.user.tenant_id)
    const offset = (value.page - 1) * value.itemsPerPage
    const [data, total, filtered] = await Promise.all(
      WalletModel.paginateWalletTopup(
        owner.id,
        offset, value.itemsPerPage,
        {
          ...value,
          search: value.q,
        }
      )
    )

    const items = data.map(item => {
      if (item.status == 'pending')
        item.qris_url = getQRISUrl(item.midtrans_transaction_id);
      return item;
    })

    return response.success(res, {
      items,
      total: total.cnt,
      filtered: filtered.cnt,
    });
  },

  async midtransWebhook(req, res) {
    if (req.body.status_code < 200 || req.body.status_code >= 300) {
      return res.sendStatus(200)
    }

    const { order_id, status_code, gross_amount, transaction_id, transaction_status, fraud_status, signature_key } = req.body;
    const payload = order_id + status_code + gross_amount + process.env.MIDTRANS_SERVER_KEY;

    const hash = require('crypto')
      .createHash("sha512")
      .update(payload)
      .digest("hex");

    if (hash != signature_key) {
      return response.badRequest(res, 'Invalid signature key')
    }

    if (transaction_status != 'settlement') {
      return res.sendStatus(200)
    }

    const trx = await master.transaction()
    try {
      const wallet = await WalletModel.findWalletTopupByMidtransId(transaction_id);
      if (!wallet) return response.notFound(res, 'Transaction not found!');

      const status = fraud_status == 'accept' ? 'success' : 'failed';
      const isUpdated = await WalletModel.updateWallet(trx, wallet.id, {
        status,
        paid_at: master.fn.now()
      });
      if (!isUpdated) return response.error(res, null, 'Gagal mengupdate transaksi');

      const owner = await trx("owners as o")
        .forUpdate()
        .where('o.id', wallet.owner_id)
        .first('o.wallet_balance')

      const data = {
        owner_id: wallet.owner_id,
        type: 'topup',
        amount: wallet.amount,
        balance_after: owner.wallet_balance + wallet.amount,
        reference_type: 'wallet_topups',
        reference_id: wallet.id,
        description: `Topup saldo lewat ${wallet.payment_method}`
      };

      await WalletTransaction.createTransaction(trx, data);
      await OwnerModel.addBalance(trx, wallet.owner_id, wallet.amount)

      getIO().to(transaction_id).emit('payment-success', {
        message: "Pembayaran Lunas!",
        transaction_id: transaction_id,
        status: status
      });

      await trx.commit();

      return response.success(res, null, 'Transaksi berhasil diupdate');
    } catch (error) {
      await trx.rollback();

      console.error('Update transaction error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengupdate transaksi');
    }
  },
}

module.exports = WalletTopupController;