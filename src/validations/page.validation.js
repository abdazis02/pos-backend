const Joi = require("joi")

const pageValidations = Joi.object({
  page: Joi.number().min(1).default(1),
  itemsPerPage: Joi.number().allow(-1).min(5).max(100).default(10),
  q: Joi.string().allow(null, '')
})

module.exports = { pageValidations }