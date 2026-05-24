/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // Kolom komisi berada di tabel users (DATABASE MASTER)
  const hasCommission = await knex.schema.hasColumn('users', 'commission_rate');
  if (!hasCommission) {
    await knex.schema.table('users', (table) => {
      table.decimal('commission_rate', 5, 2).defaultTo(0.00).after('role');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('users', (table) => {
    table.dropColumn('commission_rate');
  });
};
