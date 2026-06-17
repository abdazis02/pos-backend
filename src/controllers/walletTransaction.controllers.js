const Joi = require("joi");
const moment = require("moment");
const master = require("../config/knexMaster");
const response = require("../utils/response");
const OwnerModel = require("../models/owner.model");
const WalletModel = require("../models/walletTopup.model");
const WalletTransaction = require("../models/walletTransaction.model");
const { getIO } = require("../socket");
const { pageValidations } = require("../validations/page.validation");
const { createQRIS, createVA, createEWalletCharge, expireVA } = require("../utils/xendit");

const topupValidation = Joi.object({
  amount: Joi.number().required().min(10000),
  payment_method: Joi.string().valid('qris', 'va', 'ewallet').required(),
  bank_code: Joi.string().optional().allow('', null),
  channel_code: Joi.string().optional().allow('', null),
  phone_number: Joi.string().optional().allow('', null),
});

const listValidations = pageValidations.keys({
  type: Joi.string().valid('', 'topup', 'transaction_fee')
});

const historyValidations = pageValidations.keys({
  status: Joi.string().valid('', 'success', 'pending', 'failed')
});

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
      const owner = await OwnerModel.getByTenantId(req.user.tenant_id);

      let xendit_id = null;
      let qris_url = null;
      let qr_string = null;
      let va_number = null;
      let checkout_url = null;
      const payment_method = value.payment_method;
      const order_id = 'TOPUP-' + moment().unix() + '-' + owner.id;

      if (payment_method === 'qris') {
        const qrResponse = await createQRIS(order_id, value.amount);
        xendit_id = qrResponse.id;
        qr_string = qrResponse.qr_string;
      } else if (payment_method === 'va') {
        if (!value.bank_code) throw new Error("bank_code wajib diisi untuk VA (misal: BCA, MANDIRI)");
        const expirationDate = moment().add(60, 'minutes').toISOString();
        const vaResponse = await createVA(order_id, value.amount, value.bank_code, owner.name || 'Merchant PIPos', expirationDate);
        xendit_id = vaResponse.id;
        va_number = vaResponse.account_number;
      } else if (payment_method === 'ewallet') {
        if (!value.channel_code) throw new Error("channel_code wajib diisi untuk E-Money (misal: OVO, DANA)");
        const ewResponse = await createEWalletCharge(order_id, value.amount, value.channel_code, value.phone_number);
        xendit_id = ewResponse.reference_id; 
        checkout_url = ewResponse.actions?.mobile_deeplink_checkout_url || null;
      }

      const data = {
        owner_id: owner.id,
        midtrans_transaction_id: null,
        xendit_id: xendit_id,
        va_number: va_number,
        checkout_url: checkout_url,
        qr_string: qr_string,
        amount: value.amount,
        status: 'pending',
        payment_method: payment_method,
        expired_at: moment().add(60, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
      }

      const [id] = await trx("wallet_topups").insert(data);
      const topup = await trx("wallet_topups").where({ id }).first();

      topup.qris_url = qris_url;

      await trx.commit();

      return response.created(res, topup, 'Topup saldo berhasil dibuat');
    } catch (e) {
      await trx.rollback();
      console.error('❌ TOPUP ERROR:', e?.response?.data || e.message);
      const detail = e?.response?.data?.message || e.message || 'Gagal membuat topup, coba lagi';
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
      item.qris_url = null;
      return item;
    })

    return response.success(res, {
      items,
      total: total.cnt,
      filtered: filtered.cnt,
    });
  },

  async cancelTopup(req, res) {
    try {
      const { id } = req.params;
      const owner = await OwnerModel.getByTenantId(req.user.tenant_id);

      const topup = await WalletModel.findWalletTopupById(id);

      if (!topup) {
        return response.notFound(res, 'Topup tidak ditemukan');
      }

      if (topup.owner_id !== owner.id) {
        return response.forbidden(res, 'Akses ditolak');
      }

      if (topup.status !== 'pending') {
        return response.badRequest(res, `Topup tidak bisa dibatalkan karena status sudah ${topup.status}`);
      }

      // 🔥 BATALKAN DI XENDIT (Jika VA)
      if (topup.payment_method === 'va' && topup.xendit_id) {
        try {
          await expireVA(topup.xendit_id);
          console.log(`✅ VA ${topup.xendit_id} berhasil di-expire di Xendit`);
        } catch (xe) {
          console.error('⚠️ Gagal expire VA di Xendit:', xe?.response?.data || xe.message);
          // Tetap lanjut batalkan di lokal meski Xendit gagal (misal VA sudah kadaluarsa)
        }
      }

      await master("wallet_topups").where({ id }).update({
        status: 'failed',
      });

      return response.success(res, null, 'Topup berhasil dibatalkan');
    } catch (e) {
      console.error('❌ CANCEL TOPUP ERROR:', e);
      return response.error(res, e, 'Gagal membatalkan topup');
    }
  },

  async xenditWebhook(req, res) {
    // Xendit Webhook Token Verification
    if (!process.env.XENDIT_WEBHOOK_TOKEN) {
      console.error('XENDIT_WEBHOOK_TOKEN belum dikonfigurasi');
      return response.error(res, null, 'Webhook token belum dikonfigurasi');
    }

    const xenditToken = req.headers['x-callback-token'];
    if (xenditToken !== process.env.XENDIT_WEBHOOK_TOKEN) {
      return response.badRequest(res, 'Invalid callback token');
    }

    const payload = req.body || {};
    const data = payload.data || payload;
    let status = 'failed';
    let transaction_id = null;
    
    // Deteksi tipe webhook Xendit untuk QRIS, VA, dan E-Money.
    if (payload.event === 'qr.payment' || data.qr_id) {
      // QRIS
      transaction_id = data.qr_id; // qr_id disimpan sebagai xendit_id.
      if (['COMPLETED', 'SUCCEEDED', 'SUCCESS'].includes(data.status)) status = 'success';
    } else if (data.callback_virtual_account_id || data.bank_code) {
      // Virtual Account
      transaction_id = data.callback_virtual_account_id || data.id; 
      status = ['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'PAID'].includes(data.status)
        ? 'success'
        : (data.status ? 'failed' : 'success');
    } else if (data.reference_id || data.channel_category) {
      // E-Money
      transaction_id = data.reference_id;
      if (['SUCCEEDED', 'COMPLETED', 'SUCCESS'].includes(data.status)) status = 'success';
    } else {
      // Tipe webhook lain yang tidak dikenali
      return res.sendStatus(200);
    }

    if (status !== 'success') {
      return res.sendStatus(200);
    }

    const trx = await master.transaction();
    try {
      // Cari transaksi berdasarkan xendit_id (di tabel xendit_id menyimpan qr_id, va_id, atau reference_id)
      const wallet = await master('wallet_topups').where('xendit_id', transaction_id).first();
      
      if (!wallet) { await trx.rollback(); return response.notFound(res, 'Transaction not found!'); }

      // 🔒 Idempoten: jangan proses ulang topup yang sudah sukses
      if (wallet.status === 'success') { await trx.rollback(); return res.sendStatus(200); }

      const isUpdated = await WalletModel.updateWallet(trx, wallet.id, {
        status,
        paid_at: master.fn.now()
      });
      if (!isUpdated) { await trx.rollback(); return response.error(res, null, 'Gagal mengupdate transaksi'); }

      // 💰 Tambah saldo HANYA bila pembayaran benar-benar sukses
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
          description: `Topup saldo lewat ${wallet.payment_method} (Xendit)`
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
      const settingsRaw = await master("app_settings").select("setting_key", "setting_value");
      
      const settings = {};
      settingsRaw.forEach(item => {
        settings[item.setting_key] = item.setting_value;
      });

      return response.success(res, {
        bank_name: settings.bank_name || 'BCA',
        bank_account: settings.bank_account || 'Menunggu Info Admin',
        bank_owner: settings.bank_owner || 'PIPos',
        whatsapp_number: settings.whatsapp_number || '+6282218057732'
      });
    } catch (e) {
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
