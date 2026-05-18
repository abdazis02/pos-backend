const PPOBOrderModel = {
  async createOrder(db, data) {
    const [id] = await db('ppob_orders').insert(data);
    return id;
  },

  findOrderById(db, store_id, id) {
    return db('ppob_orders').where({ store_id, id }).first();
  },

  findOrderByRefId(db, store_id, ref_id) {
    return db('ppob_orders').where({ store_id, ref_id }).first();
  },

  paginateOrders(db, store_id, offset, limit, query) {
    const baseQuery = db('ppob_orders').where({ store_id });
    const orders = baseQuery.clone().orderBy('created_at', 'DESC');

    if (query?.search) {
      const search = `%${query.search}%`;
      orders.andWhere((builder) => {
        builder
          .where('customer_no', 'like', search)
          .orWhere('ref_id', 'like', search)
          .orWhere('buyer_sku_code', 'like', search);
      });
    }

    const totalQuery = baseQuery.clone().clearSelect().count({ cnt: 'id' }).first();
    const filteredQuery = orders.clone().clearSelect().count({ cnt: 'id' }).first();

    return [orders.offset(offset).limit(limit), totalQuery, filteredQuery];
  },

  async updateOrder(db, id, data) {
    data.updated_at = db.fn.now();
    return db('ppob_orders').where({ id }).update(data);
  },
};

module.exports = PPOBOrderModel;
