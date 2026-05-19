const db = require('./src/config/knexMaster');
db('ppob_products').where('buyer_sku_code', 'dana1').update({ is_active: 1, category: 'E-Money' }).then(res => {
  console.log('updated:', res);
  process.exit(0);
});
