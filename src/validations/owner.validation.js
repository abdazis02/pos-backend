const Joi = require("joi")

const OwnerValidation = Joi.object({
  business_name: Joi.string().trim().required(),
  // 🔥 Tambahkan business_category di sini
  business_category: Joi.string().trim().valid(
    'ritel_minimarket',
    'konter_elektronik',
    'makanan_minuman',
    'jasa_agen',
    'fashion_aksesoris',
    'kesehatan_kecantikan',
    'otomotif_bengkel',
    'distributor_grosir',
    'lainnya'
  ).optional(), 
  email: Joi.string().trim().required().email(),
  phone: Joi.string().trim().allow(null, ''),
  address: Joi.string().trim().allow(null, '')
})

module.exports = OwnerValidation