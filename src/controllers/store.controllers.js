const response = require('../utils/response');
const StoreModel = require('../models/store.model');
const ActivityLogModel = require('../models/activityLog.model');
const { move, remove } = require('../utils/uploaded_file');
const { pageValidations } = require('../validations/page.validation');
const { storeValidations } = require('../validations/store.validation');

// 🔒 Jangan pernah kirim server key (rahasia gateway) ke client.
function stripStoreSecret(store) {
  if (store) delete store.midtrans_server_key;
  return store;
}

const StoreController = {
  // Get all stores for current owner
  async list(req, res) {
    try {
      const { value, error } = pageValidations.validate(req.query);
      if (error) {
        return response.badRequest(res, error.details[0].message);
      }

      const offset = (value.page - 1) * value.itemsPerPage;
      const [stores, total, filtered] = await Promise.all(
        StoreModel.paginateStores(req.db, offset, value.itemsPerPage, value.q)
      );

      stores.forEach(stripStoreSecret);
      return response.success(res, {
        items: stores,
        total: total.cnt,
        filtered: filtered.cnt,
      });
    } catch (error) {
      return response.error(res, error, 'Terjadi kesalahan saat mengambil data toko');
    }
  },

  // Create new store
  async create(req, res) {
    try {
      const { value, error } = storeValidations.validate(req.body, { abortEarly: true, stripUnknown: true });
      if (error)
        return response.badRequest(res, error.details[0].message, error.details)

      // Ambil path gambar dari upload jika ada
      if (req.file) {
        value.logo_url = move(req.file, req.user.tenant_id);
      }

      const storeId = await StoreModel.createStore(req.db, value);

      // Logging aktivitas: tambah toko
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: storeId,
        action: 'add_store',
        detail: `Tambah toko: ${value.name}`
      });

      const store = await StoreModel.findStoreById(req.db, storeId);
      if (!store) return response.error(res, 'Gagal membuat toko');

      return response.created(res, stripStoreSecret(store), 'Toko berhasil dibuat');
    } catch (error) {
      return response.error(res, error, 'Terjadi kesalahan saat membuat toko');
    }
  },

  // Get single store
  async getStore(req, res) {
    try {
      const { id } = req.params;

      const store = await StoreModel.findStoreById(req.db, id);
      if (!store) return response.notFound(res, 'Toko tidak ditemukan');

      return response.success(res, stripStoreSecret(store), 'Data toko berhasil diambil');
    } catch (error) {
      console.error('Get store by ID error:', error);
      return response.error(res, error, 'Terjadi kesalahan saat mengambil data toko');
    }
  },

  // Update store
  async update(req, res) {
    try {
      const { id } = req.params;

      const { value, error } = storeValidations.validate(req.body, { abortEarly: true, stripUnknown: true });
      if (error)
        return response.badRequest(res, error.details[0].message, error.details)

      const storeExists = await StoreModel.findStoreById(req.db, id);
      if (!storeExists)
        return response.notFound(res, 'Toko tidak ditemukan');

      // Jika ada file gambar baru
      if (req.file) {
        value.logo_url = move(req.file, req.user.tenant_id);
      }

      const updateData = {};
      if (!!value.name) updateData.name = value.name;
      if (!!value.business_category) updateData.business_category = value.business_category;
      if (!!value.address) updateData.address = value.address;
      if (!!value.phone) updateData.phone = value.phone;
      if (!!value.tax_percentage) updateData.tax_percentage = value.tax_percentage;
      if (!!value.midtrans_merchan_id) updateData.midtrans_merchan_id = value.midtrans_merchan_id;
      if (!!value.midtrans_client_key) updateData.midtrans_client_key = value.midtrans_client_key;
      if (!!value.midtrans_server_key) updateData.midtrans_server_key = value.midtrans_server_key;
      if (!!value.logo_url) updateData.logo_url = value.logo_url;

      if (Object.keys(updateData).length === 0) {
        return response.badRequest(res, 'Tidak ada data yang diupdate');
      }

      const isUpdated = await StoreModel.updateStore(req.db, id, updateData);
      if (!isUpdated) return response.error(res, 'Gagal mengupdate toko', 400);

      const updatedStore = await StoreModel.findStoreById(req.db, id);

      // Logging aktivitas: update pengaturan toko
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: id,
        action: 'update_setting',
        detail: 'Update pengaturan toko'
      });

      if (storeExists.logo_url && updateData.logo_url && storeExists.logo_url != updateData.logo_url) {
        remove(storeExists.logo_url);
      }

      return response.success(res, stripStoreSecret(updatedStore), 'Toko berhasil diupdate');
    } catch (error) {
      console.error('Update store error:', error);
      if (error.code === 'ER_DUP_ENTRY') {
        return response.badRequest(res, 'Nama toko sudah digunakan untuk owner ini');
      }
      return response.error(res, error, 'Terjadi kesalahan saat mengupdate toko');
    }
  },

  // Delete store
  async delete(req, res) {
    try {
      const { id } = req.params;

      const storeExists = await StoreModel.findStoreById(req.db, id);
      if (!storeExists) return response.notFound(res, 'Toko tidak ditemukan');

      const isDeleted = await StoreModel.deleteStore(req.db, id);
      if (!isDeleted) return response.error(res, null, 'Gagal menghapus toko');

      // Logging aktivitas: hapus toko
      await ActivityLogModel.create(req.db, {
        user_id: req.user.id,
        store_id: null,
        action: 'delete_store',
        detail: `Hapus toko: ${storeExists.name}`
      });

      return response.success(res, null, 'Toko berhasil dihapus');
    } catch (error) {
      console.error('Delete store error:', error);
      if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        return response.badRequest(res, 'Toko tidak dapat dihapus karena masih memiliki data terkait (produk, transaksi, dll)');
      }

      return response.error(res, 'Terjadi kesalahan saat menghapus toko', 500, error);
    }
  },

  // Get store statistics (additional feature)
  async getStats(req, res) {
    try {
      const stores = await StoreModel.getAllByOwner(req.db);
      const storeCount = stores.length;

      const stats = {
        total_stores: storeCount,
        active_stores: storeCount,
        stores_by_location: {},
        recent_activity: stores.slice(0, 5).map(store => ({
          id: store.id,
          name: store.name,
          last_updated: store.updated_at || store.created_at
        }))
      };

      return response.success(res, stats, 'Statistik toko berhasil diambil');
    } catch (error) {
      console.error('Get store stats error:', error);
      return response.error(res, 'Terjadi kesalahan saat mengambil statistik toko', 500, error);
    }
  },

  // Bulk update stores (optional feature)
  async bulkUpdate(req, res) {
    return response.success(res, {
      message: 'Bulk update feature coming soon',
      note: 'This feature is under development'
    });
  },
};

module.exports = StoreController;