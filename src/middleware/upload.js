const multer = require('multer');
const FileType = require('file-type');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  async fileFilter(req, file, cb) {
    if (file && file.buffer) {
      try {
        const fileType = await FileType.fromBuffer(file.buffer);
        if (!fileType.mime.startsWith('image/')) {
          return cb(new Error('Invalid file'))
        }
      } catch (error) {
        console.error('Error detecting file type:', error);
        cb(error)
      }
    }

    cb(null, true)
  }
});

module.exports = upload;