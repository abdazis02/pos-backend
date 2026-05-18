const TransactionModel = {
  // Mendapatkan semua transaksi untuk sebuah toko
  paginateTransactions(db, store_id, offset, limit, filters) {
    const transactions = db("transactions as t")
      .join(process.env.DB_NAME + '.users as u', 'u.id', 't.user_id')
      .where("t.store_id", store_id)
      .orderBy("t.created_at", "DESC")
      .select('t.*', 'u.name as cashier')

    const total = transactions.clone().clearSelect().count({ cnt: 't.id' }).first()

    // Filter search (by transaction id, idFull, product_name, product.name)
    if (!!filters.search) {
      const k = `%${filters.search}%`
      transactions.where(q => q
        .where("id", "like", k)
        .orWhereExists(
          db("transaction_items as ti")
            .leftJoin("products as p", "p.id", "ti.product_id")
            .whereRaw("ti.transaction_id = t.id")
            .where((q) => q
              .where('ti.product_name', 'like', k)
              .orWhere('p.name', 'like', k)
            )
        )
      );
    }

    if (!!filters.payment_status) {
      transactions.where("payment_status", filters.payment_status)
    }

    if (!!filters.start_date && !!filters.end_date) {
      transactions.whereRaw(
        't.created_at BETWEEN ? AND ?',
        [filters.start_date, filters.end_date]
      );
    }

    const filtered = transactions.clone().clearSelect().count({ cnt: 't.id' }).first();

    if (limit != -1) transactions.limit(limit);
    return [transactions.offset(offset), total, filtered];
  },

  async getItemsByTransactionIds(db, transactionIds) {
    const rows = await db("transaction_items as ti")
      .leftJoin("products as p", "p.id", "ti.product_id")
      .whereIn("ti.transaction_id", transactionIds)
      .select(
        'ti.transaction_id', 'ti.product_id', 'p.name as product_name', 'p.sku',
        'ti.price', 'ti.qty as quantity', 'ti.cost_price', 'ti.subtotal',
        'ti.discount_type', 'ti.discount_value', 'ti.discount_amount'
      )

    // PERBAIKAN: Mengganti Object.groupBy dengan reduce agar support semua versi Node.js
    return rows.reduce((acc, item) => {
      const key = item.transaction_id;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {});
  },

  // Membuat transaksi baru 
  async create(db, data) {
    const [id] = await db("transactions").insert(data)

    return id;
  },

  // Menambahkan item ke transaksi
  addItems(db, transaction_id, items) {
    if (!items || !items.length) return;

    const values = items.map(item => ({ ...item, transaction_id }))

    return db("transaction_items").insert(values);
  },

  // Mendapatkan transaksi berdasarkan ID 
  findTransactionById(db, store_id, id) {
    return db("transactions as t")
      .join(process.env.DB_NAME + '.users as u', 'u.id', 't.user_id')
      .where('t.store_id', store_id)
      .where('t.id', id)
      .first('t.*', 'u.name as cashier')
  },

  // Update transaksi
  updateTransaction(db, store_id, id, data) {
    data.updated_at = db.fn.now();
    return db("transactions").where({ store_id, id }).update(data);
  },

  // Menghapus transaksi 
  deleteTransaction(db, store_id, id) {
    return db("transactions").where({ store_id, id }).delete()
  },

  // Menghapus banyak transaksi sekaligus
  batchDeleteTransactions(db, store_id, ids) {
    return db("transactions").where("store_id", store_id).whereIn("id", ids).delete()
  },

  // Update status transaksi menjadi refunded
  refundTransaction(db, store_id, id, data) {
    data.updated_at = db.fn.now();
    data.payment_status = 'refunded';
    return db("transactions").where({ store_id, id }).update(data);
  },

  // Mendapatkan item transaksi berdasarkan ID transaksi
  getItemsByTransactionId(db, transaction_id) {
    return db("transaction_items")
      .where("transaction_id", transaction_id)
      .select('*');
  },

  // Update stok produk (tambah kembali saat refund)
  addProductStock(db, store_id, product_id, qty) {
    return db("products")
      .where({ store_id, id: product_id })
      .increment("stock", qty);
  }
};

module.exports = TransactionModel;