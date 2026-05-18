const { getTenantConnection } = require("../config/knexTenant");

module.exports = (req, res, next) => {
  if (!req.user || !req.user.db_name) {
    return res.status(400).json({
      success: false,
      message: 'Tenant database (db_name) tidak ditemukan di token. Pastikan login dengan token yang benar.'
    });
  }

  req.db = getTenantConnection({ db_name: req.user.db_name })

  next();
};