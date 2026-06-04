const ProductRecipeModel = {
  // Ambil resep 1 produk lengkap dengan info bahan (nama, satuan, harga) untuk tampilan & HPP.
  getByProduct(db, store_id, product_id) {
    return db('product_recipes as r')
      .leftJoin('ingredients as i', 'i.id', 'r.ingredient_id')
      .where('r.store_id', store_id)
      .where('r.product_id', product_id)
      .select(
        'r.id',
        'r.product_id',
        'r.ingredient_id',
        'r.quantity',
        'i.name as ingredient_name',
        'i.unit as unit',
        'i.cost_price as cost_price',
        'i.stock as ingredient_stock'
      )
      .orderBy('i.name', 'asc');
  },

  // Resep untuk banyak produk sekaligus (dipakai saat potong stok transaksi).
  getByProductIds(db, store_id, productIds) {
    if (!productIds || productIds.length === 0) return Promise.resolve([]);
    return db('product_recipes')
      .where('store_id', store_id)
      .whereIn('product_id', productIds)
      .select('product_id', 'ingredient_id', 'quantity');
  },

  // Ganti seluruh resep sebuah produk (hapus lama → masukkan baru). Dipakai dalam transaksi.
  async replaceForProduct(db, store_id, product_id, rows) {
    await db('product_recipes').where({ store_id, product_id }).delete();
    if (rows && rows.length) {
      await db('product_recipes').insert(rows);
    }
  },

  deleteByProduct(db, store_id, product_id) {
    return db('product_recipes').where({ store_id, product_id }).delete();
  },
};

module.exports = ProductRecipeModel;
