/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.table('transactions', (table) => {
    table.decimal('refund_amount', 12.2).unsigned().after('subtotal');
    table.text('refund_items').after('refund_amount');
    table.integer('refunded_by').unsigned().after('refund_items');
    table.dateTime('refunded_at').after('refunded_by');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('transactions', (table) => {
    table.dropColumns('refund_amount', 'refund_items', 'refunded_by', 'refunded_at')
  })
};
