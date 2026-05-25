const { getTenantConnection } = require("../config/knexTenant");

module.exports = (req, res, next) => {
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

  req.db = getTenantConnection({ db_name: req.user.db_name })

  next();
};
