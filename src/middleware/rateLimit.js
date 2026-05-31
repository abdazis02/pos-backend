// Rate limiter sederhana berbasis memori (tanpa dependensi tambahan).
// Cocok untuk 1 instance. Untuk multi-instance, gunakan store bersama (mis. Redis).
function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keyGenerator } = {}) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = keyGenerator
      ? keyGenerator(req)
      : (req.ip || (req.connection && req.connection.remoteAddress) || 'unknown');

    let rec = hits.get(key);
    if (!rec || now - rec.start > windowMs) {
      rec = { count: 0, start: now };
    }
    rec.count++;
    hits.set(key, rec);

    // Bersihkan entri kedaluwarsa sesekali agar map tidak membengkak
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (now - v.start > windowMs) hits.delete(k);
      }
    }

    if (rec.count > max) {
      return res.status(429).json({
        success: false,
        message: 'Terlalu banyak percobaan. Silakan coba lagi beberapa saat lagi.'
      });
    }
    next();
  };
}

module.exports = rateLimit;
