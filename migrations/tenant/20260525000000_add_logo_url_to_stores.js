/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasLogoUrl = await knex.schema.hasColumn('stores', 'logo_url');
  if (!hasLogoUrl) {
    return knex.schema.table("stores", (table) => {
      table.text('logo_url').nullable().after('tax_percentage');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table("stores", (table) => {
    table.dropColumn('logo_url');
  });
};
