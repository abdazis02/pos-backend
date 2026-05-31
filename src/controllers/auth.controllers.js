const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const response = require('../utils/response');
const UserModel = require('../models/user.model');
const OwnerModel = require('../models/owner.model');
const StoreModel = require('../models/store.model');
const ActivityLogModel = require('../models/activityLog.model');
const { getTenantConnection } = require('../config/knexTenant');
const master = require('../config/knexMaster');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const AuthController = {
  /* =====================================================
     LOGIN
  ===================================================== */
  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return response.error(res, null, 'Email dan password harus diisi!', 400);
      }

      // 🔥 Tambahkan business_category di sini
      let business_name, business_category, address, phone, store_name, stores = [];

      // ===== EMAIL CHECK from DB master =====
      const user = await UserModel.findByEmail(email);
      if (!user) {
        return response.error(res, null, 'Email atau password salah!', 401);
      }

      /* ================= PASSWORD CHECK ================= */
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return response.error(res, null, 'Email atau password salah!', 401);
      }

      const tenant = await OwnerModel.getTenantByID(user.tenant_id);

      if (user.role != 'superadmin' && user.role != 'superadmin2') {
        // 🔒 Blokir login bila mitra/owner berstatus 'suspended'. NULL/active/lainnya tetap lolos
        // (hanya status 'suspended' eksplisit yang ditolak, agar tidak mengunci akun yang sah).
        const ownerRow = await OwnerModel.getByTenantId(user.tenant_id);
        if (ownerRow && String(ownerRow.status || '').toLowerCase() === 'suspended') {
          return response.error(res, null, 'Akun mitra Anda sedang dinonaktifkan. Silakan hubungi admin PIPos.', 403);
        }

        const tenant_db = getTenantConnection(tenant);

        /* ================= DATA TAMBAHAN ================= */
        if (user.role === 'owner') {
          // 🔥 Mengambil business_name, business_category, address, phone
          const owner = await OwnerModel.getBussinesNameByTenantId(user.tenant_id);
          business_name = owner?.business_name;
          business_category = owner?.business_category;
          address = owner?.address;
          phone = owner?.phone;

          stores = await StoreModel.getAllStores(tenant_db);
          if (stores.length > 0) {
            user.store_id = stores[0].id;
          }
        }

        if (user.role === 'admin' || user.role === 'cashier') {
          const store = await StoreModel.findStoreById(tenant_db, user.store_id);
          store_name = store?.name;
        }

        /* ================= LOG ================= */
        await ActivityLogModel.create(tenant_db, {
          user_id: user.id,
          store_id: user.store_id,
          action: 'login',
          detail: 'Login berhasil'
        });
      }

      /* ================= JWT PAYLOAD ================= */
      const payload = {
        id: user.id,
        tenant_id: user.tenant_id,
        store_id: user.store_id,
        role: user.role,
        name: user.name,
        email: user.email,
        commission_rate: user.commission_rate, // 🔥
        db_name: tenant?.db_name,
        business_name,
        business_category, // 🔥 Masukkan kategori ke payload JWT
        address, // 🔥
        phone,   // 🔥
        store_name,
      };

      const token = jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || '1d' }
      );

      payload.stores = stores;
      payload.balance = await OwnerModel.getBalanceByTenant(master, user.tenant_id);
      delete payload.db_name;

      res.json({
        success: true,
        message: 'Login berhasil',
        token,
        user: payload
      });

    } catch (err) {
      console.error('LOGIN ERROR:', err);
      res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan server'
      });
    }
  },

  /* =====================================================
     GET PROFILE
  ===================================================== */
  async getProfile(req, res) {
    try {
      let stores = [];
      if (req.user.role == 'owner') {
        stores = await StoreModel.getAllByOwner(req.db);
      }

      res.json({
        success: true,
        user: {
          id: req.user.id,
          tenant_id: req.user.tenant_id,
          store_id: req.user.store_id,
          role: req.user.role,
          name: req.user.name,
          email: req.user.email,
          commission_rate: req.user.commission_rate, // 🔥
          business_name: req.user.business_name,
          business_category: req.user.business_category,
          address: req.user.address, // 🔥
          phone: req.user.phone,     // 🔥
          balance: req.user.tenant_id ? await OwnerModel.getBalanceByTenant(master, req.user.tenant_id) : 0, // 🔥 SAFE CHECK
          store_name: req.user.store_name,
          stores,
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, message: 'Gagal mengambil profil' });
    }
  },

  /* =====================================================
     LOGOUT
  ===================================================== */
  async logout(req, res) {
    try {
      if (req.user && req.user.db_name) {
        await ActivityLogModel.create(req.db, {
          user_id: req.user.id,
          store_id: req.user.store_id || null,
          action: 'logout',
          detail: 'Logout dari aplikasi'
        });
      }

      res.json({
        success: true,
        message: 'Logout berhasil'
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        message: 'Terjadi kesalahan server'
      });
    }
  },

  /* =====================================================
     GOOGLE AUTH CHECK
  ===================================================== */
  async googleAuth(req, res) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        return response.badRequest(res, 'Google ID Token wajib dikirim');
      }

      // 1. Verifikasi token ke Google
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      const email = payload['email'];
      const name = payload['name'];

      // 2. Cek apakah user sudah ada
      const user = await UserModel.findByEmail(email);

      if (user) {
        // User SUDAH TERDAFTAR -> Berikan JWT login langsung
        const tenant = await OwnerModel.getTenantByID(user.tenant_id);
        let stores = [];
        let store_name = null;

        if (user.role != 'superadmin' && user.role != 'superadmin2') {
          const tenant_db = getTenantConnection(tenant);

          if (user.role === 'owner') {
            stores = await StoreModel.getAllStores(tenant_db);
            if (stores.length > 0) user.store_id = stores[0].id;
          }

          if (user.role === 'admin' || user.role === 'cashier') {
            const store = await StoreModel.findStoreById(tenant_db, user.store_id);
            store_name = store?.name;
          }

          await ActivityLogModel.create(tenant_db, {
            user_id: user.id,
            store_id: user.store_id,
            action: 'login',
            detail: 'Login berhasil via Google'
          });
        }

        const jwtPayload = {
          id: user.id,
          tenant_id: user.tenant_id,
          store_id: user.store_id,
          role: user.role,
          name: user.name,
          email: user.email,
          db_name: tenant?.db_name,
          business_name: user.business_name,
          business_category: user.business_category,
          address: user.address,
          phone: user.phone,
          store_name,
        };

        const token = jwt.sign(
          jwtPayload,
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRE || '1d' }
        );

        jwtPayload.stores = stores;
        jwtPayload.balance = await OwnerModel.getBalanceByTenant(master, user.tenant_id);
        delete jwtPayload.db_name;

        return res.json({
          success: true,
          isNewUser: false,
          message: 'Login Google berhasil',
          token,
          user: jwtPayload
        });
      } else {
        // User BARU -> Minta isi data tambahan di Flutter
        return res.json({
          success: true,
          isNewUser: true,
          message: 'Akun Google valid, silakan lengkapi profil bisnis Anda.',
          googleData: { email, name }
        });
      }

    } catch (err) {
      console.error('GOOGLE AUTH ERROR:', err);
      return res.status(401).json({
        success: false,
        message: 'Verifikasi Google gagal atau token kadaluarsa'
      });
    }
  },

  /* =====================================================
     REGISTER VIA GOOGLE (WITH EXTRA INFO)
  ===================================================== */
  async registerGoogle(req, res) {
    const {
      email, name, business_name, business_category,
      phone, province, city, district, subdistrict, address,
      password, idToken
    } = req.body;

    if (!email || !business_name || !password || !idToken) {
      return response.badRequest(res, 'Data pendaftaran tidak lengkap.');
    }

    try {
      // 1. Verifikasi ulang ID Token (Keamanan)
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const googlePayload = ticket.getPayload();
      if (googlePayload['email'] !== email) {
        return response.forbidden(res, 'Email tidak sesuai dengan token Google.');
      }

      // 2. Cek duplikasi email
      const existingEmail = await UserModel.findByEmail(email);
      if (existingEmail) return response.badRequest(res, 'Email sudah terdaftar.');

      // 3. Alur pendaftaran
      let db_name, db_user, db_pass, owner_id, tenant_id;
      const trx = await master.transaction();

      try {
        owner_id = (await trx("owners").insert({
          business_name,
          business_category: business_category || 'lainnya',
          email,
          phone,
          address, // Detail alamat
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
          name: name,
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
        throw err;
      }

      // 4. Setup Database Tenant
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

      // Buat toko pertama default (Simpan alamat lengkap)
      const [store_id] = await tenant_db("stores").insert({
        name: business_name,
        address: address, // Simpan alamat lengkap ke sini juga jika perlu
        phone: phone,
        // Optional: Simpan field wilayah jika tabel stores mendukung
      });

      // 5. Kembalikan Login Response
      const user = await UserModel.findByEmail(email);
      const jwtPayload = {
        id: user.id,
        tenant_id: user.tenant_id,
        store_id: store_id,
        role: user.role,
        name: user.name,
        email: user.email,
        commission_rate: user.commission_rate, // 🔥
        db_name: db_name,
        business_name,
        business_category,
        address,
        phone,
      };

      const token = jwt.sign(
        jwtPayload,
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRE || '1d' }
      );

      delete jwtPayload.db_name;
      jwtPayload.stores = await StoreModel.getAllStores(tenant_db);
      jwtPayload.balance = 0;

      return response.success(res, {
        token,
        user: jwtPayload
      }, 'Pendaftaran berhasil! Selamat datang di PIPos.');

    } catch (err) {
      console.error('REGISTER GOOGLE ERROR:', err);
      return response.error(res, err, 'Gagal mendaftar via Google');
    }
  }
};

module.exports = AuthController;