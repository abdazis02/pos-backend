/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('daily_reports', (table) => {
    table.increments().primary();
    table.integer('store_id').unsigned().notNullable();
    table.date('report_date').notNullable();
    table.integer('total_transactions');
    table.decimal('total_income', 18.2);
    table.decimal('total_discount', 18.2);
    table.decimal('net_revenue', 18.2);
    table.decimal('total_hpp', 18.2);
    table.decimal('gross_profit', 18.2);
    table.decimal('operational_cost', 18.2);
    table.decimal('net_profit', 18.2);
    table.string('margin', 10);
    table.decimal('best_sales_day', 18.2);
    table.decimal('lowest_sales_day', 18.2);
    table.decimal('avg_daily', 18.2);
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.foreign('store_id').references('id').inTable('stores').onDelete('restrict');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('daily_reports');
};
