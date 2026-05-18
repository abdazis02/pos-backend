/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('owners', (table) => {
    table.increments('id').primary();
    table.string('business_name').notNullable();
    table.string('business_category').defaultTo('lainnya'); 
    table.string('email').unique().notNullable();
    table.string('phone', 20);
    table.text('address'); 
    table.decimal('wallet_balance', 18, 2).defaultTo(0);
    table.enum('status', ['active', 'suspended', 'terminated']).defaultTo('active');
    table.timestamps(true, true);
  })
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('owners');
};