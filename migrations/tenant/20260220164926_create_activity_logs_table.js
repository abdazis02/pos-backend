/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable("activity_logs", (table) => {
    table.increments().primary();
    table.integer('user_id').unsigned().notNullable();
    table.integer('store_id').unsigned();
    table.string('action');
    table.text('detail');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.foreign('store_id').references('id').inTable('stores').onDelete('cascade');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('activity_logs');
};
