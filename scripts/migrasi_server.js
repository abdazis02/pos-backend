require('dotenv').config();

const knex = require('knex')
const master = require('../src/config/knexMaster')

const tenant_id = process.argv[2] // e.g: kasir_tenant_1

const pool = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_BACKUP_HOST,
    port: process.env.DB_BACKUP_PORT,
    user: process.env.DB_BACKUP_USER,
    password: process.env.DB_BACKUP_PASS,
    database: `kasir_tenant_${tenant_id}`,
  }
})

const getTenantConnection = (tenantConfig) => {
  return knex({
    client: "mysql2",
    connection: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: tenantConfig.db_user,
      password: tenantConfig.db_pass,
      database: tenantConfig.db_name,
    },
  });
}

async function createTenant(id, business_name, email, phone) {
  let db_name, db_user, db_pass;

  const trx = await master.transaction()

  try {
    await trx("owners")
      .insert({ id, business_name, email, phone, status: 'active' })
      .onConflict()
      .ignore();

    db_name = `kasir_tenant_${id}`;
    db_user = `user_${id}`;
    db_pass = require('crypto').randomBytes(16).toString('hex');

    await trx("tenants")
      .insert({ id, owner_id: id, db_name, db_user, db_pass })
      .onConflict()
      .ignore();

    await trx.commit();
  } catch (err) {
    await trx.rollback();

    throw err
  }

  try {

    await master.raw(`DROP USER IF EXISTS '${db_user}'@'%'`);

    await master.raw(`CREATE DATABASE IF NOT EXISTS ??`, [db_name]);
    await master.raw(`CREATE USER '${db_user}'@'%' IDENTIFIED BY '${db_pass}'`);
    await master.raw(`GRANT ALL PRIVILEGES ON \`${db_name}\`.* TO '${db_user}'@'%'`);
    await master.raw(`GRANT SELECT ON \`${process.env.DB_NAME}\`.\`users\` TO '${db_user}'@'%'`);
    await master.raw(`FLUSH PRIVILEGES`);

    const tenant_db = getTenantConnection({ db_name, db_user, db_pass });

    await tenant_db.migrate.latest({ directory: './migrations/tenant' })

    return tenant_db;
  } catch (err) {
    await master("tenants").where({ id: tenant_id }).delete();
    await master("owners").where({ id: owner_id }).delete();

    await master.raw(`DROP DATABASE IF EXISTS ??`, [db_name]);
    await master.raw(`DROP USER IF EXISTS ?@'%'`, [db_user]);

    throw err;
  }
}

async function main() {
  const owner = await pool("owners").first()
  const tenant_db = await createTenant(owner.id, owner.business_name, owner.email, owner.phone)

  const trxMaster = await master.transaction()
  const trxTenant = await tenant_db.transaction()

  try {

    const userMap = {}

    const users = await pool("users").select('*')
    for (const user of users) {
      const [id] = await trxMaster("users").insert({
        tenant_id: tenant_id,
        store_id: user.store_id,
        name: user.name,
        email: user.email,
        password: user.password,
        role: user.role,
        is_active: user.is_active,
        verified_at: trxMaster.fn.now(),
        created_at: user.created_at,
      }).onConflict().ignore()
      userMap[user.id] = id
    }
    console.log("Selesai migrasi user")

    const stores_query = []
    const stores = await pool("stores").select('*')
    for (const store of stores) {
      delete store.owner_id
      delete store.business_name
      delete store.receipt_template

      stores_query.push(trxTenant("stores").insert(store).onConflict().ignore())
    }
    await Promise.all(stores_query)
    console.log("Selesai migrasi stores")

    const products_query = []
    const products = await pool("products").select('*')
    for (const product of products) {
      product.discount_type = product.jenis_diskon
      product.discount_value = product.nilai_diskon
      product.discount_bundle_min_qty = product.diskon_bundle_min_qty
      product.discount_bundle_value = product.diskon_bundle_value
      delete product.jenis_diskon
      delete product.nilai_diskon
      delete product.diskon_bundle_min_qty
      delete product.diskon_bundle_value

      products_query.push(trxTenant("products").insert(product).onConflict().ignore())
    }
    await Promise.all(products_query)
    console.log("Selesai migrasi produk")

    const productsMap = products.reduce((a, b) => {
      a[b.id] = b
      return a
    }, {})

    const transactions_query = []
    const transactions = await pool("transactions").select('*')
    for (const transaction of transactions) {
      transactions_query.push(trxTenant("transactions").insert({
        id: transaction.id,
        store_id: transaction.store_id,
        user_id: userMap[transaction.user_id],
        total_cost: transaction.total_cost,
        payment_method: transaction.payment_method,
        received_amount: transaction.received_amount,
        change_amount: transaction.change_amount,
        customer_name: transaction.customer_name,
        customer_phone: transaction.customer_phone,
        payment_status: transaction.payment_status,
        subtotal: transaction.subtotal,
        discount_total: transaction.discount_total,
        tax: transaction.tax,
        tax_percentage: transaction.tax_percentage,
        created_at: transaction.created_at,
        updated_at: transaction.updated_at
      }).onConflict().ignore())
    }
    await Promise.all(transactions_query);
    console.log("Selesai migrasi transaksi")

    const transaction_items_query = []
    const transaction_items = await pool("transaction_items").select('*')
    for (const ti of transaction_items) {
      if (!ti.product_id) continue

      transaction_items_query.push(trxTenant("transaction_items").insert({
        id: ti.id,
        transaction_id: ti.transaction_id,
        product_id: ti.product_id,
        product_name: ti.product_name,
        sku: ti.sku,
        price: ti.price,
        cost_price: ti.cost_price,
        discount_type: ti.discount_type,
        discount_value: ti.discount_value,
        discount_bundle_min_qty: ti.diskon_bundle_min_qty ?? productsMap[ti.product_id]?.discount_bundle_min_qty,
        discount_bundle_value: ti.diskon_bundle_value ?? productsMap[ti.product_id]?.discount_bundle_value,
        buy_qty: productsMap[ti.product_id]?.buy_qty,
        free_qty: productsMap[ti.product_id]?.free_qty,
        qty: ti.qty,
        discount_amount: ti.discount_amount,
        subtotal: ti.subtotal,
        notes: ti.notes,
      }).onConflict().ignore())
    }
    await Promise.all(transaction_items_query)
    console.log("Selesai migrasi detail transaksi")

    const reports_daily_query = []
    const reports_daily = await pool("reports_daily").select('*')
    for (const rd of reports_daily) {
      reports_daily_query.push(trxTenant("daily_reports").insert(rd).onConflict().ignore())
    }
    await Promise.all(reports_daily_query)
    console.log("Selesai migrasi laporan harian")

    await trxMaster.commit()
    await trxTenant.commit()

    console.log('Selesai semua berhasil') // belum beres euy masih salah jam nya!!
  } catch (e) {
    console.log(e)

    await trxMaster.rollback()
    await trxTenant.rollback()
  } finally {
    await pool.destroy()
    await master.destroy()
    await tenant_db.destroy()
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1))