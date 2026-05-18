/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.hasColumn('owners', 'wallet_balance').then((exists) => {
    if (!exists) {
      return knex.schema.alterTable('owners', (table) => {
        table.double('wallet_balance').nullable().after('status').defaultTo(0);
      });
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.hasColumn('owners', 'wallet_balance').then((exists) => {
    if (exists) {
      return knex.schema.alterTable('owners', (table) => {
        table.dropColumn('wallet_balance');
      });
    }
  });
};
