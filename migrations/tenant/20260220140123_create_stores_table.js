/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable("stores", (table) => {
    table.increments().primary();
    table.string('type', 32).defaultTo('store');
    table.string('name').notNullable();
    table.text('address');
    table.string('phone', 20);
    table.decimal('tax_percentage', 5.2).defaultTo(0.00);
    table.string('midtrans_merchan_id', 15);
    table.string('midtrans_client_key', 50);
    table.string('midtrans_server_key', 50);
    table.timestamps(true, true);
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('stores');
};
