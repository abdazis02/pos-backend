/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('users', (table) => {
    table.increments().primary();
    table.integer('tenant_id').unsigned();
    table.integer('store_id').unsigned();
    table.string('name', 100).notNullable();
    table.string('email', 100).unique().notNullable();
    table.string('password').notNullable();
    table.enum('role', ['superadmin', 'owner', 'admin', 'cashier']).defaultTo('cashier');
    table.string('business_category').defaultTo('lainnya');
    table.boolean('is_active').defaultTo(true);
    table.dateTime('verified_at');
    table.timestamps(true, true);
    table.foreign('tenant_id').references('id').inTable('tenants').onDelete('restrict');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('users');
};
