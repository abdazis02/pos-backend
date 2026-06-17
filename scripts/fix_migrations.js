const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const fs = require('fs');
const master = require('../src/config/knexMaster'); // Memanggil koneksi database

async function fixMigrations() {
  try {
    console.log("🛠️ Memperbaiki tabel knex_migrations...");
    
    // Pastikan tabel knex_migrations ada
    const hasTable = await master.schema.hasTable('knex_migrations');
    if (!hasTable) {
      console.log("⚠️ Tabel knex_migrations tidak ditemukan. Membuat ulang...");
      await master.schema.createTable('knex_migrations', (table) => {
        table.increments('id').primary();
        table.string('name');
        table.integer('batch');
        table.dateTime('migration_time');
      });
    }

    // Ambil daftar file dari folder migrations/master
    const migrationDir = path.join(__dirname, '../migrations/master');
    const files = fs.readdirSync(migrationDir).filter(f => f.endsWith('.js')).sort();

    let inserted = 0;
    
    // Masukkan setiap file ke tabel knex_migrations jika belum ada
    for (const file of files) {
      const exists = await master('knex_migrations').where('name', file).first();
      if (!exists) {
        await master('knex_migrations').insert({
          name: file,
          batch: 1,
          migration_time: new Date()
        });
        inserted++;
        console.log(`✅ Ditandai sebagai selesai: ${file}`);
      }
    }

    console.log(`🎉 Berhasil memperbaiki status migrasi! (${inserted} file disinkronkan)`);
  } catch (error) {
    console.error("❌ Gagal memperbaiki migrasi:", error.message);
  } finally {
    process.exit(0);
  }
}

fixMigrations();
