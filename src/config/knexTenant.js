const knex = require("knex");

const tenantConnections = {};

function getTenantConnection(tenantConfig) {
  const key = tenantConfig.db_name;

  if (!tenantConnections[key]) {
    tenantConnections[key] = knex({
      client: "mysql2",
      connection: {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: tenantConfig.db_user,
        password: tenantConfig.db_pass,
        database: tenantConfig.db_name,
        timezone: '+09:00', // 🔥 HARDLOCK WIT (+09:00)
      },
      pool: {
        min: 0,
        max: 10,
        afterCreate: (conn, done) => {
          conn.query("SET time_zone='+09:00';", (err) => {
            done(err, conn);
          });
        }
      },
    });
  }

  return tenantConnections[key];
}

module.exports = { getTenantConnection };
