/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.table('transactions', (table) => {
    table.string('xendit_id').after('payment_status');
    table.text('qr_string').after('xendit_id');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('transactions', (table) => {
    table.dropColumn('xendit_id');
    table.dropColumn('qr_string');
  });
};
