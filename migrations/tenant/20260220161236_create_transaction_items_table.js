/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('transaction_items', (table) => {
    table.increments().primary();
    table.integer('transaction_id').unsigned().notNullable();
    table.integer('product_id').unsigned().notNullable();
    // Info dari tabel products
    table.string('product_name');
    table.string('sku', 100);
    table.decimal('price', 10.2).notNullable();
    table.decimal('cost_price', 10.2).notNullable();
    table.enum('discount_type', ['percentage', 'nominal', 'buyxgety', 'bundle']);
    table.decimal('discount_value', 10.2).unsigned();
    table.integer('discount_bundle_min_qty').unsigned();
    table.decimal('discount_bundle_value', 10.2).unsigned();
    table.integer('buy_qty').unsigned();
    table.integer('free_qty').unsigned();
    // Penjumlahan
    table.integer('qty').notNullable();
    table.decimal('discount_amount', 12.2).unsigned();
    table.decimal('subtotal', 10.2).notNullable();
    table.text('notes');

    table.foreign('transaction_id').references('id').inTable('transactions').onDelete('cascade');
    table.foreign('product_id').references('id').inTable('products').onDelete('cascade');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('transaction_items');
};
