const bcrypt = require('bcryptjs');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> } 
 */
exports.seed = async function (knex) {
  const hashedPassword = await bcrypt.hash('admin123', 10);

  await knex('users').insert({
    name: 'Superadmin',
    email: 'superadmin@gmail.com',
    password: hashedPassword,
    role: 'superadmin',
    verified_at: knex.fn.now(),
  }).onConflict(['email']).merge(['password', 'name', 'verified_at']);
};
