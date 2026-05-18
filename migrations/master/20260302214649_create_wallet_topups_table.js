/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('wallet_topups', (table) => {
    table.increments().primary();
    table.integer('owner_id').unsigned().notNullable();
    table.string('midtrans_transaction_id');
    table.float('amount');
    table.enum('status', ['pending', 'success', 'failed']);
    table.string('payment_method');
    table.dateTime('expired_at');
    table.dateTime('created_at').defaultTo(knex.fn.now());
    table.dateTime('paid_at');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('wallet_topups');
};
