const master = require('../config/knexMaster'); // Menggunakan koneksi master Knex Anda

// ============================================
// 1. MANAJEMEN KLIEN / MITRA TOKO
// ============================================

exports.getClients = async (req, res) => {
  try {
    const owners = await master('owners')
      .select(
        'id',
        'business_name as nama_toko',
        'business_name as nama_owner',
        'email',
        'phone as no_hp',
        'address as alamat',
        'wallet_balance as saldo_dompet',
        'status',
        'created_at as tanggal_gabung'
      )
      .orderBy('created_at', 'desc');

    res.status(200).json({ success: true, data: owners });
  } catch (error) {
    console.error("Error getClients:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan pada server" });
  }
};

// ============================================
// APP SETTINGS
// ============================================

exports.getAppSettings = async (req, res) => {
  try {
    const settingsRaw = await master("app_settings").select("setting_key", "setting_value");
    const settings = {};
    settingsRaw.forEach(item => {
      settings[item.setting_key] = item.setting_value;
    });

    res.status(200).json({ success: true, data: settings });
  } catch (error) {
    console.error("Error getAppSettings:", error);
    res.status(500).json({ success: false, message: "Gagal mengambil pengaturan" });
  }
};

exports.updateAppSettings = async (req, res) => {
  try {
    const updates = req.body; // { bank_name: "BCA", ... }
    
    // Gunakan transaksi atau simpan satu-satu
    for (const [key, value] of Object.entries(updates)) {
      if (typeof value === 'string') {
        await master.raw(
          `INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?`,
          [key, value, value]
        );
      }
    }

    res.status(200).json({ success: true, message: "Pengaturan berhasil disimpan" });
  } catch (error) {
    console.error("Error updateAppSettings:", error);
    res.status(500).json({ success: false, message: "Gagal menyimpan pengaturan" });
  }
};

exports.createClient = async (req, res) => {
  try {
    const { nama_toko, nama_owner, email, no_hp, alamat } = req.body;

    const [id] = await master('owners').insert({
      business_name: nama_toko,
      email: email,
      phone: no_hp,
      address: alamat,
      status: 'active',
      wallet_balance: 0
    });

    const newOwner = await master('owners').where('id', id).first();

    res.status(201).json({
      success: true,
      message: "Mitra berhasil ditambahkan",
      data: {
        id: newOwner.id,
        nama_toko: newOwner.business_name,
        nama_owner: newOwner.business_name, // Sementara disamakan
        email: newOwner.email,
        no_hp: newOwner.phone,
        alamat: newOwner.address,
        saldo_dompet: newOwner.wallet_balance,
        status: 'Aktif'
      }
    });
  } catch (error) {
    console.error("Error createClient:", error);
    res.status(500).json({ success: false, message: "Gagal menambahkan mitra" });
  }
};

exports.updateClientStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const dbStatus = status === 'Aktif' ? 'active' : 'suspended';

    await master('owners').where('id', id).update({
      status: dbStatus,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: `Status mitra berhasil diubah menjadi ${status}` });
  } catch (error) {
    console.error("Error updateClientStatus:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui status" });
  }
};

exports.updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_toko, email, no_hp, alamat } = req.body;

    await master('owners').where('id', id).update({
      business_name: nama_toko,
      email: email,
      phone: no_hp,
      address: alamat,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: "Data mitra berhasil diperbarui" });
  } catch (error) {
    console.error("Error updateClient:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui data mitra" });
  }
};


// ============================================
// 2. DASHBOARD & STATISTIK
// ============================================

exports.getDashboardStats = async (req, res) => {
  try {
    // 1. Dapatkan Statistik Mitra & Saldo (Gunakan SUM agar lebih akurat)
    const owners = await master("owners").select('status', 'wallet_balance');
    const saldoRow = await master("owners").sum('wallet_balance as total').first();

    let aktif = 0, suspend = 0, blokir = 0;
    let saldoMitra = parseFloat(saldoRow?.total || 0);

    owners.forEach(c => {
      const statusLower = String(c.status || '').toLowerCase();
      if (statusLower === 'active' || statusLower === 'aktif') aktif++;
      else if (statusLower === 'suspended' || statusLower === 'suspend') suspend++;
      else blokir++;
    });

    // 2. Tarik Saldo Asli Perusahaan dari Digiflazz
    let saldoDigiflazz = 0;
    try {
      const axios = require('axios');
      const crypto = require('crypto');
      const username = process.env.DIGIFLAZZ_USERNAME;
      const key = process.env.DIGIFLAZZ_API_KEY || process.env.DIGIFLAZZ_DEV_KEY || process.env.DIGIFLAZZ_PRODUCTION_KEY;
      
      if (username && key) {
         const sign = crypto.createHash('md5').update(username + key + "depo").digest('hex');
         const digiRes = await axios.post('https://api.digiflazz.com/v1/cek-saldo', { cmd: 'deposit', username, sign });
         if (digiRes.data && digiRes.data.data) {
            saldoDigiflazz = digiRes.data.data.deposit || 0;
         }
      }
    } catch(e) {
      console.error("Gagal menarik saldo Digiflazz:", e.message);
    }

    // 3. Hitung Total Transaksi
    let totalTransaksiAllTime = 0;
    let totalTransaksiHariIni = 0;
    try {
       const today = new Date();
       today.setHours(0,0,0,0);
       
       const txCountAll = await master("wallet_transactions").count('* as total').first();
       totalTransaksiAllTime = txCountAll.total || 0;
       
       const txCountToday = await master("wallet_transactions")
          .where('created_at', '>=', today)
          .count('* as total').first();
       totalTransaksiHariIni = txCountToday.total || 0;
    } catch(e) {
       console.error("Gagal menghitung transaksi:", e.message);
    }

    // 4. Kirimkan Data ke Frontend
    res.status(200).json({
      success: true,
      data: {
        saldoDigiflazz,
        saldoMitra, 
        totalTransaksiAllTime, 
        totalTransaksiHariIni, 
        mitraAktif: aktif, 
        mitraSuspend: suspend, 
        mitraBlokir: blokir 
      }
    });
  } catch (error) {
    console.error("Error getDashboardStats:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};

exports.getDashboardChart = async (req, res) => {
  try {
    const chartData = await master.raw(`
      SELECT 
        DATE_FORMAT(created_at, '%a') as hari_en,
        DATE(created_at) as tgl,
        SUM(ABS(amount)) as laba
      FROM wallet_transactions
      WHERE type IN ('transaction_fee', 'ppob_margin', 'ppob_fee')
        AND created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY tgl, hari_en
      ORDER BY tgl ASC
    `);

    const dayMap = {
      'Sun': 'Min', 'Mon': 'Sen', 'Tue': 'Sel', 
      'Wed': 'Rab', 'Thu': 'Kam', 'Fri': 'Jum', 'Sat': 'Sab'
    };

    const formattedData = chartData[0].map(item => ({
      hari: dayMap[item.hari_en] || item.hari_en,
      laba: item.laba
    }));

    res.status(200).json({ success: true, data: formattedData });
  } catch (error) {
    console.error("Error getDashboardChart:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};


// ============================================
// 3. RIWAYAT TRANSAKSI (VERSI ENRICHED DYNAMIC)
// ============================================

exports.getTransactions = async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 500);
    const page   = Math.max(parseInt(req.query.page)  || 1,  1);
    const offset = (page - 1) * limit;

    const typeFilter   = req.query.type;
    const searchFilter = req.query.search;

    let baseQuery = master('wallet_transactions as wt').join('owners as o', 'o.id', 'wt.owner_id');

    if (typeFilter === 'POS') {
      baseQuery = baseQuery.where('wt.reference_type', 'transactions');
    } else if (typeFilter === 'PPOB') {
      baseQuery = baseQuery.where('wt.reference_type', 'ppob_orders');
    }

    if (searchFilter) {
      baseQuery = baseQuery.where(function() {
        this.where('wt.reference_id', 'like', `%${searchFilter}%`)
            .orWhere('o.business_name', 'like', `%${searchFilter}%`)
            .orWhere('wt.description', 'like', `%${searchFilter}%`);
      });
    }

    const countRow = await baseQuery.clone().count('wt.id as total').first();
    const total = parseInt(countRow.total) || 0;

    // 🔥 OPTIMASI 1: Gabungkan 4 query statistik berat menjadi 1 kali full table scan
    const statsRow = await master('wallet_transactions')
      .select(
        master.raw("COUNT(CASE WHEN reference_type = 'transactions' THEN 1 END) as pos_count"),
        master.raw("COUNT(CASE WHEN reference_type = 'ppob_orders' THEN 1 END) as ppob_count"),
        master.raw("COUNT(*) as total_count"),
        master.raw("COALESCE(SUM(CASE WHEN type IN ('transaction_fee', 'ppob_margin', 'ppob_fee') THEN ABS(amount) ELSE 0 END), 0) as total_laba")
      )
      .first();

    const stats = {
      total: parseInt(statsRow?.total_count) || 0,
      pos: parseInt(statsRow?.pos_count) || 0,
      ppob: parseInt(statsRow?.ppob_count) || 0,
      pending: 0,
      laba: parseFloat(statsRow?.total_laba) || 0,
    };

    const logs = await baseQuery.clone()
      .select(
        'wt.id',
        master.raw("DATE_FORMAT(wt.created_at, '%Y-%m-%d %H:%i') as tanggal"),
        'o.business_name as nama_toko',
        'wt.type as tipe',
        'wt.description as produk',
        'wt.amount',
        'wt.balance_after',
        'wt.reference_type',
        'wt.reference_id',
        'o.id as owner_id' // HANYA AMBIL owner_id, sisanya dicari di tabel tenants
      )
      .orderBy('wt.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const { getTenantConnection } = require('../config/knexTenant');
    const formattedData = [];
    const uniqueMap = new Map();

    // 🔥 OPTIMASI 2: Ambil semua data tenant dalam 1 query saja untuk menghindari N+1 query ke DB master
    const uniqueOwnerIds = [...new Set(logs.map(l => l.owner_id))];
    const tenants = await master('tenants').whereIn('owner_id', uniqueOwnerIds);
    const tenantMap = new Map(tenants.map(t => [t.owner_id, t]));

    // 🔥 OPTIMASI 3: Jalankan query ke masing-masing database tenant secara PARALEL dengan Promise.all
    const logsWithDetails = await Promise.all(
      logs.map(async (l) => {
        let detail = null;
        try {
          const tenantInfo = tenantMap.get(l.owner_id);
          if (tenantInfo && tenantInfo.db_name) {
            const clientDb = getTenantConnection({
              db_name: tenantInfo.db_name,
              db_user: tenantInfo.db_user,
              db_pass: tenantInfo.db_pass
            });

            if (l.reference_type === 'transactions' && l.reference_id) {
              detail = await clientDb('transactions').where('id', l.reference_id).first();
            } else if (l.reference_type === 'ppob_orders' && l.reference_id) {
              detail = await clientDb('ppob_orders').where('id', l.reference_id).first();
            }
          }
        } catch (e) {
          // Abaikan jika database tenant tertentu bermasalah
        }
        return { log: l, detail };
      })
    );

    // 4. Proses formatting data
    for (let { log: l, detail } of logsWithDetails) {
      let tipe = l.reference_type === 'transactions' ? 'POS' : (l.reference_type === 'ppob_orders' ? 'PPOB' : l.tipe);
      
      let status = 'Sukses';
      if (detail) {
         if (detail.status === 'pending' || detail.payment_status === 'pending') status = 'Pending';
         else if (detail.status === 'failed' || detail.payment_status === 'failed') status = 'Gagal';
      }

      let laba = Math.abs(parseFloat(l.amount)) || 0;
      let grand_total = detail ? parseFloat(detail.total_cost || detail.amount || detail.sale_price || detail.price || 0) : 0;
      let harga_modal = detail ? parseFloat(detail.capital_price || detail.amount || detail.price || 0) : 0;

      if (l.tipe === 'topup' || tipe === 'topup') {
         grand_total = Math.abs(parseFloat(l.amount)) || 0;
         laba = 0; // Top-up bukan margin/laba
         harga_modal = 0;
      }
      
      // GABUNGKAN PPOB MENJADI 1 BARIS
      if (l.reference_type === 'ppob_orders') {
         tipe = 'PPOB';
         const uniqueKey = 'ppob-' + l.owner_id + '-' + l.reference_id;
         
         if (!uniqueMap.has(uniqueKey)) {
            uniqueMap.set(uniqueKey, {
               id: l.id,
               tanggal: l.tanggal,
               nama_toko: l.nama_toko,
               tipe: tipe,
               produk: detail ? (detail.product_name || detail.description || l.produk) : l.produk,
               no_tujuan: detail ? (detail.target_number || '-') : '-',
               ref_id: l.reference_id || '-',
               harga_modal: harga_modal,
               tax: detail ? parseFloat(detail.tax || 0) : 0,
               grand_total: grand_total,
               laba: 0,
               metode_pembayaran: detail ? (detail.payment_method || '-') : '-',
               status: status
            });
            formattedData.push(uniqueMap.get(uniqueKey));
         }

         const entry = uniqueMap.get(uniqueKey);
         if (l.tipe !== 'ppob_purchase') {
             entry.laba += laba; // Tambahkan laba jika ini baris margin/fee
         }
         continue; // Selesai proses baris PPOB ini
      }

      // Baris Non-PPOB (POS / Topup)
      formattedData.push({
        id: l.id,
        tanggal: l.tanggal,
        nama_toko: l.nama_toko,
        tipe: tipe,
        produk: detail ? (detail.product_name || detail.description || l.produk) : l.produk,
        no_tujuan: detail ? (detail.target_number || '-') : '-',
        ref_id: l.reference_id || '-',
        harga_modal: harga_modal,
        tax: detail ? parseFloat(detail.tax || 0) : 0,
        grand_total: grand_total,
        laba: laba,
        metode_pembayaran: detail ? (detail.payment_method || '-') : '-',
        status: status
      });
    }

    res.json({ success: true, total, stats, data: formattedData });
  } catch (e) {
    console.error('getTransactions error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};


// ============================================
// 4. SETTING LAYANAN GLOBAL
// ============================================

exports.getServices = async (req, res) => {
  try {
    const services = await master('services').select(
      'id', 
      'name', 
      'description as desc', // ALIAS PENTING: Menyesuaikan database ke Frontend
      'is_active'
    );
    const mapped = services.map(s => ({ ...s, is_active: !!s.is_active }));
    res.status(200).json({ success: true, data: mapped });
  } catch (error) {
    res.status(500).json({ success: false, message: "Gagal memuat layanan" });
  }
};

exports.updateServiceStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body; 

    await master('services').where('id', id).update({ is_active: is_active ? 1 : 0 });
    res.status(200).json({ success: true, message: "Status layanan diperbarui" });
  } catch (error) {
    console.error("Error updateServiceStatus:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui status layanan" });
  }
};


// ============================================
// 5. MANAJEMEN PRODUK & MARGIN
// ============================================

exports.getProducts = async (req, res) => {
  try {
    const { type } = req.query; 
    
    let query = master('ppob_products').select(
      'id',
      'product_name as nama',
      'category as kategori',
      'buyer_sku_code as sku',
      'price as harga_modal',
      'type',
      'margin'
    );

    if (type) {
      query = query.where('type', type);
    }

    const products = await query;
    const mappedProducts = products.map(p => ({
      ...p,
      margin: p.margin !== null ? parseFloat(p.margin) : 500 
    }));

    res.status(200).json({ success: true, data: mappedProducts });
  } catch (error) {
    console.error("Error getProducts:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
  }
};

exports.updateProductMargin = async (req, res) => {
  try {
    const { id } = req.params;
    const { margin } = req.body;
    
    await master('ppob_products').where('id', id).update({ margin, updated_at: new Date() });
    res.status(200).json({ success: true, message: "Margin produk berhasil diperbarui" });
  } catch (error) {
    console.error("Error updateProductMargin:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui margin" });
  }
};


// ============================================
// 6. SETTING BIAYA POS (ADMINISTRASI APP)
// ============================================

exports.getPosFee = async (req, res) => {
  try {
    const setting = await master('settings').where('setting_key', 'pos_fee').first();
    // Ambil nilai dari setting_value, jika kosong default ke 150
    const fee = setting ? parseFloat(setting.setting_value) : 150;
    res.status(200).json({ success: true, data: { fee } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Gagal memuat biaya POS" });
  }
};

exports.updatePosFee = async (req, res) => {
  try {
    const { fee } = req.body;
    
    const exists = await master('settings').where('setting_key', 'pos_fee').first();
    if (exists) {
      await master('settings').where('setting_key', 'pos_fee').update({ setting_value: fee.toString() });
    } else {
      await master('settings').insert({ setting_key: 'pos_fee', setting_value: fee.toString() });
    }
    
    res.status(200).json({ success: true, message: "Biaya POS berhasil diperbarui" });
  } catch (error) {
    console.error("Error updatePosFee:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui biaya POS" });
  }
};

// ============================================
// BIAYA ADMIN BULANAN (dipotong dari saldo tiap tanggal 1)
// ============================================

exports.getMonthlyFee = async (req, res) => {
  try {
    const setting = await master('settings').where('setting_key', 'monthly_admin_fee').first();
    const fee = setting ? parseFloat(setting.setting_value) : 10000; // default 10.000
    res.status(200).json({ success: true, data: { fee } });
  } catch (error) {
    res.status(500).json({ success: false, message: "Gagal memuat biaya admin bulanan" });
  }
};

exports.updateMonthlyFee = async (req, res) => {
  try {
    const fee = parseInt(req.body.fee, 10);
    if (isNaN(fee) || fee < 0) {
      return res.status(400).json({ success: false, message: "Nilai biaya tidak valid" });
    }

    const exists = await master('settings').where('setting_key', 'monthly_admin_fee').first();
    if (exists) {
      await master('settings').where('setting_key', 'monthly_admin_fee').update({ setting_value: fee.toString() });
    } else {
      await master('settings').insert({ setting_key: 'monthly_admin_fee', setting_value: fee.toString() });
    }

    res.status(200).json({ success: true, message: "Biaya admin bulanan berhasil diperbarui" });
  } catch (error) {
    console.error("Error updateMonthlyFee:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui biaya admin bulanan" });
  }
};

// Menghapus Mitra beserta data terkait (Tenants, Users, Wallet)
exports.deleteClient = async (req, res) => {
  try {
    const { id } = req.params;

    // Menggunakan query transaction agar aman (jika ada yg gagal, semua dibatalkan)
    await master.transaction(async (trx) => {
      // 1. Ambil daftar tenant_id milik owner ini
      const tenants = await trx('tenants').where('owner_id', id).select('id');
      const tenantIds = tenants.map(t => t.id);

      // 2. Hapus data users yang menginduk ke tenant tersebut
      if (tenantIds.length > 0) {
        await trx('users').whereIn('tenant_id', tenantIds).del();
      }

      // 3. Hapus data tenants
      await trx('tenants').where('owner_id', id).del();

      // 4. Hapus data wallet dompet
      await trx('wallet_topups').where('owner_id', id).del();
      await trx('wallet_transactions').where('owner_id', id).del();

      // 5. Terakhir, setelah semua dependensi bersih, hapus owner-nya
      await trx('owners').where('id', id).del();
    });

    res.status(200).json({ success: true, message: "Mitra dan data terkait berhasil dihapus" });
  } catch (error) {
    console.error("Error deleteClient:", error);
    res.status(500).json({ success: false, message: "Gagal menghapus mitra karena masih ada data yang terikat" });
  }
};

const bcrypt = require('bcryptjs'); // Pastikan package ini sudah di-install

// ============================================
// 7. MANAJEMEN PROFIL SUPERADMIN
// ============================================

exports.getProfile = async (req, res) => {
  try {
    // 🔒 Ambil HANYA akun superadmin yang sedang login (bukan sembarang superadmin)
    const admin = await master('users').where('id', req.user.id).first();

    if (!admin) {
        return res.status(404).json({ success: false, message: "Admin tidak ditemukan" });
    }

    res.status(200).json({ 
      success: true, 
      data: {
        id: admin.id,
        name: admin.name || "John Admin",
        email: admin.email
      } 
    });
  } catch (error) {
    console.error("Error getProfile:", error);
    res.status(500).json({ success: false, message: "Gagal memuat profil admin" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { name, email } = req.body;
    
    // 🔒 Update HANYA akun superadmin yang sedang login (cegah ubah semua superadmin)
    await master('users').where('id', req.user.id).update({
      name: name,
      email: email,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: "Profil berhasil diperbarui" });
  } catch (error) {
    console.error("Error updateProfile:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui profil admin" });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const admin = await master('users').where('id', req.user.id).first();
    if (!admin) {
        return res.status(404).json({ success: false, message: "Admin tidak ditemukan" });
    }

    // Verifikasi password saat ini
    const isMatch = await bcrypt.compare(currentPassword, admin.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Password saat ini tidak cocok" });
    }

    // Hash password baru
    const salt = await bcrypt.genSalt(10);
    const hashPassword = await bcrypt.hash(newPassword, salt);

    // 🔒 Ubah HANYA password akun yang sedang login
    await master('users').where('id', req.user.id).update({
      password: hashPassword,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: "Password berhasil diperbarui" });
  } catch (error) {
    console.error("Error updatePassword:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui password admin" });
  }
};

// LEADERBOARD (Top Mitra & Top PPOB)
exports.getLeaderboard = async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const lastDay = new Date(yr, mo, 0).getDate(); // hari terakhir bulan (benar utk Feb/30 hari)
    const startDate = `${month}-01 00:00:00`;
    const endDate   = `${month}-${String(lastDay).padStart(2, '0')} 23:59:59`;

    // 1. Top 5 Mitra Paling Aktif Bulan Ini
    // KITA KEMBALIKAN 'transaction_fee' agar transaksi POS kasir (seperti Abijaya) terhitung!
    // Hanya buang ppob_margin dan ppob_fee agar tidak dihitung dua kali
    const topMitra = await master('wallet_transactions as wt')
      .join('owners as o', 'o.id', 'wt.owner_id')
      .whereBetween('wt.created_at', [startDate, endDate])
      .whereNotIn('wt.type', ['ppob_margin', 'ppob_fee']) 
      .select('o.id', 'o.business_name')
      .count('wt.id as total_trx')
      .groupBy('o.id', 'o.business_name')
      .orderByRaw('COUNT(wt.id) DESC')
      .limit(5);

    // 2. Top 5 Produk PPOB Terlaris Bulan Ini
    const ppobTransactions = await master('wallet_transactions as wt')
      .where('wt.reference_type', 'ppob_orders')
      .whereNotIn('wt.type', ['transaction_fee', 'ppob_margin', 'ppob_fee'])
      .whereBetween('wt.created_at', [startDate, endDate])
      .select('wt.description');

    const productCounts = {};
    for (let trx of ppobTransactions) {
       const match = trx.description.match(/PPOB\s+([^\s]+)\s+untuk/i);
       let sku = match ? match[1] : trx.description; 
       
       if (!productCounts[sku]) {
          productCounts[sku] = 0;
       }
       productCounts[sku]++;
    }

    const sortedSkus = Object.keys(productCounts)
       .map(sku => ({ sku, total_sold: productCounts[sku] }))
       .sort((a, b) => b.total_sold - a.total_sold)
       .slice(0, 5);

    const topProducts = [];
    for (let item of sortedSkus) {
      const productDetail = await master('ppob_products')
        .whereRaw('LOWER(buyer_sku_code) = ?', [item.sku.toLowerCase()])
        .first();

      topProducts.push({
        product_name: productDetail ? productDetail.product_name : item.sku,
        total_sold: item.total_sold,
        buyer_sku_code: item.sku,
        category: productDetail ? productDetail.category : 'PPOB'
      });
    }

    res.json({
      success: true,
      data: { topMitra, topProducts }
    });

  } catch (e) {
    console.error('getLeaderboard error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};


// REKONSILIASI
exports.getReconciliation = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const rows = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      const dEnd = new Date(d);
      dEnd.setHours(23, 59, 59, 999);
      const dateStr = d.toISOString().slice(0, 10);

      const topupRow = await master('wallet_topups')
        .where('status', 'success')
        .whereBetween('paid_at', [d, dEnd])
        .select(master.raw('COALESCE(SUM(amount), 0) as total, COUNT(*) as cnt'))
        .first();

      const purchaseRow = await master('wallet_transactions')
        .whereIn('type', ['ppob_purchase'])
        .whereBetween('created_at', [d, dEnd])
        .select(master.raw('COALESCE(SUM(ABS(amount)), 0) as total, COUNT(*) as cnt'))
        .first();

      rows.push({
        date: dateStr,
        totalTopup: parseFloat(topupRow.total || 0),
        topupCount: parseInt(topupRow.cnt || 0),
        totalPurchase: parseFloat(purchaseRow.total || 0),
        purchaseCount: parseInt(purchaseRow.cnt || 0)
      });
    }
    res.json({ success: true, data: rows });
  } catch (e) {
    console.error('Reconciliation error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};

// AUDIT LOG
exports.getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20, module } = req.query;
    const offset = (page - 1) * limit;
    let q = master('admin_logs').orderBy('created_at', 'desc').limit(limit).offset(offset);
    if (module) q = q.where('module', module);
    const logs = await q;
    res.json({ success: true, data: logs });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
};

// LAPORAN BULANAN
// LAPORAN BULANAN
exports.getMonthlyReport = async (req, res) => {
  try {
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const [yr, mo] = month.split('-').map(Number);
    const lastDay = new Date(yr, mo, 0).getDate(); // hari terakhir bulan (benar utk Feb/30 hari)
    const startDate = `${month}-01 00:00:00`;
    const endDate   = `${month}-${String(lastDay).padStart(2, '0')} 23:59:59`;

    // 1. Dapatkan daftar mitra yang AKTIF melakukan transaksi di bulan tersebut
    const activeClients = await master('owners as o')
      .join('wallet_transactions as wt', 'wt.owner_id', 'o.id')
      .whereBetween('wt.created_at', [startDate, endDate])
      .select('o.id', 'o.business_name as nama_toko', 'o.email', 'o.phone as no_hp', 'o.status', 'o.created_at as tanggal_gabung')
      .groupBy('o.id', 'o.business_name', 'o.email', 'o.phone', 'o.status', 'o.created_at')
      .orderByRaw('COUNT(wt.id) DESC');

    // 2. Total transaksi bulan ini
    const countRow = await master('wallet_transactions')
      .whereBetween('created_at', [startDate, endDate])
      .count('id as total').first();
    const totalTransactions = parseInt(countRow.total) || 0;

    // 3. Estimasi laba bulan ini
    const year  = parseInt(month.slice(0, 4));
    const mon   = parseInt(month.slice(5, 7));
    const profitRow = await master('wallet_transactions')
      .whereIn('type', ['transaction_fee', 'ppob_margin', 'ppob_fee'])
      .whereRaw('YEAR(created_at) = ? AND MONTH(created_at) = ?', [year, mon])
      .select(master.raw('COALESCE(SUM(ABS(amount)), 0) as total')).first();
    const totalProfit = parseFloat(profitRow.total) || 0;

    // 4. Sample 200 transaksi untuk PDF/CSV
    const logs = await master('wallet_transactions as wt')
      .join('owners as o', 'o.id', 'wt.owner_id')
      .whereBetween('wt.created_at', [startDate, endDate])
      .select(
        'wt.id',
        master.raw("DATE_FORMAT(wt.created_at, '%Y-%m-%d %H:%i') as tanggal"),
        'o.business_name as nama_toko',
        'wt.type as tipe',
        'wt.description as produk',
        master.raw('ABS(wt.amount) as laba'),
        'wt.reference_type',
        'wt.reference_id'
      )
      .orderBy('wt.created_at', 'desc');

    const transactions = [];
    const uniqueMap = new Map();

    for (let l of logs) {
      const isTopup = l.tipe === 'topup' || l.tipe?.includes('topup');
      
      if (l.reference_type === 'ppob_orders') {
         const uniqueKey = 'ppob-' + l.reference_id;
         if (!uniqueMap.has(uniqueKey)) {
             uniqueMap.set(uniqueKey, {
                id:          l.id,
                tanggal:     l.tanggal,
                nama_toko:   l.nama_toko,
                tipe:        'PPOB',
                produk:      l.produk || '-',
                grand_total: 0,
                laba:        0,
                status:      'Sukses',
                ref_id:      l.reference_id || '-'
             });
             transactions.push(uniqueMap.get(uniqueKey));
         }
         
         const entry = uniqueMap.get(uniqueKey);
         if (l.tipe === 'ppob_purchase') {
            entry.grand_total += parseFloat(l.laba) || 0; // Tambahkan modal ke total
         } else {
            entry.laba += parseFloat(l.laba) || 0; // Ini adalah fee admin (laba)
            entry.grand_total += parseFloat(l.laba) || 0; // Tambahkan fee ke total bayar
         }
         continue;
      }

      transactions.push({
        id:          l.id,
        tanggal:     l.tanggal,
        nama_toko:   l.nama_toko,
        tipe:        l.reference_type === 'transactions' ? 'POS' : (l.tipe || '-'),
        produk:      l.produk || '-',
        grand_total: parseFloat(l.laba) || 0,
        laba:        isTopup ? 0 : (parseFloat(l.laba) || 0),
        status:      'Sukses',
        ref_id:      l.reference_id || '-'
      });
    }

    res.json({
      success: true,
      data: { newClients: activeClients, totalTransactions, totalProfit, transactions }
    });

  } catch (e) {
    console.error('Monthly report error:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
};
