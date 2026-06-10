const Joi = require('joi');

const transactionItemSchema = Joi.object({
  product_id: Joi.number().required(),
  qty: Joi.number().integer().min(1).required(),
  notes: Joi.string().allow('', null).trim(),
  handled_by: Joi.number().integer().min(1).allow(null), // 🔥 FIX: Gunakan integer().min(1) bukan unsigned()
});

const transactionValidations = Joi.object({
  payment_method: Joi.string().required().valid('cash', 'qris', 'qris_static'),
  payment_status: Joi.string().valid('pending', 'paid').default('paid'),
  received_amount: Joi.when('payment_method', {
    not: 'qris',
    then: Joi.number().min(0).required(),
    otherwise: Joi.any().strip().default(0)
  }),
  notes: Joi.string().allow(null, ''),
  // BARIS TRANSAKSI OFFLINE DITERIMA
  created_at: Joi.any().optional(),
  table_id: Joi.number().integer().min(1).allow(null), // 🔥 FIX: Gunakan integer().min(1) bukan unsigned()

  items: Joi.array()
    .items(transactionItemSchema)
    .min(1)
    .required()
    .custom((value, helpers) => {
      const ids = value.map(i => i.product_id);
      if (ids.length !== new Set(ids).size) {
        return helpers.message('Duplicate product_id in items');
      }

      return value;
    })
});

const refundValidations = Joi.object({
  reason: Joi.string().allow('', null).trim(),
  refund_items: Joi.array()
    .items(Joi.object({
      product_id: Joi.number().required(),
      qty: Joi.number().integer().min(1).required()
    }))
    .min(1)
    .required()
});

const payLaterValidations = Joi.object({
  payment_method: Joi.string().required().valid('cash'),
  received_amount: Joi.number().min(0).required(),
});

module.exports = { transactionValidations, refundValidations, payLaterValidations };
