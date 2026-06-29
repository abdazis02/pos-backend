const Joi = require("joi");
const moment = require("moment");
const master = require("../config/knexMaster");
const response = require("../utils/response");
const OwnerModel = require("../models/owner.model");
const WalletModel = require("../models/walletTopup.model");
const WalletTransaction = require("../models/walletTransaction.model");
const { getIO } = require("../socket");
const { pageValidations } = require("../validations/page.validation");
const { expireVA, createInvoice } = require("../utils/xendit");

const topupValidation = Joi.object({
  amount: Joi.number().required().min(10000),
  payment_method: Joi.string().valid('xendit_browser', 'manual_bca').required(),
  phone_number: Joi.string().optional().allow('', null),
});

const listValidations = pageValidations.keys({
  type: Joi.string().valid('', 'topup', 'transaction_fee')
});

const historyValidations = pageValidations.keys({
  status: Joi.string().valid('', 'success', 'pending', 'failed')
});

// Biaya admin topup (menutup potongan Xendit ~Rp4.440 agar tidak rugi).
const TOPUP_ADMIN_FEE = 5000;
const MANUAL_TOPUP_EXPIRY_HOURS = 24;

function normalizeXenditStatus(value) {
  const status = value?.toString().toUpperCase();
  if (['COMPLETED', 'SUCCEEDED', 'SUCCESS', 'PAID'].includes(status)) return 'success';
  if (['FAILED', 'EXPIRED', 'VOIDED', 'CANCELLED', 'CANCELED'].includes(status)) return 'failed';
  return 'pending';
}

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
      const isManualTopup = payment_method === 'manual_bca';
      const admin_fee = isManualTopup ? 0 : TOPUP_ADMIN_FEE;
      const total_amount = Number(value.amount) + admin_fee;

      if (!isManualTopup) {
        const invoice = await createInvoice(
          order_id,
          total_amount,
          owner.email,
          `Topup Saldo Merchant: ${owner.name || owner.business_name || 'PIPos'}`,
          {
            topupAmount: value.amount,
            adminFee: admin_fee,
          }
        );
        xendit_id = invoice.id;
        checkout_url = invoice.invoice_url;
      }

      const data = {
        owner_id: owner.id,
        midtrans_transaction_id: order_id,
        xendit_id: xendit_id,
        va_number: va_number,
        checkout_url: checkout_url,
        qr_string: qr_string,
        amount: value.amount,
        admin_fee: admin_fee,
        total_amount: total_amount,
        status: 'pending',
        payment_method: payment_method,
        expired_at: isManualTopup
          ? moment().add(MANUAL_TOPUP_EXPIRY_HOURS, 'hours').format('YYYY-MM-DD HH:mm:ss')
          : moment().add(60, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
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

  async topupDetail(req, res) {
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

      topup.qris_url = null;
      return response.success(res, topup);
    } catch (e) {
      return response.error(res, e, 'Gagal memuat detail topup');
    }
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
    const status = normalizeXenditStatus(data.status || payload.status);
    const transactionCandidates = [
      data.qr_id,
      data.callback_virtual_account_id,
      data.reference_id,
      payload.reference_id,
      data.external_id,
      data.id,
    ].filter(Boolean);

    if (transactionCandidates.length === 0 || status !== 'success') {
      return res.sendStatus(200);
    }

    const trx = await master.transaction();
    try {
      const wallet = await master('wallet_topups')
        .whereIn('xendit_id', transactionCandidates)
        .orWhereIn('midtrans_transaction_id', transactionCandidates)
        .first();
      
      if (!wallet) {
        await trx.rollback();
        console.warn('Xendit topup webhook tidak menemukan transaksi:', transactionCandidates);
        return res.sendStatus(200);
      }

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

      getIO().to(wallet.xendit_id).emit('payment-success', {
        message: "Pembayaran Lunas!",
        transaction_id: wallet.xendit_id,
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
