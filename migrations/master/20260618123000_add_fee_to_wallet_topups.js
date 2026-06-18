/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasAdminFee = await knex.schema.hasColumn('wallet_topups', 'admin_fee');
  const hasTotalAmount = await knex.schema.hasColumn('wallet_topups', 'total_amount');

  if (!hasAdminFee || !hasTotalAmount) {
    await knex.schema.table('wallet_topups', (table) => {
      if (!hasAdminFee) table.float('admin_fee').defaultTo(0);
      if (!hasTotalAmount) table.float('total_amount');
    });
  }

  return knex('wallet_topups')
    .whereNull('total_amount')
    .update({
      admin_fee: knex.raw('COALESCE(admin_fee, 0)'),
      total_amount: knex.raw('amount + COALESCE(admin_fee, 0)'),
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasAdminFee = await knex.schema.hasColumn('wallet_topups', 'admin_fee');
  const hasTotalAmount = await knex.schema.hasColumn('wallet_topups', 'total_amount');

  if (!hasAdminFee && !hasTotalAmount) return;

  return knex.schema.table('wallet_topups', (table) => {
    if (hasAdminFee) table.dropColumn('admin_fee');
    if (hasTotalAmount) table.dropColumn('total_amount');
  });
};
