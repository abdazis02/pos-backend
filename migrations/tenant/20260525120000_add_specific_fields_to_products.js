/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.table("products", (table) => {
    // 🔥 Fields untuk Apotek / Toko Kosmetik
    table.date('expired_date').nullable().after('image_url');
    table.string('batch_number', 50).nullable().after('expired_date');

    // 🔥 Fields untuk Distributor / Grosir (Harga Bertingkat)
    table.decimal('wholesale_price', 15, 2).nullable().after('batch_number');
    table.integer('min_wholesale_qty').nullable().after('wholesale_price');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.table("products", (table) => {
    table.dropColumn('expired_date');
    table.dropColumn('batch_number');
    table.dropColumn('wholesale_price');
    table.dropColumn('min_wholesale_qty');
  });
};
