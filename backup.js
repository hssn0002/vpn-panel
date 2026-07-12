const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const telegram = require('./telegram');

const BACKUP_DIR = path.join(__dirname, 'backups');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function createBackup() {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.zip`;
    const filepath = path.join(BACKUP_DIR, filename);
    const output = fs.createWriteStream(filepath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const size = archive.pointer();
      require('./db').addBackup(filename, size);
      resolve(filepath);
    });
    archive.on('error', reject);
    archive.pipe(output);

    // Database files
    const dbPath = path.join(__dirname, 'db', 'panel.db');
    if (fs.existsSync(dbPath)) archive.file(dbPath, { name: 'db/panel.db' });
    ['-wal', '-shm'].forEach(ext => {
      const wp = dbPath + ext;
      if (fs.existsSync(wp)) archive.file(wp, { name: `db/panel.db${ext}` });
    });

    // Uploads (chat images)
    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    if (fs.existsSync(uploadsDir)) {
      fs.readdirSync(uploadsDir).forEach(f => {
        const fp = path.join(uploadsDir, f);
        if (fs.statSync(fp).isFile()) archive.file(fp, { name: `public/uploads/${f}` });
      });
    }

    // Certificates
    const certsDir = path.join(__dirname, 'certs');
    if (fs.existsSync(certsDir)) archive.directory(certsDir, 'certs');

    archive.finalize();
  });
}

async function backupToTelegram() {
  const filepath = await createBackup();
  const stats = fs.statSync(filepath);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  const caption = `📦 <b>بکاپ خودکار</b>\n📅 ${new Date().toLocaleString('fa-IR')}\n📏 حجم: ${sizeMB} MB`;
  if (telegram.initialized) {
    await telegram.sendBackup(filepath, caption);
  }
  cleanupOldBackups(10);
  return filepath;
}

function restoreBackup(backupPath) {
  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    exec(`unzip -o "${backupPath}" -d "${__dirname}"`, (err, stdout, stderr) => {
      if (err) return reject(err);
      // Re-create uploads dir if missing
      const uploadsDir = path.join(__dirname, 'public', 'uploads');
      fs.mkdirSync(uploadsDir, { recursive: true });
      resolve(true);
    });
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
  } catch (e) { return []; }
}

module.exports = { createBackup, backupToTelegram, restoreBackup, listLocalBackups };
