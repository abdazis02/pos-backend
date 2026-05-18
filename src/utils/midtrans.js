const midtransClient = require('midtrans-client');

// Create core instance
const coreApi = new midtransClient.CoreApi({
    isProduction: process.env.MIDTRANS_IS_PRODUCTION == "true",
    serverKey: process.env.MIDTRANS_SERVER_KEY,
    clientKey: process.env.MIDTRANS_CLIENT_KEY
});

const getTenantApi = (store) => {
    return new midtransClient.CoreApi({
        isProduction: true,
        serverKey: store.midtrans_server_key,
        clientKey: store.midtrans_client_key,
    })
}

const getQRISUrl = (transaction_id) => {
    return process.env.MIDTRANS_IS_PRODUCTION == true
        ? `https://api.midtrans.com/v2/qris/${transaction_id}/qr-code`
        : `https://api.sandbox.midtrans.com/v2/qris/${transaction_id}/qr-code`
}

module.exports.coreApi = coreApi

module.exports.getTenantApi = getTenantApi

module.exports.getQRISUrl = getQRISUrl