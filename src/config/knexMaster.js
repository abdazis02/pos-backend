const knex = require("knex");

const master = knex({
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '+00:00', // 🔥 Pakai UTC (Standard POS)
  },
  pool: {
    min: 2,
    max: 20,
    idleTimeoutMillis: 30000,
  },
});

module.exports = master;
