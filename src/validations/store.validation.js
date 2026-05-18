const Joi = require("joi");

const storeValidations = Joi.object({
  name: Joi.string().required().trim(),
  address: Joi.string().trim().allow(null, ''),
  phone: Joi.string().trim().allow(null, ''),
  tax_percentage: Joi.number().min(0).max(100).allow(null, ''),
  midtrans_merchan_id: Joi.string().trim().allow(null, ""),
  midtrans_client_key: Joi.string().trim().allow(null, ""),
  midtrans_server_key: Joi.string().trim().allow(null, ""),
})

module.exports = { storeValidations }