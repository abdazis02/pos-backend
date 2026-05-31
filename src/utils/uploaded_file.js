const fs = require('fs');
const path = require('path');

module.exports.move = (file, tenant_id) => {
  // 🔒 Sanitasi nama file: buang komponen direktori (cegah path traversal) & karakter aneh
  const safeOriginal = path.basename(String(file.originalname || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeTenant = String(tenant_id).replace(/[^0-9]/g, '') || '0';
  const filename = Date.now() + '-' + safeOriginal;
  const baseDir = path.join(__dirname, '../../uploads', `tenant_${safeTenant}`);
  const target = path.join(baseDir, filename);
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

  fs.writeFileSync(target, file.buffer)

  return path.relative(path.join(__dirname, '../../'), target).replace(/\\/g, '/');
}

module.exports.remove = (filepath) => {
  if (!filepath) return;

  const root = path.join(__dirname, '../../');
  const resolved = path.resolve(root, filepath);
  // 🔒 Pastikan target tetap di dalam folder uploads (cegah hapus file sembarangan)
  const uploadsRoot = path.join(root, 'uploads');
  if (!resolved.startsWith(uploadsRoot)) return;

  if (fs.existsSync(resolved)) {
    fs.rmSync(resolved)
  }
}