/**
 * Backup System
 * Creates full site backups and sends to Telegram
 */
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { addBackup } = require('./db');
const telegram = require('./telegram');

const BACKUP_DIR = path.join(__dirname, 'backups');

fs.mkdirSync(BACKUP_DIR, { recursive: true });

/**
 * Create a full backup of the site (database + settings + certs)
 * @returns {Promise<string>} Path to the backup file
 */
function createBackup() {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.zip`;
    const filepath = path.join(BACKUP_DIR, filename);
    const output = fs.createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const size = archive.pointer();
      addBackup(filename, size);
      resolve(filepath);
    });

    archive.on('error', reject);
    archive.pipe(output);

    // Add database
    const dbPath = path.join(__dirname, 'db', 'panel.db');
    if (fs.existsSync(dbPath)) {
      archive.file(dbPath, { name: 'db/panel.db' });
    }

    // Add WAL/SHM files if exist
    for (const ext of ['-wal', '-shm']) {
      const walPath = dbPath + ext;
      if (fs.existsSync(walPath)) {
        archive.file(walPath, { name: `db/panel.db${ext}` });
      }
    }

    // Add certs
    const certsDir = path.join(__dirname, 'certs');
    if (fs.existsSync(certsDir)) {
      archive.directory(certsDir, 'certs');
    }

    archive.finalize();
  });
}

/**
 * Send backup to Telegram and optionally keep local copy
 */
async function backupToTelegram() {
  try {
    const filepath = await createBackup();
    const stats = fs.statSync(filepath);
    const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    
    const caption = `📦 <b>بکاپ خودکار</b>\n📅 ${new Date().toLocaleString('fa-IR')}\n📏 حجم: ${sizeMB} MB`;
    
    if (telegram.initialized) {
      await telegram.sendBackup(filepath, caption);
    }
    
    // Keep only last 10 local backups
    cleanupOldBackups(10);
    
    return filepath;
  } catch (err) {
    console.error('Backup failed:', err.message);
    throw err;
  }
}

/**
 * Restore from a backup file
 * @param {string} backupPath - Path to the zip file
 */
function restoreBackup(backupPath) {
  return new Promise((resolve, reject) => {
    const extract = require('child_process').exec(
      `unzip -o "${backupPath}" -d "${__dirname}"`,
      (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

function cleanupOldBackups(keep = 10) {
  fs.readdir(BACKUP_DIR, (err, files) => {
    if (err) return;
    const backups = files.filter(f => f.endsWith('.zip')).sort().reverse();
    for (let i = keep; i < backups.length; i++) {
      fs.unlink(path.join(BACKUP_DIR, backups[i]), () => {});
    }
  });
}

function listLocalBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.zip'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        size: fs.statSync(path.join(BACKUP_DIR, f)).size,
        date: fs.statSync(path.join(BACKUP_DIR, f)).mtime
      }))
      .sort((a, b) => b.date - a.date);
  } catch (e) {
    return [];
  }
}

module.exports = { createBackup, backupToTelegram, restoreBackup, listLocalBackups };
