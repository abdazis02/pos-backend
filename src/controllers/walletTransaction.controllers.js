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
  amount: Joi.number().required().min(10000), // 🔥 Minimal topup 10rb, tidak kaku ke 50/100rb
  payment_method: Joi.string().valid('qris', 'manual_bca').default('qris')
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

      let midtrans_transaction_id = null;
      let qris_url = null;
      let payment_method = value.payment_method;

      // HANYA panggil Midtrans jika metode = qris
      if (payment_method === 'qris') {
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
        midtrans_transaction_id = transaction.transaction_id;
        qris_url = getQRISUrl(midtrans_transaction_id);
      } else {
        // Untuk manual_bca, buat ID dummy untuk tracking
        midtrans_transaction_id = 'MANUAL-' + moment().unix() + '-' + Math.floor(Math.random() * 1000);
      }

      const data = {
        owner_id: owner.id,
        midtrans_transaction_id: midtrans_transaction_id,
        amount: value.amount,
        status: 'pending',
        payment_method: payment_method,
        expired_at: moment().add(60, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
      }

      const [id] = await trx("wallet_topups").insert(data);
      const topup = await trx("wallet_topups").where({ id }).first();

      topup.qris_url = qris_url;

      await trx.commit();

      return response.created(res, topup, 'Topup saldo berhasil dibuat, silahkan melakukan pembayaran dalam kurun waktu 60 menit');
    } catch (e) {
      await trx.rollback();

      // Surface penyebab asli (umumnya error dari Midtrans QRIS, mis. batas nominal)
      // agar tidak tertutup "Server error" generik. Detail penuh dicatat ke log.
      const api = e?.ApiResponse || {};
      const detail = (Array.isArray(api.error_messages) && api.error_messages.length)
        ? api.error_messages.join('; ')
        : (api.status_message || e?.message || 'Gagal membuat topup, coba lagi');
      console.error('❌ TOPUP ERROR:', {
        amount: value?.amount,
        method: value?.payment_method,
        httpStatus: e?.httpStatusCode,
        detail,
        api,
      });

      return response.error(res, e, detail);
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
      if (!wallet) { await trx.rollback(); return response.notFound(res, 'Transaction not found!'); }

      // 🔒 Idempoten: jangan proses ulang topup yang sudah sukses (cegah saldo dobel saat retry callback)
      if (wallet.status === 'success') { await trx.rollback(); return res.sendStatus(200); }

      const status = fraud_status == 'accept' ? 'success' : 'failed';
      const isUpdated = await WalletModel.updateWallet(trx, wallet.id, {
        status,
        paid_at: master.fn.now()
      });
      if (!isUpdated) { await trx.rollback(); return response.error(res, null, 'Gagal mengupdate transaksi'); }

      // 💰 Tambah saldo HANYA bila pembayaran benar-benar sukses (bukan saat fraud ditolak)
      if (status === 'success') {
        const owner = await trx("owners as o")
          .forUpdate()
          .where('o.id', wallet.owner_id)
          .first('o.wallet_balance')

        await WalletTransaction.createTransaction(trx, {
          owner_id: wallet.owner_id,
          type: 'topup',
          amount: wallet.amount,
          balance_after: parseFloat(owner.wallet_balance || 0) + parseFloat(wallet.amount || 0),
          reference_type: 'wallet_topups',
          reference_id: wallet.id,
          description: `Topup saldo lewat ${wallet.payment_method}`
        });

        await OwnerModel.addBalance(trx, wallet.owner_id, wallet.amount)
      }

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

  async getBankInfo(req, res) {
    try {
      // Mengambil settingan dari tabel app_settings (yang akan dimasukkan via HeidiSQL)
      const settingsRaw = await master("app_settings").select("setting_key", "setting_value");
      
      const settings = {};
      settingsRaw.forEach(item => {
        settings[item.setting_key] = item.setting_value;
      });

      // Default fallback jika belum di-set di DB
      return response.success(res, {
        bank_name: settings.bank_name || 'BCA',
        bank_account: settings.bank_account || 'Menunggu Info Admin',
        bank_owner: settings.bank_owner || 'PIPos',
        whatsapp_number: settings.whatsapp_number || '+6282218057732'
      });
    } catch (e) {
      // Jika tabel belum ada, kembalikan nilai default agar aplikasi tidak crash
      return response.success(res, {
        bank_name: 'BCA',
        bank_account: 'Menunggu Info Admin',
        bank_owner: 'PIPos',
        whatsapp_number: '+6282218057732'
      });
    }
  }
}

module.exports = WalletTopupController;