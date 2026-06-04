const Joi = require('joi');
const response = require('../utils/response');
const IngredientModel = require('../models/ingredient.model');

const ingredientSchema = Joi.object({
  name: Joi.string().required().trim().max(255),
  unit: Joi.string().trim().max(20).allow(null, '').default('gr'),
  cost_price: Joi.number().min(0).allow(null, '').default(0),
  stock: Joi.number().min(0).allow(null, '').default(0),
  min_stock: Joi.number().min(0).allow(null, '').default(0),
  is_active: Joi.boolean().default(true),
});

const IngredientController = {
  // GET /:store_id/ingredients  (list semua / paginated bila ada page)
  async list(req, res) {
    try {
      const { store_id } = req.params;
      const onlyActive = req.query.active === undefined ? false : req.query.active === 'true';

      // Tanpa pagination → kembalikan semua (untuk picker resep & layar master).
      const items = await IngredientModel.listAll(req.db, store_id, onlyActive);
      return response.success(res, { items }, 'Daftar bahan baku');
    } catch (e) {
      console.error('❌ ERROR LIST INGREDIENT:', e);
      return response.error(res, e, 'Gagal memuat bahan baku');
    }
  },

  async create(req, res) {
    try {
      const { store_id } = req.params;
      const { value, error } = ingredientSchema.validate(req.body, { stripUnknown: true });
      if (error) return response.badRequest(res, error.details[0].message, error.details);

      value.store_id = parseInt(store_id);
      ['cost_price', 'stock', 'min_stock'].forEach((f) => {
        if (value[f] === '' || value[f] === null || value[f] === undefined) value[f] = 0;
      });
      if (!value.unit) value.unit = 'gr';

      const id = await IngredientModel.create(req.db, value);
      const created = await IngredientModel.getById(req.db, store_id, id);
      return response.created(res, created, 'Bahan baku ditambahkan');
    } catch (e) {
      console.error('❌ ERROR CREATE INGREDIENT:', e);
      return response.error(res, e, 'Gagal menambah bahan baku');
    }
  },

  async update(req, res) {
    try {
      const { store_id, id } = req.params;
      const { value, error } = ingredientSchema.validate(req.body, { stripUnknown: true });
      if (error) return response.badRequest(res, error.details[0].message, error.details);

      const existing = await IngredientModel.getById(req.db, store_id, id);
      if (!existing) return response.notFound(res, 'Bahan baku tidak ditemukan');

      ['cost_price', 'stock', 'min_stock'].forEach((f) => {
        if (value[f] === '' || value[f] === null || value[f] === undefined) value[f] = 0;
      });
      if (!value.unit) value.unit = 'gr';

      await IngredientModel.update(req.db, store_id, id, value);
      const updated = await IngredientModel.getById(req.db, store_id, id);
      return response.success(res, updated, 'Bahan baku diperbarui');
    } catch (e) {
      console.error('❌ ERROR UPDATE INGREDIENT:', e);
      return response.error(res, e, 'Gagal memperbarui bahan baku');
    }
  },

  async remove(req, res) {
    try {
      const { store_id, id } = req.params;
      const existing = await IngredientModel.getById(req.db, store_id, id);
      if (!existing) return response.notFound(res, 'Bahan baku tidak ditemukan');

      await IngredientModel.delete(req.db, store_id, id);
      return response.success(res, null, 'Bahan baku dihapus');
    } catch (e) {
      console.error('❌ ERROR DELETE INGREDIENT:', e);
      return response.error(res, e, 'Gagal menghapus bahan baku');
    }
  },

  // PUT /:store_id/ingredients/:id/add-stock  { amount }
  async addStock(req, res) {
    try {
      const { store_id, id } = req.params;
      const amount = parseFloat(req.body.amount);
      if (isNaN(amount) || amount <= 0) return response.badRequest(res, 'Jumlah tambah stok tidak valid');

      const existing = await IngredientModel.getById(req.db, store_id, id);
      if (!existing) return response.notFound(res, 'Bahan baku tidak ditemukan');

      await IngredientModel.addStock(req.db, store_id, id, amount);
      const updated = await IngredientModel.getById(req.db, store_id, id);
      return response.success(res, updated, 'Stok bahan ditambahkan');
    } catch (e) {
      console.error('❌ ERROR ADDSTOCK INGREDIENT:', e);
      return response.error(res, e, 'Gagal menambah stok bahan');
    }
  },
};

module.exports = IngredientController;
