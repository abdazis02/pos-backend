const Joi = require("joi")

const OwnerValidation = Joi.object({
  business_name: Joi.string().trim().required(),
  // 🔥 Tambahkan business_category di sini
  business_category: Joi.string().trim().valid(
    'ritel_minimarket',
    'makanan_minuman',
    'kesehatan_kecantikan',
    'jasa_agen',
    'laundry',
    'lainnya'
  ).optional(),
  email: Joi.string().trim().required().email(),
  phone: Joi.string().trim().allow(null, ''),
  address: Joi.string().trim().allow(null, '')
})

module.exports = OwnerValidation