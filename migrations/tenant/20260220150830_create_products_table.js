/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('products', (table) => {
    table.increments().primary();
    table.integer('store_id').unsigned().notNullable();
    table.string('name').notNullable();
    table.string('sku', 20);
    table.string('barcode', 100);
    table.decimal('price', 18, 2).notNullable(); // Tips: Gunakan 18, 2 agar angka tidak terpotong
    table.decimal('cost_price', 18, 2);
    table.integer('stock').unsigned().defaultTo(0);
    table.string('category', 255).nullable(); 
    table.text('description');
    table.text('image_url');
    table.boolean('is_active').defaultTo(true);
    table.enum('discount_type', ['percentage', 'nominal', 'buyxgety', 'bundle']);
    table.decimal('discount_value', 18, 2).unsigned();
    table.integer('discount_bundle_min_qty').unsigned();
    table.decimal('discount_bundle_value', 18, 2).unsigned();
    table.integer('buy_qty').unsigned();
    table.integer('free_qty').unsigned();
    
    // Tambahan: Agar saat hapus produk, sisa stok tidak error
    table.boolean('without_stock').defaultTo(false); 
    
    table.timestamps(true, true);

    table.foreign('store_id').references('id').inTable('stores').onDelete('restrict');
  })
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('products');
};