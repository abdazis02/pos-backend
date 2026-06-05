const cron = require('node-cron');
const { startBackup } = require('../../scripts/backup_gdrive');

function startBackupJob() {
    // Membaca pengaturan jam dari .env (Contoh: "0 0 * * *" = Tiap jam 12 malam)
    // Jika tidak diisi di .env, maka akan otomatis berjalan jam 00:00 tengah malam.
    const scheduleTime = process.env.BACKUP_TIME || '0 0 * * *';

    cron.schedule(scheduleTime, async () => {
        console.log(`[Job] 🤖 Menjalankan Backup Otomatis pada ${new Date().toLocaleString()}`);
        await startBackup();
    });

    console.log(`[Cron] Auto Backup GDrive terpasang untuk jadwal: ${scheduleTime}`);
}

module.exports = { startBackupJob };
