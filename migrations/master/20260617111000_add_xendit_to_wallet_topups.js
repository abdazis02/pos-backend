/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.table('wallet_topups', (table) => {
    table.string('xendit_id');
    table.string('va_number');
    table.string('checkout_url');
    table.text('qr_string');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('wallet_topups', (table) => {
    table.dropColumn('xendit_id');
    table.dropColumn('va_number');
    table.dropColumn('checkout_url');
    table.dropColumn('qr_string');
  });
};
