/**
 * Tambah kolom business_category ke tabel stores (per-toko kategori bisnis).
 * Idempotent: cek dulu apakah kolom sudah ada agar aman dijalankan ulang.
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const has = await knex.schema.hasColumn('stores', 'business_category');
  if (!has) {
    await knex.schema.alterTable('stores', (table) => {
      table.string('business_category').defaultTo('lainnya');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const has = await knex.schema.hasColumn('stores', 'business_category');
  if (has) {
    await knex.schema.alterTable('stores', (table) => {
      table.dropColumn('business_category');
    });
  }
};
