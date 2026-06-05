require('dotenv').config();
const master = require('../src/config/knexMaster');
const Digiflazz = require('../src/utils/digiflazz');
const PPOBProductModel = require('../src/models/ppobProduct.model');

async function forceSync() {
  try {
    console.log('=============================================');
    console.log('🔄 MENARIK DATA HARGA TERBARU DARI DIGIFLAZZ');
    console.log('=============================================');
    
    const allProducts = await Digiflazz.productList();
    if (!allProducts || allProducts.length === 0) {
      console.log('❌ GAGAL: Digiflazz mengembalikan 0 produk (Kosong).');
      return;
    }
    
    console.log(`✅ Berhasil mendapat ${allProducts.length} produk dari API Digiflazz.`);
    console.log('💾 Sedang mencoba menulis dan menimpa harga ke Database PIPos...');
    
    await PPOBProductModel.createOrUpdateProducts(allProducts);
    
    console.log('🎉 SINKRONISASI 100% SUKSES!');
    console.log('Silakan buka ulang aplikasi Kasir Anda untuk melihat harga baru.');
    
  } catch (err) {
    console.log('\n❌ TERJADI ERROR SINKRONISASI DATABASE:');
    console.error(err);
  } finally {
    master.destroy();
  }
}

forceSync();
