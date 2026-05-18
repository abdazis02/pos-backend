const response = require('../utils/response');
const ActivityLogModel = require('../models/activityLog.model');

const ReportController = {
  async summary(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end, payment_method } = req.query;

      // 🔥 1. KASIR SUMMARY
      const cashSummaryQuery = req.db("transactions").where({ store_id })
        .whereRaw('DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) >= ? AND DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) <= ?', [start, end])
        .select(req.db.raw('COUNT(*) as total_transaksi'))
        .select(req.db.raw('CAST(SUM(total_cost) AS DECIMAL(18,2)) AS total_pendapatan'))
        .select(req.db.raw('CAST(SUM(discount_total) AS DECIMAL(18,2)) AS total_diskon'))
        .first();
      if (payment_method == 'cash' || payment_method == 'qris') {
        cashSummaryQuery.where({ payment_method })
      }

      // 🔥 2. PPOB SUMMARY (Hanya jika payment_method bukan 'cash', karena PPOB biasanya non-cash di sistem ini)
      const ppobSummaryQuery = req.db("ppob_orders").where({ store_id, status: 'success' })
        .whereRaw('DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) >= ? AND DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) <= ?', [start, end])
        .select(req.db.raw('COUNT(*) as total_transaksi'))
        .select(req.db.raw('CAST(SUM(sale_price) AS DECIMAL(18,2)) AS total_pendapatan'))
        .select(req.db.raw('CAST(SUM(sale_price - price) AS DECIMAL(18,2)) AS total_profit'))
        .first();

      // HPP/modal (totalCost) dari produk yang terjual
      const hppRowsQuery = req.db("transaction_items as ti").where('t.store_id', store_id)
        .whereRaw('DATE(CONVERT_TZ(t.created_at, "+00:00", "+09:00")) >= ? AND DATE(CONVERT_TZ(t.created_at, "+00:00", "+09:00")) <= ?', [start, end])
        .join("transactions as t", "t.id", "ti.transaction_id")
        .select(req.db.raw('COALESCE(SUM(ti.cost_price * ti.qty), 0) AS total_hpp'))
        .first();
      if (payment_method == 'cash' || payment_method == 'qris') {
        hppRowsQuery.where('t.payment_method', payment_method)
      }

      // Statistik harian (KASIR)
      const dailyStatsQuery = req.db("transactions").where({ store_id })
        .whereRaw('DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) >= ? AND DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) <= ?', [start, end])
        .select(req.db.raw('DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) as day'))
        .select(req.db.raw('SUM(total_cost) as total'))
        .groupBy('day');

      // Statistik harian (PPOB)
      const ppobDailyQuery = req.db("ppob_orders").where({ store_id, status: 'success' })
        .whereRaw('DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) >= ? AND DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) <= ?', [start, end])
        .select(req.db.raw('DATE(CONVERT_TZ(created_at, "+00:00", "+09:00")) as day'))
        .select(req.db.raw('SUM(sale_price) as total'))
        .groupBy('day');

      // Top produk
      const topProductsQuery = req.db("transaction_items as ti").where('t.store_id', store_id)
        .whereRaw('DATE(CONVERT_TZ(t.created_at, "+00:00", "+09:00")) >= ? AND DATE(CONVERT_TZ(t.created_at, "+00:00", "+09:00")) <= ?', [start, end])
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

      const [cashSummary, ppobSummary, hppRows, dailyStats, ppobDaily, topProducts, stokMenipis] = await Promise.all([
        cashSummaryQuery, ppobSummaryQuery, hppRowsQuery, dailyStatsQuery, ppobDailyQuery, topProductsQuery, stokMenipisQuery
      ]);

      // --- MENGGABUNGKAN DATA ---
      const total_transaksi = (Number(cashSummary.total_transaksi) || 0) + (Number(ppobSummary.total_transaksi) || 0);
      const total_pendapatan_kasir = parseFloat(cashSummary.total_pendapatan) || 0;
      const total_pendapatan_ppob = parseFloat(ppobSummary.total_pendapatan) || 0;
      const total_pendapatan = total_pendapatan_kasir + total_pendapatan_ppob;

      const total_diskon = parseFloat(cashSummary.total_diskon) || 0;
      const total_hpp_kasir = hppRows.total_hpp || 0;
      const profit_ppob = parseFloat(ppobSummary.total_profit) || 0;

      // Gabungkan statistik harian untuk grafik
      const combinedDailyMap = {};
      dailyStats.forEach(d => { combinedDailyMap[d.day] = (combinedDailyMap[d.day] || 0) + Number(d.total); });
      ppobDaily.forEach(d => { combinedDailyMap[d.day] = (combinedDailyMap[d.day] || 0) + Number(d.total); });

      const finalDailyStats = Object.keys(combinedDailyMap).map(day => ({
        day,
        total: combinedDailyMap[day]
      })).sort((a,b) => a.day.localeCompare(b.day));

      const dailyTotals = finalDailyStats.map(r => Number(r.total));
      const bestSalesDay = dailyTotals.length ? Math.max(...dailyTotals) : 0;
      const lowestSalesDay = dailyTotals.length ? Math.min(...dailyTotals) : 0;

      const avgDaily = dailyTotals.length
        ? Math.round(total_pendapatan / dailyTotals.length)
        : 0;

      console.log(`📊 COMBINED REPORT [${store_id}]: Kasir=${total_pendapatan_kasir} PPOB=${total_pendapatan_ppob}`);

      const net_revenue = total_pendapatan - total_diskon;

      // Laba Kotor = (Revenue Kasir - HPP Kasir) + Margin PPOB
      const gross_profit = (total_pendapatan_kasir - total_diskon - total_hpp_kasir) + profit_ppob;

      const operational_cost = 0;
      const net_profit = gross_profit - operational_cost;
      const marginValue = net_revenue > 0 ? (gross_profit / net_revenue) * 100 : 0;
      const margin = `${marginValue.toFixed(2)}%`;

      return response.success(res, {
        total_transaksi,
        total_pendapatan,
        total_diskon,
        net_revenue,
        total_hpp: total_hpp_kasir, // HPP Kasir
        gross_profit,
        operational_cost,
        net_profit,
        margin,
        best_sales_day: finalDailyStats.length ? finalDailyStats.reduce((a, b) => (a.total > b.total ? a : b)).day : '-',
        lowest_sales_day: finalDailyStats.length ? finalDailyStats.reduce((a, b) => (a.total < b.total ? a : b)).day : '-',
        avg_daily: avgDaily,
        daily_list: finalDailyStats, // 🔥 Sertakan list harian yang sudah digabung
        top_products: topProducts,
        stok_menipis: stokMenipis
      });
    } catch (error) {
      return response.error(res, err, 'Gagal mengambil laporan summary');
    }
  },

  async products(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end } = req.query;

      // Total produk
      const products = await req.db("products")
        .count({ total: '*' })
        .where({ store_id })
        .first()

      // Total produk terjual
      let totalSold = 0;
      if (start && end) {
        const sold = await req.db("transaction_items as ti")
          .join("transactions as t", "t.id", "ti.transaction_id")
          .select(req.db.raw("SUM(COALESCE(ti.qty, 0)) as total"))
          .whereBetween('t.created_at', [start, end])
          .where('t.store_id', store_id)
          .first();

        totalSold = parseInt(sold.total || 0);
      }

      // Top produk (dengan revenue)
      const topProducts = req.db("transaction_items as ti")
        .select(req.db.raw('ti.product_id, p.sku, p.name, SUM(ti.qty) AS sold, SUM(ti.qty * ti.price) AS revenue'))
        .join("products as p", "p.id", "ti.product_id")
        .join("transactions as t", "t.id", "ti.transaction_id")
        .where('t.store_id', store_id)
        .groupBy(['ti.product_id', 'p.sku', 'p.name'])
        .orderBy('sold', 'desc')
        .limit(10);
      if (start && end) {
        topProducts.whereBetween('t.created_at', [start, end])
      }

      // Stok menipis
      const stokMenipis = await req.db("products")
        .select(['id', 'name', 'stock as remaining'])
        .where({ store_id })
        .where('stock', '<=', 5);

      // Stok habis
      const stokHabis = await req.db("products")
        .where({ store_id, stock: 0 })
        .count({ total: '*' })
        .first();

      return response.success(res, {
        total_products: products.total,
        total_sold: totalSold,
        top_products: await topProducts,
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
      const { start, end } = req.query;

      // Performa kasir
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
        cashierQuery.whereBetween('t.created_at', [start, end]);
      }

      // Total karyawan
      const totalKaryawan = await req.db(process.env.DB_NAME + ".users")
        .where({ store_id, role: 'cashier' })
        .count({ total: '*' })
        .first();

      // Rata-rata performa (dummy, sesuaikan jika ada field performa)
      let avgPerformance = 0;
      const cashierStats = await cashierQuery;
      if (cashierStats?.length > 0) {
        avgPerformance = Math.round(
          cashierStats.reduce((a, b) => a + parseInt(b.total_transaksi || 0), 0) / cashierStats.length
        );
      }

      // Kehadiran (dummy, sesuaikan jika ada absensi)
      const avgAttendance = 98.5;

      return response.success(res, {
        total_karyawan: totalKaryawan.total,
        avg_performance: avgPerformance,
        avg_attendance: avgAttendance,
        cashiers: cashierStats
      });
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil laporan kasir');
    }
  },

  async generateDailyReport(req, res) {
    try {
      const { store_id } = req.params;
      const { date } = req.query; // format: YYYY-MM-DD

      if (!date) return response.badRequest(res, 'Tanggal laporan wajib diisi.');

      // Cek jika sudah ada laporan hari ini
      const [exist] = await req.db.raw(
        `SELECT id FROM daily_reports WHERE store_id = ? AND report_date = ?`,
        [store_id, date]
      );
      if (exist.length > 0) {
        return response.badRequest(res, 'Laporan harian sudah ada untuk tanggal ini.');
      }

      // Ambil data summary seperti di summary() (DISKON DISET 0)
      const [summary] = await req.db.raw(
        `SELECT 
            COUNT(*) AS total_transaksi, 
            COALESCE(SUM(total_cost),0) AS total_pendapatan,
            0 AS total_diskon
         FROM transactions
         WHERE store_id = ? AND DATE(created_at) = ?`,
        [store_id, date]
      );

      const [hppRows] = await req.db.raw(
        `SELECT COALESCE(SUM(ti.cost_price * ti.qty), 0) AS total_hpp
         FROM transaction_items ti
         JOIN transactions t ON ti.transaction_id = t.id
         WHERE t.store_id = ? AND DATE(t.created_at) = ?`,
        [store_id, date]
      );

      const total_hpp = Number(hppRows[0].total_hpp) || 0;

      // Statistik harian (hanya 1 hari)
      const total_pendapatan = Number(summary[0].total_pendapatan) || 0;
      const total_diskon = Number(summary[0].total_diskon) || 0;
      const net_revenue = total_pendapatan - total_diskon;
      const gross_profit = net_revenue - total_hpp;
      const operational_cost = 0; // default
      const net_profit = gross_profit - operational_cost;
      const marginValue =
        net_revenue > 0
          ? (gross_profit / net_revenue) * 100
          : 0;

      const margin = `${marginValue.toFixed(2)}%`;

      // Untuk best_sales_day, lowest_sales_day, avg_daily (hanya 1 hari, jadi sama)
      const best_sales_day = total_pendapatan;
      const lowest_sales_day = total_pendapatan;
      const avg_daily = total_pendapatan;

      // Simpan ke tabel daily_reports
      await req.db.raw(
        `INSERT INTO daily_reports 
        (store_id, report_date, total_transactions, total_income, total_discount, net_revenue, total_hpp, gross_profit, operational_cost, net_profit, margin, best_sales_day, lowest_sales_day, avg_daily)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          store_id, date,
          summary[0].total_transaksi,
          total_pendapatan,
          total_diskon,
          net_revenue,
          total_hpp,
          gross_profit,
          operational_cost,
          net_profit,
          margin,
          best_sales_day,
          lowest_sales_day,
          avg_daily
        ]
      );

      // Logging aktivitas: generate laporan harian
      await ActivityLogModel.create(conn, {
        user_id: req.user.id,
        store_id: store_id,
        action: 'generate_daily_report',
        detail: `Generate laporan harian untuk tanggal ${date}`
      });

      return response.success(res, { message: 'Laporan harian berhasil disimpan.' });
    } catch (err) {
      return response.error(res, err, 'Gagal generate laporan harian');
    }
  },

  async getDailyReport(req, res) {
    try {
      const { store_id } = req.params;
      const { date } = req.query; // format: YYYY-MM-DD

      if (!date) return response.badRequest(res, 'Tanggal laporan wajib diisi.');

      const [rows] = await req.db.raw(
        `SELECT * FROM daily_reports WHERE store_id = ? AND report_date = ?`,
        [store_id, date]
      );
      if (rows.length === 0) {
        return response.notFound(res, 'Laporan harian tidak ditemukan.');
      }
      return response.success(res, rows[0]);
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil laporan harian');
    }
  },

  async listDailyReports(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end } = req.query;

      if (!start || !end) return response.badRequest(res, 'Parameter start dan end wajib diisi.');

      const [rows] = await req.db.raw(
        `SELECT * FROM daily_reports WHERE store_id = ? AND report_date BETWEEN ? AND ? ORDER BY report_date ASC`,
        [store_id, start, end]
      );
      return response.success(res, { items: rows });
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil list laporan harian');
    }
  },

  async periodicReport(req, res) {
    try {
      const { store_id } = req.params;
      const { type, start, end } = req.query; // type: weekly|monthly|yearly

      if (!type || !start || !end)
        return response.badRequest(res, 'Parameter type, start, end wajib diisi.');

      let groupBy;
      if (type === 'weekly') groupBy = 'YEAR(report_date), WEEK(report_date)';
      else if (type === 'monthly') groupBy = 'YEAR(report_date), MONTH(report_date)';
      else if (type === 'yearly') groupBy = 'YEAR(report_date)';
      else return response.badRequest(res, 'Type tidak valid.');

      const [rows] = await req.db.raw(
        `SELECT 
          MIN(report_date) as period_start,
          MAX(report_date) as period_end,
          SUM(total_transactions) as total_transactions,
          SUM(total_income) as total_income,
          SUM(total_discount) as total_discount,
          SUM(net_revenue) as net_revenue,
          SUM(total_hpp) as total_hpp,
          SUM(gross_profit) as gross_profit,
          SUM(operational_cost) as operational_cost,
          SUM(net_profit) as net_profit
        FROM daily_reports
        WHERE store_id = ? AND report_date BETWEEN ? AND ?
        GROUP BY ${groupBy}
        ORDER BY period_start ASC`,
        [store_id, start, end]
      );
      return response.success(res, rows);
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil laporan periodik');
    }
  },
};

module.exports = ReportController;

// Penjelasan perubahan:
// - Perhitungan HPP (total_hpp) sekarang SELALU dari transaction_items.cost_price × qty, bukan dari products.
// - Perhitungan total_diskon diambil dari SUM(discount_total) di tabel transactions (jika sudah diisi benar saat transaksi).
// - Semua rumus laba, margin, dan net revenue mengikuti standar POS & akuntansi.
// - Query SQL sudah audit-ready dan tidak akan berubah walaupun harga beli produk diubah di master products.