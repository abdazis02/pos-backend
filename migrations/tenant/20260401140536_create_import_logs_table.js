/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('import_logs', (table) => {
    table.increments().primary();
    table.integer('user_id').unsigned().notNullable();
    table.integer('store_id').unsigned();
    table.string('filename', 100);
    table.decimal('size');
    table.string('status', 50);
    table.timestamps(true, true);

    table.foreign('store_id').references('id').inTable('stores').onDelete('cascade');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('import_logs');
};
