/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.table('wallet_topups', (table) => {
    table.string('bank_code').nullable();
    table.string('channel_code').nullable();
    table.timestamp('paid_at').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('wallet_topups', (table) => {
    table.dropColumn('bank_code');
    table.dropColumn('channel_code');
    table.dropColumn('paid_at');
  });
};
