exports.up = function(knex) {
  return knex.schema.table('ppob_orders', (table) => {
    table.string('sn', 255).nullable().after('status');
  });
};

exports.down = function(knex) {
  return knex.schema.table('ppob_orders', (table) => {
    table.dropColumn('sn');
  });
};
