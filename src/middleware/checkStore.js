const response = require("../utils/response");

/**
 * @type {import("express").RequestHandler}
 */
module.exports = (req, res, next) => {
  const { role } = req.user;
  if ((role === 'admin' || role === 'cashier') && req.params.store_id != req.user.store_id) {
    return response.forbidden(res, 'Admin / Kasir hanya bisa akses di tokonya.');
  }

  next()
}