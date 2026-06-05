require('dotenv').config();
const crypto = require('crypto');
const https = require('https');

const _strip = (s) => s ? s.replace(/^["']|["']$/g, '').trim() : s;

const URL_BASE = _strip(process.env.DIGIFLAZZ_URL) || 'https://api.digiflazz.com';
const USERNAME = _strip(process.env.DIGIFLAZZ_USERNAME);
const API_KEY  = _strip(process.env.DIGIFLAZZ_API_KEY);

console.log('=============================================');
console.log('🔍 DIAGNOSA KONEKSI DIGIFLAZZ');
console.log('=============================================');
console.log('URL      :', URL_BASE);
console.log('USERNAME :', USERNAME || '❌ KOSONG!');
console.log('API_KEY  :', API_KEY ? API_KEY.substring(0, 8) + '...' : '❌ KOSONG!');
console.log('---------------------------------------------');

if (!USERNAME || !API_KEY) {
  console.log('❌ GAGAL: Username atau API Key kosong di file .env');
  process.exit(1);
}

const sign = crypto.createHash('md5').update(`${USERNAME}${API_KEY}pricelist`).digest('hex');

const payload = JSON.stringify({
  cmd: 'prepaid',
  username: USERNAME,
  sign: sign,
  ref_id: 'pricelist',
});

console.log('📡 Mengirim permintaan ke Digiflazz (prepaid)...');

const url = new URL('/v1/price-list', URL_BASE);

const req = https.request(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Accept': 'application/json',
  },
}, (res) => {
  let raw = '';
  res.on('data', (chunk) => { raw += chunk; });
  res.on('end', () => {
    console.log('---------------------------------------------');
    console.log('HTTP STATUS :', res.statusCode);
    
    try {
      const parsed = JSON.parse(raw);
      const data = parsed.data || parsed;
      
      if (Array.isArray(data)) {
        console.log(`JUMLAH PRODUK: ${data.length}`);
        if (data.length > 0) {
          console.log('\n📦 CONTOH 3 PRODUK PERTAMA:');
          data.slice(0, 3).forEach((p, i) => {
            console.log(`  ${i+1}. ${p.product_name} | SKU: ${p.buyer_sku_code} | Harga: ${p.price} | Seller: ${p.seller_name || '-'}`);
          });
          console.log('\n✅ Koneksi ke Digiflazz BERHASIL! Data bisa ditarik.');
        }
      } else {
        console.log('⚠️ RESPON BUKAN ARRAY:');
        console.log(JSON.stringify(parsed, null, 2).substring(0, 2000));
      }
    } catch (e) {
      console.log('❌ GAGAL PARSING RESPON:');
      console.log(raw.substring(0, 2000));
    }
  });
});

req.on('error', (err) => {
  console.log('❌ GAGAL TERHUBUNG:', err.message);
});

req.setTimeout(30000, () => {
  req.destroy(new Error('Timeout 30 detik'));
});

req.write(payload);
req.end();
