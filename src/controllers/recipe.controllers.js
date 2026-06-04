const Joi = require('joi');
const response = require('../utils/response');
const ProductRecipeModel = require('../models/productRecipe.model');
const IngredientModel = require('../models/ingredient.model');
const ProductModel = require('../models/product.model');

const recipeSchema = Joi.object({
  items: Joi.array().items(
    Joi.object({
      ingredient_id: Joi.number().integer().required(),
      quantity: Joi.number().min(0).required(),
    })
  ).default([]),
  // Jika true, HPP hasil hitung otomatis mengisi cost_price (harga modal) produk.
  apply_hpp: Joi.boolean().default(true),
});

const RecipeController = {
  // GET /:store_id/products/:product_id/recipe
  async get(req, res) {
    try {
      const { store_id, product_id } = req.params;
      const items = await ProductRecipeModel.getByProduct(req.db, store_id, product_id);

      // Hitung HPP dari resep saat ini.
      const hpp = items.reduce(
        (sum, r) => sum + parseFloat(r.quantity || 0) * parseFloat(r.cost_price || 0),
        0
      );
      return response.success(res, { items, hpp }, 'Resep produk');
    } catch (e) {
      console.error('❌ ERROR GET RECIPE:', e);
      return response.error(res, e, 'Gagal memuat resep');
    }
  },

  // PUT /:store_id/products/:product_id/recipe  { items:[{ingredient_id, quantity}], apply_hpp }
  async replace(req, res) {
    try {
      const { store_id, product_id } = req.params;
      const { value, error } = recipeSchema.validate(req.body, { stripUnknown: true });
      if (error) return response.badRequest(res, error.details[0].message, error.details);

      const product = await ProductModel.findProductById(req.db, store_id, product_id);
      if (!product) return response.notFound(res, 'Produk tidak ditemukan');

      // Hanya simpan baris dengan takaran > 0.
      const cleanItems = (value.items || []).filter(
        (it) => it.ingredient_id && parseFloat(it.quantity) > 0
      );

      // Validasi: semua ingredient_id milik toko ini.
      let hpp = 0;
      if (cleanItems.length) {
        const ids = [...new Set(cleanItems.map((i) => i.ingredient_id))];
        const ingredients = await IngredientModel.getByIds(req.db, store_id, ids);
        const byId = new Map(ingredients.map((i) => [i.id, i]));
        for (const it of cleanItems) {
          if (!byId.has(it.ingredient_id)) {
            return response.badRequest(res, `Bahan id ${it.ingredient_id} tidak ditemukan di toko ini`);
          }
          hpp += parseFloat(it.quantity) * parseFloat(byId.get(it.ingredient_id).cost_price || 0);
        }
      }

      await req.db.transaction(async (trx) => {
        const rows = cleanItems.map((it) => ({
          store_id: parseInt(store_id),
          product_id: parseInt(product_id),
          ingredient_id: it.ingredient_id,
          quantity: it.quantity,
        }));
        await ProductRecipeModel.replaceForProduct(trx, store_id, product_id, rows);

        // Auto-isi HPP ke harga modal produk (hanya bila resep ada isinya & diminta).
        if (value.apply_hpp && cleanItems.length) {
          await ProductModel.updateProduct(trx, store_id, product_id, { cost_price: hpp });
        }
      });

      const items = await ProductRecipeModel.getByProduct(req.db, store_id, product_id);
      return response.success(res, { items, hpp, applied_hpp: !!(value.apply_hpp && cleanItems.length) }, 'Resep disimpan');
    } catch (e) {
      console.error('❌ ERROR SAVE RECIPE:', e);
      return response.error(res, e, 'Gagal menyimpan resep');
    }
  },
};

module.exports = RecipeController;
