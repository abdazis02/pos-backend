const ProductModel = {
  // Get all products for a store
  paginateProducts(db, store_id, offset, limit, filters) {
    const products = db("products").where("store_id", store_id).orderBy("created_at", "DESC").orderBy('id', 'DESC')
    const total = products.clone().count({ cnt: 'id' }).first()

    if (!!filters.search) {
      const k = `%${filters.search}%`
      products.where(q => q.where("name", "like", k).orWhere("sku", "like", k).orWhere("barcode", "like", k));
    }

    if (!!filters.category) {
      products.where("category", filters.category)
    }

    if (!!filters.sku) {
      products.where("sku", filters.sku);
    }

    if (!!filters.barcode) {
      products.where("barcode", filters.barcode);
    }

    if (filters.status != null) {
      products.where("is_active", filters.status);
    }

    const filtered = products.clone().count({ cnt: 'id' }).first()
    return [products.offset(offset).limit(limit), total, filtered];
  },

  getAllProductsByIds(db, store_id, ids) {
    return db("products").orderBy("created_at", "DESC").where({ store_id, is_active: true }).whereIn('id', ids);
  },

  getProductStats(db, store_id) {
    const stats = db("products").select(db.raw(`
      COUNT(*) as total_products,
      COUNT(CASE WHEN is_active THEN 1 END) as active_products,
      COUNT(CASE WHEN is_active = 0 THEN 1 END) as inactive_products,
      SUM(COALESCE(price, 0) * COALESCE(stock, 0)) as total_inventory_value,
      SUM(price) as sum_price,
      COUNT(CASE WHEN is_active AND stock > 10 THEN 1 END) as in_stock,
      COUNT(CASE WHEN is_active AND stock <= 10 THEN 1 END) as low_stock,
      COUNT(CASE WHEN is_active AND stock = 0 THEN 1 END) as out_of_stock
    `)).where({ store_id }).first();

    const low_stock_items = db("products")
      .where({ store_id, is_active: true })
      .where('stock', '<=', 10)
      .select('id', 'name', 'stock', 'price');

    const recent_products = db("products")
      .where({ store_id })
      .select('id', 'name', 'created_at')
      .orderBy('created_at', 'desc')
      .limit(5);

    return [stats, low_stock_items, recent_products];
  },

  async createProduct(db, data) {
    data.discount_type = data.discount_type == '' ? null : data.discount_type
    const [id] = await db("products").insert(data);
    return id;
  },

  findProductById(db, store_id, id) {
    return db("products").where({ store_id, id }).first();
  },

  findProductByBarcode(db, store_id, barcode) {
    return db("products").where({ store_id, barcode }).first();
  },

  updateProduct(db, store_id, id, data) {
    data.updated_at = db.fn.now()
    return db("products").where({ store_id, id }).update(data)
  },

  deleteProduct(db, store_id, id) {
    return db("products").where({ store_id, id }).delete()
  },

  addProductStock(db, store_id, id, quantity) {
    return db("products")
      .where({ store_id, id })
      .increment({ "stock": quantity })
      .update({ updated_at: db.fn.now() })
  },

  subProductStock(db, store_id, id, quantity) {
    return db("products")
      .where({ store_id, id })
      .where('stock', '>=', quantity)
      .decrement({ stock: quantity })
      .update({ updated_at: db.fn.now() });
  },

  getLowStock(db, store_id, threshold = 10) {
    return db("products").where({ store_id, is_active: true }).where("stock", "<=", threshold).orderBy("stock")
  },

  // Bulk update
  async bulkUpdate(connOrStoreId, maybeStoreId, productIds, updateData) {
    const hasConn = connOrStoreId && typeof connOrStoreId.execute === 'function';
    const db = hasConn ? connOrStoreId : pool;
    const storeId = hasConn ? maybeStoreId : connOrStoreId;
    if (!Array.isArray(productIds) || productIds.length === 0) throw new Error('Product IDs must be a non-empty array');
    try {
      const fields = [];
      const values = [];
      const allowedFields = ['price', 'stock', 'is_active'];
      allowedFields.forEach(field => {
        if (updateData[field] !== undefined) {
          fields.push(`${field} = ?`);
          values.push(updateData[field]);
        }
      });
      if (fields.length === 0) throw new Error('No valid fields to update');
      const placeholders = productIds.map(() => '?').join(',');
      values.push(storeId, ...productIds);
      const [result] = await db.execute(
        `UPDATE products SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE store_id = ? AND id IN (${placeholders})`,
        values
      );
      return result.affectedRows;
    } catch (error) {
      throw error;
    }
  },

};

module.exports = ProductModel;