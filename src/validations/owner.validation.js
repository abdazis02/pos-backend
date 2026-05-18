const Joi = require("joi")

const OwnerValidation = Joi.object({
  business_name: Joi.string().trim().required(),
  // 🔥 Tambahkan business_category di sini
  business_category: Joi.string().trim().valid(
    'Supermarket', 
    'Caffe', 
    'Restaurant', 
    'Toko Kecil', 
    'Warung Kecil', 
    'Lainnya'
  ).optional(), 
  email: Joi.string().trim().required().email(),
  phone: Joi.string().trim().allow(null, ''),
  address: Joi.string().trim().allow(null, '')
})

module.exports = OwnerValidation