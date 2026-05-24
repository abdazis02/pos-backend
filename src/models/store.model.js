const StoreModel = {
  getAllStores(db) {
    return db("stores").select("*")
  },

  getAllByOwner(db) {
    return db("stores").orderBy("created_at", "DESC").select('*')
  },

  paginateStores(db, offset, limit, q) {
    const stores = db("stores").orderBy("created_at", "DESC").select('*')
    const stores_total = stores.clone().clearSelect().count({ cnt: 'id' }).first()

    if (!!q) {
      const k = `%${q}%`
      stores.where("name", "like", k).orWhere("address", "like", k).orWhere("phone", "like", k);
    }

    const stores_filtered = stores.clone().clearSelect().count({ cnt: 'id' }).first()
    return [stores.offset(offset).limit(limit), stores_total, stores_filtered];
  },

  async createStore(db, data) {
    const { name, address, phone, tax_percentage, logo_url } = data;

    const [id] = await db("stores").insert({ name, address, phone, tax_percentage, logo_url })
    return id;
  },

  findStoreById(db, id) {
    return db("stores").where("id", id).first();
  },

  async updateStore(db, id, data) {
    data.updated_at = db.fn.now();
    const rows = await db("stores").where("id", id).update(data);
    return rows > 0;
  },

  async deleteStore(db, id) {
    const rows = await db("stores").where("id", id).delete();
    return rows > 0
  },
};

module.exports = StoreModel;