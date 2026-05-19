const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8').split('\n').forEach(line => {
  let [k, v] = line.split('=');
  if(k && v) {
    v = v.trim().replace(/"/g, '');
    process.env[k] = v;
  }
});
const { productList } = require('./src/utils/digiflazz');
const db = require('./src/config/knexMaster');
const PPOBProductModel = require('./src/models/ppobProduct.model');

(async () => {
  try {
    const allProducts = await productList();
    console.log('Total fetched:', allProducts.length);
    await PPOBProductModel.createOrUpdateProducts(allProducts);
    
    const postpaid = await db('ppob_products').where({ type: 'postpaid' }).count({ total: '*' }).first();
    console.log('Postpaid in DB:', postpaid.total);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
