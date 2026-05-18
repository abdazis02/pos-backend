/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.table('products', (table) => {
    // 🔥 Column already exists in 20260220150830_create_products_table.js
    // We check if it exists first to prevent crash during tenant migration
    return knex.schema.hasColumn('products', 'without_stock').then((exists) => {
      if (!exists) {
        table.boolean('without_stock').after('cost_price').defaultTo(false);
      }
    });
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table('products', (table) => {
    return knex.schema.hasColumn('products', 'without_stock').then((exists) => {
      if (exists) {
        table.dropColumn('without_stock');
      }
    });
  });
};
