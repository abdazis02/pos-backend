/**
 * Perbaikan skema tabel products agar promo (khususnya BUNDLE) bisa disimpan:
 *  1. Kolom diskon DECIMAL(18,2) UNSIGNED — agar harga bundle/nominal besar
 *     (mis. 1.600.000) tidak overflow saat update.
 *  2. ENUM discount_type memuat 'bundle' — agar discount_type='bundle' tidak
 *     ditolak MySQL strict-mode ("Data truncated") saat update.
 *
 * Idempoten: hanya menjalankan ALTER bila definisi kolom belum sesuai target,
 * sehingga aman di-run berulang dan tidak membangun ulang tabel tanpa perlu.
 *
 * @param { import("knex").Knex } knex
 */
const DECIMAL_TARGET = 'decimal(18,2) unsigned';
const DECIMAL_COLUMNS = ['discount_bundle_value', 'discount_value'];
const ENUM_TARGET = "enum('percentage','nominal','buyxgety','bundle')";

async function getColumnType(knex, column) {
  const res = await knex.raw(
    `SELECT COLUMN_TYPE AS t
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND COLUMN_NAME = ?`,
    [column]
  );
  const rows = Array.isArray(res) ? res[0] : res;
  return rows && rows[0] ? String(rows[0].t || '').toLowerCase() : null;
}

exports.up = async function (knex) {
  // 1. Perbesar kolom decimal bila masih lebih kecil dari target.
  for (const col of DECIMAL_COLUMNS) {
    const current = await getColumnType(knex, col);
    if (!current || current === DECIMAL_TARGET) continue;
    await knex.raw(
      `ALTER TABLE products MODIFY \`${col}\` DECIMAL(18,2) UNSIGNED NULL`
    );
  }

  // 2. Pastikan ENUM discount_type memuat nilai 'bundle' (dan promo lain).
  const enumType = await getColumnType(knex, 'discount_type');
  if (enumType && !enumType.includes("'bundle'")) {
    await knex.raw(
      `ALTER TABLE products MODIFY discount_type ` +
      `ENUM('percentage','nominal','buyxgety','bundle') NULL`
    );
  }
};

exports.down = async function () {
  // Sengaja no-op: tidak menyempitkan kembali kolom (mencegah kehilangan data).
};
