const multer = require('multer');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    // Catatan: dengan memoryStorage, file.buffer BELUM terisi saat fileFilter dipanggil,
    // sehingga validasi magic-byte (file-type) tidak pernah berjalan di sini.
    // Validasi via mimetype yang dideklarasikan klien untuk menolak tipe non-gambar.
    if (file && typeof file.mimetype === 'string' && file.mimetype.startsWith('image/')) {
      return cb(null, true);
    }
    return cb(new Error('File harus berupa gambar'));
  }
});

module.exports = upload;