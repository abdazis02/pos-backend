const ProductReturnModel = {
  // Create new return request
  async create(db, data) {
    const [id] = await db("product_returns").insert(data);
    return id;
  },

  // Get all returns for a store with pagination
  paginateReturns(db, store_id, offset, limit, filters = {}) {
    const returns = db("product_returns as pr")
      .join("products as p", "p.id", "pr.product_id")
      .join(process.env.DB_NAME + ".users as u", "u.id", "pr.user_id")
      .where("pr.store_id", store_id)
      .orderBy("pr.created_at", "DESC")
      .select(
        'pr.*', 
        'p.name as product_name', 
        'p.sku',
        'u.name as user_name'
      );

    const total = returns.clone().clearSelect().count({ cnt: 'pr.id' }).first();

    if (filters.status) {
      returns.where("pr.status", filters.status);
    }

    if (filters.search) {
      const k = `%${filters.search}%`;
      returns.where(q => q
        .where("p.name", "like", k)
        .orWhere("p.sku", "like", k)
        .orWhere("pr.note", "like", k)
      );
    }

    const filtered = returns.clone().clearSelect().count({ cnt: 'pr.id' }).first();

    return [returns.offset(offset).limit(limit), total, filtered];
  },

  // Get return by ID
  findById(db, store_id, id) {
    return db("product_returns as pr")
      .join("products as p", "p.id", "pr.product_id")
      .join(process.env.DB_NAME + ".users as u", "u.id", "pr.user_id")
      .where("pr.store_id", store_id)
      .where("pr.id", id)
      .first(
        'pr.*', 
        'p.name as product_name', 
        'p.sku',
        'u.name as user_name'
      );
  },

  // Get returns by product ID
  findByProductId(db, store_id, product_id) {
    return db("product_returns as pr")
      .join(process.env.DB_NAME + ".users as u", "u.id", "pr.user_id")
      .where("pr.store_id", store_id)
      .where("pr.product_id", product_id)
      .orderBy("pr.created_at", "DESC")
      .select(
        'pr.*', 
        'u.name as user_name'
      );
  },

  // Update return status
  updateStatus(db, store_id, id, status) {
    return db("product_returns")
      .where({ store_id, id })
      .update({ 
        status, 
        updated_at: db.fn.now() 
      });
  },

  // Delete return
  delete(db, store_id, id) {
    return db("product_returns").where({ store_id, id }).delete();
  },
};

module.exports = ProductReturnModel;