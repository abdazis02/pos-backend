const https = require('https');
const crypto = require('crypto');

const DIGIFLAZZ_URL = process.env.DIGIFLAZZ_URL || 'https://api.digiflazz.com';
const DIGIFLAZZ_USERNAME = process.env.DIGIFLAZZ_USERNAME;
const DIGIFLAZZ_API_KEY = process.env.DIGIFLAZZ_API_KEY;

function buildSignature({ username, ref_id = '' }) {
  return crypto
    .createHash('md5')
    .update(`${username}${DIGIFLAZZ_API_KEY}${ref_id}`)
    .digest('hex');
}

function sendDigiflazzRequest(path, payload) {
  if (!DIGIFLAZZ_USERNAME || !DIGIFLAZZ_API_KEY) {
    throw new Error('Digiflazz credentials belum diset di environment variables');
  }

  payload.username = DIGIFLAZZ_USERNAME;

  if (payload.ref_id) {
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

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function normalizeDigiflazzProductList(result) {
  if (!result) return [];
  const data = result.data;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.products)) return data.products;
  return [];
}

function findProductBySku(products, buyer_sku_code) {
  return products.find((item) => {
    const code = item.buyer_sku_code || item.seller_sku_code || item.code || item.sku || item.product_code || '';
    return String(code).toLowerCase() === String(buyer_sku_code).toLowerCase();
  });
}

async function productList(buyer_sku_code = null) {
  const payload = { cmd: 'prepaid', ref_id: 'pricelist' }

  if (buyer_sku_code) {
    payload.code = buyer_sku_code;
  }

  const result = await sendDigiflazzRequest('price-list', payload);
  return normalizeDigiflazzProductList(result);
}

async function getProductDetail(buyer_sku_code) {
  const products = await productList(buyer_sku_code);
  return findProductBySku(products, buyer_sku_code);
}

async function purchase({ buyer_sku_code, customer_no, ref_id }) {
  if (!buyer_sku_code || !customer_no) {
    throw new Error('buyer_sku_code, dan customer_no wajib diisi');
  }

  return sendDigiflazzRequest('transaction', {
    testing: process.env.NODE_ENV == 'development',
    cb_url: process.env.URL + '/api/webhook/digiflazz',
    buyer_sku_code,
    customer_no,
    ref_id,
  });
}

module.exports = {
  purchase,
  productList,
  getProductDetail,
};
