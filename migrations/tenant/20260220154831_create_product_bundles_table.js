/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('product_bundles', (table) => {
    table.increments().primary();
    table.integer('store_id').unsigned().notNullable();
    table.integer('product_id').unsigned().notNullable();
    table.integer('min_qty');
    table.decimal('bundle_price', 12.2);
    table.boolean('is_active').defaultTo(1);
    table.timestamps(true, true);

    table.foreign('store_id').references('id').inTable('stores').onDelete('restrict');
    table.foreign('product_id').references('id').inTable('products').onDelete('restrict');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('product_bundles');
};
