const LaundryOrderModel = {
  paginate(db, store_id, offset, limit, filters = {}) {
    const base = db('laundry_orders').where('store_id', store_id).orderBy('id', 'desc');
    if (filters.status) base.where('status', filters.status);
    if (filters.payment_status) base.where('payment_status', filters.payment_status);
    if (filters.search) {
      const k = `%${filters.search}%`;
      base.where((q) =>
        q.where('customer_name', 'like', k)
          .orWhere('customer_phone', 'like', k)
          .orWhere('order_no', 'like', k)
      );
    }
    const total = base.clone().clearOrder().count({ cnt: 'id' }).first();
    return [base.offset(offset).limit(limit), total];
  },

  getById(db, store_id, id) {
    return db('laundry_orders').where({ store_id, id }).first();
  },

  getItems(db, order_id) {
    return db('laundry_order_items').where('order_id', order_id).orderBy('id', 'asc');
  },

  // Buat pesanan + itemnya dalam satu transaksi. Mengembalikan id pesanan.
  async create(db, order, items) {
    return db.transaction(async (trx) => {
      const [orderId] = await trx('laundry_orders').insert(order);
      const orderNo = `LDY-${String(orderId).padStart(5, '0')}`;
      await trx('laundry_orders').where('id', orderId).update({ order_no: orderNo });

      if (items && items.length) {
        const rows = items.map((it) => ({
          ...it,
          order_id: orderId,
          store_id: order.store_id,
        }));
        await trx('laundry_order_items').insert(rows);
      }
      return orderId;
    });
  },

  update(db, store_id, id, data) {
    data.updated_at = db.fn.now();
    return db('laundry_orders').where({ store_id, id }).update(data);
  },

  // Update bersyarat (cegah balapan dobel-proses). affectedRows 0 = sudah berubah.
  updateWhere(db, store_id, id, where, data) {
    data.updated_at = db.fn.now();
    return db('laundry_orders').where({ store_id, id, ...where }).update(data);
  },
};

module.exports = LaundryOrderModel;
