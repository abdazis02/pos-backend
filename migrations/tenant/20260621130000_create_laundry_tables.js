/**
 * Fitur Laundry (Scope C): manajemen pesanan.
 *  - `laundry_orders`      : pesanan (pelanggan, total, status, estimasi, pembayaran).
 *  - `laundry_order_items` : baris layanan (kiloan/satuan).
 *  - kolom `products.sell_unit` : satuan jual layanan (pcs/kg) — default 'pcs'
 *    sehingga TIDAK memengaruhi kategori lain (mereka tetap pcs).
 *
 * Idempoten (hasTable/hasColumn) agar aman dijalankan ulang & untuk tenant baru.
 *
 * @param { import("knex").Knex } knex
 */
exports.up = async function (knex) {
  const hasOrders = await knex.schema.hasTable('laundry_orders');
  if (!hasOrders) {
    await knex.schema.createTable('laundry_orders', (table) => {
      table.increments().primary();
      table.integer('store_id').unsigned().notNullable();
      table.string('order_no', 30);
      table.string('customer_name').notNullable();
      table.string('customer_phone', 30).nullable();
      table.decimal('total', 18, 2).defaultTo(0);
      table.decimal('paid_amount', 18, 2).defaultTo(0);
      table.enum('payment_status', ['unpaid', 'paid']).defaultTo('unpaid');
      table.enum('status', ['diterima', 'dikerjakan', 'selesai', 'diambil', 'batal']).defaultTo('diterima');
      table.dateTime('estimated_done_at').nullable();
      table.dateTime('received_at').nullable();
      table.dateTime('done_at').nullable();
      table.dateTime('picked_up_at').nullable();
      table.text('notes').nullable();
      table.integer('created_by').unsigned().nullable();
      table.timestamps(true, true);
      table.index('store_id');
      table.index('status');
    });
  }

  const hasItems = await knex.schema.hasTable('laundry_order_items');
  if (!hasItems) {
    await knex.schema.createTable('laundry_order_items', (table) => {
      table.increments().primary();
      table.integer('order_id').unsigned().notNullable();
      table.integer('store_id').unsigned().notNullable();
      table.integer('product_id').unsigned().nullable(); // tautan ke produk/layanan (opsional)
      table.string('name').notNullable();
      table.enum('unit', ['pcs', 'kg']).defaultTo('pcs');
      table.decimal('qty', 18, 3).notNullable().defaultTo(0); // pcs atau kg (boleh pecahan)
      table.decimal('price', 18, 2).notNullable().defaultTo(0);
      table.decimal('subtotal', 18, 2).notNullable().defaultTo(0);
      table.timestamps(true, true);
      table.index('order_id');
    });
  }

  // Satuan jual produk (khusus laundry pakai 'kg'; lainnya tetap 'pcs').
  const hasSellUnit = await knex.schema.hasColumn('products', 'sell_unit');
  if (!hasSellUnit) {
    await knex.schema.table('products', (table) => {
      table.enum('sell_unit', ['pcs', 'kg']).defaultTo('pcs');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('laundry_order_items');
  await knex.schema.dropTableIfExists('laundry_orders');
  const hasSellUnit = await knex.schema.hasColumn('products', 'sell_unit');
  if (hasSellUnit) {
    await knex.schema.table('products', (table) => table.dropColumn('sell_unit'));
  }
};
