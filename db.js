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
    contact_type TEXT DEFAULT 'telegram',
    contact_id TEXT DEFAULT '',
    subscription_links TEXT DEFAULT '[]',
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

// Default settings
const defaultSettings = {
  admin_password: '$2a$10$dummy_hash_for_427726',
  site_url: '',
  ssl_cert: '',
  ssl_key: '',
  telegram_token: '',
  telegram_admin_id: '',
  panel_path: 'panel_h',
  last_backup: '',
  support_id: ''
};

// ── Users ──
function getUsers(sortBy = 'remaining_days', sortDir = 'ASC') {
  const allowedSorts = ['remaining_days', 'username', 'remaining_volume', 'created_at', 'sub_error'];
  if (!allowedSorts.includes(sortBy)) sortBy = 'remaining_days';
  if (sortDir !== 'ASC' && sortDir !== 'DESC') sortDir = 'ASC';
  return db.prepare(`SELECT * FROM users ORDER BY sub_error DESC, ${sortBy} ${sortDir}`).all();
}

function getUserById(id) { return db.prepare('SELECT * FROM users WHERE id = ?').get(id); }
function getUserByUsername(username) { return db.prepare('SELECT * FROM users WHERE username = ?').get(username); }

function createUser(data) {
  return db.prepare(`
    INSERT INTO users (username, contact_type, contact_id, subscription_links, unlimited_volume, manual_days, vless_links)
    VALUES (@username, @contact_type, @contact_id, @subscription_links, @unlimited_volume, @manual_days, @vless_links)
  `).run(data);
}

function updateUser(id, data) {
  const allowed = ['username','contact_type','contact_id','subscription_links','unlimited_volume',
    'manual_days','vless_links','remaining_volume','remaining_days','total_volume',
    'total_days','used_volume','last_checked','sub_error','last_data'];
  const fields = [];
  const values = {};
  for (const [key, val] of Object.entries(data)) {
    if (allowed.includes(key)) { fields.push(`${key} = @${key}`); values[key] = val; }
  }
  if (!fields.length) return null;
  values.id = id;
  fields.push("updated_at = datetime('now','localtime')");
  return db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = @id`).run(values);
}

function deleteUser(id) {
  db.prepare('DELETE FROM messages WHERE user_id = ?').run(id);
  return db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

function deleteUsers(ids) {
  const ph = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM messages WHERE user_id IN (${ph})`).run(...ids);
  return db.prepare(`DELETE FROM users WHERE id IN (${ph})`).run(...ids);
}

function renameUsers(renames) {
  const stmt = db.prepare('UPDATE users SET username = @newname, updated_at = datetime(\'now\',\'localtime\') WHERE id = @id');
  const tx = db.transaction((items) => {
    for (const item of items) {
      stmt.run({ id: item.id, newname: item.newname });
    }
  });
  tx(renames);
  return true;
}

// ── Messages ──
function getMessages(userId, limit = 200) {
  return db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT ?').all(userId, limit);
}

function getUnreadMessages() {
  return db.prepare(`
    SELECT m.*, u.username FROM messages m 
    JOIN users u ON m.user_id = u.id 
    WHERE m.sender_type = 'user' AND m.seen = 0 
    ORDER BY m.created_at DESC
  `).all();
}

function getLatestMessages() {
  return db.prepare(`
    SELECT DISTINCT m.user_id, u.username,
      (SELECT message FROM messages WHERE user_id = m.user_id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT created_at FROM messages WHERE user_id = m.user_id ORDER BY created_at DESC LIMIT 1) as last_time,
      (SELECT COUNT(*) FROM messages WHERE user_id = m.user_id AND sender_type = 'user' AND seen = 0) as unread
    FROM messages m JOIN users u ON m.user_id = u.id
    ORDER BY last_time DESC
  `).all();
}

function addMessage(userId, senderType, message, image = '') {
  const r = db.prepare(`INSERT INTO messages (user_id, sender_type, message, image) VALUES (?, ?, ?, ?)`)
    .run(userId, senderType, message, image);
  return {
    id: r.lastInsertRowid,
    user_id: userId,
    sender_type: senderType,
    message,
    image,
    seen: 0,
    created_at: new Date().toISOString()
  };
}

function updateMessage(msgId, newMessage) {
  return db.prepare('UPDATE messages SET message = ? WHERE id = ?').run(newMessage, msgId);
}

function deleteMessage(msgId) {
  return db.prepare('DELETE FROM messages WHERE id = ?').run(msgId);
}

function markMessagesSeen(userId) {
  return db.prepare('UPDATE messages SET seen = 1 WHERE user_id = ? AND sender_type = ? AND seen = 0').run(userId, 'user');
}

function getUnreadCount(userId) {
  const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE user_id = ? AND sender_type = ? AND seen = 0')
    .get(userId, 'admin');
  return row ? row.count : 0;
}

// ── Settings ──
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : (defaultSettings[key] || '');
}

function setSetting(key, value) {
  return db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...defaultSettings };
  rows.forEach(r => s[r.key] = r.value);
  return s;
}

// ── Backups ──
function addBackup(filename, size) {
  return db.prepare('INSERT INTO backups (filename, size) VALUES (?, ?)').run(filename, size);
}
function getBackups() {
  return db.prepare('SELECT * FROM backups ORDER BY created_at DESC').all();
}

module.exports = {
  db, getUsers, getUserById, getUserByUsername, createUser, updateUser, deleteUser, deleteUsers,
  renameUsers, getMessages, getUnreadMessages, getLatestMessages, addMessage, updateMessage,
  deleteMessage, markMessagesSeen, getSetting, setSetting, getAllSettings, addBackup, getBackups, getUnreadCount
};
