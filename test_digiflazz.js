const db = require('./src/config/knexMaster');
db('ppob_products')
  .whereIn('buyer_sku_code', ['dana1', 'gopay1', 'ovo1', 'shopee1'])
  .update({ category: 'E-Money' })
  .then(res => {
    console.log('Updated rows:', res);
    process.exit(0);
  })
  .catch(console.error);
