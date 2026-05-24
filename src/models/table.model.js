const TableModel = {
  getAllByStore(db) {
    return db("restaurant_tables").orderBy("table_number", "ASC");
  },

  findById(db, id) {
    return db("restaurant_tables").where("id", id).first();
  },

  async create(db, data) {
    const [id] = await db("restaurant_tables").insert(data);
    return id;
  },

  async update(db, id, data) {
    data.updated_at = db.fn.now();
    const rows = await db("restaurant_tables").where("id", id).update(data);
    return rows > 0;
  },

  async delete(db, id) {
    const rows = await db("restaurant_tables").where("id", id).delete();
    return rows > 0;
  },

  updateStatus(db, id, status, transaction_id = null) {
      return db("restaurant_tables").where("id", id).update({
          status,
          current_transaction_id: transaction_id,
          updated_at: db.fn.now()
      });
  }
};

module.exports = TableModel;
