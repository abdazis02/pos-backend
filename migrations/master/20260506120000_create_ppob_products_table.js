/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('ppob_products', function(table) {
    table.increments('id').primary();
    table.string('product_name').notNullable();
    table.string('category').notNullable(); // Pulsa, Data, Games, E-Money, dll
    table.string('brand').notNullable(); // Telkomsel, XL, Tri, dll
    table.decimal('price', 10, 2).notNullable();
    table.string('buyer_sku_code').notNullable().unique();
    table.string('type').notNullable(); // prepaid or postpaid
    table.boolean('is_active').defaultTo(true);
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTable('ppob_products');
};