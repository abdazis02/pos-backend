const bcrypt = require('bcryptjs');
const master = require('../config/knexMaster');
const response = require('../utils/response');
const { getTenantConnection } = require('../config/knexTenant');

const AdminClientController = {
  // List all clients
  async index(req, res) {
    try {
      const rows = await master("owners as o").leftJoin("tenants as t", "o.id", "t.owner_id").select(master.raw(`
        o.id, o.business_name, o.email, o.phone, o.created_at, o.status AS owner_status,
        o.wallet_balance,
        t.db_name, t.db_user, t.db_pass
      `)).orderBy("o.id", "desc");
      response.success(res, rows);
    } catch (err) {
      response.error(res, err, err.message, 500);
    }
  },

  async create(req, res) {
    const { business_name, business_category, email, phone, address, password } = req.body;
    if (!business_name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });
    }

    let db_name, db_user, db_pass, owner_id, tenant_id;
    const trx = await master.transaction();

    try {
      owner_id = (await trx("owners").insert({
        business_name,
        business_category: business_category || 'lainnya',
        email,
        phone,
        address,
        status: 'active',
        wallet_balance: 0
      }))[0];

      db_name = `kasir_tenant_${owner_id}`;
      db_user = `user_${owner_id}`;
      db_pass = require('crypto').randomBytes(16).toString('hex');

      tenant_id = (await trx("tenants").insert({ owner_id, db_name, db_user, db_pass }))[0];
      const hashedPassword = await bcrypt.hash(password, 10);

      await trx("users").insert({
        tenant_id: tenant_id,
        name: business_name,
        email: email,
        password: hashedPassword,
        role: 'owner',
        business_category: business_category || 'lainnya',
        is_active: true,
        verified_at: trx.fn.now(),
      });

      await trx.commit();
    } catch (err) {
      await trx.rollback();
      return response.error(res, err, 'Data tenant gagal ditambahkan!', 500);
    }

    try {
      await master.raw(`CREATE DATABASE IF NOT EXISTS ??`, [db_name]);
      await master.raw(`CREATE USER IF NOT EXISTS ??@'%' IDENTIFIED BY ?`, [db_user, db_pass]);
      await master.raw(`CREATE USER IF NOT EXISTS ??@'localhost' IDENTIFIED BY ?`, [db_user, db_pass]);
      await master.raw(`GRANT ALL PRIVILEGES ON \`${db_name}\`.* TO ??@'%'`, [db_user]);
      await master.raw(`GRANT ALL PRIVILEGES ON \`${db_name}\`.* TO ??@'localhost'`, [db_user]);
      await master.raw(`GRANT SELECT ON \`${process.env.DB_NAME}\`.\`users\` TO ??@'%'`, [db_user]);
      await master.raw(`GRANT SELECT ON \`${process.env.DB_NAME}\`.\`users\` TO ??@'localhost'`, [db_user]);
      await master.raw(`FLUSH PRIVILEGES`);

      const tenant_db = getTenantConnection({ db_name, db_user, db_pass });
      await tenant_db.migrate.latest({ directory: './migrations/tenant' });

      await tenant_db("stores").insert({
        name: business_name,
        address: address,
        phone: phone
      });
      response.created(res, null, 'Data tenant berhasil ditambahkan!');
    } catch (err) {
      await master("users").where({ tenant_id }).delete();
      await master("tenants").where({ id: tenant_id }).delete();
      await master("owners").where({ id: owner_id }).delete();
      await master.raw(`DROP DATABASE IF EXISTS ??`, [db_name]);
      await master.raw(`DROP USER IF EXISTS ??@'%'`, [db_user]);
      await master.raw(`DROP USER IF EXISTS ??@'localhost'`, [db_user]);
      response.error(res, err, 'Data tenant gagal ditambahkan!', 500);
    }
  },

  async update(req, res) {
    const { id } = req.params;
    const { business_name, business_category, email, phone, address } = req.body;
    try {
      await master("owners").where("id", id).update({ business_name, business_category, email, phone, address });
      await master("users").where({ email: email, role: 'owner' }).update({ business_category });
      response.success(res, null, 'Tenant updated!');
    } catch (err) {
      response.error(res, err, err.message, 500);
    }
  },

  async delete(req, res) {
    const { id } = req.params;
    const trx = await master.transaction();
    try {
      const tenant = await trx("tenants").where('owner_id', id).first();
      if (!tenant) return response.notFound(res, 'Tenant not found!');
      await trx("users").where('tenant_id', id).delete();
      await trx("tenants").where('owner_id', id).delete();
      await trx("owners").where('id', id).delete();
      await master.raw(`DROP DATABASE IF EXISTS \`${tenant.db_name}\``);
      await master.raw(`DROP USER IF EXISTS ??@'%'`, [tenant.db_user]);
      await master.raw(`DROP USER IF EXISTS ??@'localhost'`, [tenant.db_user]);
      trx.commit();
      response.success(res, null, 'Tenant deleted!');
    } catch (err) {
      trx.rollback();
      response.error(res, err, err.message, 500);
    }
  },

  async stats(req, res) {
    try {
      const owners = await master("owners").select('*');

      let total = 0, aktif = 0, suspend = 0, blokir = 0;
      let saldoMitra = 0;

      owners.forEach(c => {
        total++;
        saldoMitra += parseFloat(c.wallet_balance || 0);
        if (c.status === 'active' || c.status === 'Aktif') aktif++;
        else if (c.status === 'suspended' || c.status === 'Suspend') suspend++;
        else blokir++;
      });

      // 1. Tarik Saldo Asli Perusahaan dari Digiflazz
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

      // 2. Hitung Total Transaksi (All Time & Hari Ini)
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

      response.success(res, { 
        saldoDigiflazz, 
        saldoMitra, 
        totalTransaksiAllTime, 
        totalTransaksiHariIni, 
        mitraAktif: aktif, 
        mitraSuspend: suspend, 
        mitraBlokir: blokir 
      });
    } catch (err) {
      response.error(res, err, err.message, 500);
    }
  },

  async detail(req, res) {
    const { id } = req.params;
    try {
      const owner = await master("owners as o").leftJoin("tenants as t", "o.id", "t.owner_id").where("o.id", id).first(master.raw(`
        o.id, o.business_name, o.email, o.phone, o.created_at, o.status AS owner_status,
        t.id as tenant_id, t.db_name, t.db_user, t.db_pass
      `)).orderBy("o.id", "desc");

      if (!owner) return response.notFound(res, 'Tenant not found!');

      const stats = await master("users").where("tenant_id", owner.tenant_id).first(master.raw(`
        COUNT(*) AS total,
        SUM(is_active) as active
      `));

      response.success(res, { ...owner, ...stats });
    } catch (err) {
      response.error(res, err, err.message, 500);
    }
  },

  async approveTopup(req, res) {
    const { id } = req.params;
    const trx = await master.transaction();
    
    try {
      const topup = await trx("wallet_topups").where({ id, status: 'pending' }).first();
      
      if (!topup) {
        await trx.rollback();
        return res.status(404).json({ success: false, message: "Topup tidak ditemukan atau sudah diproses." });
      }

      // Update status topup
      await trx("wallet_topups").where({ id }).update({
        status: 'success',
        paid_at: master.fn.now()
      });

      // Ambil saldo owner
      const owner = await trx("owners as o").forUpdate().where('o.id', topup.owner_id).first('o.wallet_balance');
      const currentBalance = parseFloat(owner.wallet_balance) || 0;
      const topupAmount = parseFloat(topup.amount) || 0;
      const newBalance = currentBalance + topupAmount;

      // Catat mutasi transaksi
      await trx("wallet_transactions").insert({
        owner_id: topup.owner_id,
        type: 'topup',
        amount: topup.amount,
        balance_after: newBalance,
        reference_type: 'wallet_topups',
        reference_id: topup.id,
        description: `Topup saldo lewat Konfirmasi Manual (Admin)`
      });

      // Tambah saldo
      await trx("owners").where({ id: topup.owner_id }).update({
        wallet_balance: newBalance
      });

      await trx.commit();
      res.json({ success: true, message: "Topup berhasil disetujui, saldo mitra telah ditambahkan." });
    } catch (e) {
      await trx.rollback();
      console.error('Approve topup error:', e.message);
      res.status(500).json({ success: false, message: "Terjadi kesalahan server saat menyetujui topup." });
    }
  },

  async rejectTopup(req, res) {
    const { id } = req.params;
    
    try {
      const topup = await master("wallet_topups").where({ id, status: 'pending' }).first();
      
      if (!topup) {
        return res.status(404).json({ success: false, message: "Topup tidak ditemukan atau sudah diproses." });
      }

      // Update status topup menjadi failed
      await master("wallet_topups").where({ id }).update({
        status: 'failed'
      });

      res.json({ success: true, message: "Topup berhasil ditolak." });
    } catch (e) {
      console.error('Reject topup error:', e.message);
      res.status(500).json({ success: false, message: "Terjadi kesalahan server saat menolak topup." });
    }
  },

  async getPendingTopups(req, res) {
    try {
      const topups = await master("wallet_topups as wt")
        .join("owners as o", "o.id", "wt.owner_id")
        .where("wt.status", "pending")
        .where("wt.payment_method", "manual_bca")
        .select(
          "wt.id",
          "o.business_name as nama_toko",
          "wt.amount",
          "wt.payment_method",
          "wt.created_at"
        )
        .orderBy("wt.created_at", "desc");
        
      res.json({ success: true, data: topups });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  }
};

module.exports = AdminClientController;
