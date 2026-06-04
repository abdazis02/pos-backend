const express = require('express');
const router = express.Router();
const checkStore = require('../middleware/checkStore');
const tenantResolver = require('../middleware/tenantResolver');
const authMiddleware = require('../middleware/auth');
const IngredientController = require('../controllers/ingredient.controllers');
const RecipeController = require('../controllers/recipe.controllers');

// ===== MASTER BAHAN BAKU =====
router.get(
  '/:store_id/ingredients',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  IngredientController.list
);

router.post(
  '/:store_id/ingredients',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  IngredientController.create
);

router.put(
  '/:store_id/ingredients/:id/add-stock',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  IngredientController.addStock
);

router.put(
  '/:store_id/ingredients/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  IngredientController.update
);

router.delete(
  '/:store_id/ingredients/:id',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  IngredientController.remove
);

// ===== RESEP / KOMPOSISI PRODUK =====
router.get(
  '/:store_id/products/:product_id/recipe',
  authMiddleware(['owner', 'admin', 'cashier']),
  tenantResolver,
  checkStore,
  RecipeController.get
);

router.put(
  '/:store_id/products/:product_id/recipe',
  authMiddleware(['owner', 'admin']),
  tenantResolver,
  checkStore,
  RecipeController.replace
);

module.exports = router;
