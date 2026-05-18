const fs = require('fs');
const path = require('path');

module.exports.move = (file, tenant_id) => {
  const filename = Date.now() + '-' + file.originalname
  const target = path.join(__dirname, '../../uploads', `tenant_${tenant_id}`, filename);
  if (!fs.existsSync(path.dirname(target))) fs.mkdirSync(path.dirname(target), { recursive: true });

  fs.writeFileSync(target, file.buffer)

  return path.relative(path.join(__dirname, '../../'), target).replace(/\\/g, '/');
}

module.exports.remove = (filepath) => {
  filepath = path.join(__dirname, '../../', filepath);

  if (fs.existsSync(filepath)) {
    fs.rmSync(filepath)
  }
}