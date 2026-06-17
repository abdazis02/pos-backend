const axios = require('axios');

const getAuthHeader = () => {
  if (!process.env.XENDIT_SECRET_KEY) {
    throw new Error('XENDIT_SECRET_KEY belum dikonfigurasi');
  }
  return 'Basic ' + Buffer.from(process.env.XENDIT_SECRET_KEY + ':').toString('base64');
};

const xenditAPI = axios.create({
  baseURL: 'https://api.xendit.co',
});

xenditAPI.interceptors.request.use(config => {
  config.headers.Authorization = getAuthHeader();
  config.headers['Content-Type'] = 'application/json';
  config.headers['api-version'] = '2022-07-31';
  return config;
});

async function createQRIS(reference_id, amount) {
  const payload = {
    reference_id: reference_id,
    external_id: reference_id,
    type: 'DYNAMIC',
    currency: 'IDR',
    amount: amount,
    callback_url: process.env.URL || 'https://pipos.kamunara.com'
  };
  const response = await xenditAPI.post('/qr_codes', payload);
  return response.data;
}

async function createVA(external_id, amount, bank_code, name) {
  const payload = {
    external_id: external_id,
    bank_code: bank_code,
    name: name,
    expected_amount: amount,
    is_closed: true,
    is_single_use: true,
  };
  const response = await xenditAPI.post('/callback_virtual_accounts', payload);
  return response.data;
}

async function createEWalletCharge(reference_id, amount, channel_code, phone_number = null) {
  const payload = {
    reference_id: reference_id,
    currency: 'IDR',
    amount: amount,
    checkout_method: 'ONE_TIME_PAYMENT',
    channel_code: channel_code,
    channel_properties: {
      success_redirect_url: process.env.URL || 'https://kamunara.com',
    }
  };
  
  if (phone_number) {
    payload.channel_properties.mobile_number = phone_number;
  }
  
  const response = await xenditAPI.post('/ewallets/charges', payload);
  return response.data;
}

async function expireVA(id) {
  // Mengupdate tanggal kadaluarsa ke masa lalu untuk membatalkan VA
  const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const payload = {
    expiration_date: pastDate
  };
  const response = await xenditAPI.patch(`/callback_virtual_accounts/${id}`, payload);
  return response.data;
}

module.exports = {
  createQRIS,
  createVA,
  createEWalletCharge,
  expireVA
};
