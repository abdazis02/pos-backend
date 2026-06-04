/**
 * Fitur Resep/Komposisi (khusus F&B / cafe):
 *  - `ingredients`     : master bahan baku per toko (stok, satuan, harga).
 *  - `product_recipes` : komposisi tiap menu (produk) → daftar bahan + takaran.
 *
 * Dari sini:
 *  - HPP menu dihitung dari Σ(takaran × harga bahan).
 *  - Stok bahan dipotong otomatis saat menu terjual.
 *
 * Idempoten (hasTable check) agar aman dijalankan ulang di semua tenant.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasIngredients = await knex.schema.hasTable('ingredients');
  if (!hasIngredients) {
    await knex.schema.createTable('ingredients', (table) => {
      table.increments().primary();
      table.integer('store_id').unsigned().notNullable();
      table.string('name').notNullable();
      table.string('unit', 20).defaultTo('gr');     // satuan: gr, ml, pcs, ...
      table.decimal('cost_price', 18, 2).defaultTo(0); // harga beli per 1 satuan
      table.decimal('stock', 18, 3).defaultTo(0);      // stok saat ini (boleh pecahan)
      table.decimal('min_stock', 18, 3).defaultTo(0);  // ambang peringatan
      table.boolean('is_active').defaultTo(true);
      table.timestamps(true, true);
      table.index('store_id');
    });
  }

  const hasRecipes = await knex.schema.hasTable('product_recipes');
  if (!hasRecipes) {
    await knex.schema.createTable('product_recipes', (table) => {
      table.increments().primary();
      table.integer('store_id').unsigned().notNullable();
      table.integer('product_id').unsigned().notNullable();
      table.integer('ingredient_id').unsigned().notNullable();
      table.decimal('quantity', 18, 3).notNullable().defaultTo(0); // takaran per 1 porsi (dalam satuan bahan)
      table.timestamps(true, true);
      table.index('product_id');
      table.index('ingredient_id');
    });
  }
};

exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('product_recipes')
    .dropTableIfExists('ingredients');
};
