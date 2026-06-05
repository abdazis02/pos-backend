const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const CREDENTIALS_PATH = path.join(__dirname, '../client_secret.json');
const TOKEN_PATH = path.join(__dirname, '../token.json');

function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  
  // URL fallback jika redirect_uris kosong
  const redirectUri = (redirect_uris && redirect_uris.length > 0) ? redirect_uris[0] : 'urn:ietf:wg:oauth:2.0:oob';
  
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);

  fs.readFile(TOKEN_PATH, (err, token) => {
    if (err) return getAccessToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    console.log("Token sudah ada! Anda siap untuk menjalankan backup otomatis.");
    callback(oAuth2Client);
  });
}

function getAccessToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Wajib agar selalu diberikan refresh_token
  });

  console.log('===========================================================');
  console.log('🤖 OTORISASI AKUN GOOGLE DRIVE 🤖');
  console.log('===========================================================');
  console.log('1. Silakan buka tautan berikut di browser Anda:');
  console.log('\n', authUrl, '\n');
  console.log('2. Login menggunakan akun Google Anda (yang memiliki kapasitas 15GB).');
  console.log('3. Klik Izinkan (Allow / Continue).');
  console.log('4. Jika muncul peringatan keamanan, klik "Lanjutan (Advanced)", lalu "Buka / Lanjutkan".');
  console.log('5. Salin kode (Auth Code) yang diberikan oleh Google.');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('\nTempelkan (Paste) kode yang Anda dapatkan di sini: ', (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error('❌ Gagal mendapatkan token: ', err);
      oAuth2Client.setCredentials(token);
      
      fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log('\n✅ SUKSES! Token rahasia berhasil disimpan di', TOKEN_PATH);
        console.log('Server Anda kini memiliki hak penuh untuk melakukan backup otomatis!');
      });
      callback(oAuth2Client);
    });
  });
}

fs.readFile(CREDENTIALS_PATH, (err, content) => {
  if (err) {
    console.log('❌ Error: File client_secret.json tidak ditemukan!');
    console.log('Pastikan Anda sudah mengunduh OAuth Client ID dari Google Cloud dan menaruhnya di folder utama pos-backend.');
    return;
  }
  authorize(JSON.parse(content), () => {});
});
