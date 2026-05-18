const ActivityLogModel = require('../models/activityLog.model');
const archiver = require('archiver');
const ExcelJS = require('exceljs');
const master = require('../config/knexMaster');
const XLSX = require('xlsx');
const { Parser } = require('json2csv');
const { parse } = require('csv-parse/sync');

function toMySQLDatetime(dt) {
  if (!dt) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dt)) return dt;
  if (typeof dt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(dt)) {
    const d = new Date(dt);
    if (isNaN(d)) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }
  const d = new Date(dt);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function excelDateToMySQLDatetime(serial) {
  if (!serial) return null;
  if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}/.test(serial)) return serial; // sudah ISO
  if (typeof serial === 'number') {
    // Excel epoch: 1900-01-01
    const utc_days = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;
    const date_info = new Date(utc_value * 1000);
    // Tambahkan jam, menit, detik dari pecahan
    const fractional_day = serial - Math.floor(serial);
    let totalSeconds = Math.round(86400 * fractional_day);
    const hours = Math.floor(totalSeconds / 3600);
    totalSeconds -= hours * 3600;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds - minutes * 60;
    date_info.setHours(hours, minutes, seconds, 0);
    // Format ke MySQL
    return date_info.toISOString().slice(0, 19).replace('T', ' ');
  }
  return null;
}

function normalizeNull(val) {
  // Ubah '' atau undefined jadi null, biarkan 0 dan angka tetap
  return (val === '' || val === undefined) ? null : val;
}

function normalizeNumericFields(obj, numericFields) {
  for (const key of numericFields) {
    if (obj[key] === '' || obj[key] === undefined) obj[key] = null;
  }
}

function normalizeEnumField(obj, field, validValues) {
  if (!obj[field] || obj[field] === '' || !validValues.includes(obj[field])) {
    obj[field] = null;
  }
}

exports.exportData = async (req, res) => {
  try {
    // Ambil parameter dari frontend
    const dataParam = (req.query.data || 'all').toLowerCase();
    const typeParam = (req.query.type || 'json').toLowerCase();
    const startDate = req.query.start_date;
    const endDate = req.query.end_date;

    // Multi-data support
    const dataList = dataParam.split(',').map(x => x.trim()).filter(Boolean);

    // Helper untuk filter tanggal
    function buildDateFilter(field) {
      if (startDate && endDate) return `WHERE ${field} BETWEEN '${startDate} 00:00:00' AND '${endDate} 23:59:59'`;
      if (startDate) return `WHERE ${field} >= '${startDate} 00:00:00'`;
      if (endDate) return `WHERE ${field} <= '${endDate} 23:59:59'`;
      return '';
    }

    // Mapping kategori ke query
    const dataMap = {
      'karyawan': async () => {
        const [users] = await req.db.raw(`SELECT * FROM ${process.env.DB_NAME}.users WHERE role != "owner" AND tenant_id = ${req.user.tenant_id} AND store_id = :store_id`, { store_id: req.user.store_id });
        return { users };
      },
      'users': async () => {
        const [users] = await req.db.raw(`SELECT * FROM ${process.env.DB_NAME}.users WHERE role != "owner" AND tenant_id = ${req.user.tenant_id} AND store_id = :store_id`, { store_id: req.user.store_id });
        return { users };
      },
      'produk': async () => {
        const [products] = await req.db.raw('SELECT * FROM products WHERE store_id = :store_id', { store_id: req.user.store_id });
        return { products };
      },
      'products': async () => {
        const [products] = await req.db.raw('SELECT * FROM products WHERE store_id = :store_id', { store_id: req.user.store_id });
        return { products };
      },
      'transaksi': async () => {
        const [transactions] = await req.db.raw(`SELECT * FROM transactions ${buildDateFilter('created_at')} AND store_id = :store_id`, { store_id: req.user.store_id });
        const [transaction_items] = await req.db.raw(`SELECT * FROM transaction_items WHERE store_id = :store_id`, { store_id: req.user.store_id });
        return { transactions, transaction_items };
      },
      'transactions': async () => {
        const [transactions] = await req.db.raw(`SELECT * FROM transactions ${buildDateFilter('created_at')} AND store_id = :store_id`, { store_id: req.user.store_id });
        const [transaction_items] = await req.db.raw(`SELECT * FROM transaction_items WHERE store_id = :store_id`, { store_id: req.user.store_id });
        return { transactions, transaction_items };
      },
      'item_transaksi': async () => {
        const [transaction_items] = await req.db.raw('SELECT * FROM transaction_items WHERE store_id = :store_id', { store_id: req.user.store_id });
        return { transaction_items };
      },
      'transaction_items': async () => {
        const [transaction_items] = await req.db.raw('SELECT * FROM transaction_items WHERE store_id = :store_id', { store_id: req.user.store_id });
        return { transaction_items };
      },
      // 'pelanggan': async () => {
      //   const [customers] = await req.db.raw('SELECT * FROM customers');
      //   return { customers };
      // },
      // 'customers': async () => {
      //   const [customers] = await req.db.raw('SELECT * FROM customers');
      //   return { customers };
      // }
    };

    let data = {};

    // Tentukan apakah ini export ZIP (multi-data)
    const isZipExport = dataList.length > 1 || dataParam === 'all';

    if (dataParam === 'all') {
      // Semua data
      const [users] = await req.db.raw(`SELECT * FROM ${process.env.DB_NAME}.users WHERE tenant_id = ${req.user.tenant_id} WHERE store_id = :store_id`, { store_id: req.user.store_id });
      const [products] = await req.db.raw('SELECT * FROM products WHERE store_id = :store_id', { store_id: req.user.store_id });
      const [transactions] = await req.db.raw(`SELECT * FROM transactions ${buildDateFilter('created_at')} AND store_id = :store_id`, { store_id: req.user.store_id });
      const [transaction_items] = await req.db.raw(`SELECT * FROM transaction_items WHERE store_id = :store_id`, { store_id: req.user.store_id });
      data = { users, products, transactions, transaction_items };
    } else if (dataList.length > 1) {
      // Multi-data, hasilkan ZIP
      for (const key of dataList) {
        if (dataMap[key]) {
          const result = await dataMap[key]();
          Object.assign(data, result);
        }
      }
      if (Object.keys(data).length === 0) {
        return res.status(400).json({ success: false, message: 'Data kategori tidak didukung' });
      }
    } else if (dataMap[dataParam]) {
      // Single data
      data = await dataMap[dataParam]();
    } else {
      return res.status(400).json({ success: false, message: 'Data kategori tidak didukung' });
    }

    // === ZIP EXPORT ===
    if (isZipExport) {
      res.setHeader('Content-Disposition', `attachment; filename=backup_multi_${Date.now()}.zip`);
      res.setHeader('Content-Type', 'application/zip');

      const archive = archiver('zip', {
        zlib: { level: 9 } // Kompresi maksimum
      });

      // Handle archive errors
      archive.on('error', (err) => {
        console.error('Archive error:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: 'Gagal membuat arsip ZIP', error: err.message });
        }
      });

      // Pipe archive ke response
      archive.pipe(res);

      // Tambahkan file ke archive
      for (const [table, rows] of Object.entries(data)) {
        let buffer, filename;

        if (typeParam === 'excel' || typeParam === 'xlsx') {
          const workbook = new ExcelJS.Workbook();
          const ws = workbook.addWorksheet(table);
          if (rows.length > 0) {
            ws.columns = Object.keys(rows[0]).map(key => ({ header: key, key }));
            rows.forEach(row => ws.addRow(row));
          }
          buffer = await workbook.xlsx.writeBuffer();
          filename = `${table}.xlsx`;
        } else if (typeParam === 'csv') {
          const parser = new Parser();
          const csv = parser.parse(rows || []);
          buffer = Buffer.from(csv, 'utf-8');
          filename = `${table}.csv`;
        } else if (typeParam === 'json') {
          buffer = Buffer.from(JSON.stringify(rows, null, 2), 'utf-8');
          filename = `${table}.json`;
        }

        if (buffer) {
          archive.append(buffer, { name: filename });
        }
      }

      // Finalize archive (akan mengirim response secara otomatis)
      await archive.finalize();

      // Log activity setelah archive selesai
      archive.on('end', async () => {
        try {
          await ActivityLogModel.create(req.db, {
            user_id: req.user.id,
            store_id: req.user.store_id || null,
            action: 'backup_data',
            detail: `Backup data kategori ${dataParam === 'all' ? 'all' : dataList.join(',')} dalam format zip (${typeParam})`
          });
        } catch (logError) {
          console.error('Failed to log activity:', logError);
        }
      });

      return; // KELUAR DARI FUNGSI, JANGAN LANJUT!
    }

    // === SINGLE FILE EXPORT ===
    if (typeParam === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename=backup_${dataParam}_${Date.now()}.json`);
      res.setHeader('Content-Type', 'application/json');
      res.json(data);
    } else if (typeParam === 'csv') {
      const tableName = Object.keys(data)[0];
      const parser = new Parser();
      const csv = parser.parse(data[tableName] || []);
      res.setHeader('Content-Disposition', `attachment; filename=${tableName}_${Date.now()}.csv`);
      res.setHeader('Content-Type', 'text/csv');
      res.send(csv);
    } else if (typeParam === 'excel' || typeParam === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      for (const [table, rows] of Object.entries(data)) {
        const ws = workbook.addWorksheet(table);
        if (rows.length > 0) {
          ws.columns = Object.keys(rows[0]).map(key => ({ header: key, key }));
          rows.forEach(row => ws.addRow(row));
        }
      }
      res.setHeader('Content-Disposition', `attachment; filename=backup_${dataParam}_${Date.now()}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      await workbook.xlsx.write(res);
    } else {
      return res.status(400).json({ success: false, message: 'Format file tidak didukung' });
    }

    // Log activity untuk single file export
    await ActivityLogModel.create(req.db, {
      user_id: req.user.id,
      store_id: req.user.store_id || null,
      action: 'backup_data',
      detail: `Backup data kategori ${dataParam} dalam format ${typeParam}`
    });

  } catch (error) {
    console.error('Export error:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Gagal export data', error: error.message });
    }
  }
};

exports.importData = async (req, res) => {
  let importLogId = null;
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'File backup tidak ditemukan' });

    const dataType = req.body.type || 'produk'; // 'produk' or 'karyawan'
    const store_id = req.body.store_id || req.user.store_id;

    if (!store_id) {
       return res.status(400).json({ success: false, message: 'store_id tidak ditemukan' });
    }

    // Catat log import (status pending)
    const [result] = await req.db.raw(
      `INSERT INTO import_logs (store_id, user_id, filename, size, status) VALUES (?, ?, ?, ?, ?)`,
      [store_id, req.user.id, req.file.originalname, req.file.size, 'pending']
    );
    importLogId = result.insertId;

    let rows = [];
    const originalname = req.file.originalname.toLowerCase();

    // === PARSE FILE ===
    if (originalname.endsWith('.json')) {
      try {
        const data = JSON.parse(req.file.buffer.toString());
        rows = data.products || data.users || (Array.isArray(data) ? data : []);
      } catch (e) {
        throw new Error('Format file JSON tidak valid');
      }
    } else if (originalname.endsWith('.csv')) {
      rows = parse(req.file.buffer.toString(), { columns: true, skip_empty_lines: true });
    } else if (originalname.endsWith('.xlsx') || originalname.endsWith('.xls')) {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(firstSheet);
    } else {
      throw new Error('Format file tidak didukung (hanya .json, .csv, .xlsx)');
    }

    if (!rows || rows.length === 0) {
      throw new Error("File kosong atau tidak terbaca");
    }

    // === COLUMN MAPPING HELPER ===
    const mapFields = (row, mapping) => {
      const result = {};
      const rowKeys = Object.keys(row);

      for (const [dbField, variations] of Object.entries(mapping)) {
        // Cari key di row yang cocok dengan salah satu variasi
        const foundKey = rowKeys.find(rk =>
          variations.some(v => rk.toLowerCase().trim() === v.toLowerCase())
        );
        if (foundKey !== undefined) {
          result[dbField] = row[foundKey];
        }
      }
      return result;
    };

    const productMapping = {
      'name': ['name', 'nama', 'nama produk', 'product name'],
      'sku': ['sku', 'kode'],
      'barcode': ['barcode', 'kode batang'],
      'price': ['price', 'harga', 'harga jual', 'selling_price'],
      'cost_price': ['cost_price', 'harga beli', 'modal', 'buying_price'],
      'stock': ['stock', 'stok', 'jumlah'],
      'category': ['category', 'kategori'],
      'description': ['description', 'deskripsi', 'keterangan'],
      'without_stock': ['without_stock', 'tanpa stok', 'unlimited']
    };

    const userMapping = {
      'name': ['name', 'nama', 'nama lengkap'],
      'username': ['username', 'user'],
      'email': ['email', 'surel'],
      'password': ['password', 'sandi', 'kata sandi'],
      'role': ['role', 'jabatan', 'akses'],
      'is_active': ['is_active', 'aktif', 'status']
    };

    console.log(`📦 INFO: Starting import process for ${dataType} (Total Raw Rows: ${rows.length})`);

    let importedCount = 0;
    const currentMapping = dataType === 'karyawan' ? userMapping : productMapping;

    for (let i = 0; i < rows.length; i++) {
      const rawRow = rows[i];
      const mappedData = mapFields(rawRow, currentMapping);

      if (dataType === 'karyawan') {
        if (!mappedData.name || !mappedData.email) {
          console.log(`⚠️ SKIP: Row ${i + 1} invalid name/email`);
          continue;
        }

        // Hash password default jika kosong
        if (!mappedData.password) {
          mappedData.password = await bcrypt.hash('123456', 10);
        }

        await master.raw(
          `INSERT INTO users (tenant_id, store_id, name, email, password, role, is_active, created_at, verified_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), is_active=VALUES(is_active)`,
          [req.user.tenant_id, store_id, mappedData.name, mappedData.email, mappedData.password, mappedData.role || 'cashier', mappedData.is_active ?? 1, new Date(), new Date()]
        );
        importedCount++;
      } else {
        // Validation: Nama wajib ada
        if (!mappedData.name) {
          console.log(`⚠️ SKIP: Row ${i + 1} missing product name`);
          continue;
        }

        // Clean & Normalize Numbers
        const parseNum = (v) => {
          if (v === undefined || v === null) return 0;
          if (typeof v === 'string') return parseFloat(v.replace(/[^0-9.]/g, '')) || 0;
          return parseFloat(v) || 0;
        };

        const finalProduct = {
          store_id: store_id,
          name: mappedData.name,
          sku: mappedData.sku || null,
          barcode: mappedData.barcode?.toString() || null,
          price: parseNum(mappedData.price),
          cost_price: mappedData.cost_price ? parseNum(mappedData.cost_price) : 0,
          stock: mappedData.stock ? parseInt(mappedData.stock, 10) : 0,
          category: mappedData.category || 'Umum',
          description: mappedData.description || '',
          without_stock: mappedData.without_stock == 1 || mappedData.without_stock == true || String(mappedData.without_stock).toLowerCase() == 'ya',
          is_active: 1,
          created_at: new Date(),
          updated_at: new Date()
        };

        // 🔥 Gunakan UPSERT yang lebih fleksibel
        try {
          // Jika ada barcode, jadikan patokan update
          if (finalProduct.barcode) {
            await req.db("products").insert(finalProduct)
              .onConflict(['store_id', 'barcode'])
              .merge([
                'name', 'sku', 'price', 'cost_price', 'stock', 'category',
                'description', 'updated_at', 'without_stock'
              ]);
          } else if (finalProduct.sku) {
            // Jika tidak ada barcode tapi ada SKU
            await req.db("products").insert(finalProduct)
              .onConflict(['store_id', 'sku'])
              .merge([
                'name', 'barcode', 'price', 'cost_price', 'stock', 'category',
                'description', 'updated_at', 'without_stock'
              ]);
          } else {
            // Jika tidak ada keduanya, insert saja
            await req.db("products").insert(finalProduct);
          }
          importedCount++;
        } catch (dbErr) {
          console.error(`❌ DB ERROR at Row ${i + 1}:`, dbErr.message);
        }
      }
    }

    console.log(`✅ FINISH: Successfully imported ${importedCount} items.`);

    if (importedCount === 0) {
      throw new Error("Tidak ada data valid yang ditemukan untuk di-import");
    }

    // Jika sukses, update status ke success
    await req.db.raw(`UPDATE import_logs SET status='success' WHERE id=?`, [importLogId]);

    res.json({ success: true, message: `Berhasil mengimport ${importedCount} data ${dataType}` });

    // Log activity
    await ActivityLogModel.create(req.db, {
      user_id: req.user.id,
      store_id: store_id,
      action: 'import_data',
      detail: `Import ${importedCount} data ${dataType} berhasil`
    });

  } catch (error) {
    console.error('❌ IMPORT ERROR:', error);
    if (req.db && importLogId) {
      await req.db.raw(`UPDATE import_logs SET status='failed' WHERE id=?`, [importLogId]);
    }

    if (!res.headersSent) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
};

exports.resetData = async (req, res) => {
  try {
    // Hapus semua data, kecuali owner
    // Urutan penting karena foreign key!
    await req.db.raw('DELETE FROM transaction_items');
    await req.db.raw('DELETE FROM transactions');
    await req.db.raw('DELETE FROM products');
    await req.db.raw('DELETE FROM users WHERE role != "owner"');
    // Jika ada tabel lain (misal: categories, struck_receipt), tambahkan juga di sini

    res.json({ success: true, message: 'Semua data berhasil direset, kecuali data owner.' });

    // Log activity
    await ActivityLogModel.create(req.db, {
      user_id: req.user.id,
      store_id: req.user.store_id || null,
      action: 'reset_data',
      detail: 'Reset data dilakukan'
    });

  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Gagal reset data', error: error.message });
    }
  }
};

exports.importHistory = async (req, res) => {
  try {
    const [rows] = await req.db.raw(
      `SELECT filename, size, created_at as date, status FROM import_logs WHERE store_id=? ORDER BY created_at DESC LIMIT 50`,
      [req.user.store_id]
    );
    res.json(rows);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Gagal mengambil riwayat import', error: error.message });
    }
  }
};

exports.importStats = async (req, res) => {
  try {
    const [[stats]] = await req.db.raw(
      `SELECT
        COUNT(*) as total_files,
        SUM(size) as total_size,
        SUM(status='success') as success_count,
        MAX(created_at) as last_import
      FROM 
        import_logs 
      WHERE store_id=?`,
      [req.user.store_id]
    );

    res.json({
      total_files: stats.total_files || 0,
      success_count: stats.success_count || 0,
      total_size: stats.total_size || 0,
      last_import: stats.last_import
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Gagal mengambil statistik import', error: error.message });
    }
  }
};