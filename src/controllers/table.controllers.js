const response = require('../utils/response');
const TableModel = require('../models/table.model');

const TableController = {
  async list(req, res) {
    try {
      const tables = await TableModel.getAllByStore(req.db);
      return response.success(res, tables);
    } catch (error) {
      return response.error(res, error, 'Gagal mengambil data meja');
    }
  },

  async create(req, res) {
    try {
      const { table_number, capacity } = req.body;
      if (!table_number) return response.badRequest(res, 'Nomor meja wajib diisi');

      const id = await TableModel.create(req.db, { table_number, capacity });
      const table = await TableModel.findById(req.db, id);

      return response.created(res, table, 'Meja berhasil ditambahkan');
    } catch (error) {
      return response.error(res, error, 'Gagal menambah meja');
    }
  },

  async update(req, res) {
    try {
      const { id } = req.params;
      const { table_number, capacity, status } = req.body;

      const isUpdated = await TableModel.update(req.db, id, { table_number, capacity, status });
      if (!isUpdated) return response.notFound(res, 'Meja tidak ditemukan');

      const table = await TableModel.findById(req.db, id);
      return response.success(res, table, 'Meja berhasil diperbarui');
    } catch (error) {
      return response.error(res, error, 'Gagal memperbarui meja');
    }
  },

  async delete(req, res) {
    try {
      const { id } = req.params;
      const isDeleted = await TableModel.delete(req.db, id);
      if (!isDeleted) return response.notFound(res, 'Meja tidak ditemukan');

      return response.success(res, null, 'Meja berhasil dihapus');
    } catch (error) {
      return response.error(res, error, 'Gagal menghapus meja');
    }
  }
};

module.exports = TableController;
