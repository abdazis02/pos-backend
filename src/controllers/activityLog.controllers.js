const response = require('../utils/response');
const ActivityLogModel = require('../models/activityLog.model');
const { pageValidations } = require('../validations/page.validation');

const ActivityLogController = {
  async list(req, res) {
    try {
      const { store_id } = req.params;

      // Ambil pagination dari query
      const { value, error } = pageValidations.validate(req.query)
      if (error) {
        return response.badRequest(res, error.details[0].message, error.details);
      }

      // Query log & total
      const offset = (value.page - 1) * value.itemsPerPage;
      const [items, total, filtered] = await Promise.all(
        ActivityLogModel.paginateActivityLogs(req.db, store_id, offset, value.itemsPerPage, value.q)
      );

      // Format untuk frontend
      const mapped = items.map(log => ({
        id: log.id,
        user: log.name,
        action: log.action,
        title: mapActionToTitle(log.action),
        detail: log.detail,
        time: log.created_at
      }));

      return response.success(res, {
        items: mapped,
        total: total.cnt,
        filtered: filtered.cnt,
      });
    } catch (err) {
      return response.error(res, err, 'Gagal mengambil log aktivitas');
    }
  }
};

function mapActionToTitle(action) {
  switch (action) {
    case 'login': return 'Login berhasil';
    case 'add_product': return 'Produk ditambahkan';
    case 'transaction': return 'Transaksi dibuat';
    case 'update_setting': return 'Pengaturan diubah';
    // ...tambahkan mapping lain sesuai kebutuhan...
    default: return 'Aktivitas';
  }
}

module.exports = ActivityLogController;