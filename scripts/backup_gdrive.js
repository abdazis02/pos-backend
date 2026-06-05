require('dotenv').config();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// Fungsi untuk mengeksekusi perintah terminal (mysqldump & gzip)
function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error mengeksekusi perintah: ${command}`);
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

// Konfigurasi Google Drive API (Metode OAuth2)
const CREDENTIALS_PATH = path.join(__dirname, '../client_secret.json');
const TOKEN_PATH = path.join(__dirname, '../token.json');

async function getDriveService() {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error("❌ File client_secret.json tidak ditemukan di folder utama pos-backend.");
  }
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error("❌ File token.json tidak ditemukan! Anda harus menjalankan 'node scripts/get_token.js' satu kali saja.");
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  
  const redirectUri = (redirect_uris && redirect_uris.length > 0) ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob';
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  oAuth2Client.setCredentials(token);

  // oAuth2Client otomatis akan menyegarkan (refresh) token jika kedaluwarsa.
  return google.drive({ version: 'v3', auth: oAuth2Client });
}

// Fungsi untuk membaca daftar Database Tenant + Master
async function getDatabasesToBackup() {
  const knex = require('knex');
  const db = knex({
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
    }
  });

  try {
    const result = await db.raw("SHOW DATABASES LIKE 'kasir_tenant_%'");
    let databases = result[0].map(row => Object.values(row)[0]);
    // Jangan lupakan database pusatnya
    databases.unshift(process.env.DB_NAME); 
    return databases;
  } finally {
    await db.destroy();
  }
}

// Fungsi HAPUS & GANTI (Menghapus file backup lama di Google Drive)
async function deleteOldBackups(folderId) {
  const driveService = await getDriveService();
  
  // Ambil semua daftar file backup di folder Drive tersebut
  const res = await driveService.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, createdTime)',
  });

  const files = res.data.files;
  if (files && files.length > 0) {
    console.log(`[Google Drive] Ditemukan ${files.length} file backup lama. Melakukan penghapusan...`);
    for (const file of files) {
      console.log(`[Google Drive] Menghapus: ${file.name}`);
      await driveService.files.delete({ fileId: file.id });
    }
  } else {
    console.log("[Google Drive] Folder masih kosong. Tidak ada yang perlu dihapus.");
  }
}

// Fungsi Unggah ke Drive
async function uploadToDrive(filePath, fileName, folderId) {
  const driveService = await getDriveService();
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };
  const media = {
    mimeType: 'application/gzip',
    body: fs.createReadStream(filePath),
  };

  const response = await driveService.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id',
  });
  return response.data.id;
}

// Fungsi UTAMA
async function startBackup() {
  console.log(`[Backup] === Memulai proses backup ke Google Drive pada ${new Date().toLocaleString()} ===`);
  
  const folderId = process.env.GDRIVE_FOLDER_ID;
  if (!folderId) {
    console.error("[Backup] GAGAL: Variabel GDRIVE_FOLDER_ID belum diatur di .env");
    return;
  }

  try {
    // 1. Deteksi Database
    const dbs = await getDatabasesToBackup();
    console.log(`[Backup] Ditemukan ${dbs.length} database untuk disalin: ${dbs.join(', ')}`);

    const dateStr = new Date().toISOString().split('T')[0];
    const backupFileName = `backup_pipos_full_${dateStr}.sql.gz`;
    const backupFilePath = path.join(__dirname, '../', backupFileName);

    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const dbPort = process.env.DB_PORT || '3306';
    const dbUser = process.env.DB_USER;
    const dbPass = process.env.DB_PASS;

    // 2. Ekstraksi (Dump) & Kompresi menjadi .sql.gz
    const dumpCmd = `mysqldump -h ${dbHost} -P ${dbPort} -u ${dbUser} -p"${dbPass}" --databases ${dbs.join(' ')} | gzip > "${backupFilePath}"`;

    console.log("[Backup] Mengekstrak seluruh data dan memampatkan file (gzip)...");
    await runCommand(dumpCmd);
    console.log("[Backup] Ekstraksi dan kompresi berhasil.");

    // 3. Hapus File Lama di Google Drive
    console.log("[Backup] Menghubungi Google Drive untuk membersihkan file usang...");
    await deleteOldBackups(folderId);

    // 4. Unggah File Baru
    console.log("[Backup] Mengunggah file backup terbaru...");
    const uploadedId = await uploadToDrive(backupFilePath, backupFileName, folderId);
    console.log(`[Backup] SUKSES! File berhasil diunggah dengan ID Drive: ${uploadedId}`);

    // 5. Bersihkan sampah lokal
    if (fs.existsSync(backupFilePath)) {
      fs.unlinkSync(backupFilePath);
      console.log("[Backup] File sampah di server lokal telah dibersihkan.");
    }
    
    console.log("[Backup] === Selesai dengan Sempurna ===");

  } catch (error) {
    console.error("[Backup] Terjadi kesalahan fatal:", error);
  }
}

// Jika dieksekusi secara manual: node scripts/backup_gdrive.js
if (require.main === module) {
  startBackup().then(() => process.exit(0));
}

module.exports = { startBackup };
