const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'db', 'panel.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const wasmPath = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    const wasmBinary = fs.existsSync(wasmPath) ? fs.readFileSync(wasmPath) : undefined;
    initSqlJs({ wasmBinary }).then(SQL => {
      if (fs.existsSync(DB_PATH)) {
        const buf = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buf);
      } else {
        db = new SQL.Database();
      }
      db.run('PRAGMA foreign_keys = ON');
      resolve();
    }).catch(reject);
  });
}

function saveDB() {
  if (!db) return;
  const data = db.export();
  const buf = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buf);
}

function exec(sql) {
  try { db.run(sql); } catch(e) { /* ignore migration errors - just log if needed */ }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDB();
  } catch(e) { /* ignore */ }
}

function prepare(sql) {
  return {
    get: (...params) => {
      try {
        const stmt = db.prepare(sql);
        if (stmt.getAsObject) {
          const res = stmt.getAsObject(params);
          stmt.free();
          return res || null;
        }
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const obj = {};
          cols.forEach((c,i) => { obj[c] = vals[i]; });
          return obj;
        }
        stmt.free();
        return null;
      } catch(e) { return null; }
    },
    all: (...params) => {
      try {
        const stmt = db.prepare(sql);
        const results = [];
        stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const obj = {};
          cols.forEach((c,i) => { obj[c] = vals[i]; });
          results.push(obj);
        }
        stmt.free();
        return results;
      } catch(e) { return []; }
    },
    run: (...params) => {
      try {
        db.run(sql, params);
        saveDB();
        return { lastInsertRowid: getLastInsertId(), changes: db.getRowsModified() };
      } catch(e) { return { lastInsertRowid: 0, changes: 0 }; }
    }
  };
}

function getLastInsertId() {
  try {
    const r = db.exec('SELECT last_insert_rowid() as id');
    if (r.length && r[0].values.length) return r[0].values[0][0];
    return 0;
  } catch(e) { return 0; }
}

// ─── Schema ───
function initSchema() {
  exec(`
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
      config_overrides TEXT DEFAULT '{}',
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
      created_at TEXT DEFAULT (datetime('now','localtime'))
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
  `);
  exec('CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at)');
  exec('CREATE INDEX IF NOT EXISTS idx_messages_seen ON messages(user_id, seen)');
  saveDB();
}

const defaultSettings = {
  admin_password: '$2a$10$dummy_hash_for_427726',
  site_url: '', ssl_cert: '', ssl_key: '',
  telegram_token: '', telegram_admin_id: '',
  support_id: '', panel_path: 'panel_h', last_backup: '',
  proxy_url: '', proxy_type: 'http'
};

// ─── Users ───
function getUsers(sortBy = 'remaining_days', sortDir = 'ASC') {
  const allowed = ['remaining_days', 'username', 'remaining_volume', 'created_at', 'sub_error'];
  if (!allowed.includes(sortBy)) sortBy = 'remaining_days';
  if (sortDir !== 'ASC' && sortDir !== 'DESC') sortDir = 'ASC';
  return prepare(`SELECT * FROM users ORDER BY sub_error DESC, ${sortBy} ${sortDir}`).all();
}

function getStats() {
  const total = prepare('SELECT COUNT(*) as c FROM users').get().c;
  const active = prepare('SELECT COUNT(*) as c FROM users WHERE suspended=0 AND (remaining_days>0 OR unlimited_volume=1)').get().c;
  const inactive = prepare('SELECT COUNT(*) as c FROM users WHERE suspended=1 OR (remaining_days<=0 AND unlimited_volume=0)').get().c;
  const errorCount = prepare('SELECT COUNT(*) as c FROM users WHERE sub_error=1').get().c;
  return { total, active, inactive, errors: errorCount };
}

function getUserById(id) { return prepare('SELECT * FROM users WHERE id = ?').get(id); }
function getUserByUsername(u) { return prepare('SELECT * FROM users WHERE username = ?').get(u); }

function createUser(data) {
  return prepare(`INSERT INTO users (username,display_name,contact_type,contact_id,subscription_links,manual_vless,unlimited_volume,manual_days,vless_links) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(data.username, data.display_name || '', data.contact_type || 'telegram', data.contact_id || '', data.subscription_links || '[]', data.manual_vless || '[]', data.unlimited_volume ? 1 : 0, data.manual_days || 30, data.vless_links || '[]');
}

function updateUser(id, data) {
  const sets = [];
  const vals = [];
  for (const [k,v] of Object.entries(data)) {
    const allowed = ['username','display_name','contact_type','contact_id','subscription_links','manual_vless','unlimited_volume',
      'manual_days','vless_links','remaining_volume','remaining_days','total_volume',
      'total_days','used_volume','last_checked','sub_error','error_acked','suspended','last_data','config_overrides'];
    if (allowed.includes(k)) { sets.push(`${k}=?`); vals.push(typeof v === 'string' ? v : JSON.stringify(v)); }
  }
  if (!vals.length) return null;
  sets.push("updated_at=datetime('now','localtime')");
  vals.push(id);
  return prepare(`UPDATE users SET ${sets.join(',')} WHERE id=?`).run(...vals);
}

function deleteUser(id) {
  prepare('DELETE FROM messages WHERE user_id=?').run(id);
  return prepare('DELETE FROM users WHERE id=?').run(id);
}

function deleteUsers(ids) {
  const ph = ids.map(()=>'?').join(',');
  prepare(`DELETE FROM messages WHERE user_id IN (${ph})`).run(...ids);
  return prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
}

function suspendUser(id, suspended) {
  return prepare("UPDATE users SET suspended=?,updated_at=datetime('now','localtime') WHERE id=?").run(suspended?1:0, id);
}

function ackError(id) {
  return prepare("UPDATE users SET error_acked=1,updated_at=datetime('now','localtime') WHERE id=?").run(id);
}

// ─── Messages ───
function getMessages(userId, limit = 300) {
  return prepare('SELECT * FROM messages WHERE user_id=? ORDER BY created_at ASC LIMIT ?').all(userId, limit);
}
function getUnreadMessages() {
  return prepare("SELECT m.*,u.username FROM messages m JOIN users u ON m.user_id=u.id WHERE m.sender_type='user' AND m.seen=0 ORDER BY m.created_at DESC").all();
}
function getLatestMessages() {
  return prepare(`SELECT DISTINCT m.user_id,u.username,(SELECT message FROM messages WHERE user_id=m.user_id ORDER BY created_at DESC LIMIT 1) as last_message,(SELECT created_at FROM messages WHERE user_id=m.user_id ORDER BY created_at DESC LIMIT 1) as last_time,(SELECT COUNT(*) FROM messages WHERE user_id=m.user_id AND sender_type='user' AND seen=0) as unread FROM messages m JOIN users u ON m.user_id=u.id ORDER BY last_time DESC`).all();
}
function addMessage(uid, st, msg, img='') {
  const r = prepare('INSERT INTO messages(user_id,sender_type,message,image) VALUES(?,?,?,?)').run(uid, st, msg, img);
  return {id:r.lastInsertRowid,user_id:uid,sender_type:st,message:msg,image:img,seen:0,created_at:new Date().toISOString()};
}
function updateMessage(id, msg) { return prepare('UPDATE messages SET message=? WHERE id=?').run(msg, id); }
function deleteMessage(id) { return prepare('DELETE FROM messages WHERE id=?').run(id); }
function markMessagesSeen(uid) { return prepare("UPDATE messages SET seen=1 WHERE user_id=? AND sender_type='user' AND seen=0").run(uid); }
function getUnreadCount(uid) {
  const r = prepare("SELECT COUNT(*) as c FROM messages WHERE user_id=? AND sender_type='admin' AND seen=0").get(uid);
  return r ? r.c : 0;
}

// ─── Settings & Backups ───
function getSetting(k) { const r = prepare('SELECT value FROM settings WHERE key=?').get(k); return r ? r.value : (defaultSettings[k] || ''); }
function setSetting(k, v) { return prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, String(v)); }
function getAllSettings() { const s = { ...defaultSettings }; prepare('SELECT key,value FROM settings').all().forEach(r => s[r.key] = r.value); return s; }
function addBackup(f, s) { return prepare('INSERT INTO backups(filename,size) VALUES(?,?)').run(f, s); }
function getBackups() { return prepare('SELECT * FROM backups ORDER BY created_at DESC').all(); }

// ─── Init ───
async function init() {
  await openDB();
  initSchema();
  return module.exports;
}

module.exports = { init, db: () => db, getUsers, getStats, getUserById, getUserByUsername, createUser, updateUser, deleteUser, deleteUsers, suspendUser, ackError, getMessages, getUnreadMessages, getLatestMessages, addMessage, updateMessage, deleteMessage, markMessagesSeen, getSetting, setSetting, getAllSettings, addBackup, getBackups, getUnreadCount };
