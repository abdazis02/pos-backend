/**
 * Perbesar kolom `amount` pada wallet_topups & wallet_transactions menjadi
 * DECIMAL(18,2). Kolom ini sebelumnya dibuat lewat knex `.float()` yang di MySQL
 * menghasilkan FLOAT(8,2) — maksimal 999.999,99 — sehingga topup/transaksi
 * bernilai >= 1.000.000 ditolak ("Out of range value") di strict mode.
 *
 * Idempoten: hanya ALTER bila tipe kolom belum sesuai target.
 *
 * @param { import("knex").Knex } knex
 */
const TARGET = 'decimal(18,2)';
const TABLES = ['wallet_topups', 'wallet_transactions'];

async function getColumnType(knex, tableName, column) {
  const res = await knex.raw(
    `SELECT COLUMN_TYPE AS t
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?`,
    [tableName, column]
  );
  const rows = Array.isArray(res) ? res[0] : res;
  return rows && rows[0] ? String(rows[0].t || '').toLowerCase() : null;
}

exports.up = async function (knex) {
  for (const tbl of TABLES) {
    const current = await getColumnType(knex, tbl, 'amount');
    if (!current || current === TARGET) continue; // kolom tak ada / sudah sesuai → lewati
    await knex.raw(`ALTER TABLE \`${tbl}\` MODIFY amount DECIMAL(18,2)`);
  }
};

exports.down = async function () {
  // Sengaja no-op: tidak menyempitkan kembali (mencegah kehilangan data).
};
