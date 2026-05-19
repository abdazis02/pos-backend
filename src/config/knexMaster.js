const knex = require("knex");

const master = knex({
  client: "mysql2",
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '+09:00', // 🔥 HARDLOCK WIT (+09:00)
  },
  pool: {
    min: 2,
    max: 20,
    afterCreate: (conn, done) => {
      // Set session timezone to WIT for all connections
      conn.query("SET time_zone='+09:00';", (err) => {
        done(err, conn);
      });
    }
  },
});

module.exports = master;
