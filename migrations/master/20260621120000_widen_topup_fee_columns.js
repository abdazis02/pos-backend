/**
 * Pastikan kolom admin_fee & total_amount pada wallet_topups bertipe DECIMAL(18,2).
 * Sebelumnya dibuat lewat knex `.float()` → FLOAT(8,2) (maks 999.999,99), sehingga
 * total_amount (amount + admin_fee) overflow saat topup >= ~Rp1 juta → "server error".
 *
 * Idempoten: tambah kolom bila belum ada, lalu perbesar bila tipenya belum sesuai.
 *
 * @param { import("knex").Knex } knex
 */
const TARGET = 'decimal(18,2)';

async function colType(knex, col) {
  const res = await knex.raw(
    `SELECT COLUMN_TYPE AS t
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'wallet_topups'
        AND COLUMN_NAME = ?`,
    [col]
  );
  const rows = Array.isArray(res) ? res[0] : res;
  return rows && rows[0] ? String(rows[0].t || '').toLowerCase() : null;
}

exports.up = async function (knex) {
  const af = await colType(knex, 'admin_fee');
  if (!af) {
    await knex.raw('ALTER TABLE wallet_topups ADD COLUMN admin_fee DECIMAL(18,2) DEFAULT 0');
  } else if (af !== TARGET) {
    await knex.raw('ALTER TABLE wallet_topups MODIFY admin_fee DECIMAL(18,2) DEFAULT 0');
  }

  const ta = await colType(knex, 'total_amount');
  if (!ta) {
    await knex.raw('ALTER TABLE wallet_topups ADD COLUMN total_amount DECIMAL(18,2)');
  } else if (ta !== TARGET) {
    await knex.raw('ALTER TABLE wallet_topups MODIFY total_amount DECIMAL(18,2)');
  }
};

exports.down = async function () {
  // no-op: tidak menyempitkan kembali (mencegah kehilangan data).
};
