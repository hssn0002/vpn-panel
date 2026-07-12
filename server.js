const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const subParser = require('./sub-parser');
const telegram = require('./telegram');
const backup = require('./backup');

const app = express();
const server = http.createServer(app);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: 50 * 1024 * 1024 } });

const certsDir = path.join(__dirname, 'certs');
const certUpload = multer({ dest: certsDir, limits: { fileSize: 10 * 1024 * 1024 } });

const JWT_SECRET = db.getSetting('jwt_secret') || crypto.randomBytes(32).toString('hex');
db.setSetting('jwt_secret', JWT_SECRET);

const storedPass = db.getSetting('admin_password');
if (!storedPass || storedPass === '$2a$10$dummy_hash_for_427726') {
  db.setSetting('admin_password', bcrypt.hashSync('427726', 10));
}

// ═══ WebSocket ═══
const wss = new WebSocket.Server({ server });
const clients = new Map();
const adminClients = new Set();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const type = url.searchParams.get('type');
  if (!token) return ws.close();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    ws.userId = type === 'admin' ? 'admin' : decoded.userId;
    if (type === 'admin') adminClients.add(ws);
    else clients.set(decoded.userId, ws);
    
    ws.on('message', (data) => {
      try { handleWSMessage(ws, JSON.parse(data.toString())); } catch {}
    });
    ws.on('close', () => {
      if (type === 'admin') adminClients.delete(ws);
      else clients.delete(decoded.userId);
    });
  } catch { ws.close(); }
});

function handleWSMessage(ws, msg) {
  if (msg.type === 'chat' && msg.userId) {
    const userId = msg.userId;
    const message = msg.text || '';
    const image = msg.image || '';
    const senderType = ws.userId === 'admin' ? 'admin' : 'user';
    
    const savedMsg = db.addMessage(userId, senderType, message, image);
    const user = db.getUserById(userId);
    const chatMsg = {
      type: 'chat', id: savedMsg.id, userId: userId,
      username: user ? user.username : '', message, image,
      senderType, time: new Date().toLocaleString('fa-IR')
    };

    // Send to user
    const userWs = clients.get(userId);
    if (userWs && userWs.readyState === WebSocket.OPEN) {
      userWs.send(JSON.stringify(chatMsg));
    }

    // Send to all admins
    for (const aws of adminClients) {
      if (aws.readyState === WebSocket.OPEN) {
        aws.send(JSON.stringify({ ...chatMsg, type: 'admin_chat' }));
      }
    }

    // Telegram notification
    if (senderType === 'user' && user) telegram.notifyNewMessage(user.username, message).catch(() => {});
  }

  if (msg.type === 'mark_seen' && msg.userId) {
    db.markMessagesSeen(msg.userId);
  }

  if (msg.type === 'delete_message') {
    db.deleteMessage(msg.messageId);
    broadcast({ type: 'message_deleted', messageId: msg.messageId, userId: msg.userId });
  }

  if (msg.type === 'edit_message') {
    db.updateMessage(msg.messageId, msg.text);
    broadcast({ type: 'message_edited', messageId: msg.messageId, text: msg.text, userId: msg.userId });
  }
}

function broadcast(data) {
  const json = JSON.stringify(data);
  for (const ws of adminClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
  for (const [, ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

function broadcastAdmin(data) {
  const json = JSON.stringify(data);
  for (const ws of adminClients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json);
  }
}

// ═══ Auth Middleware ═══
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ═══ Auth ═══
app.post('/api/login', (req, res) => {
  const hash = db.getSetting('admin_password');
  if (!bcrypt.compareSync(req.body.password || '', hash)) return res.status(401).json({ error: 'رمز عبور اشتباه است' });
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' }) });
});

app.post('/api/user-login', (req, res) => {
  const user = db.getUserByUsername(req.body.username);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json({ token: jwt.sign({ userId: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '30d' }), user: sanitizeUser(user) });
});

app.post('/api/change-password', authMiddleware, adminMiddleware, (req, res) => {
  if (!bcrypt.compareSync(req.body.currentPassword, db.getSetting('admin_password')))
    return res.status(400).json({ error: 'رمز عبور فعلی اشتباه است' });
  db.setSetting('admin_password', bcrypt.hashSync(req.body.newPassword, 10));
  res.json({ success: true });
});

// ═══ Users ═══
app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const users = db.getUsers(req.query.sort || 'remaining_days', req.query.dir || 'ASC');
  res.json(users.map(sanitizeUser));
});

app.get('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const u = db.getUserById(req.params.id);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json(sanitizeUser(u));
});

app.post('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const { username, contact_type, contact_id, subscription_links, unlimited_volume, manual_days, vless_links } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'نام کاربری الزامی است' });
  if (db.getUserByUsername(username.trim())) return res.status(400).json({ error: 'این نام کاربری قبلا ثبت شده' });

  const data = {
    username: username.trim(),
    contact_type: contact_type || 'telegram',
    contact_id: contact_id || '',
    subscription_links: JSON.stringify(subscription_links || []),
    unlimited_volume: unlimited_volume ? 1 : 0,
    manual_days: parseInt(manual_days) || 30,
    vless_links: JSON.stringify(vless_links || [])
  };
  const r = db.createUser(data);
  if (!unlimited_volume && subscription_links?.length) fetchAndUpdateUserSub(r.lastInsertRowid).catch(() => {});
  res.json({ id: r.lastInsertRowid, success: true });
});

app.put('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  if (!db.getUserById(req.params.id)) return res.status(404).json({ error: 'کاربر یافت نشد' });
  const updates = {};
  ['username','contact_type','contact_id','unlimited_volume','manual_days'].forEach(f => {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  });
  if (req.body.subscription_links !== undefined) updates.subscription_links = JSON.stringify(req.body.subscription_links);
  if (req.body.vless_links !== undefined) updates.vless_links = JSON.stringify(req.body.vless_links);
  db.updateUser(req.params.id, updates);
  
  const u = db.getUserById(req.params.id);
  const links = safeJSON(u.subscription_links, []);
  if (!u.unlimited_volume && links.length) fetchAndUpdateUserSub(req.params.id).catch(() => {});
  res.json({ success: true });
});

app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  db.deleteUser(req.params.id); res.json({ success: true });
});

app.post('/api/users/bulk-delete', authMiddleware, adminMiddleware, (req, res) => {
  if (!req.body.ids?.length) return res.status(400).json({ error: 'هیچ کاربری انتخاب نشده' });
  db.deleteUsers(req.body.ids); res.json({ success: true });
});

app.post('/api/users/bulk-rename', authMiddleware, adminMiddleware, (req, res) => {
  if (!req.body.renames?.length) return res.status(400).json({ error: 'هیچ نامی وارد نشده' });
  db.renameUsers(req.body.renames);
  res.json({ success: true });
});

app.post('/api/users/:id/refresh', authMiddleware, adminMiddleware, async (req, res) => {
  try { res.json(await fetchAndUpdateUserSub(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/refresh-all', authMiddleware, adminMiddleware, async (req, res) => {
  const users = db.getUsers(); let c = 0;
  for (const u of users) { try { await fetchAndUpdateUserSub(u.id); c++; } catch {} }
  res.json({ updated: c, total: users.length });
});

// ═══ Messages ═══
app.get('/api/messages/:userId', authMiddleware, (req, res) => {
  const msgs = db.getMessages(req.params.userId, parseInt(req.query.limit) || 200);
  res.json(msgs);
});

app.post('/api/messages/:userId', authMiddleware, (req, res) => {
  const { message, image } = req.body;
  const senderType = req.user.role === 'admin' ? 'admin' : 'user';
  if (!message && !image) return res.status(400).json({ error: 'پیام خالی' });
  
  const savedMsg = db.addMessage(req.params.userId, senderType, message || '', image || '');
  
  // Notify via WS
  const user = db.getUserById(req.params.userId);
  const chatMsg = {
    type: 'chat', id: savedMsg.id, userId: parseInt(req.params.userId),
    username: user?.username || '', message: message || '', image: image || '',
    senderType, time: new Date().toLocaleString('fa-IR')
  };
  
  const userWs = clients.get(parseInt(req.params.userId));
  if (userWs?.readyState === WebSocket.OPEN) userWs.send(JSON.stringify(chatMsg));
  for (const aws of adminClients) {
    if (aws.readyState === WebSocket.OPEN) aws.send(JSON.stringify({ ...chatMsg, type: 'admin_chat' }));
  }
  
  if (senderType === 'user' && user) telegram.notifyNewMessage(user.username, message || '📷 تصویر').catch(() => {});
  
  res.json({ id: savedMsg.id, success: true });
});

app.delete('/api/messages/:id', authMiddleware, (req, res) => {
  db.deleteMessage(req.params.id);
  broadcast({ type: 'message_deleted', messageId: parseInt(req.params.id) });
  res.json({ success: true });
});

app.put('/api/messages/:id', authMiddleware, (req, res) => {
  db.updateMessage(req.params.id, req.body.message);
  broadcast({ type: 'message_edited', messageId: parseInt(req.params.id), text: req.body.message });
  res.json({ success: true });
});

app.post('/api/messages/:userId/seen', authMiddleware, (req, res) => {
  db.markMessagesSeen(req.params.userId); res.json({ success: true });
});

app.get('/api/unread-messages', authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.getUnreadMessages());
});

app.get('/api/chat-room', authMiddleware, adminMiddleware, (req, res) => {
  res.json(db.getLatestMessages());
});

// ═══ Sub Preview ═══
app.post('/api/sub-preview', authMiddleware, adminMiddleware, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'لینک ساب لازم است' });
  try {
    const result = await subParser.parseSubscription(url);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══ User Panel ═══
app.get('/api/me', authMiddleware, (req, res) => {
  const u = db.getUserById(req.user.userId);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json(sanitizeUser(u));
});

app.get('/api/me/config-count', authMiddleware, async (req, res) => {
  const u = db.getUserById(req.user.userId);
  if (!u) return res.status(404).json();
  const links = safeJSON(u.subscription_links, []);
  let count = 0;
  if (links.length) {
    for (const link of links) {
      try {
        const r = await subParser.parseSubscription(link);
        count += (r.linkCount || 0);
      } catch {}
    }
  } else {
    count = safeJSON(u.vless_links, []).length;
  }
  res.json({ count });
});

app.get('/api/me/messages', authMiddleware, (req, res) => {
  res.json(db.getMessages(req.user.userId, 200));
});

app.get('/api/me/unread', authMiddleware, (req, res) => {
  res.json({ count: db.getUnreadCount(req.user.userId) });
});

// ═══ Settings ═══
app.get('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  const s = db.getAllSettings();
  delete s.admin_password;
  res.json(s);
});

app.post('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  ['site_url','telegram_token','telegram_admin_id','panel_path','support_id'].forEach(k => {
    if (req.body[k] !== undefined) db.setSetting(k, String(req.body[k]));
  });
  const token = req.body.telegram_token || db.getSetting('telegram_token');
  const adminId = req.body.telegram_admin_id || db.getSetting('telegram_admin_id');
  if (token && adminId) telegram.init(token, adminId);
  res.json({ success: true });
});

app.post('/api/settings/ssl', authMiddleware, adminMiddleware, certUpload.fields([
  { name: 'cert', maxCount: 1 }, { name: 'key', maxCount: 1 }
]), (req, res) => {
  if (req.files?.cert) { fs.renameSync(req.files.cert[0].path, path.join(certsDir, 'cert.pem')); db.setSetting('ssl_cert', path.join(certsDir, 'cert.pem')); }
  if (req.files?.key) { fs.renameSync(req.files.key[0].path, path.join(certsDir, 'key.pem')); db.setSetting('ssl_key', path.join(certsDir, 'key.pem')); }
  res.json({ success: true });
});

app.post('/api/settings/url', authMiddleware, adminMiddleware, (req, res) => {
  db.setSetting('site_url', req.body.url); res.json({ success: true });
});

// ═══ Telegram ═══
app.post('/api/telegram/test', authMiddleware, adminMiddleware, async (req, res) => {
  if (req.body.token) db.setSetting('telegram_token', req.body.token);
  if (req.body.adminId) db.setSetting('telegram_admin_id', req.body.adminId);
  const t = req.body.token || db.getSetting('telegram_token');
  const a = req.body.adminId || db.getSetting('telegram_admin_id');
  telegram.init(t, a);
  res.json(await telegram.testConnection());
});

// ═══ Backup ═══
app.post('/api/backup/create', authMiddleware, adminMiddleware, async (req, res) => {
  try { res.json({ success: true, path: await backup.createBackup() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/backup/send-telegram', authMiddleware, adminMiddleware, async (req, res) => {
  try { await backup.backupToTelegram(); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/backups', authMiddleware, adminMiddleware, (req, res) => {
  res.json(backup.listLocalBackups());
});

app.get('/api/backups/download/:name', authMiddleware, adminMiddleware, (req, res) => {
  const fp = path.join(__dirname, 'backups', req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'فایل یافت نشد' });
  res.download(fp);
});

app.post('/api/backup/restore', authMiddleware, adminMiddleware, upload.single('backup'), async (req, res) => {
  try { await backup.restoreBackup(req.file.path); res.json({ success: true, message: 'بکاپ بازیابی شد' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ Image Upload ═══
app.post('/api/upload-image', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی آپلود نشد' });
  const ext = path.extname(req.file.originalname) || '.png';
  const newName = Date.now() + ext;
  fs.renameSync(req.file.path, path.join(uploadDir, newName));
  res.json({ url: '/uploads/' + newName });
});

// ═══ Check Auth ═══
app.get('/api/check-auth', authMiddleware, (req, res) => res.json({ valid: true, role: req.user.role }));

// ═══ Panel pages ═══
app.get('/u/:username', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user.html')));
app.get('/' + (db.getSetting('panel_path') || 'panel_h'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ═══ Helpers ═══
function sanitizeUser(u) {
  if (!u) return null;
  return { ...u, subscription_links: safeJSON(u.subscription_links, []), vless_links: safeJSON(u.vless_links, []), last_data: safeJSON(u.last_data, {}) };
}
function safeJSON(s, fb) { try { return JSON.parse(s || ''); } catch { return fb; } }

async function fetchAndUpdateUserSub(userId) {
  const user = db.getUserById(userId);
  if (!user) throw new Error('User not found');
  if (user.unlimited_volume) {
    db.updateUser(userId, { remaining_volume: 'نامحدود', remaining_days: user.manual_days || 30, total_volume: 'نامحدود', total_days: user.manual_days || 30, used_volume: 'نامحدود', sub_error: 0, last_checked: new Date().toISOString() });
    return { success: true, mode: 'unlimited' };
  }
  const links = safeJSON(user.subscription_links, []);
  if (!links.length) {
    db.updateUser(userId, { remaining_volume: '0', remaining_days: 0, sub_error: 0, last_checked: new Date().toISOString() });
    return { success: true, mode: 'no_subs' };
  }
  const result = await subParser.parseMultipleSubscriptions(links);
  db.updateUser(userId, {
    remaining_volume: result.remainingVolume || '0', remaining_days: result.remainingDays || 0,
    total_volume: result.totalVolume || '0', total_days: result.remainingDays || 0,
    used_volume: result.usedVolume || '0', sub_error: result.error ? 1 : 0,
    last_checked: new Date().toISOString(), last_data: JSON.stringify(result)
  });
  if (result.error) {
    telegram.notifySubError(user.username, result.error).catch(() => {});
    broadcastAdmin({ type: 'sub_error', userId, username: user.username, error: result.error });
  }
  return result;
}

// ═══ Cron ═══
cron.schedule('* * * * *', async () => {
  const users = db.getUsers();
  for (const u of users) {
    try { await fetchAndUpdateUserSub(u.id); } catch {}
  }
  broadcastAdmin({ type: 'refresh' });
});

cron.schedule('*/5 * * * *', async () => {
  try { await backup.backupToTelegram(); db.setSetting('last_backup', new Date().toISOString()); } catch {}
});

// ═══ Init ═══
const tt = db.getSetting('telegram_token');
const ta = db.getSetting('telegram_admin_id');
if (tt && ta) telegram.init(tt, ta);

const PORT = process.env.PORT || 3000;
const panelPath = db.getSetting('panel_path') || 'panel_h';

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n╔══════════════════════════════════════════════╗`);
  console.log(`║     VPN User Management Panel v2.0          ║`);
  console.log(`║     Server running on port ${PORT}              ║`);
  console.log(`║     Admin panel: /${panelPath}                 ║`);
  console.log(`║     Default password: 427726                 ║`);
  console.log(`╚══════════════════════════════════════════════╝\n`);
  
  setTimeout(async () => {
    const users = db.getUsers();
    for (const u of users) { try { await fetchAndUpdateUserSub(u.id); } catch {} }
  }, 5000);
});

process.on('SIGTERM', () => { wss.close(); server.close(); process.exit(0); });
