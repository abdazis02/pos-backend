const response = require('../utils/response');
const ActivityLogModel = require('../models/activityLog.model');

const ReportController = {
  async summary(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end, payment_method, timezone } = req.query;

      // 🔥 STANDARISASI: Database (TIMESTAMP) adalah UTC (+00:00).
      // Kita konversi ke Timezone HP user untuk memfilter Tanggal yang pas.
      const baseTz = "+00:00";
      const targetTz = timezone || "+09:00";

      console.log(`🔍 [REPORT SYNC] Store: ${store_id} | Range: ${start} to ${end} | TZ: ${targetTz}`);

      // 1. KASIR SUMMARY (POS)
      const cashSummaryQuery = req.db("transactions").where({ store_id })
        .whereRaw(`DATE(CONVERT_TZ(created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
        .select(req.db.raw('COUNT(*) as total_transaksi'))
        .select(req.db.raw('CAST(SUM(total_cost) AS DECIMAL(18,2)) AS total_pendapatan'))
        .select(req.db.raw('CAST(SUM(discount_total) AS DECIMAL(18,2)) AS total_diskon'))
        .first();

      if (payment_method == 'cash' || payment_method == 'qris') {
        cashSummaryQuery.where({ payment_method });
      }

      // HPP POS
      const hppRowsQuery = req.db("transaction_items as ti").where('t.store_id', store_id)
        .whereRaw(`DATE(CONVERT_TZ(t.created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(t.created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
        .join("transactions as t", "t.id", "ti.transaction_id")
        .select(req.db.raw('COALESCE(SUM(ti.cost_price * ti.qty), 0) AS total_hpp'))
        .first();

      // Statistik harian POS
      const dailyStatsQuery = req.db("transactions").where({ store_id })
        .whereRaw(`DATE(CONVERT_TZ(created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
        .select(req.db.raw(`DATE(CONVERT_TZ(created_at, ?, ?)) as day`, [baseTz, targetTz]))
        .select(req.db.raw('SUM(total_cost) as total'))
        .groupBy('day');

      // Top produk POS
      const topProductsQuery = req.db("transaction_items as ti").where('t.store_id', store_id)
        .whereRaw(`DATE(CONVERT_TZ(t.created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(t.created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
        .join("products as p", "p.id", "ti.product_id")
        .join("transactions as t", "t.id", "ti.transaction_id")
        .select('ti.product_id')
        .select('p.sku')
        .select('p.name')
        .select(req.db.raw('SUM(ti.qty) as sold'))
        .select(req.db.raw('SUM(ti.qty * ti.price) as revenue'))
        .groupBy('ti.product_id', 'p.sku', 'p.name')
        .orderBy('sold', 'desc')
        .limit(10);

      // Stok menipis
      const stokMenipisQuery = req.db("products").where({ store_id })
        .select('id', 'name', 'stock as remaining')
        .where('stock', '<=', 5);

      // 2. PPOB SUMMARY (Safe Fetch)
      let ppobSummaryData = { total_transaksi: 0, total_pendapatan: 0, total_profit: 0, total_hpp: 0 };
      let ppobDaily = [];

      try {
        const hasPpobTable = await req.db.schema.hasTable('ppob_orders');
        if (hasPpobTable) {
          const pSum = await req.db("ppob_orders").where({ store_id, status: 'success' })
            .whereRaw(`DATE(CONVERT_TZ(created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
            .select(req.db.raw('COUNT(*) as total_transaksi'))
            .select(req.db.raw('COALESCE(SUM(sale_price), 0) AS total_pendapatan'))
            .select(req.db.raw('COALESCE(SUM(price), 0) AS total_hpp'))
            .select(req.db.raw('COALESCE(SUM(sale_price - price), 0) AS total_profit'))
            .first();

          if (pSum) {
            ppobSummaryData = {
              total_transaksi: Number(pSum.total_transaksi) || 0,
              total_pendapatan: parseFloat(pSum.total_pendapatan) || 0,
              total_profit: parseFloat(pSum.total_profit) || 0,
              total_hpp: parseFloat(pSum.total_hpp) || 0
            };
          }

          ppobDaily = await req.db("ppob_orders").where({ store_id, status: 'success' })
            .whereRaw(`DATE(CONVERT_TZ(created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
            .select(req.db.raw(`DATE(CONVERT_TZ(created_at, ?, ?)) as day`, [baseTz, targetTz]))
            .select(req.db.raw('SUM(sale_price) as total'))
            .groupBy('day');
        }
      } catch (e) {
        console.warn("PPOB Data Fetch Skip:", e.message);
      }

      // 🔥 3. RECENT ACTIVITIES (FIX WAKTU: Kirim format string agar tidak bergeser di HP)
      const recentTransactions = await req.db("transactions").where({ store_id, payment_status: 'paid' })
        .whereRaw(`DATE(CONVERT_TZ(created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
        .select(req.db.raw(`DATE_FORMAT(CONVERT_TZ(created_at, ?, ?), '%Y-%m-%d %H:%i:%s') as created_at`, [baseTz, targetTz]))
        .select(req.db.raw('"POS" as source'), 'payment_method as type', 'total_cost as amount')
        .orderBy('created_at', 'desc')
        .limit(15);

      let recentPpob = [];
      try {
        if (await req.db.schema.hasTable('ppob_orders')) {
          recentPpob = await req.db("ppob_orders").where({ store_id, status: 'success' })
            .whereRaw(`DATE(CONVERT_TZ(created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
            .select(req.db.raw(`DATE_FORMAT(CONVERT_TZ(created_at, ?, ?), '%Y-%m-%d %H:%i:%s') as created_at`, [baseTz, targetTz]))
            .select(req.db.raw('"PPOB" as source'), 'buyer_sku_code as type', 'sale_price as amount')
            .orderBy('created_at', 'desc')
            .limit(15);
        }
      } catch (e) {}

      const combinedRecent = [...recentTransactions, ...recentPpob]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 15);

      // 4. EXECUTE ALL QUERIES
      const [cashSummary, hppRows, dailyStats, topProducts, stokMenipis] = await Promise.all([
        cashSummaryQuery,
        hppRowsQuery,
        dailyStatsQuery,
        topProductsQuery,
        stokMenipisQuery
      ]);

      const total_transaksi = (Number(cashSummary.total_transaksi) || 0) + ppobSummaryData.total_transaksi;
      const income_pos = parseFloat(cashSummary.total_pendapatan) || 0;
      const total_pendapatan = income_pos + ppobSummaryData.total_pendapatan;
      const total_diskon = parseFloat(cashSummary.total_diskon) || 0;
      const hpp_pos = parseFloat(hppRows.total_hpp) || 0;
      const total_hpp = hpp_pos + ppobSummaryData.total_hpp;

      const combinedDailyMap = {};
      (dailyStats || []).forEach(d => {
        const dStr = d.day instanceof Date ? d.day.toISOString().split('T')[0] : String(d.day);
        combinedDailyMap[dStr] = (combinedDailyMap[dStr] || 0) + Number(d.total);
      });
      (ppobDaily || []).forEach(d => {
        const dStr = d.day instanceof Date ? d.day.toISOString().split('T')[0] : String(d.day);
        combinedDailyMap[dStr] = (combinedDailyMap[dStr] || 0) + Number(d.total);
      });

      const finalDailyStats = Object.keys(combinedDailyMap).map(day => ({
        day,
        total: combinedDailyMap[day]
      })).sort((a, b) => a.day.localeCompare(b.day));

      const dailyValues = finalDailyStats.map(r => Number(r.total));
      const bestValue = dailyValues.length ? Math.max(...dailyValues) : 0;
      const lowestValue = dailyValues.length ? Math.min(...dailyValues) : 0;

      const net_revenue = total_pendapatan - total_diskon;
      const gross_profit = net_revenue - total_hpp;
      const marginValue = net_revenue > 0 ? (gross_profit / net_revenue) * 100 : 0;

      return response.success(res, {
        total_transaksi,
        total_pendapatan,
        total_diskon,
        net_revenue,
        total_hpp,
        gross_profit,
        operational_cost: 0,
        net_profit: gross_profit,
        margin: `${marginValue.toFixed(2)}%`,
        best_sales_day: bestValue,
        lowest_sales_day: lowestValue,
        avg_daily: dailyValues.length ? Math.round(total_pendapatan / dailyValues.length) : 0,
        daily_list: finalDailyStats,
        top_products: topProducts,
        stok_menipis: stokMenipis,
        recent_activities: combinedRecent
      });
    } catch (error) {
      console.error("❌ Summary Report Error:", error);
      return response.error(res, error, 'Gagal mengambil laporan summary');
    }
  },

  async products(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end, timezone } = req.query;
      const baseTz = "+00:00";
      const targetTz = timezone || "+09:00";

      const productsCount = await req.db("products").count({ total: '*' }).where({ store_id }).first();

      let totalSold = 0;
      if (start && end) {
        const sold = await req.db("transaction_items as ti")
          .join("transactions as t", "t.id", "ti.transaction_id")
          .select(req.db.raw("SUM(COALESCE(ti.qty, 0)) as total"))
          .whereRaw(`DATE(CONVERT_TZ(t.created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(t.created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
          .where('t.store_id', store_id)
          .first();
        totalSold = parseInt(sold.total || 0);
      }

      const topProducts = await req.db("transaction_items as ti")
        .select(req.db.raw('ti.product_id, p.sku, p.name, CAST(SUM(ti.qty) AS SIGNED) AS sold, CAST(SUM(ti.qty * ti.price) AS DECIMAL(18,2)) AS revenue'))
        .join("products as p", "p.id", "ti.product_id")
        .join("transactions as t", "t.id", "ti.transaction_id")
        .where('t.store_id', store_id)
        .whereRaw(`DATE(CONVERT_TZ(t.created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(t.created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end])
        .groupBy(['ti.product_id', 'p.sku', 'p.name'])
        .orderBy('sold', 'desc')
        .limit(10);

      const stokMenipis = await req.db("products")
        .select(['id', 'name', 'stock as remaining'])
        .where({ store_id })
        .where('stock', '>', 0)
        .where('stock', '<=', 5);

      const stokHabis = await req.db("products")
        .where({ store_id, stock: 0 })
        .count({ total: '*' })
        .first();

      return response.success(res, {
        total_products: productsCount.total,
        total_sold: totalSold,
        top_products: topProducts,
        stok_menipis: stokMenipis,
        stok_habis: stokHabis.total
      });
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil laporan produk');
    }
  },

  async cashiers(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end, timezone } = req.query;
      const baseTz = "+00:00";
      const targetTz = timezone || "+09:00";

      const cashierQuery = req.db(process.env.DB_NAME + ".users as u")
        .select([
          'u.id',
          'u.name',
          'u.role',
          req.db.raw('COUNT(t.id) as total_transaksi'),
          req.db.raw('SUM(COALESCE(t.total_cost, 0)) as total_penjualan'),
        ])
        .leftJoin("transactions as t", "u.id", "t.user_id")
        .where('u.role', 'cashier')
        .where('u.store_id', store_id)
        .groupBy(['u.id', 'u.name', 'u.role']);

      if (start && end) {
        cashierQuery.whereRaw(`DATE(CONVERT_TZ(t.created_at, ?, ?)) >= ? AND DATE(CONVERT_TZ(t.created_at, ?, ?)) <= ?`, [baseTz, targetTz, start, baseTz, targetTz, end]);
      }

      const totalKaryawan = await req.db(process.env.DB_NAME + ".users")
        .where({ store_id, role: 'cashier' })
        .count({ total: '*' })
        .first();

      const cashierStats = await cashierQuery;
      let avgPerformance = 0;
      if (cashierStats?.length > 0) {
        avgPerformance = Math.round(
          cashierStats.reduce((a, b) => a + parseInt(b.total_transaksi || 0), 0) / cashierStats.length
        );
      }

      return response.success(res, {
        total_karyawan: totalKaryawan.total,
        avg_performance: avgPerformance,
        avg_attendance: 100,
        cashiers: cashierStats
      });
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil laporan kasir');
    }
  },

  async generateDailyReport(req, res) {
    try {
      const { store_id } = req.params;
      const { date, timezone } = req.query;
      const baseTz = "+00:00";
      const targetTz = timezone || "+09:00";

      if (!date) return response.badRequest(res, 'Tanggal laporan wajib diisi.');

      const [exist] = await req.db.raw(`SELECT id FROM daily_reports WHERE store_id = ? AND report_date = ?`, [store_id, date]);
      if (exist.length > 0) return response.badRequest(res, 'Laporan harian sudah ada untuk tanggal ini.');

      const [summary] = await req.db.raw(
        `SELECT COUNT(*) AS total_transaksi, COALESCE(SUM(total_cost),0) AS total_pendapatan, COALESCE(SUM(discount_total),0) AS total_diskon
         FROM transactions WHERE store_id = ? AND DATE(CONVERT_TZ(created_at, ?, ?)) = ?`,
        [store_id, baseTz, targetTz, date]
      );

      const [hppRows] = await req.db.raw(
        `SELECT COALESCE(SUM(ti.cost_price * ti.qty), 0) AS total_hpp
         FROM transaction_items ti JOIN transactions t ON ti.transaction_id = t.id
         WHERE t.store_id = ? AND DATE(CONVERT_TZ(t.created_at, ?, ?)) = ?`,
        [store_id, baseTz, targetTz, date]
      );

      const total_hpp = Number(hppRows[0].total_hpp) || 0;
      const total_pendapatan = Number(summary[0].total_pendapatan) || 0;
      const total_diskon = Number(summary[0].total_diskon) || 0;
      const net_revenue = total_pendapatan - total_diskon;
      const gross_profit = net_revenue - total_hpp;
      const marginValue = net_revenue > 0 ? (gross_profit / net_revenue) * 100 : 0;

      await req.db.raw(
        `INSERT INTO daily_reports 
        (store_id, report_date, total_transactions, total_income, total_discount, net_revenue, total_hpp, gross_profit, operational_cost, net_profit, margin, best_sales_day, lowest_sales_day, avg_daily)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          store_id, date, summary[0].total_transaksi, total_pendapatan, total_diskon,
          net_revenue, total_hpp, gross_profit, 0, gross_profit, `${marginValue.toFixed(2)}%`,
          total_pendapatan, total_pendapatan, total_pendapatan
        ]
      );

      return response.success(res, { message: 'Laporan harian berhasil disimpan.' });
    } catch (err) {
      return response.error(res, err, 'Gagal generate laporan harian');
    }
  },

  async getDailyReport(req, res) {
    try {
      const { store_id } = req.params;
      const { date } = req.query;
      const [rows] = await req.db.raw(`SELECT * FROM daily_reports WHERE store_id = ? AND report_date = ?`, [store_id, date]);
      if (rows.length === 0) return response.notFound(res, 'Laporan harian tidak ditemukan.');
      return response.success(res, rows[0]);
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil laporan harian');
    }
  },

  async listDailyReports(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end } = req.query;
      const [rows] = await req.db.raw(`SELECT * FROM daily_reports WHERE store_id = ? AND report_date BETWEEN ? AND ? ORDER BY report_date ASC`, [store_id, start, end]);
      return response.success(res, { items: rows });
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil list laporan harian');
    }
  },

  async periodicReport(req, res) {
    try {
      const { store_id } = req.params;
      const { type, start, end } = req.query;
      let groupBy = type === 'weekly' ? 'YEAR(report_date), WEEK(report_date)' : type === 'monthly' ? 'YEAR(report_date), MONTH(report_date)' : 'YEAR(report_date)';
      const [rows] = await req.db.raw(
        `SELECT MIN(report_date) as period_start, MAX(report_date) as period_end, SUM(total_transactions) as total_transactions, SUM(total_income) as total_income, SUM(total_discount) as total_discount, SUM(net_revenue) as net_revenue, SUM(total_hpp) as total_hpp, SUM(gross_profit) as gross_profit, SUM(operational_cost) as operational_cost, SUM(net_profit) as net_profit
        FROM daily_reports WHERE store_id = ? AND report_date BETWEEN ? AND ? GROUP BY ${groupBy} ORDER BY period_start ASC`,
        [store_id, start, end]
      );
      return response.success(res, rows);
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil laporan periodik');
    }
  },
};

module.exports = ReportController;
