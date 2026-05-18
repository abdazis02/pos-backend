/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('wallet_transactions', (table) => {
    table.string('type', 20).alter()
    table.enum('reference_type', ['wallet_topups', 'transactions']).alter()
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {

};
