exports.up = function(knex) {
  return knex.schema.alterTable('ingredients', function(table) {
    table.string('purchase_unit').nullable().comment('Satuan pembelian, cth: Botol, Dus');
    table.decimal('purchase_price', 15, 2).nullable().comment('Harga beli total per purchase_unit');
    table.decimal('conversion_rate', 10, 2).nullable().comment('Jumlah satuan dasar dalam 1 purchase_unit, cth: 1000');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('ingredients', function(table) {
    table.dropColumn('purchase_unit');
    table.dropColumn('purchase_price');
    table.dropColumn('conversion_rate');
  });
};
