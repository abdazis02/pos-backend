const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const response = require('../utils/response');
const UserModel = require('../models/user.model');
const OwnerModel = require('../models/owner.model');
const StoreModel = require('../models/store.model');
const ActivityLogModel = require('../models/activityLog.model');
const { getTenantConnection } = require('../config/knexTenant');
const master = require('../config/knexMaster');

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
          business_name: req.user.business_name,
          business_category: req.user.business_category,
          address: req.user.address, // 🔥
          phone: req.user.phone,     // 🔥
          balance: await OwnerModel.getBalanceByTenant(master, req.user.tenant_id),
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
  }
};

module.exports = AuthController;