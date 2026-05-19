/**
 * Timezone Utility — Konversi timestamp ke WIT (Waktu Indonesia Timur, UTC+9)
 *
 * Best practice:
 * - Database tetap menyimpan dalam UTC (tidak diubah)
 * - Semua response API dikonversi ke WIT sebelum dikirim ke client
 */

const WIT_OFFSET_MS = 9 * 60 * 60 * 1000; // UTC+9 dalam milidetik

/**
 * Konversi Date/string/null ke format WIT ISO string
 * Output: "2026-05-20T03:31:06+09:00"
 */
function toWIT(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return date; // kembalikan apa adanya jika tidak valid

  // Geser ke UTC+9
  const witDate = new Date(d.getTime() + WIT_OFFSET_MS);
  // Buat ISO string manual agar suffix +09:00 (bukan Z)
  const iso = witDate.toISOString().replace('Z', '+09:00');
  return iso;
}

/**
 * Dapatkan waktu sekarang dalam format WIT ISO string
 */
function nowWIT() {
  return toWIT(new Date());
}

/**
 * Konversi semua field timestamp dalam sebuah object/array ke WIT
 * Fields yang dikonversi: created_at, updated_at, deleted_at, paid_at, expired_at, date, time, timestamp
 */
const TIMESTAMP_FIELDS = [
  'created_at', 'updated_at', 'deleted_at',
  'paid_at', 'expired_at', 'start_date', 'end_date',
  'report_date', 'date', 'timestamp'
];

function convertToWIT(data) {
  if (!data) return data;

  // Handle array
  if (Array.isArray(data)) {
    return data.map(item => convertToWIT(item));
  }

  // Handle object
  if (typeof data === 'object' && !(data instanceof Date)) {
    const result = { ...data };
    for (const field of TIMESTAMP_FIELDS) {
      if (result[field] !== undefined && result[field] !== null) {
        result[field] = toWIT(result[field]);
      }
    }
    return result;
  }

  return data;
}

module.exports = { toWIT, nowWIT, convertToWIT };
