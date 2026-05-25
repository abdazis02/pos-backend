const response = require('../utils/response');
const ActivityLogModel = require('../models/activityLog.model');
const master = require('../config/knexMaster'); // 🔥 Import Master DB

const ReportController = {
  async summary(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end, payment_method } = req.query;

      // 🚀 DATABASE SUDAH HARDLOCK +09:00 via Knex Config
      const baseTz = "+00:00";
      const targetTz = "+09:00";

      // 1. KASIR SUMMARY (POS)
      const cashSummaryQuery = req.db("transactions").where({ store_id })
        .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
        .select(req.db.raw('COUNT(*) as total_transaksi'))
        .select(req.db.raw('CAST(SUM(total_cost) AS DECIMAL(18,2)) AS total_pendapatan'))
        .select(req.db.raw('CAST(SUM(discount_total) AS DECIMAL(18,2)) AS total_diskon'))
        .first();

      if (payment_method == 'cash' || payment_method == 'qris') {
        cashSummaryQuery.where({ payment_method });
      }

      // HPP POS
      const hppRowsQuery = req.db("transaction_items as ti").where('t.store_id', store_id)
        .whereRaw(`DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?`, [start, end])
        .join("transactions as t", "t.id", "ti.transaction_id")
        .select(req.db.raw('COALESCE(SUM(ti.cost_price * ti.qty), 0) AS total_hpp'))
        .first();

      // Statistik harian POS
      const dailyStatsQuery = req.db("transactions").where({ store_id })
        .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
        .select(req.db.raw(`DATE(created_at) as day`))
        .select(req.db.raw('SUM(total_cost) as total'))
        .groupBy('day');

      // Top produk POS
      const topProductsQuery = req.db("transaction_items as ti").where('t.store_id', store_id)
        .whereRaw(`DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?`, [start, end])
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

      const stokMenipisQuery = req.db("products").where({ store_id })
        .select('id', 'name', 'stock as remaining')
        .where('stock', '<=', 5);

      // 2. PPOB SUMMARY & TOP PRODUCTS
      let ppobSummaryData = { total_transaksi: 0, total_pendapatan: 0, total_profit: 0, total_hpp: 0 };
      let ppobDaily = [];
      let ppobTopProducts = [];

      try {
        const hasPpobTable = await req.db.schema.hasTable('ppob_orders');
        if (hasPpobTable) {
          const pSum = await req.db("ppob_orders").where({ store_id, status: 'success' })
            .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
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
            .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
            .select(req.db.raw(`DATE(created_at) as day`))
            .select(req.db.raw('SUM(sale_price) as total'))
            .groupBy('day');

          // 🔥 TOP PPOB PRODUCTS
          const rawPpobTop = await req.db("ppob_orders").where({ store_id, status: 'success' })
            .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
            .select('buyer_sku_code as sku')
            .select(req.db.raw('MAX(COALESCE(product_name, buyer_sku_code)) as name'))
            .select(req.db.raw('COUNT(*) as sold'))
            .select(req.db.raw('SUM(sale_price) as revenue'))
            .groupBy('sku')
            .orderBy('sold', 'desc')
            .limit(10);

          // Fix names from Master DB
          const skus = rawPpobTop.map(r => r.sku);
          const masterProds = await master("ppob_products").whereIn('buyer_sku_code', skus).select('buyer_sku_code', 'product_name');
          const nameMap = Object.fromEntries(masterProds.map(p => [p.buyer_sku_code, p.product_name]));

          ppobTopProducts = rawPpobTop.map(r => ({
            product_id: "PPOB",
            sku: r.sku,
            name: nameMap[r.sku] || r.name,
            sold: r.sold,
            revenue: r.revenue
          }));
        }
      } catch (e) {}

      // 3. RECENT ACTIVITIES (WIT LITERAL)
      const recentTransactions = await req.db("transactions").where({ store_id, payment_status: 'paid' })
        .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
        .select(req.db.raw(`DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at`))
        .select(req.db.raw('"POS" as source'), 'payment_method as type', 'total_cost as amount')
        .orderBy('created_at', 'desc')
        .limit(15);

      let recentPpob = [];
      try {
        if (await req.db.schema.hasTable('ppob_orders')) {
          recentPpob = await req.db("ppob_orders").where({ store_id, status: 'success' })
            .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
            .select(req.db.raw(`DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at`))
            .select(req.db.raw('"PPOB" as source'), 'buyer_sku_code as type', 'sale_price as amount')
            .orderBy('created_at', 'desc')
            .limit(15);
        }
      } catch (e) {}

      const combinedRecent = [...recentTransactions, ...recentPpob]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 15);

      // 4. EXECUTE ALL
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

      // 🔥 GABUNGKAN TOP PRODUCTS (POS + PPOB)
      const finalTopProducts = [...topProducts, ...ppobTopProducts]
        .sort((a, b) => b.sold - a.sold)
        .slice(0, 10);

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
        top_products: finalTopProducts, // 🔥 Hasil gabungan
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
      const { start, end } = req.query;

      const productsCount = await req.db("products").count({ total: '*' }).where({ store_id }).first();

      let totalSold = 0;
      if (start && end) {
        // POS Sold
        const sold = await req.db("transaction_items as ti")
          .join("transactions as t", "t.id", "ti.transaction_id")
          .select(req.db.raw("SUM(COALESCE(ti.qty, 0)) as total"))
          .whereRaw(`DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?`, [start, end])
          .where('t.store_id', store_id)
          .first();

        // PPOB Sold
        let ppobSold = 0;
        try {
          const hasPpob = await req.db.schema.hasTable('ppob_orders');
          if (hasPpob) {
            const pSold = await req.db("ppob_orders").where({ store_id, status: 'success' })
              .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
              .count({ cnt: '*' }).first();
            ppobSold = Number(pSold.cnt) || 0;
          }
        } catch (e) {}

        totalSold = parseInt(sold.total || 0) + ppobSold;
      }

      // Top POS
      const topPos = await req.db("transaction_items as ti")
        .select(req.db.raw('ti.product_id, p.sku, p.name, CAST(SUM(ti.qty) AS SIGNED) AS sold, CAST(SUM(ti.qty * ti.price) AS DECIMAL(18,2)) AS revenue'))
        .join("products as p", "p.id", "ti.product_id")
        .join("transactions as t", "t.id", "ti.transaction_id")
        .where('t.store_id', store_id)
        .whereRaw(`DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?`, [start, end])
        .groupBy(['ti.product_id', 'p.sku', 'p.name'])
        .orderBy('sold', 'desc')
        .limit(10);

      // Top PPOB
      let topPpob = [];
      try {
        const hasPpob = await req.db.schema.hasTable('ppob_orders');
        if (hasPpob) {
          const rawPpob = await req.db("ppob_orders").where({ store_id, status: 'success' })
            .whereRaw(`DATE(created_at) >= ? AND DATE(created_at) <= ?`, [start, end])
            .select('buyer_sku_code as sku')
            .select(req.db.raw('MAX(COALESCE(product_name, buyer_sku_code)) as name'))
            .select(req.db.raw('COUNT(*) as sold'))
            .select(req.db.raw('SUM(sale_price) as revenue'))
            .groupBy('sku')
            .orderBy('sold', 'desc')
            .limit(10);

          const skus = rawPpob.map(r => r.sku);
          const masterProds = await master("ppob_products").whereIn('buyer_sku_code', skus).select('buyer_sku_code', 'product_name');
          const nameMap = Object.fromEntries(masterProds.map(p => [p.buyer_sku_code, p.product_name]));

          topPpob = rawPpob.map(r => ({
            product_id: "PPOB",
            sku: r.sku,
            name: nameMap[r.sku] || r.name,
            sold: r.sold,
            revenue: r.revenue
          }));
        }
      } catch (e) {}

      const mergedTop = [...topPos, ...topPpob]
        .sort((a, b) => b.sold - a.sold)
        .slice(0, 10);

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
        top_products: mergedTop,
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
        cashierQuery.whereRaw(`DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?`, [start, end]);
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
      const { date } = req.query;

      if (!date) return response.badRequest(res, 'Tanggal laporan wajib diisi.');

      const [exist] = await req.db.raw(`SELECT id FROM daily_reports WHERE store_id = ? AND report_date = ?`, [store_id, date]);
      if (exist.length > 0) return response.badRequest(res, 'Laporan harian sudah ada untuk tanggal ini.');

      const [summary] = await req.db.raw(
        `SELECT COUNT(*) AS total_transaksi, COALESCE(SUM(total_cost),0) AS total_pendapatan, COALESCE(SUM(discount_total),0) AS total_diskon
         FROM transactions WHERE store_id = ? AND DATE(created_at) = ?`,
        [store_id, date]
      );

      const [hppRows] = await req.db.raw(
        `SELECT COALESCE(SUM(ti.cost_price * ti.qty), 0) AS total_hpp
         FROM transaction_items ti JOIN transactions t ON ti.transaction_id = t.id
         WHERE t.store_id = ? AND DATE(t.created_at) = ?`,
        [store_id, date]
      );

      const total_hpp = Number(hppRows[0].total_hpp) || 0;
      const total_pendapatan = Number(summary[0].total_pendapatan) || 0;
      const total_diskon = Number(summary[0].total_diskon) || 0;
      const net_revenue = total_pendapatan - total_diskon;
      const gross_profit = net_revenue - total_hpp;

      await req.db.raw(
        `INSERT INTO daily_reports 
        (store_id, report_date, total_transactions, total_income, total_discount, net_revenue, total_hpp, gross_profit, operational_cost, net_profit, margin, best_sales_day, lowest_sales_day, avg_daily)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          store_id, date, summary[0].total_transaksi, total_pendapatan, total_diskon,
          net_revenue, total_hpp, gross_profit, 0, gross_profit,
          (net_revenue > 0 ? ((gross_profit / net_revenue) * 100).toFixed(2) + '%' : '0%'),
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

  async detailedSalesReport(req, res) {
    try {
      const { store_id } = req.params;
      const { start, end } = req.query;

      if (!start || !end) {
        return response.badRequest(res, 'Range tanggal wajib diisi');
      }

      // 1. Ambil Semua Item Transaksi POS
      const posItems = await req.db("transaction_items as ti")
        .join("transactions as t", "t.id", "ti.transaction_id")
        .where("t.store_id", store_id)
        .whereRaw("DATE(t.created_at) >= ? AND DATE(t.created_at) <= ?", [start, end])
        .select(
          req.db.raw("DATE_FORMAT(t.created_at, '%Y-%m-%d %H:%i:%s') as date"),
          req.db.raw("'POS' as source"),
          "ti.product_name as name",
          "ti.sku as type",
          "ti.qty",
          "ti.price",
          "ti.subtotal as total",
          req.db.raw("(ti.price - ti.cost_price) * ti.qty as profit"),
          "t.payment_method"
        )
        .orderBy("t.created_at", "desc");

      // 2. Ambil Semua Order PPOB
      let ppobItems = [];
      try {
        const hasPpob = await req.db.schema.hasTable('ppob_orders');
        if (hasPpob) {
          ppobItems = await req.db("ppob_orders")
            .where({ store_id, status: 'success' })
            .whereRaw("DATE(created_at) >= ? AND DATE(created_at) <= ?", [start, end])
            .select(
              req.db.raw("DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as date"),
              req.db.raw("'PPOB' as source"),
              "product_name as name",
              "buyer_sku_code as type",
              req.db.raw("1 as qty"),
              req.db.raw("sale_price as price"),
              "sale_price as total",
              req.db.raw("sale_price - price as profit"),
              req.db.raw("'saldo' as payment_method")
            )
            .orderBy("created_at", "desc");
        }
      } catch (e) {}

      const combined = [...posItems, ...ppobItems].sort((a, b) => new Date(b.date) - new Date(a.date));

      return response.success(res, combined);
    } catch (error) {
      console.error("❌ Detailed Sales Error:", error);
      return response.error(res, error, 'Gagal mengambil data detail penjualan');
    }
  }
};

module.exports = ReportController;
