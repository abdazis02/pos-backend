const { getTenantConnection } = require('../src/config/db');
const owners = require('../src/models/owners'); // Pastikan model ini ada dan bisa ambil semua tenant
const jwt = require('jsonwebtoken');
const axios = require('axios');
const moment = require('moment');

// Fungsi utama generate laporan harian untuk semua tenant & store
async function generateAllDailyReports() {
  const allTenants = await owners.getAllTenants(); // Harus return array { db_name }
  const today = moment().format('YYYY-MM-DD');

  for (const tenant of allTenants) {
    const dbName = tenant.db_name;
    const conn = await getTenantConnection(dbName);
    try {
      const [stores] = await conn.query('SELECT id FROM stores');
      for (const store of stores) {
        // Panggil langsung logic generateDailyReport (bisa refactor ke service)
        // Atau, jika pakai endpoint, gunakan axios/fetch ke endpoint internal
        await conn.query(
          `INSERT IGNORE INTO reports_daily 
          (store_id, report_date, total_transactions, total_income, total_discount, net_revenue, total_hpp, gross_profit, operational_cost, net_profit, margin, best_sales_day, lowest_sales_day, avg_daily)
          SELECT ?, ?, 
            COUNT(*), 
            COALESCE(SUM(total_cost),0), 
            0,
            COALESCE(SUM(total_cost),0),
            IFNULL((SELECT SUM(p.cost_price * ti.qty)
                    FROM transaction_items ti
                    JOIN products p ON ti.product_id = p.id
                    JOIN transactions t2 ON ti.transaction_id = t2.id
                    WHERE t2.store_id = ? AND DATE(t2.created_at) = ?), 0),
            0, 0, 0, '0%', 
            COALESCE(SUM(total_cost),0), 
            COALESCE(SUM(total_cost),0), 
            COALESCE(SUM(total_cost),0)
          FROM transactions
          WHERE store_id = ? AND DATE(created_at) = ?`,
          [store.id, today, store.id, today, store.id, today, store.id, today]
        );
      }
    } finally {
      await conn.end();
    }
  }
}

// Jalankan dengan node-cron, pm2, atau scheduler lain
if (require.main === module) {
  generateAllDailyReports()
    .then(() => {
      console.log('Generate laporan harian otomatis selesai.');
      process.exit(0);
    })
    .catch(err => {
      console.error('Gagal generate laporan harian otomatis:', err);
      process.exit(1);
    });
}