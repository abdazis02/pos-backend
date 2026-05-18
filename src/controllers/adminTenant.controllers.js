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
    // 🔥 TAMBAHKAN business_category dan address di sini
    const { business_name, business_category, email, phone, address, password } = req.body;

    // Validasi sederhana
    if (!business_name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Data tidak lengkap.' });
    }

    let db_name, db_user, db_pass, owner_id, tenant_id;

    const trx = await master.transaction()

    try {
      // 🔥 Masukkan business_category dan address ke tabel 'owners'
      owner_id = (await trx("owners").insert({ 
        business_name, 
        business_category: business_category || 'lainnya', // Simpan kategori
        email, 
        phone, 
        address, // Simpan alamat lengkap dari Flutter
        status: 'active',
        wallet_balance: 0
      }))[0];

      db_name = `kasir_tenant_${owner_id}`;
      db_user = `user_${owner_id}`;
      db_pass = require('crypto').randomBytes(16).toString('hex');

      tenant_id = (await trx("tenants").insert({ owner_id, db_name, db_user, db_pass }))[0];

      const hashedPassword = await bcrypt.hash(password, 10);
      
      // 🔥 Masukkan juga business_category ke tabel 'users' agar muncul saat login/profile
      await trx("users").insert({
        tenant_id: tenant_id,
        name: business_name,
        email: email,
        password: hashedPassword,
        role: 'owner',
        business_category: business_category || 'lainnya', // PENTING: Untuk deteksi PPOB di Sidebar
        is_active: true,
        verified_at: trx.fn.now(),
      });

      await trx.commit();
    } catch (err) {
      await trx.rollback();
      console.error("Error Create Owner:", err);
      return response.error(res, err, 'Data tenant gagal ditambahkan!', 500);
    }

    try {
      await master.raw(`CREATE DATABASE IF NOT EXISTS ??`, [db_name]);

      // 🔥 Buat user untuk '%' DAN 'localhost' agar pasti bisa konek secara lokal
      await master.raw(`CREATE USER IF NOT EXISTS ??@'%' IDENTIFIED BY ?`, [db_user, db_pass]);
      await master.raw(`CREATE USER IF NOT EXISTS ??@'localhost' IDENTIFIED BY ?`, [db_user, db_pass]);

      // 🔥 Beri akses untuk kedua host tersebut
      await master.raw(`GRANT ALL PRIVILEGES ON \`${db_name}\`.* TO ??@'%'`, [db_user]);
      await master.raw(`GRANT ALL PRIVILEGES ON \`${db_name}\`.* TO ??@'localhost'`, [db_user]);

      await master.raw(`GRANT SELECT ON \`${process.env.DB_NAME}\`.\`users\` TO ??@'%'`, [db_user]);
      await master.raw(`GRANT SELECT ON \`${process.env.DB_NAME}\`.\`users\` TO ??@'localhost'`, [db_user]);

      await master.raw(`FLUSH PRIVILEGES`);

      const tenant_db = getTenantConnection({ db_name, db_user, db_pass });

      await tenant_db.migrate.latest({ directory: './migrations/tenant' })

      await tenant_db("stores").insert({
        name: `${business_name} Store`,
        address: address, // 🔥 Simpan alamat ke database tenant
        phone: phone      // 🔥 Simpan no hp ke database tenant
      });

      console.log('Registrasi klien & database tenant berhasil!');

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

  // Update owner info
  async update(req, res) {
    const { id } = req.params;
    // 🔥 Pastikan address, phone, dan kategori juga bisa diupdate
    const { business_name, business_category, email, phone, address } = req.body;

    try {
      await master("owners").where("id", id).update({ 
        business_name, 
        business_category, 
        email, 
        phone, 
        address 
      });

      // Update juga di tabel users agar sinkron saat login
      await master("users").where({ email: email, role: 'owner' }).update({
        business_category
      });

      response.success(res, null, 'Tenant updated!');
    } catch (err) {
      response.error(res, err, err.message, 500);
    }
  },

  // Delete owner (dan database tenant)
  async delete(req, res) {
    const { id } = req.params;

    const trx = await master.transaction()

    try {
      // Get db_name
      const tenant = await trx("tenants").where('owner_id', id).first();
      if (!tenant)
        return response.notFound(res, 'Tenant not found!');

      // Hapus data di master DB
      await trx("users").where('tenant_id', id).delete();
      await trx("tenants").where('owner_id', id).delete();
      await trx("owners").where('id', id).delete();

      // Hapus database dan user tenant
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

      let total = 0, aktif = 0, suspend = 0, expired = 0;
      let totalSaldo = 0;

      owners.forEach(c => {
        total++;
        totalSaldo += parseFloat(c.wallet_balance || 0);
        if (c.status === 'active') aktif++;
        else if (c.status === 'suspended') suspend++;
        else if (c.status === 'terminated') expired++;
      });

      response.success(res, { total, aktif, suspend, expired, totalSaldo });
    } catch (err) {
      response.error(res, err, err.message, 500);
    }
  },

  async detail(req, res) {
    const { id } = req.params;

    try {
      // Ambil data client (owner, tenant)
      const owner = await master("owners as o").leftJoin("tenants as t", "o.id", "t.owner_id").where("o.id", id).first(master.raw(`
        o.id, o.business_name, o.email, o.phone, o.created_at, o.status AS owner_status,
        t.id as tenant_id, t.db_name, t.db_user, t.db_pass
      `)).orderBy("o.id", "desc")

      if (!owner)
        return response.notFound(res, 'Tenant not found!');

      // Statistik users tenant
      const stats = await master("users").where("tenant_id", owner.tenant_id).first(master.raw(`
        COUNT(*) AS total,
        SUM(is_active) as active
      `))

      response.success(res, {
        ...owner,
        ...stats,
      });
    } catch (err) {
      response.error(res, err, err.message, 500);
    }
  }
};

module.exports = AdminClientController;