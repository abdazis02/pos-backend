const master = require('../config/knexMaster');

/**
 * Middleware Audit Log — catat aksi admin ke tabel admin_logs
 * Cara pakai: router.post('/endpoint', requireSuperadmin, auditLog('ACTION', 'module', 'Deskripsi'), controller)
 */
const auditLog = (action, module, descriptionFn) => {
  return async (req, res, next) => {
    // Simpan referensi ke res.json asli
    const originalJson = res.json.bind(res);

    res.json = async (body) => {
      // Hanya catat jika response sukses (status 2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const userId   = req.user?.id || req.admin?.id || null;
          const userName = req.user?.name || req.user?.username || req.admin?.name || 'Admin';
          const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';

          // descriptionFn bisa berupa string atau fungsi yang menerima req
          const description = typeof descriptionFn === 'function'
            ? descriptionFn(req, body)
            : (descriptionFn || action);

          await master('admin_logs').insert({
            user_id:     userId,
            user_name:   userName,
            action:      action,
            module:      module,
            description: description,
            ip_address:  ip,
            created_at:  new Date()
          });
        } catch (err) {
          console.error('[AuditLog] Gagal mencatat log:', err.message);
        }
      }
      return originalJson(body);
    };

    next();
  };
};

module.exports = auditLog;
