/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('tenants', (table) => {
    table.increments('id').primary();
    table.integer('owner_id').unsigned().notNullable();
    table.string('db_name').notNullable();
    table.string('db_user').notNullable();
    table.string('db_pass').notNullable();
    table.timestamps(true, true);

    table.foreign('owner_id').references('id').inTable('owners').onDelete('restrict');
  })
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTableIfExists('tenants');
};
