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
    const ownerStats = await master('owners')
      .where('status', 'active')
      .sum('wallet_balance as total_saldo')
      .count('id as total_mitra')
      .first();

    const revenueStats = await master('wallet_transactions')
      .whereIn('type', ['transaction_fee', 'ppob_margin', 'ppob_fee'])
      .sum('amount as total_potongan')
      .count('id as total_trx')
      .first();

    const totalPendapatan = (revenueStats.total_potongan || 0) * -1;
    const transaksiSukses = revenueStats.total_trx || 0;

    res.status(200).json({
      success: true,
      data: {
        saldoPusat: ownerStats.total_saldo || 0,
        totalPendapatan: totalPendapatan,
        transaksiSukses: transaksiSukses,
        mitraAktif: ownerStats.total_mitra || 0
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
    const limit = req.query.limit ? parseInt(req.query.limit) : 100;

    // 1. Ambil log dasar dari master database
    const logs = await master('wallet_transactions as wt')
      .join('owners as o', 'o.id', 'wt.owner_id')
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
        'o.id as owner_id'
      )
      .orderBy('wt.created_at', 'desc')
      .limit(limit);

    const enrichedLogs = [];
    const { getTenantConnection } = require('../config/knexTenant');

    // 2. Hubungkan secara dinamis ke database tenant untuk mengambil detail finansial asli
    for (const log of logs) {
      let total_cost = 0;
      let transaction_fee = 0;
      let payment_method = 'Saldo Dompet';
      let status = 'Sukses';

      try {
        const tenant = await master('tenants').where('owner_id', log.owner_id).first();
        
        if (tenant) {
          const tenantDb = getTenantConnection(tenant);

          // JIKA TRANSAKSI KASIR (POS)
          if (log.reference_type === 'transactions') {
            const tx = await tenantDb('transactions').where('id', log.reference_id).first();
            if (tx) {
              total_cost = tx.total_cost || 0;
              payment_method = tx.payment_method || 'CASH';
              status = tx.payment_status === 'paid' ? 'Sukses' : (tx.payment_status === 'pending' ? 'Pending' : 'Gagal');
            }
            // Margin POS diambil dari transaction_fee yang dipotong per transaksi
            transaction_fee = Math.abs(log.amount);

          // JIKA TRANSAKSI LAYANAN PPOB
          } else if (log.reference_type === 'ppob_orders') {
            const order = await tenantDb('ppob_orders').where('id', log.reference_id).first();
            if (order) {
              total_cost = order.sale_price || 0;
              status = order.status === 'success' ? 'Sukses' : (order.status === 'pending' ? 'Pending' : 'Gagal');
              payment_method = 'Saldo Dompet';
            }
            // Margin PPOB diambil dari fee/margin transaksi tersebut
            transaction_fee = Math.abs(log.amount);
          }
        }
      } catch (err) {
        console.error(`Gagal menarik detail database tenant untuk log ID ${log.id}:`, err);
      }

      // Pastikan format properti sinkron 100% dengan kebutuhan komponen React Anda
      enrichedLogs.push({
        id: log.id,
        tanggal: log.tanggal,
        nama_toko: log.nama_toko,
        tipe: log.reference_type === 'transactions' ? 'POS' : (log.reference_type === 'ppob_orders' ? 'PPOB' : log.tipe),
        produk: log.produk,
        grand_total: total_cost || Math.abs(log.amount), // Total cost transaksi dari mitra
        laba: transaction_fee || Math.abs(log.amount),  // Transaction fee / margin yang dipotong
        metode_pembayaran: payment_method,
        status: status,
        ref_id: log.reference_id || '-'
      });
    }

    res.status(200).json({ success: true, data: enrichedLogs });
  } catch (error) {
    console.error("Error getTransactions:", error);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server" });
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
    // Sesuaikan nama tabel 'users' dengan tabel admin di database Anda
    const admin = await master('users').where('role', 'superadmin').first(); 
    
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
    
    // Sesuaikan parameter where() sesuai cara Anda mengenali Superadmin
    await master('users').where('role', 'superadmin').update({
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

    const admin = await master('users').where('role', 'superadmin').first();
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

    await master('users').where('role', 'superadmin').update({
      password: hashPassword,
      updated_at: new Date()
    });

    res.status(200).json({ success: true, message: "Password berhasil diperbarui" });
  } catch (error) {
    console.error("Error updatePassword:", error);
    res.status(500).json({ success: false, message: "Gagal memperbarui password admin" });
  }
};