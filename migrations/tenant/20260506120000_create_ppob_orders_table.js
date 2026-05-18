exports.up = function(knex) {
  return knex.schema.createTable('ppob_orders', (table) => {
    table.increments('id').primary();
    table.integer('store_id').notNullable();
    table.integer('user_id').notNullable();
    table.string('cmd', 100).notNullable();
    table.string('buyer_sku_code', 150).notNullable();
    table.string('customer_no', 100).notNullable();
    table.string('ref_id', 120).notNullable().unique();
    table.string('product_name').nullable();
    table.decimal('price', 16, 2).nullable();
    table.decimal('sale_price', 16, 2).nullable();
    table.enum('status', ['pending', 'success', 'failed']).defaultTo('pending');
    table.text('response').nullable();
    table.timestamp('created_at').defaultTo(knex.fn.now());
    table.timestamp('updated_at').defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('ppob_orders');
};
