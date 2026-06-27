const Joi = require("joi");

const productValidation = {
  bulkUpdate: (req, res, next) => {
    const { product_ids, update_data } = req.body;
    const errors = [];

    // Validate product_ids
    if (!Array.isArray(product_ids) || product_ids.length === 0) {
      errors.push('Daftar ID produk harus berupa array tidak kosong');
    } else {
      product_ids.forEach((id, index) => {
        if (isNaN(parseInt(id))) {
          errors.push(`ID produk ke-${index + 1} tidak valid`);
        }
      });
    }

    // Validate update_data
    if (!update_data || typeof update_data !== 'object' || Object.keys(update_data).length === 0) {
      errors.push('Data update harus diisi');
    } else {
      // Only allow certain fields for bulk update
      const allowedFields = ['price', 'stock', 'is_active'];
      const providedFields = Object.keys(update_data);

      providedFields.forEach(field => {
        if (!allowedFields.includes(field)) {
          errors.push(`Field '${field}' tidak diperbolehkan untuk bulk update`);
        }
      });

      // Validate price if provided
      if (update_data.price !== undefined) {
        if (isNaN(parseFloat(update_data.price)) || parseFloat(update_data.price) < 0) {
          errors.push('Harga harus berupa angka positif');
        }
      }

      // Validate stock if provided
      if (update_data.stock !== undefined) {
        if (isNaN(parseInt(update_data.stock)) || parseInt(update_data.stock) < 0) {
          errors.push('Stok harus berupa angka positif');
        }
      }

      // Validate is_active if provided
      if (update_data.is_active !== undefined) {
        if (typeof update_data.is_active !== 'boolean') {
          errors.push('is_active harus berupa boolean');
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Validasi bulk update gagal',
        errors
      });
    }

    // Parse values
    req.body.product_ids = product_ids.map(id => parseInt(id));
    if (update_data.price !== undefined) update_data.price = parseFloat(update_data.price);
    if (update_data.stock !== undefined) update_data.stock = parseInt(update_data.stock);

    next();
  }
};

const productValidations = Joi.object({
  name: Joi.string().required().max(255).trim(),
  sku: Joi.string().allow(null, '').max(20).trim(),
  barcode: Joi.string().allow(null, '').max(100).trim(),
  price: Joi.number().required().positive(),
  cost_price: Joi.number().allow(null, '').positive(),
  without_stock: Joi.boolean().default(false),
  stock: Joi.when('without_stock', {
    switch: [
      { is: true, then: Joi.allow(null, '') },
      { is: false, then: Joi.number().min(0).integer() }
    ]
  }),
  // Izinkan string apa pun (dinamis), boleh kosong atau null
  category: Joi.string().allow('', null).optional(),
  description: Joi.string().allow(null, '').trim().optional(),
  image_url: Joi.string().allow(null, '').uri().trim(),
  is_active: Joi.boolean().default(true),
  discount_type: Joi.string().allow(null, '').valid('percentage', 'nominal', 'buyxgety', 'bundle'),
  discount_value: Joi.when('discount_type', {
    switch: [
      { is: 'percentage', then: Joi.number().required().positive().max(100) },
      { is: 'nominal', then: Joi.number().required().positive() },
    ],
    otherwise: Joi.any().strip().default(null)
  }),
  discount_bundle_min_qty: Joi.when('discount_type', {
    is: 'bundle',
    then: Joi.number().required().greater(0).integer(),
    otherwise: Joi.any().strip().default(null)
  }),
  discount_bundle_value: Joi.when('discount_type', {
    is: 'bundle',
    then: Joi.number().required().greater(0),
    otherwise: Joi.any().strip().default(null)
  }),
  buy_qty: Joi.when('discount_type', {
    is: 'buyxgety',
    then: Joi.number().required().greater(0).integer(),
    otherwise: Joi.any().strip().default(null)
  }),
  free_qty: Joi.when('discount_type', {
    is: 'buyxgety',
    then: Joi.number().required().greater(0).integer(),
    otherwise: Joi.any().strip().default(null)
  }),
  expired_date: Joi.date().iso().allow(null, ""), // 🔥 Tambahan
  batch_number: Joi.string().trim().allow(null, ""), // 🔥 Tambahan
  wholesale_price: Joi.number().min(0).allow(null, ""), // 🔥 Tambahan
  min_wholesale_qty: Joi.number().integer().min(1).allow(null, ""), // 🔥 Tambahan
  // Satuan jual (khusus laundry: 'kg'). Tanpa default & tanpa '' agar saat tidak
  // dikirim nilainya tidak ikut ditulis (tidak menimpa produk lain).
  sell_unit: Joi.string().valid('pcs', 'kg').allow(null), // 🔥 laundry
})

// module.exports = productValidation;
module.exports.productValidation = productValidations