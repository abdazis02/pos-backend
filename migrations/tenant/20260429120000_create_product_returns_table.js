/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema.createTable('product_returns', (table) => {
    table.increments('id').primary();
    table.integer('store_id').unsigned().notNullable();
    table.integer('product_id').unsigned().notNullable();
    table.integer('quantity').notNullable().defaultTo(1);
    table.text('note').nullable();
    table.json('photos').nullable(); // Array of photo paths
    table.integer('user_id').unsigned().notNullable();
    table.string('status').defaultTo('pending'); // pending, approved, rejected
    table.timestamps(true, true);

    table.foreign('store_id').references('id').inTable('stores');
    table.foreign('product_id').references('id').inTable('products');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('product_returns');
};