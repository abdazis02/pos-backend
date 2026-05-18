const Joi = require('joi');
const response = require('../utils/response');
const ProductReturnModel = require('../models/productReturn.model');
const ProductModel = require('../models/product.model');
const ActivityLogModel = require('../models/activityLog.model');
const { move, remove } = require('../utils/uploaded_file');
const { pageValidations } = require('../validations/page.validation');

const validation = pageValidations.keys({
  status: Joi.string().allow(null, ''),
});

// Validation schema for creating return
const createReturnValidation = Joi.object({
  product_id: Joi.number().integer().required(),
  quantity: Joi.number().integer().min(1).required(),
  note: Joi.string().allow('', null),
});

// Validation schema for updating return status
const updateStatusValidation = Joi.object({
  status: Joi.string().valid('pending', 'approved', 'rejected').required(),
});

const ProductReturnController = {
  // Get all returns for a store
  async list(req, res) {
    try {
      const { value, error } = validation.validate(req.query);
      if (error) {
        return response.badRequest(res, error.details[0].message, error.details);
      }

      const { store_id } = req.params;
      const offset = (value.page - 1) * value.itemsPerPage;

      const [returns, total, filtered] = await Promise.all(
        ProductReturnModel.paginateReturns(req.db, store_id, offset, value.itemsPerPage, {
          status: value.status,
          search: value.q
        })
      );

      return response.success(res, {
        items: returns,
        total: total.cnt,
        filtered: filtered.cnt
      });
    } catch (error) {
      console.error('GetAll Returns Error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengambil data return');
    }
  },

  // Get return by ID
  async getById(req, res) {
    try {
      const { store_id, id } = req.params;
      
      const returnData = await ProductReturnModel.findById(req.db, store_id, id);
      
      if (!returnData) {
        return response.notFound(res, 'Data return tidak ditemukan');
      }

      return response.success(res, returnData);
    } catch (error) {
      console.error('Get Return By ID Error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengambil data return');
    }
  },

  // Get returns by product ID
  async getByProductId(req, res) {
    try {
      const { store_id, product_id } = req.params;
      
      const returns = await ProductReturnModel.findByProductId(req.db, store_id, product_id);
      
      return response.success(res, returns);
    } catch (error) {
      console.error('Get Returns By Product ID Error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengambil data return');
    }
  },

  // Create new return request
  async create(req, res) {
    try {
      const { value, error } = createReturnValidation.validate(req.body);
      if (error) {
        return response.badRequest(res, error.details[0].message, error.details);
      }

      const { store_id } = req.params;
      const { product_id, quantity, note } = value;

      // Verify product exists
      const product = await ProductModel.findProductById(req.db, store_id, product_id);
      if (!product) {
        return response.notFound(res, 'Produk tidak ditemukan');
      }

      // Check if quantity is valid
      if (quantity > product.stock) {
        return response.badRequest(res, `Stok produk tidak mencukupi (tersedia: ${product.stock})`);
      }

      // Handle multiple photos
      let photoPaths = [];
      if (req.files && req.files.length > 0) {
        photoPaths = req.files.map(file => move(file, req.user.tenant_id));
      }

      // Create return record
      const returnData = {
        store_id,
        product_id,
        quantity,
        note: note || null,
        photos: photoPaths.length > 0 ? JSON.stringify(photoPaths) : null,
        user_id: req.user.id,
        status: 'pending',
        created_at: req.db.fn.now(),
        updated_at: req.db.fn.now()
      };

      const returnId = await ProductReturnModel.create(req.db, returnData);

      // Log activity
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id,
        action: 'CREATE_RETURN',
        detail: `Membuat request return untuk produk ${product.name} sebanyak ${quantity} pcs`
      });

      const newReturn = await ProductReturnModel.findById(req.db, store_id, returnId);
      
      return response.created(res, newReturn, 'Request return berhasil dibuat');
    } catch (error) {
      console.error('Create Return Error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat membuat request return');
    }
  },

  // Update return status (approve/reject)
  async updateStatus(req, res) {
    try {
      const { value, error } = updateStatusValidation.validate(req.body);
      if (error) {
        return response.badRequest(res, error.details[0].message, error.details);
      }

      const { store_id, id } = req.params;
      const { status } = value;

      // Check if return exists
      const returnData = await ProductReturnModel.findById(req.db, store_id, id);
      if (!returnData) {
        return response.notFound(res, 'Data return tidak ditemukan');
      }

      // Check if return is already processed
      if (returnData.status !== 'pending') {
        return response.badRequest(res, 'Return sudah diproses sebelumnya');
      }

      // Update status
      await ProductReturnModel.updateStatus(req.db, store_id, id, status);

      // If approved, reduce product stock
      if (status === 'approved') {
        await ProductModel.subProductStock(req.db, store_id, returnData.product_id, returnData.quantity);

        // Log activity
        await ActivityLogModel.create(req.db, {
          user_id: req.user.id,
          store_id,
          action: 'APPROVE_RETURN',
          detail: `Menyetujui return produk ${returnData.product_name} sebanyak ${returnData.quantity} pcs`
        });
      } else if (status === 'rejected') {
        // Log activity
        await ActivityLogModel.create(req.db, {
          user_id: req.user.id,
          store_id,
          action: 'REJECT_RETURN',
          detail: `Menolak return produk ${returnData.product_name} sebanyak ${returnData.quantity} pcs`
        });
      }

      const updatedReturn = await ProductReturnModel.findById(req.db, store_id, id);
      
      return response.success(res, updatedReturn, `Return berhasil ${status === 'approved' ? 'disetujui' : 'ditolak'}`);
    } catch (error) {
      console.error('Update Return Status Error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengupdate status return');
    }
  },

  // Delete return
  async delete(req, res) {
    try {
      const { store_id, id } = req.params;

      // Check if return exists
      const returnData = await ProductReturnModel.findById(req.db, store_id, id);
      if (!returnData) {
        return response.notFound(res, 'Data return tidak ditemukan');
      }

      // Only allow delete for pending returns
      if (returnData.status !== 'pending') {
        return response.badRequest(res, 'Hanya return dengan status pending yang dapat dihapus');
      }

      // Remove photos if exists
      if (returnData.photos) {
        photos.forEach(photo => remove(photo));
      }

      await ProductReturnModel.delete(req.db, store_id, id);

      // Log activity
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id,
        action: 'DELETE_RETURN',
        detail: `Menghapus request return untuk produk ${returnData.product_name}`
      });

      return response.success(res, null, 'Return berhasil dihapus');
    } catch (error) {
      console.error('Delete Return Error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat menghapus return');
    }
  }
};

module.exports = ProductReturnController;