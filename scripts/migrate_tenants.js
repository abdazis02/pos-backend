require("dotenv").config();

const knex = require("knex");
const master = require("../src/config/knexMaster");

async function migrateTenants() {
  try {
    console.log("🚀 Start tenant migrations...");

    const tenants = master("tenants").join("owners", "owners.id", "tenants.owner_id").select("*");

    let rollback = false;
    if (process.argv[2] != null && process.argv[2] == "--rollback") {
      rollback = true
    } else if (process.argv[2] != null && process.argv[2] != "") {
      tenants.where("db_name", process.argv[2]);
    }

    if (!(await tenants).length) {
      console.log("No tenants found");
      return;
    }

    for (const tenant of await tenants) {
      console.log(`Migrating tenant: ${tenant.db_name}`);

      const db = knex({
        client: "mysql2",
        connection: {
          host: process.env.DB_HOST,
          port: process.env.DB_PORT,
          user: process.env.DB_USER,
          password: process.env.DB_PASS,
          database: tenant.db_name,
        },
      });

      try {
        if (rollback) {
          await db.migrate.rollback({
            directory: "./migrations/tenant",
          })
        } else {
          await db.migrate.latest({
            directory: "./migrations/tenant",
          });
        }

        console.log(`✅ Success: ${tenant.business_name}`);
      } catch (err) {
        console.error(`❌ Failed: ${tenant.business_name}`, err.message);
      } finally {
        await db.destroy();
      }
    }

    if (rollback) {
      console.log("🎉 All tenants rollbacked");
    } else {
      console.log("🎉 All tenants migrated");
    }
    process.exit(0);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(1);
  }
}

migrateTenants();
