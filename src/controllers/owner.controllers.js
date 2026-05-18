const response = require('../utils/response');
const OwnerModel = require('../models/owner.model');
const ActivityLogModel = require('../models/activityLog.model');
const OwnerValidation = require('../validations/owner.validation');

const OwnerController = {
  /* =====================================================
     GET OWNER DATA
  ===================================================== */
  async getOwner(req, res) {
    try {
      const owner = await OwnerModel.getByTenantId(req.user.tenant_id);
      if (!owner) return response.notFound(res, 'Owner tidak ditemukan');

      return response.success(res, owner);
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil data owner');
    }
  },

  /* =====================================================
     UPDATE OWNER DATA & CATEGORY
  ===================================================== */
  async updateOwner(req, res) {
    try {
      // Validasi input (termasuk business_category jika ada)
      const { value, error } = OwnerValidation.validate(req.body);
      if (error) {
        return response.badRequest(res, error.message, error.details);
      }

      const owner = await OwnerModel.getByTenantId(req.user.tenant_id);
      if (!owner) return response.notFound(res, 'Owner tidak ditemukan');

      // Update data di database master
      const isUpdated = await OwnerModel.updateById(owner.id, value);
      if (!isUpdated) return response.badRequest(res, 'Owner gagal diupdate');

      // Logging aktivitas: update owner
      if (req.db) {
        await ActivityLogModel.create(req.db, {
          user_id: req.user.id || null,
          store_id: req.user.store_id || null,
          action: 'update_owner',
          detail: `Update data/kategori owner: ${owner.id}`
        });
      }

      const updated = await OwnerModel.getByTenantId(req.user.tenant_id);
      return response.success(res, updated, 'Owner berhasil diupdate');
    } catch (err) {
      console.error('UPDATE OWNER ERROR:', err);
      return response.error(res, err, 'Gagal update data owner');
    }
  }
};

module.exports = OwnerController;