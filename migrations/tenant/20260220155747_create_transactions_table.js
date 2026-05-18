/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('transactions', (table) => {
    table.increments().primary();
    table.integer('store_id').unsigned().notNullable();
    table.integer('user_id').unsigned();
    table.decimal('total_cost', 10.2).unsigned().notNullable();
    table.enum('payment_method', ['cash', 'qris_static', 'qris']).defaultTo('cash');
    table.decimal('received_amount', 10.2).unsigned().notNullable();
    table.decimal('change_amount', 10.2).unsigned().notNullable();
    table.string('customer_name', 100);
    table.string('customer_phone', 100);
    table.enum('payment_status', ['pending', 'paid', 'canceled', 'refunded']).defaultTo('paid');
    table.decimal('subtotal', 12.2).unsigned().notNullable();
    table.decimal('discount_total', 12.2).unsigned().notNullable();
    table.decimal('tax', 12.2).unsigned();
    table.decimal('tax_percentage', 5.2).unsigned();
    table.timestamps(true, true);

    table.foreign('store_id').references('id').inTable('stores').onDelete('restrict');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {

};
