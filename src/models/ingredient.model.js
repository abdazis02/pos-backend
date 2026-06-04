const IngredientModel = {
  paginate(db, store_id, offset, limit, filters = {}) {
    const base = db('ingredients').where('store_id', store_id).orderBy('name', 'asc');
    if (filters.search) {
      const k = `%${filters.search}%`;
      base.where('name', 'like', k);
    }
    if (filters.status != null) {
      base.where('is_active', filters.status);
    }
    const total = base.clone().count({ cnt: 'id' }).first();
    return [base.offset(offset).limit(limit), total];
  },

  listAll(db, store_id, onlyActive = true) {
    const q = db('ingredients').where('store_id', store_id).orderBy('name', 'asc');
    if (onlyActive) q.where('is_active', true);
    return q;
  },

  getById(db, store_id, id) {
    return db('ingredients').where({ store_id, id }).first();
  },

  getByIds(db, store_id, ids) {
    return db('ingredients').where('store_id', store_id).whereIn('id', ids);
  },

  async create(db, data) {
    const [id] = await db('ingredients').insert(data);
    return id;
  },

  update(db, store_id, id, data) {
    data.updated_at = db.fn.now();
    return db('ingredients').where({ store_id, id }).update(data);
  },

  delete(db, store_id, id) {
    return db('ingredients').where({ store_id, id }).delete();
  },

  // Kurangi stok bahan (boleh menjadi negatif agar selisih/over-pakai tetap terlihat).
  consumeStock(db, store_id, id, amount) {
    return db('ingredients')
      .where({ store_id, id })
      .update({
        stock: db.raw('stock - ?', [amount]),
        updated_at: db.fn.now(),
      });
  },

  addStock(db, store_id, id, amount) {
    return db('ingredients')
      .where({ store_id, id })
      .update({
        stock: db.raw('stock + ?', [amount]),
        updated_at: db.fn.now(),
      });
  },
};

module.exports = IngredientModel;
