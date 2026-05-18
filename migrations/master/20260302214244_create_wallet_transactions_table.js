/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('wallet_transactions', (table) => {
    table.increments().primary();
    table.integer('owner_id').unsigned().notNullable();
    table.enum('type', ['credit', 'debig']);
    table.float('amount');
    table.double('balance_after');
    table.enum('reference_type', ['topup', 'transaction', 'refund', 'adjusment']);
    table.integer('reference_id').unsigned();
    table.text('description').nullable();
    table.timestamps(true, true);

    table.index(['reference_type', 'reference_id']);
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('wallet_transactions');
};
