const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'db', 'panel.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT DEFAULT '',
    contact_type TEXT DEFAULT 'telegram',
    contact_id TEXT DEFAULT '',
    subscription_links TEXT DEFAULT '[]',
    manual_vless TEXT DEFAULT '[]',
    unlimited_volume INTEGER DEFAULT 0,
    manual_days INTEGER DEFAULT 30,
    vless_links TEXT DEFAULT '[]',
    remaining_volume TEXT DEFAULT '0',
    remaining_days INTEGER DEFAULT 0,
    total_volume TEXT DEFAULT '0',
    total_days INTEGER DEFAULT 0,
    used_volume TEXT DEFAULT '0',
    last_checked TEXT DEFAULT '',
    sub_error INTEGER DEFAULT 0,
    error_acked INTEGER DEFAULT 0,
    suspended INTEGER DEFAULT 0,
    last_data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    sender_type TEXT NOT NULL,
    message TEXT DEFAULT '',
    image TEXT DEFAULT '',
    seen INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_seen ON messages(user_id, seen);
`);

// Safe migration — ignore errors on duplicate columns
function safeMigrate(col, def) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`); } catch {}
}
safeMigrate('manual_vless', "TEXT DEFAULT '[]'");
safeMigrate('suspended', 'INTEGER DEFAULT 0');
safeMigrate('error_acked', 'INTEGER DEFAULT 0');
safeMigrate('display_name', "TEXT DEFAULT ''");

const defaultSettings = {
  admin_password: '$2a$10$dummy_hash_for_427726',
  site_url: '', ssl_cert: '', ssl_key: '',
  telegram_token: '', telegram_admin_id: '',
  support_id: '', panel_path: 'panel_h', last_backup: '',
  proxy_url: '', proxy_type: 'http'
};

function getUsers(sortBy = 'remaining_days', sortDir = 'ASC') {
  const allowed = ['remaining_days', 'username', 'remaining_volume', 'created_at', 'sub_error'];
  if (!allowed.includes(sortBy)) sortBy = 'remaining_days';
  if (sortDir !== 'ASC' && sortDir !== 'DESC') sortDir = 'ASC';
  return db.prepare(`SELECT * FROM users ORDER BY sub_error DESC, ${sortBy} ${sortDir}`).all();
}

function getStats() {
  const total = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const active = db.prepare('SELECT COUNT(*) as c FROM users WHERE suspended=0 AND (remaining_days>0 OR unlimited_volume=1)').get().c;
  const inactive = db.prepare('SELECT COUNT(*) as c FROM users WHERE suspended=1 OR (remaining_days<=0 AND unlimited_volume=0)').get().c;
  const errorCount = db.prepare('SELECT COUNT(*) as c FROM users WHERE sub_error=1').get().c;
  const totalVol = db.prepare("SELECT SUM(CAST(REPLACE(REPLACE(remaining_volume,' GB',''),' MB','') AS REAL)) as v FROM users WHERE remaining_volume NOT IN ('نامحدود','∞','0')").get().v || 0;
  return { total, active, inactive, errors: errorCount };
}

function getUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function getUserByUsername(u) { return db.prepare('SELECT * FROM users WHERE username = ?').get(u); }

function createUser(data) {
  return db.prepare(`INSERT INTO users (username,display_name,contact_type,contact_id,subscription_links,manual_vless,unlimited_volume,manual_days,vless_links) VALUES (@username,@display_name,@contact_type,@contact_id,@subscription_links,@manual_vless,@unlimited_volume,@manual_days,@vless_links)`).run(data);
}

function updateUser(id, data) {
  const allowed = ['username','display_name','contact_type','contact_id','subscription_links','manual_vless','unlimited_volume',
    'manual_days','vless_links','remaining_volume','remaining_days','total_volume',
    'total_days','used_volume','last_checked','sub_error','error_acked','suspended','last_data'];
  const fields = [], values = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k)) { fields.push(`${k}=@${k}`); values[k] = v; }
  }
  if (!fields.length) return null;
  values.id = id; fields.push("updated_at=datetime('now','localtime')");
  return db.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=@id`).run(values);
}

function deleteUser(id) {
  db.prepare('DELETE FROM messages WHERE user_id=?').run(id);
  return db.prepare('DELETE FROM users WHERE id=?').run(id);
}

function deleteUsers(ids) {
  const ph = ids.map(()=>'?').join(',');
  db.prepare(`DELETE FROM messages WHERE user_id IN (${ph})`).run(...ids);
  return db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
}

function suspendUser(id, suspended) {
  return db.prepare("UPDATE users SET suspended=?,updated_at=datetime('now','localtime') WHERE id=?").run(suspended?1:0, id);
}

function ackError(id) {
  return db.prepare("UPDATE users SET error_acked=1,updated_at=datetime('now','localtime') WHERE id=?").run(id);
}

// Messages
function getMessages(userId, limit = 300) {
  return db.prepare('SELECT * FROM messages WHERE user_id=? ORDER BY created_at ASC LIMIT ?').all(userId, limit);
}
function getUnreadMessages() {
  return db.prepare("SELECT m.*,u.username FROM messages m JOIN users u ON m.user_id=u.id WHERE m.sender_type='user' AND m.seen=0 ORDER BY m.created_at DESC").all();
}
function getLatestMessages() {
  return db.prepare(`SELECT DISTINCT m.user_id,u.username,(SELECT message FROM messages WHERE user_id=m.user_id ORDER BY created_at DESC LIMIT 1) as last_message,(SELECT created_at FROM messages WHERE user_id=m.user_id ORDER BY created_at DESC LIMIT 1) as last_time,(SELECT COUNT(*) FROM messages WHERE user_id=m.user_id AND sender_type='user' AND seen=0) as unread FROM messages m JOIN users u ON m.user_id=u.id ORDER BY last_time DESC`).all();
}
function addMessage(uid, st, msg, img='') {
  const r = db.prepare('INSERT INTO messages(user_id,sender_type,message,image) VALUES(?,?,?,?)').run(uid, st, msg, img);
  return {id:r.lastInsertRowid,user_id:uid,sender_type:st,message:msg,image:img,seen:0,created_at:new Date().toISOString()};
}
function updateMessage(id, msg) { return db.prepare('UPDATE messages SET message=? WHERE id=?').run(msg, id); }
function deleteMessage(id) { return db.prepare('DELETE FROM messages WHERE id=?').run(id); }
function markMessagesSeen(uid) { return db.prepare("UPDATE messages SET seen=1 WHERE user_id=? AND sender_type='user' AND seen=0").run(uid); }
function getUnreadCount(uid) {
  const r = db.prepare("SELECT COUNT(*) as c FROM messages WHERE user_id=? AND sender_type='admin' AND seen=0").get(uid);
  return r?r.c:0;
}

function getSetting(k) { const r=db.prepare('SELECT value FROM settings WHERE key=?').get(k); return r?r.value:(defaultSettings[k]||''); }
function setSetting(k,v) { return db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k,String(v)); }
function getAllSettings() { const s={...defaultSettings}; db.prepare('SELECT key,value FROM settings').all().forEach(r=>s[r.key]=r.value); return s; }
function addBackup(f,s) { return db.prepare('INSERT INTO backups(filename,size) VALUES(?,?)').run(f,s); }
function getBackups() { return db.prepare('SELECT * FROM backups ORDER BY created_at DESC').all(); }

module.exports={db,getUsers,getStats,getUserById,getUserByUsername,createUser,updateUser,deleteUser,deleteUsers,suspendUser,ackError,getMessages,getUnreadMessages,getLatestMessages,addMessage,updateMessage,deleteMessage,markMessagesSeen,getSetting,setSetting,getAllSettings,addBackup,getBackups,getUnreadCount};
