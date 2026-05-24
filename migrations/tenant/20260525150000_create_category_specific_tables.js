/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // 1. Tabel Meja (Untuk Restoran & Cafe) - Di Database Tenant
  const hasTables = await knex.schema.hasTable('restaurant_tables');
  if (!hasTables) {
    await knex.schema.createTable('restaurant_tables', (table) => {
      table.increments().primary();
      table.string('table_number', 20).notNullable();
      table.integer('capacity').defaultTo(4);
      table.enum('status', ['available', 'occupied', 'booked']).defaultTo('available');
      table.integer('current_transaction_id').unsigned().nullable();
      table.timestamps(true, true);
    });
  }

  // 2. Tambah link Meja di Tabel Transaksi - Di Database Tenant
  const hasTableId = await knex.schema.hasColumn('transactions', 'table_id');
  if (!hasTableId) {
    await knex.schema.table('transactions', (table) => {
      table.integer('table_id').unsigned().nullable().after('store_id');
    });
  }

  // 3. Tambah link Karyawan (untuk Komisi) di Tabel Transaction Items - Di Database Tenant
  const hasHandledBy = await knex.schema.hasColumn('transaction_items', 'handled_by');
  if (!hasHandledBy) {
    await knex.schema.table('transaction_items', (table) => {
      table.integer('handled_by').unsigned().nullable().after('product_id');
      table.decimal('commission_amount', 15, 2).defaultTo(0.00).after('handled_by');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .dropTableIfExists('restaurant_tables')
    .table('transactions', (table) => table.dropColumn('table_id'))
    .table('transaction_items', (table) => {
        table.dropColumn('handled_by');
        table.dropColumn('commission_amount');
    });
};
