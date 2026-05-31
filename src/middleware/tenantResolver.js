const master = require("../config/knexMaster");
const { getTenantConnection } = require("../config/knexTenant");

// Cache kredensial tenant (db_user/db_pass) per db_name agar tidak query master tiap request.
// Penting: JWT TIDAK menyimpan db_user/db_pass, jadi tanpa lookup ini koneksi tenant akan
// dibuat dengan kredensial undefined setelah restart/di instance lain.
const tenantCredCache = {};

module.exports = async (req, res, next) => {
  // 🔥 BYPASS: Superadmin tidak butuh tenant db resolver
  if (req.user && (req.user.role === 'superadmin' || req.user.role === 'superadmin2')) {
    return next();
  }

  if (!req.user || !req.user.db_name) {
    return res.status(400).json({
      success: false,
      message: 'Tenant database (db_name) tidak ditemukan di token. Pastikan login dengan token yang benar.'
    });
  }

  try {
    let cred = tenantCredCache[req.user.db_name];
    if (!cred) {
      const tenant = await master('tenants').where('db_name', req.user.db_name).first();
      if (!tenant) {
        return res.status(400).json({ success: false, message: 'Tenant tidak ditemukan.' });
      }
      cred = { db_name: tenant.db_name, db_user: tenant.db_user, db_pass: tenant.db_pass };
      tenantCredCache[req.user.db_name] = cred;
    }

    req.db = getTenantConnection(cred);
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Gagal menyiapkan koneksi tenant.' });
  }
};
