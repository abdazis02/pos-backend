const express = require('express');
const router = express.Router();

// Sinkronisasi produk dari lokal ke server (bulk insert/update)
router.post('/products', async (req, res) => {
  try {
    const products = Array.isArray(req.body) ? req.body : [req.body];
    for (const p of products) {
      await pool.execute(
        `INSERT INTO products
          (id, store_id, name, sku, barcode, price, cost_price, stock, category, description, is_active, jenis_diskon, nilai_diskon, diskon_bundle_min_qty, diskon_bundle_value, buy_qty, free_qty, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name=VALUES(name), sku=VALUES(sku), barcode=VALUES(barcode), price=VALUES(price),
           cost_price=VALUES(cost_price), stock=VALUES(stock), category=VALUES(category),
           description=VALUES(description), is_active=VALUES(is_active),
           jenis_diskon=VALUES(jenis_diskon), nilai_diskon=VALUES(nilai_diskon),
           diskon_bundle_min_qty=VALUES(diskon_bundle_min_qty), diskon_bundle_value=VALUES(diskon_bundle_value),
           buy_qty=VALUES(buy_qty), free_qty=VALUES(free_qty), updated_at=VALUES(updated_at)`,
        [
          p.id, p.store_id, p.name, p.sku, p.barcode, p.price, p.cost_price, p.stock, p.category, p.description,
          p.is_active, p.jenis_diskon, p.nilai_diskon, p.diskon_bundle_min_qty, p.diskon_bundle_value,
          p.buy_qty, p.free_qty, p.created_at, p.updated_at
        ]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sinkronisasi produk dari server ke lokal
router.get('/products', async (req, res) => {
  try {
    const { store_id } = req.query;
    const [rows] = await pool.execute('SELECT * FROM products WHERE store_id = ?', [store_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sinkronisasi transaksi dari lokal ke server (bulk insert/update)
router.post('/transactions', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];
    for (const trx of transactions) {
      // Upsert transaksi
      const [result] = await conn.execute(
        `INSERT INTO transactions
          (id, store_id, user_id, total_cost, payment_type, payment_method, received_amount, change_amount, payment_status, created_at, updated_at, tax, tax_percentage, role, is_owner, customer_name, customer_phone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           store_id=VALUES(store_id), user_id=VALUES(user_id), total_cost=VALUES(total_cost),
           payment_type=VALUES(payment_type), payment_method=VALUES(payment_method),
           received_amount=VALUES(received_amount), change_amount=VALUES(change_amount),
           payment_status=VALUES(payment_status), updated_at=VALUES(updated_at),
           tax=VALUES(tax), tax_percentage=VALUES(tax_percentage), role=VALUES(role),
           is_owner=VALUES(is_owner), customer_name=VALUES(customer_name), customer_phone=VALUES(customer_phone)`
        ,
        [
          trx.id, trx.store_id, trx.user_id, trx.total_cost, trx.payment_type, trx.payment_method,
          trx.received_amount, trx.change_amount, trx.payment_status, trx.created_at, trx.updated_at,
          trx.tax, trx.tax_percentage, trx.role, trx.is_owner, trx.customer_name, trx.customer_phone
        ]
      );

      // Hapus item lama jika update
      if (trx.id) {
        await conn.execute('DELETE FROM transaction_items WHERE transaction_id = ?', [trx.id]);
      }

      // Insert item transaksi
      if (Array.isArray(trx.items)) {
        for (const item of trx.items) {
          await conn.execute(
            `INSERT INTO transaction_items
              (transaction_id, product_id, product_name, qty, price, subtotal)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              trx.id, item.product_id, item.product_name, item.qty, item.price, item.subtotal
            ]
          );
        }
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.end();
  }
});

// Sinkronisasi transaksi dari server ke lokal
router.get('/transactions', async (req, res) => {
  try {
    const { store_id } = req.query;
    const [transactions] = await pool.execute('SELECT * FROM transactions WHERE store_id = ?', [store_id]);
    for (const trx of transactions) {
      const [items] = await pool.execute('SELECT * FROM transaction_items WHERE transaction_id = ?', [trx.id]);
      trx.items = items;
    }
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sinkronisasi user dari lokal ke server (bulk insert/update)
router.post('/users', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const users = Array.isArray(req.body) ? req.body : [req.body];
    for (const user of users) {
      // Upsert user (jika id sudah ada, update; jika belum, insert)
      await conn.execute(
        `INSERT INTO users
          (id, owner_id, store_id, name, username, email, password, role, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           owner_id=VALUES(owner_id), store_id=VALUES(store_id), name=VALUES(name),
           username=VALUES(username), email=VALUES(email), password=VALUES(password),
           role=VALUES(role), is_active=VALUES(is_active), created_at=VALUES(created_at)`,
        [
          user.id, user.owner_id, user.store_id, user.name, user.username, user.email,
          user.password, user.role, user.is_active, user.created_at
        ]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.end();
  }
});

// Sinkronisasi user dari server ke lokal
router.get('/users', async (req, res) => {
  try {
    const { store_id } = req.query;
    const [users] = await pool.execute(
      'SELECT * FROM users WHERE store_id = ?',
      [store_id]
    );
    res.json(users);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sinkronisasi store dari lokal ke server (bulk insert/update)
router.post('/stores', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const stores = Array.isArray(req.body) ? req.body : [req.body];
    for (const store of stores) {
      await conn.execute(
        `INSERT INTO stores
          (id, owner_id, name, address, phone, receipt_template, created_at, updated_at, tax_percentage)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           owner_id=VALUES(owner_id), name=VALUES(name), address=VALUES(address), phone=VALUES(phone),
           receipt_template=VALUES(receipt_template), updated_at=VALUES(updated_at), tax_percentage=VALUES(tax_percentage)`,
        [
          store.id, store.owner_id, store.name, store.address, store.phone,
          store.receipt_template, store.created_at, store.updated_at, store.tax_percentage
        ]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.end();
  }
});

// Sinkronisasi store dari server ke lokal
router.get('/stores', async (req, res) => {
  try {
    const { owner_id } = req.query;
    const [stores] = await pool.execute(
      'SELECT * FROM stores WHERE owner_id = ?',
      [owner_id]
    );
    res.json(stores);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sinkronisasi owner dari lokal ke server (bulk insert/update)
router.post('/owners', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const owners = Array.isArray(req.body) ? req.body : [req.body];
    for (const owner of owners) {
      await conn.execute(
        `INSERT INTO owners
          (id, business_name, email, phone, address, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           business_name=VALUES(business_name), email=VALUES(email), phone=VALUES(phone),
           address=VALUES(address), created_at=VALUES(created_at)`,
        [
          owner.id, owner.business_name, owner.email, owner.phone, owner.address, owner.created_at
        ]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.end();
  }
});

// Sinkronisasi owner dari server ke lokal
router.get('/owners', async (req, res) => {
  try {
    const { id } = req.query;
    let sql = 'SELECT * FROM owners';
    let params = [];
    if (id) {
      sql += ' WHERE id = ?';
      params.push(id);
    }
    const [owners] = await pool.execute(sql, params);
    res.json(owners);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Sinkronisasi laporan harian dari lokal ke server (bulk insert/update)
router.post('/reports_daily', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const reports = Array.isArray(req.body) ? req.body : [req.body];
    for (const r of reports) {
      await conn.execute(
        `INSERT INTO reports_daily
          (id, store_id, report_date, total_transactions, total_income, total_discount, net_revenue, total_hpp, gross_profit, operational_cost, net_profit, margin, best_sales_day, lowest_sales_day, avg_daily, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           store_id=VALUES(store_id), report_date=VALUES(report_date), total_transactions=VALUES(total_transactions),
           total_income=VALUES(total_income), total_discount=VALUES(total_discount), net_revenue=VALUES(net_revenue),
           total_hpp=VALUES(total_hpp), gross_profit=VALUES(gross_profit), operational_cost=VALUES(operational_cost),
           net_profit=VALUES(net_profit), margin=VALUES(margin), best_sales_day=VALUES(best_sales_day),
           lowest_sales_day=VALUES(lowest_sales_day), avg_daily=VALUES(avg_daily), created_at=VALUES(created_at)`,
        [
          r.id, r.store_id, r.report_date, r.total_transactions, r.total_income, r.total_discount,
          r.net_revenue, r.total_hpp, r.gross_profit, r.operational_cost, r.net_profit, r.margin,
          r.best_sales_day, r.lowest_sales_day, r.avg_daily, r.created_at
        ]
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.end();
  }
});

// Sinkronisasi laporan harian dari server ke lokal
router.get('/reports_daily', async (req, res) => {
  try {
    const { store_id } = req.query;
    const [rows] = await pool.execute('SELECT * FROM reports_daily WHERE store_id = ?', [store_id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;