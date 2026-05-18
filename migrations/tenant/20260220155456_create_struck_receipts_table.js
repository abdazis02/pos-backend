/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('struck_receipts', (table) => {
    table.increments().primary();
    table.integer('store_id').unsigned().notNullable();
    table.string('template_name', 100);
    table.text('template_data');
    table.timestamps(true, true);

    table.foreign('store_id').references('id').inTable('stores').onDelete('restrict');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('struck_receipts');
};
