const Joi = require('joi');
const moment = require('moment');
const master = require('../config/knexMaster');
const response = require('../utils/response');
const StoreModel = require('../models/store.model');
const OwnerModel = require('../models/owner.model');
const ProductModel = require('../models/product.model');
const TransactionModel = require('../models/transaction.model');
const ActivityLogModel = require('../models/activityLog.model');
const WalletTransaction = require('../models/walletTransaction.model');
const { transactionValidations, refundValidations } = require('../validations/transaction.validation');
const { getIO } = require('../socket');
const { getTenantApi } = require('../utils/midtrans');
const { pageValidations } = require('../validations/page.validation');
const { getTenantConnection } = require('../config/knexTenant');
const { calculateBundlePrice } = require('../utils/pricing');

function mapTransactionToFrontend(tx, owner_id, items = []) {
  const seg1 = owner_id.toString().padStart(2, '0')
  const seg2 = tx.store_id.toString().padStart(2, '0')
  const seg3 = tx.id.toString().padStart(4, '0')

  return {
    transaction_id: tx.id,
    idFull: tx.idFull || `TX${seg1}${seg2}${seg3}`,
    cashier: tx.cashier || '-',
    table_id: tx.table_id,
    table_number: tx.table_number,
    total_cost: tx.total_cost,
    payment_method: tx.payment_method,
    received_amount: tx.received_amount,
    change_amount: tx.change_amount,
    payment_status: tx.payment_status,
    subtotal: tx.subtotal,
    discount_total: tx.discount_total,
    tax: tx.tax,
    tax_percentage: tx.tax_percentage,
    notes: tx.notes,
    // 🔥 STANDARISASI WIT (+09:00):
    // Menggunakan .utcOffset(9) dari moment agar jam konsisten di Ternate.
    created_at: moment.utc(tx.created_at).utcOffset(9).format('YYYY-MM-DD HH:mm:ss'),
    items: items.map(item => ({
      productId: item.product_id,
      name: item.product_name,
      sku: item.sku,
      price: item.price,
      quantity: item.quantity,
      lineTotal: item.subtotal,
      discount_type: item.discount_type,
      discount_value: item.discount_value,
      discount_amount: item.discount_amount
    }))
  };
}

const validation = pageValidations.keys({
  payment_status: Joi.string().valid('pending', 'paid', 'canceled', 'refunded').allow(null, ''),
  start_date: Joi.date().iso().allow(null, ''),
  end_date: Joi.date().iso().min(Joi.ref('start_date')).allow(null, '')
})

const TransactionController = {
  async list(req, res) {
    try {
      const { store_id } = req.params;
      const { value, error } = validation.validate(req.query);
      if (error) {
        return response.badRequest(res, error.message, error.details)
      }

      const offset = (value.page - 1) * value.itemsPerPage;
      const filters = { ...value, search: value.q };
      const [transactions, total, filtered] = await Promise.all(
        TransactionModel.paginateTransactions(req.db, store_id, offset, value.itemsPerPage, filters)
      );

      const tx_ids = transactions.map(tx => tx.id);
      const items = await TransactionModel.getItemsByTransactionIds(req.db, tx_ids);

      const mapped = transactions.map(tx => mapTransactionToFrontend(tx, req.user.tenant_id, items[tx.id]));

      return response.success(res, {
        items: mapped,
        total: total.cnt,
        filtered: filtered.cnt
      });
    } catch (error) {
      console.error('Get all transactions error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengambil data transaksi');
    }
  },

  // Membuat transaksi baru
  async create(req, res) {
    const trxMaster = await master.transaction();
    const trxTenant = await req.db.transaction();
    try {
      const { store_id } = req.params;
      const { tenant_id, id: userId } = req.user;

      const fee = parseInt(process.env.TRANSACTION_FEE, 10)
      const before = await OwnerModel.getBalanceByTenant(trxMaster, tenant_id);
      const after = before - fee;
      if (after < 0) {
        await trxMaster.rollback();
        await trxTenant.rollback();

        return response.badRequest(
          res,
          "Maaf saldo anda tidak cukup untuk melakukan transaksi, silahkan topup terlebih dahulu"
        );
      }

      const { value, error } = transactionValidations.validate(req.body);
      if (error) {
        await trxMaster.rollback();
        await trxTenant.rollback();

        return response.badRequest(res, error.message, error.details);
      }

      const { payment_method, received_amount, notes, items, created_at, table_id } = value;

      // Verifikasi item transaksi
      let grossSubtotal = 0;    // total harga sebelum diskon
      let discountTotal = 0;    // total diskon

      const processedItems = [];
      const product_ids = items.map(i => i.product_id)

      const products = await ProductModel.getAllProductsByIds(req.db, store_id, product_ids)
      const mappedProducts = Object.fromEntries(products.map((p) => [p.id, p]));

      for (const item of items) {
        const product = mappedProducts[item.product_id]
        if (!product) {
          await trxMaster.rollback();
          await trxTenant.rollback();

          return response.notFound(res, `Product with ID ${item.product_id} not found`);
        }

        // Memeriksa stok produk
        if (!product.without_stock && product.stock < item.qty) {
          await trxMaster.rollback();
          await trxTenant.rollback();

          return response.badRequest(res, `Insufficient stock for ${product.name}. Available: ${product.stock}`);
        }

        // Harga produk dari database
        const itemGross = parseFloat(product.price) * parseInt(item.qty, 10);
        let discountAmount = 0;
        let netSubtotal = itemGross;

        // === LOGIKA DISKON ===
        // Percentage
        if (product.discount_type === 'percentage' && product.discount_value > 0) {
          discountAmount = itemGross * (product.discount_value / 100);
          netSubtotal = itemGross - discountAmount;
        }
        // Nominal
        else if (product.discount_type === 'nominal' && product.discount_value > 0) {
          discountAmount = Math.min(product.discount_value, itemGross);
          netSubtotal = itemGross - discountAmount;
        }
        // Buy X Get Y
        else if (product.discount_type === 'buyxgety' && product.buy_qty > 0 && product.free_qty > 0) {
          const x = product.buy_qty;
          const y = product.free_qty;
          const totalQty = item.qty;
          const groupQty = x + y;
          const paidQty = Math.floor(totalQty / groupQty) * x + (totalQty % groupQty);
          discountAmount = (totalQty - paidQty) * product.price;
          netSubtotal = paidQty * product.price;
        }
        // === BUNDLE DISCOUNT ===
        else if (
          product.discount_type === 'bundle' &&
          product.discount_bundle_min_qty > 0 &&
          product.discount_bundle_value > 0
        ) {
          // Ambil data bundle dari product jika ada, jika tidak dari produk
          const bundleQty = product.discount_bundle_min_qty;
          const bundleValue = product.discount_bundle_value;
          const bundleTotal = calculateBundlePrice(item.qty, product.price, bundleQty, bundleValue);
          discountAmount = itemGross - bundleTotal;
          netSubtotal = bundleTotal;
        }

        // Safety
        if (discountAmount > itemGross) discountAmount = itemGross;

        // Hitung Komisi (Jika ada handled_by)
        let commissionAmount = 0;
        if (item.handled_by) {
          const handler = await master("users").where("id", item.handled_by).first('commission_rate');
          const rate = parseFloat(handler?.commission_rate || 0);
          commissionAmount = netSubtotal * (rate / 100);
        }

        processedItems.push({
          product_id: product.id,
          // Info dari tabel produk
          product_name: product.name,
          sku: product.sku,
          price: product.price,
          cost_price: product.cost_price,
          discount_type: product.discount_type,
          discount_value: product.discount_value,
          discount_bundle_min_qty: product.discount_bundle_min_qty,
          discount_bundle_value: product.discount_bundle_value,
          buy_qty: product.buy_qty,
          free_qty: product.free_qty,
          // Penjumlahan
          qty: item.qty,
          discount_amount: discountAmount,
          subtotal: netSubtotal,
          notes: item.notes,
          handled_by: item.handled_by, // 🔥
          commission_amount: commissionAmount, // 🔥
        });

        grossSubtotal += itemGross;
        discountTotal += discountAmount;
      }

      // Menghitung total transaksi
      const store = await StoreModel.findStoreById(req.db, store_id);
      const taxPercentage = Number(store?.tax_percentage || 0);

      const netSubtotal = grossSubtotal - discountTotal;
      const tax = netSubtotal * (taxPercentage / 100);
      const grandTotal = netSubtotal + tax;

      // Memeriksa pembayaran
      if (received_amount < grandTotal) {
        await trxMaster.rollback();
        await trxTenant.rollback();

        return response.badRequest(res, 'Insufficient payment amount');
      }

      const changeAmountFinal = received_amount - grandTotal;

      // Membuat objek transaksi
      const transaction = {
        store_id,
        user_id: userId,
        table_id, // 🔥
        total_cost: grandTotal,
        payment_method,
        received_amount: payment_method != 'qris' ? received_amount : 0,
        change_amount: payment_method != 'qris' ? changeAmountFinal : 0,
        payment_status: payment_method != 'qris' ? 'paid' : 'pending',
        subtotal: netSubtotal,
        discount_total: discountTotal,
        tax,
      };

      // 🔥 TAMBAHKAN KODE INI AGAR WAKTU OFFLINE TERSIMPAN:
      if (created_at) {
        transaction.created_at = created_at;
      }

      // Simpan transaksi dan item dalam transaksi
      const transaction_id = await TransactionModel.create(trxTenant, transaction);
      await TransactionModel.addItems(trxTenant, transaction_id, processedItems);

      // Update stok produk
      for (const item of processedItems) {
        if (mappedProducts[item.product_id].without_stock) {
          continue
        }

        const updated = await ProductModel.subProductStock(trxTenant, store_id, item.product_id, item.qty);
        if (!updated) {
          await trxMaster.rollback();
          await trxTenant.rollback();

          return response.badRequest(res, 'Insufficient stock');
        }
      }

      const txRow = await TransactionModel.findTransactionById(trxTenant, store_id, transaction_id);
      const mapped = mapTransactionToFrontend(txRow, req.user.tenant_id, processedItems);

      if (payment_method == 'qris') {
        if (!store.midtrans_server_key || !store.midtrans_client_key) {
          await trxMaster.rollback();
          await trxTenant.rollback();

          return response.badRequest(res, 'Qris midtrans key belum disetting, silahkan lengkapi terlebih dahulu!');
        }

        const api = getTenantApi(store)
        api.httpClient.http_client.defaults.headers.common['X-Override-Notification'] = `${process.env.URL}/api/stores/${tenant_id}/transaction-callback/${store_id}`;

        const transaction = await api.charge({
          payment_type: "gopay",
          transaction_details: {
            order_id: `TX-T${tenant_id}-S${store_id}-${transaction_id}`,
            gross_amount: grandTotal
          }
        })

        const qrisData = transaction.actions.find(action => action.name === 'generate-qr-code-v2');

        if (qrisData)
          mapped.qris_url = qrisData.url
      } else {
        // Pengurangan saldo/wallet di owner
        const owner = await OwnerModel.getByTenantId(tenant_id);
        await WalletTransaction.createTransaction(trxMaster, {
          owner_id: owner.id,
          type: 'transaction_fee',
          amount: -fee,
          balance_after: after,
          reference_type: 'transactions',
          reference_id: transaction_id,
          description: `Transaksi fee pada id ${transaction_id?.toString().padStart(6, '0')}`
        });

        await OwnerModel.subtractBalance(trxMaster, owner.id, fee);
      }

      mapped.balance = await OwnerModel.getBalanceByTenant(trxMaster, tenant_id);

      // Logging aktivitas: transaksi baru
      await ActivityLogModel.create(trxTenant, {
        user_id: userId,
        store_id: store_id,
        action: 'transaction',
        detail: `Transaksi baru, total: Rp${grandTotal}`
      });

      await trxTenant.commit();
      await trxMaster.commit();

      return response.created(res, mapped, 'Transaction created successfully');
    } catch (error) {
      await trxTenant.rollback();
      await trxMaster.rollback();

      console.error('Error creating transaction:', error);
      return response.error(res, error, 'Error creating transaction');
    }
  },

  // Mendapatkan transaksi berdasarkan ID
  async detail(req, res) {
    try {
      const { store_id, id } = req.params;

      const tx = await TransactionModel.findTransactionById(req.db, store_id, id);
      if (!tx) return response.notFound(res, 'Transaction not found');

      const items = await TransactionModel.getItemsByTransactionIds(req.db, [id]);
      const mapped = mapTransactionToFrontend(tx, req.user.tenant_id, items[id]);

      return response.success(res, mapped, 'Transaction found');
    } catch (error) {
      return response.error(res, error, 'Error getting transaction');
    }
  },

  // Update transaksi (hanya metadata, bukan nilai)
  async update(req, res) {
    try {
      const { store_id, id } = req.params;
      const { payment_method, payment_status } = req.body;

      const isUpdated = await TransactionModel.updateTransaction(req.db, store_id, id, {
        payment_method,
        payment_status
      });
      if (!isUpdated) return response.error(res, null, 'Gagal mengupdate transaksi');

      const updatedTransaction = await TransactionModel.findTransactionById(req.db, store_id, id);

      return response.success(res, updatedTransaction, 'Transaksi berhasil diupdate');
    } catch (error) {
      console.error('Update transaction error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengupdate transaksi', 500);
    }
  },

  async updateStatus(req, res) {
    if (req.body.status_code < 200 || req.body.status_code >= 300) {
      return res.status(200)
    }

    const { tenant_id, store_id } = req.params;
    
    // Fetch store first to get its midtrans server key
    const store = await StoreModel.findStoreById(master, store_id);
    if (!store || !store.midtrans_server_key) {
      return response.badRequest(res, 'Store Midtrans Server Key not configured');
    }

    const { order_id, status_code, gross_amount, transaction_status, fraud_status, signature_key } = req.body;
    
    // 🔥 PENTING: Gunakan Server Key milik TOKO, bukan milik superadmin!
    const payload = order_id + status_code + gross_amount + store.midtrans_server_key;

    const hash = require('crypto')
      .createHash("sha512")
      .update(payload)
      .digest("hex");

    if (hash != signature_key) {
      return response.badRequest(res, 'Invalid signature key')
    }

    if (transaction_status != 'settlement') {
      return res.status(200)
    }

    const trxMaster = await master.transaction()
    try {

      const fee = parseInt(process.env.TRANSACTION_FEE, 10) || 0;

      const tenant = await OwnerModel.getTenantByID(tenant_id);
      const tenant_db = getTenantConnection(tenant);

      const id = parseInt(order_id.split('-').pop(), 10);
      const transaction = await TransactionModel.findTransactionById(tenant_db, store_id, id);
      if (!transaction) return response.notFound(res, 'Transaction not found!');

      const payment_status = fraud_status == 'accept' ? 'paid' : 'canceled';
      const isUpdated = await TransactionModel.updateTransaction(tenant_db, store_id, id, {
        payment_status,
        received_amount: parseFloat(gross_amount),
        change_amount: transaction.total_cost - parseFloat(gross_amount),
      });
      if (!isUpdated) return response.error(res, null, 'Gagal mengupdate transaksi');

      // Pengurangan saldo/wallet di owner
      const owner = await OwnerModel.getByTenantId(tenant_id);
      const after = owner.wallet_balance - fee;

      await WalletTransaction.createTransaction(trxMaster, {
        owner_id: owner.id,
        type: 'transaction_fee',
        amount: -fee,
        balance_after: after,
        reference_type: 'transactions',
        reference_id: id,
        description: `Transaksi fee pada id ${id?.toString().padStart(6, '0')}`
      });

      await OwnerModel.subtractBalance(trxMaster, owner.id, fee);

      const mapped = mapTransactionToFrontend(transaction, owner.id, []);
      getIO().to(mapped.idFull).emit('payment-success', {
        message: "Pembayaran Lunas!",
        transaction_id: mapped.idFull,
        status: payment_status
      });

      return response.success(res, null, 'Transaksi berhasil diupdate');
    } catch (error) {
      console.error('Update transaction error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengupdate transaksi');
    }
  },

  // Delete transaksi
  async delete(req, res) {
    try {
      const { store_id, id } = req.params;

      // Pastikan transaksi ada
      const trx = await TransactionModel.findTransactionById(req.db, store_id, id);
      if (!trx) return response.notFound(res, 'Transaksi tidak ditemukan');

      const deleted = await TransactionModel.deleteTransaction(req.db, store_id, id);
      if (!deleted) return response.error(res, 'Gagal menghapus transaksi');

      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: store_id,
        action: 'delete_transaction',
        detail: `Hapus transaksi: ID ${id}`
      });

      return response.success(res, null, 'Transaksi berhasil dihapus');
    } catch (error) {
      return response.error(res, error, 'Terjadi kesalahan saat menghapus transaksi');
    }
  },

  async batchDelete(req, res) {
    try {
      const { store_id } = req.params;
      const { transaction_ids } = req.body;

      if (!Array.isArray(transaction_ids) || transaction_ids.length === 0) {
        return response.badRequest(res, 'transaction_ids harus berupa array dan tidak boleh kosong');
      }

      const deleted = await TransactionModel.batchDeleteTransactions(req.db, store_id, transaction_ids);
      if (!deleted) return response.error(res, 'Gagal menghapus transaksi');

      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: store_id,
        action: 'batch_delete_transaction',
        detail: `Hapus batch transaksi: ID [${transaction_ids.join(', ')}]`
      });

      return response.success(res, null, `${deleted} transaksi berhasil dihapus`);
    } catch (error) {
      return response.error(res, error, 'Terjadi kesalahan saat menghapus batch transaksi');
    }
  },

  // Refund transaksi
  async refund(req, res) {
    const trxTenant = await req.db.transaction();
    try {
      const { store_id, id } = req.params;
      const { tenant_id, id: userId } = req.user;

      // Validasi input
      const { value, error } = refundValidations.validate(req.body);
      if (error) {
        await trxTenant.rollback();
        return response.badRequest(res, error.message, error.details);
      }

      const { reason, refund_items } = value;

      // Pastikan transaksi ada dan belum refunded
      const transaction = await TransactionModel.findTransactionById(trxTenant, store_id, id);
      if (!transaction) {
        await trxTenant.rollback();
        return response.notFound(res, 'Transaksi tidak ditemukan');
      }

      if (transaction.payment_status === 'refunded') {
        await trxTenant.rollback();
        return response.badRequest(res, 'Transaksi sudah di-refund');
      }

      if (transaction.payment_status !== 'paid') {
        await trxTenant.rollback();
        return response.badRequest(res, 'Hanya transaksi yang sudah dibayar dapat di-refund');
      }

      // Get original transaction items
      const originalItems = await TransactionModel.getItemsByTransactionId(trxTenant, id);
      
      // Validate refund items against original
      const originalItemMap = Object.fromEntries(originalItems.map(i => [i.product_id, i]));
      
      for (const refundItem of refund_items) {
        const original = originalItemMap[refundItem.product_id];
        if (!original) {
          await trxTenant.rollback();
          return response.badRequest(res, `Produk dengan ID ${refundItem.product_id} tidak ada dalam transaksi`);
        }
        if (refundItem.qty > original.qty) {
          await trxTenant.rollback();
          return response.badRequest(res, `Jumlah refund untuk produk ${original.product_name} melebihi jumlah pembelian`);
        }
      }

      // Hitung jumlah refund
      let refundTotal = 0;
      for (const refundItem of refund_items) {
        const original = originalItemMap[refundItem.product_id];
        const ratio = refundItem.qty / original.qty;
        refundTotal += original.subtotal * ratio;
      }

      // Update transaction status to refunded
      await TransactionModel.refundTransaction(trxTenant, store_id, id, {
        notes: transaction.notes ? `${transaction.notes} | Refund: ${reason}` : `Refund: ${reason}`,
        refund_amount: refundTotal,
        refund_items: JSON.stringify(refund_items),
        refunded_by: userId,
        refunded_at: trxTenant.fn.now()
      });

      // Restore product stock (cek without_stock dari tabel produk, bukan dari item transaksi
      // yang tidak punya kolom tersebut)
      for (const refundItem of refund_items) {
        const prod = await trxTenant('products')
          .where({ store_id, id: refundItem.product_id })
          .first('without_stock');
        if (!prod || !prod.without_stock) {
          await TransactionModel.addProductStock(trxTenant, store_id, refundItem.product_id, refundItem.qty);
        }
      }

      await trxTenant.commit();

      // Log activity
      await ActivityLogModel.create(req.db, {
        user_id: userId,
        store_id: store_id,
        action: 'refund_transaction',
        detail: `Refund transaksi ID ${id}, jumlah: ${refundTotal}`
      });

      return response.success(res, { refund_amount: refundTotal }, 'Refund berhasil');
    } catch (error) {
      await trxTenant.rollback();
      console.error('Refund transaction error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat melakukan refund');
    }
  },

  // Menambahkan barang ke keranjang belanja (simulasi untuk caffe)
  // async addItemToCart(req, res) {
  //   try {
  //     const { store_id } = req.params;
  //     const { product_id, qty, price, discount_type, discount_value } = req.body;

  //     // Mendapatkan produk dari database
  //     const product = await ProductModel.findProductById(req.db, store_id, product_id);
  //     if (!product) return response.notFound(res, 'Produk tidak ditemukan');

  //     // Memeriksa stok produk
  //     if (product.stock < qty)
  //       return response.badRequest(res, 'Stok produk tidak cukup');

  //     // Menghitung harga dan diskon
  //     const subtotal = price * qty;
  //     let discountAmount = 0;
  //     if (discount_type === 'percentage') {
  //       discountAmount = (discount_value / 100) * subtotal;
  //     } else if (discount_type === 'nominal') {
  //       discountAmount = Math.min(discount_value, subtotal);
  //     }

  //     const totalAfterDiscount = subtotal - discountAmount;

  //     // Simulasi: kembalikan detail item
  //     const item = {
  //       product_id,
  //       product_name: product.name,
  //       sku: product.sku,
  //       price,
  //       qty,
  //       discount_type,
  //       discount_value,
  //       discount_amount: discountAmount,
  //       subtotal,
  //       total_after_discount: totalAfterDiscount,
  //     };

  //     return response.success(res, item, 'Barang berhasil ditambahkan ke keranjang');
  //   } catch (error) {
  //     return response.error(res, error, 'Terjadi kesalahan saat menambahkan barang ke keranjang');
  //   }
  // },
};

module.exports = TransactionController;
