const https = require('https');
const crypto = require('crypto');

const _stripQuotes = (s) => s ? s.replace(/^["']|["']$/g, '').trim() : s;

const DIGIFLAZZ_URL = _stripQuotes(process.env.DIGIFLAZZ_URL) || 'https://api.digiflazz.com';
const DIGIFLAZZ_USERNAME = _stripQuotes(process.env.DIGIFLAZZ_USERNAME);
const DIGIFLAZZ_API_KEY = _stripQuotes(process.env.DIGIFLAZZ_API_KEY);

function buildSignature({ username, ref_id = '', tr_id = '' }) {
  const signKey = tr_id ? tr_id : ref_id;
  return crypto
    .createHash('md5')
    .update(`${username}${DIGIFLAZZ_API_KEY}${signKey}`)
    .digest('hex');
}

function buildCustomerNoSignature(customer_no) {
  return crypto
    .createHash('md5')
    .update(`${DIGIFLAZZ_USERNAME}${DIGIFLAZZ_API_KEY}${customer_no}`)
    .digest('hex');
}

function sendDigiflazzRequest(path, payload) {
  if (!DIGIFLAZZ_USERNAME || !DIGIFLAZZ_API_KEY) {
    throw new Error('Digiflazz credentials belum diset di environment variables');
  }

  payload.username = DIGIFLAZZ_USERNAME;

  if (payload.ref_id || payload.tr_id) {
    payload.sign = buildSignature(payload);
  }

  const data = JSON.stringify(payload);
  const url = new URL(`/v1/${path}`, DIGIFLAZZ_URL);

  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Accept': 'application/json'
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Gagal memparsing respons Digiflazz: ${err.message}`));
        }
      });
    });

    // ⏱️ Timeout agar request tidak menggantung selamanya (mis. Digiflazz lambat/hang).
    // Penting karena pemanggilan ini bisa terjadi di dalam transaksi DB yang mengunci saldo.
    req.setTimeout(30000, () => {
      req.destroy(new Error('Digiflazz request timeout (30s)'));
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function normalizeDigiflazzProductList(result) {
  if (!result) return [];
  // Digiflazz sering mengembalikan data di dalam field 'data'
  const data = result.data || result;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function findProductBySku(products, buyer_sku_code) {
  return products.find((item) => {
    const code = item.buyer_sku_code || item.product_code || item.code || item.sku || '';
    return String(code).toLowerCase() === String(buyer_sku_code).toLowerCase();
  });
}

async function productList(buyer_sku_code = null) {
  try {
    const prepaidResult = await sendDigiflazzRequest('price-list', {
      cmd: 'prepaid',
      ref_id: 'pricelist',
      code: buyer_sku_code || undefined
    }).catch(e => { console.error("❌ Digiflazz Prepaid Err:", e.message); return []; });

    const postpaidResult = await sendDigiflazzRequest('price-list', {
      cmd: 'pasca',
      ref_id: 'pricelist',
      code: buyer_sku_code || undefined
    }).catch(e => { console.error("❌ Digiflazz Postpaid Err:", e.message); return []; });

    // Inject 'type' dan gabungkan
    const prepaidList = normalizeDigiflazzProductList(prepaidResult).map(p => ({ ...p, type: 'prepaid' }));
    const postpaidList = normalizeDigiflazzProductList(postpaidResult).map(p => ({ ...p, type: 'postpaid' }));

    return [...prepaidList, ...postpaidList];
  } catch (err) {
    console.error("❌ Product List Sync Fatal Error:", err.message);
    return [];
  }
}

async function getProductDetail(buyer_sku_code) {
  const products = await productList(buyer_sku_code);
  return findProductBySku(products, buyer_sku_code);
}

async function purchase({ buyer_sku_code, customer_no, ref_id, tr_id }) {
  if (!buyer_sku_code || !customer_no) {
    throw new Error('buyer_sku_code, dan customer_no wajib diisi');
  }

  // Ambil type produk dari DB lokal untuk tentukan prepaid/postpaid
  const master = require('../config/knexMaster');
  const productRow = await master('ppob_products').where({ buyer_sku_code }).first();

  const isPostpaid = productRow?.type === 'postpaid' ||
                     productRow?.category?.toLowerCase().includes('pascabayar') ||
                     ['PLN PASCABAYAR', 'PDAM', 'BPJS', 'TELKOM'].includes(String(productRow?.brand || '').toUpperCase());

  let payload;
  if (isPostpaid) {
    if (!tr_id) {
      throw new Error('tr_id wajib diisi untuk pembayaran pascabayar (harus melalui inquiry terlebih dahulu)');
    }
    payload = {
      commands: 'pay-pasca',
      tr_id,
    };
  } else {
    payload = {
      cb_url: process.env.URL + '/api/webhook/digiflazz',
      buyer_sku_code,
      customer_no,
      ref_id,
    };
  }

  console.log(`🚀 Digiflazz Req [transaction]: ${buyer_sku_code} to ${customer_no} (Postpaid: ${isPostpaid})`);

  return sendDigiflazzRequest('transaction', payload);
}

/**
 * 🔥 Tambahan fungsi Cek Tagihan (Inquiry) khusus Pascabayar
 */
async function checkInquiry({ buyer_sku_code, customer_no, ref_id }) {
  // ref_id wajib ada agar buildSignature bisa membuat tanda tangan
  const inquiryRefId = ref_id || `INQ-${Date.now()}`;
  return sendDigiflazzRequest('transaction', {
    commands: 'inq-pasca',
    buyer_sku_code,
    customer_no,
    ref_id: inquiryRefId,
  });
}

/**
 * Inquiry PLN prabayar untuk validasi ID meter / nomor pelanggan.
 */
async function checkPlnInquiry({ customer_no }) {
  if (!customer_no) {
    throw new Error('customer_no wajib diisi untuk inquiry PLN');
  }

  return sendDigiflazzRequest('inquiry-pln', {
    customer_no,
    sign: buildCustomerNoSignature(customer_no),
  });
}

/**
 * Cek Status Transaksi (Polling)
 */
async function checkTransactionStatus(ref_id) {
  if (!ref_id) throw new Error('ref_id wajib diisi untuk cek status');
  return sendDigiflazzRequest('transaction', {
    commands: 'check-status',
    ref_id,
  });
}

module.exports = {
  purchase,
  productList,
  getProductDetail,
  checkInquiry,
  checkPlnInquiry,
  checkTransactionStatus, // 🔥 Export fungsi baru
};
