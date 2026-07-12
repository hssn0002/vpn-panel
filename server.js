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
    const d = jwt.verify(token, JWT_SECRET);
    ws.userId = type === 'admin' ? 'admin' : d.userId;
    if (type === 'admin') adminClients.add(ws);
    else clients.set(d.userId, ws);
    ws.on('message', data => { try { handleWS(ws, JSON.parse(data.toString())); } catch {} });
    ws.on('close', () => { if (type === 'admin') adminClients.delete(ws); else clients.delete(d.userId); });
  } catch { ws.close(); }
});

function handleWS(ws, msg) {
  if (msg.type === 'chat' && msg.userId) {
    const uid = msg.userId, text = msg.text || '', img = msg.image || '';
    const st = ws.userId === 'admin' ? 'admin' : 'user';
    const saved = db.addMessage(uid, st, text, img);
    const user = db.getUserById(uid);
    const cm = { type: 'chat', id: saved.id, userId: uid, username: user?.username || '', message: text, image: img, senderType: st, time: new Date().toLocaleString('fa-IR') };
    const uws = clients.get(uid);
    if (uws?.readyState === WebSocket.OPEN) uws.send(JSON.stringify(cm));
    const json = JSON.stringify({ ...cm, type: 'admin_chat' });
    for (const aw of adminClients) { if (aw.readyState === WebSocket.OPEN) aw.send(json); }
    if (st === 'user' && user) telegram.notifyNewMessage(user.username, text).catch(() => {});
  }
  if (msg.type === 'mark_seen' && msg.userId) db.markMessagesSeen(msg.userId);
  if (msg.type === 'delete_message') { db.deleteMessage(msg.messageId); bcast({ type: 'message_deleted', messageId: msg.messageId }); }
  if (msg.type === 'edit_message') { db.updateMessage(msg.messageId, msg.text); bcast({ type: 'message_edited', messageId: msg.messageId, text: msg.text }); }
}

function bcast(data) {
  const j = JSON.stringify(data);
  for (const ws of adminClients) { if (ws.readyState === WebSocket.OPEN) ws.send(j); }
  for (const [,ws] of clients) { if (ws.readyState === WebSocket.OPEN) ws.send(j); }
}

function bcastAdmin(data) {
  const j = JSON.stringify(data);
  for (const ws of adminClients) { if (ws.readyState === WebSocket.OPEN) ws.send(j); }
}

// ═══ Auth ═══
function auth(req, res, next) {
  const t = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!t) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); } catch { res.status(401).json({ error: 'Invalid token' }); }
}
function adminOnly(req, res, next) { req.user?.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' }); }

app.post('/api/login', (req, res) => {
  if (!bcrypt.compareSync(req.body.password || '', db.getSetting('admin_password'))) return res.status(401).json({ error: 'رمز عبور اشتباه است' });
  res.json({ token: jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' }) });
});

app.post('/api/user-login', (req, res) => {
  const u = db.getUserByUsername(req.body.username);
  if (!u) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json({ token: jwt.sign({ userId: u.id, role: 'user' }, JWT_SECRET, { expiresIn: '30d' }), user: sanitizeUser(u) });
});

app.post('/api/change-password', auth, adminOnly, (req, res) => {
  if (!bcrypt.compareSync(req.body.currentPassword, db.getSetting('admin_password'))) return res.status(400).json({ error: 'رمز فعلی اشتباه است' });
  db.setSetting('admin_password', bcrypt.hashSync(req.body.newPassword, 10));
  res.json({ success: true });
});

// ═══ Users CRUD ═══
app.get('/api/users', auth, adminOnly, (req, res) => {
  res.json(db.getUsers(req.query.sort, req.query.dir).map(sanitizeUser));
});

app.get('/api/stats', auth, adminOnly, (req, res) => {
  res.json(db.getStats());
});

app.get('/api/users/:id', auth, adminOnly, (req, res) => {
  const u = db.getUserById(req.params.id);
  u ? res.json(sanitizeUser(u)) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/users', auth, adminOnly, (req, res) => {
  const { username, contact_type, contact_id, subscription_links, manual_vless, unlimited_volume, manual_days, vless_links } = req.body;
  if (!username?.trim()) return res.status(400).json({ error: 'نام کاربری الزامی است' });
  if (db.getUserByUsername(username.trim())) return res.status(400).json({ error: 'نام تکراری' });
  const d = {
    username: username.trim(), display_name: username.trim(),
    contact_type: contact_type || 'telegram', contact_id: contact_id || '',
    subscription_links: JSON.stringify(subscription_links || []),
    manual_vless: JSON.stringify(manual_vless || []),
    unlimited_volume: unlimited_volume ? 1 : 0,
    manual_days: parseInt(manual_days) || 30,
    vless_links: JSON.stringify(vless_links || [])
  };
  const r = db.createUser(d);
  if (!unlimited_volume && subscription_links?.length) refreshSub(r.lastInsertRowid).catch(() => {});
  res.json({ id: r.lastInsertRowid, success: true });
});

app.put('/api/users/:id', auth, adminOnly, (req, res) => {
  if (!db.getUserById(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const up = {};
  ['username','display_name','contact_type','contact_id','unlimited_volume','manual_days'].forEach(f => { if (req.body[f] !== undefined) up[f] = req.body[f]; });
  if (req.body.subscription_links !== undefined) up.subscription_links = JSON.stringify(req.body.subscription_links);
  if (req.body.manual_vless !== undefined) up.manual_vless = JSON.stringify(req.body.manual_vless);
  if (req.body.vless_links !== undefined) up.vless_links = JSON.stringify(req.body.vless_links);
  db.updateUser(req.params.id, up);
  const u = db.getUserById(req.params.id);
  const links = safeJSON(u.subscription_links, []);
  if (!u.unlimited_volume && links.length) refreshSub(req.params.id).catch(() => {});
  res.json({ success: true });
});

app.delete('/api/users/:id', auth, adminOnly, (req, res) => { db.deleteUser(req.params.id); res.json({ success: true }); });
app.post('/api/users/bulk-delete', auth, adminOnly, (req, res) => {
  if (!req.body.ids?.length) return res.status(400).json();
  db.deleteUsers(req.body.ids); res.json({ success: true });
});

app.post('/api/users/:id/suspend', auth, adminOnly, (req, res) => {
  db.suspendUser(req.params.id, req.body.suspended);
  res.json({ success: true });
});

app.post('/api/users/:id/ack-error', auth, adminOnly, (req, res) => {
  db.ackError(req.params.id);
  res.json({ success: true });
});

app.post('/api/users/:id/refresh', auth, adminOnly, async (req, res) => {
  try { res.json(await refreshSub(req.params.id)); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users/refresh-all', auth, adminOnly, async (req, res) => {
  let c = 0; const users = db.getUsers();
  for (const u of users) { try { await refreshSub(u.id); c++; } catch {} }
  res.json({ updated: c, total: users.length });
});

// ═══ Sub Preview (check button) ═══
app.post('/api/sub-preview', auth, adminOnly, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json();
  try { res.json(await subParser.parseSubscription(url)); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ Messages ═══
app.get('/api/messages/:uid', auth, (req, res) => {
  res.json(db.getMessages(req.params.uid, parseInt(req.query.limit) || 300));
});

app.post('/api/messages/:uid', auth, (req, res) => {
  const st = req.user.role === 'admin' ? 'admin' : 'user';
  const { message, image } = req.body;
  if (!message && !image) return res.status(400).json();
  const saved = db.addMessage(req.params.uid, st, message || '', image || '');
  const u = db.getUserById(req.params.uid);
  const cm = { type: 'chat', id: saved.id, userId: parseInt(req.params.uid), username: u?.username || '', message: message || '', image: image || '', senderType: st, time: new Date().toLocaleString('fa-IR') };
  const uws = clients.get(parseInt(req.params.uid));
  if (uws?.readyState === WebSocket.OPEN) uws.send(JSON.stringify(cm));
  const j = JSON.stringify({ ...cm, type: 'admin_chat' });
  for (const aw of adminClients) { if (aw.readyState === WebSocket.OPEN) aw.send(j); }
  if (st === 'user' && u) telegram.notifyNewMessage(u.username, message || '📷').catch(() => {});
  res.json({ id: saved.id, success: true });
});

app.delete('/api/messages/:id', auth, (req, res) => {
  db.deleteMessage(req.params.id); bcast({ type: 'message_deleted', messageId: parseInt(req.params.id) }); res.json({ success: true });
});

app.put('/api/messages/:id', auth, (req, res) => {
  db.updateMessage(req.params.id, req.body.message); bcast({ type: 'message_edited', messageId: parseInt(req.params.id), text: req.body.message }); res.json({ success: true });
});

app.post('/api/messages/:uid/seen', auth, (req, res) => { db.markMessagesSeen(req.params.uid); res.json({ success: true }); });
app.get('/api/unread-messages', auth, adminOnly, (req, res) => res.json(db.getUnreadMessages()));
app.get('/api/chat-room', auth, adminOnly, (req, res) => res.json(db.getLatestMessages()));

// ═══ Direct Subscription Endpoint (for v2ray apps) ═══
app.get('/sub/:username', async (req, res) => {
  const u = db.getUserByUsername(req.params.username);
  if (!u) return res.status(404).send('User not found');
  
  let allConfigs = [];
  // From subscription links
  const subLinks = safeJSON(u.subscription_links, []);
  for (const link of subLinks) {
    try {
      const result = await subParser.parseSubscription(link);
      if (result.allConfigs?.length) allConfigs = allConfigs.concat(result.allConfigs);
    } catch {}
  }
  // From manual vless
  const manual = safeJSON(u.manual_vless, []);
  allConfigs = allConfigs.concat(manual);
  // From unlimited vless
  const vless = safeJSON(u.vless_links, []);
  allConfigs = allConfigs.concat(vless);

  if (!allConfigs.length) return res.send('');
  
  const body = allConfigs.join('\n');
  const b64 = Buffer.from(body, 'utf-8').toString('base64');
  
  // Set subscription-userinfo header
  const upload = 0, download = 0;
  const totalBytes = parseVolToBytes(u.total_volume);
  const expireTs = u.remaining_days > 0 ? Math.floor(Date.now() / 1000) + (u.remaining_days * 86400) : 0;
  res.setHeader('subscription-userinfo', `upload=0; download=0; total=${totalBytes}; expire=${expireTs}`);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(b64);
});

// ═══ User Panel ═══
app.get('/api/me', auth, (req, res) => {
  const u = db.getUserById(req.user.userId);
  if (!u) return res.status(404).json();
  const su = sanitizeUser(u);
  // Add suspension/expiry messages
  if (u.suspended) su.status_message = '⛔ اشتراک شما غیرفعال شده است. لطفا با پشتیبانی تماس بگیرید.';
  else if (u.remaining_days <= 0 && !u.unlimited_volume) su.status_message = '⏰ زمان اشتراک شما به پایان رسیده است. در صورت تمایل به تمدید با پشتیبانی تماس بگیرید.';
  else if (parseFloat(u.remaining_volume) <= 0 && u.remaining_volume !== 'نامحدود' && u.remaining_volume !== '∞') su.status_message = '📊 حجم اشتراک شما به پایان رسیده است. در صورت تمایل به شارژ مجدد با پشتیبانی تماس بگیرید.';
  res.json(su);
});

app.get('/api/me/configs', auth, async (req, res) => {
  const u = db.getUserById(req.user.userId);
  if (!u) return res.status(404).json();
  let allConfigs = [];
  const subLinks = safeJSON(u.subscription_links, []);
  for (const link of subLinks) {
    try { const r = await subParser.parseSubscription(link); if (r.allConfigs?.length) allConfigs = allConfigs.concat(r.allConfigs); } catch {}
  }
  allConfigs = allConfigs.concat(safeJSON(u.manual_vless, []));
  allConfigs = allConfigs.concat(safeJSON(u.vless_links, []));
  res.json({ configs: allConfigs, count: allConfigs.length });
});

app.get('/api/me/messages', auth, (req, res) => res.json(db.getMessages(req.user.userId, 300)));
app.get('/api/me/unread', auth, (req, res) => res.json({ count: db.getUnreadCount(req.user.userId) }));

// ═══ Settings ═══
app.get('/api/settings', auth, adminOnly, (req, res) => {
  const s = db.getAllSettings(); delete s.admin_password; res.json(s);
});

app.post('/api/settings', auth, adminOnly, (req, res) => {
  ['site_url','telegram_token','telegram_admin_id','panel_path','support_id','proxy_url','proxy_type'].forEach(k => {
    if (req.body[k] !== undefined) db.setSetting(k, String(req.body[k]));
  });
  initTelegram();
  res.json({ success: true });
});

app.post('/api/settings/ssl', auth, adminOnly, certUpload.fields([{ name:'cert',maxCount:1 },{ name:'key',maxCount:1 }]), (req, res) => {
  if (req.files?.cert) { fs.renameSync(req.files.cert[0].path, path.join(certsDir,'cert.pem')); db.setSetting('ssl_cert',path.join(certsDir,'cert.pem')); }
  if (req.files?.key) { fs.renameSync(req.files.key[0].path, path.join(certsDir,'key.pem')); db.setSetting('ssl_key',path.join(certsDir,'key.pem')); }
  res.json({ success: true });
});

app.post('/api/settings/url', auth, adminOnly, (req, res) => { db.setSetting('site_url', req.body.url); res.json({ success: true }); });

// ═══ Telegram ═══
app.post('/api/telegram/test', auth, adminOnly, async (req, res) => {
  if (req.body.token) db.setSetting('telegram_token', req.body.token);
  if (req.body.adminId) db.setSetting('telegram_admin_id', req.body.adminId);
  initTelegram();
  res.json(await telegram.testConnection());
});

app.post('/api/telegram/test-proxy', auth, adminOnly, async (req, res) => {
  const proxyUrl = req.body.proxyUrl || db.getSetting('proxy_url');
  if (!proxyUrl) return res.json({ ok: false, error: 'پروکسی تنظیم نشده' });
  db.setSetting('proxy_url', proxyUrl);
  if (req.body.proxyType) db.setSetting('proxy_type', req.body.proxyType);
  initTelegram();
  res.json(await telegram.testProxy());
});

// ═══ Backup ═══
app.post('/api/backup/create', auth, adminOnly, async (req, res) => {
  try { res.json({ success: true, path: await backup.createBackup() }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/backup/send-telegram', auth, adminOnly, async (req, res) => {
  try { await backup.backupToTelegram(); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/backups', auth, adminOnly, (req, res) => res.json(backup.listLocalBackups()));
app.get('/api/backups/download/:name', auth, adminOnly, (req, res) => {
  const fp = path.join(__dirname, 'backups', req.params.name);
  fs.existsSync(fp) ? res.download(fp) : res.status(404).json();
});
app.post('/api/backup/restore', auth, adminOnly, upload.single('backup'), async (req, res) => {
  try { await backup.restoreBackup(req.file.path); res.json({ success: true, message: 'بازیابی شد' }); } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ Upload ═══
app.post('/api/upload-image', auth, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json();
  const ext = path.extname(req.file.originalname) || '.png';
  const n = Date.now() + ext;
  fs.renameSync(req.file.path, path.join(uploadDir, n));
  res.json({ url: '/uploads/' + n });
});

app.get('/api/check-auth', auth, (req, res) => res.json({ valid: true, role: req.user.role }));

// ═══ Pages ═══
app.get('/u/:username', (req, res) => res.sendFile(path.join(__dirname, 'public', 'user.html')));
app.get('/' + (db.getSetting('panel_path') || 'panel_h'), (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ═══ Helpers ═══
function sanitizeUser(u) {
  if (!u) return null;
  return { ...u, subscription_links: safeJSON(u.subscription_links, []), manual_vless: safeJSON(u.manual_vless, []), vless_links: safeJSON(u.vless_links, []), last_data: safeJSON(u.last_data, {}) };
}
function safeJSON(s, fb) { try { return JSON.parse(s || ''); } catch { return fb; } }
function parseVolToBytes(s) {
  if (!s || s === 'نامحدود' || s === '∞') return 0;
  const m = s.match(/([\d.]+)\s*(GB|MB|KB|B|TB)/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2];
  const mul = { B:1, KB:1024, MB:1048576, GB:1073741824, TB:1099511627776 };
  return Math.floor(n * (mul[u] || 1));
}

async function refreshSub(userId) {
  const user = db.getUserById(userId);
  if (!user) throw new Error('Not found');
  if (user.unlimited_volume) {
    db.updateUser(userId, { remaining_volume: 'نامحدود', remaining_days: user.manual_days || 30, total_volume: 'نامحدود', total_days: user.manual_days, used_volume: 'نامحدود', sub_error: 0, last_checked: new Date().toISOString() });
    return { mode: 'unlimited' };
  }
  const links = safeJSON(user.subscription_links, []);
  if (!links.length) {
    db.updateUser(userId, { remaining_volume: '0', remaining_days: 0, sub_error: 0, last_checked: new Date().toISOString() });
    return { mode: 'no_subs' };
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
    bcastAdmin({ type: 'sub_error', userId, username: user.username, error: result.error });
  }
  return result;
}

function initTelegram() {
  const t = db.getSetting('telegram_token');
  const a = db.getSetting('telegram_admin_id');
  const p = db.getSetting('proxy_url');
  const pt = db.getSetting('proxy_type') || 'http';
  if (t && a) telegram.init(t, a, p, pt);
}

// ═══ Cron ═══
cron.schedule('* * * * *', async () => {
  const users = db.getUsers();
  for (const u of users) { try { await refreshSub(u.id); } catch {} }
  bcastAdmin({ type: 'refresh' });
});

cron.schedule('*/5 * * * *', async () => {
  try { await backup.backupToTelegram(); db.setSetting('last_backup', new Date().toISOString()); } catch {}
});

// ═══ Start ═══
initTelegram();

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nVPN Panel v3.0 | Port ${PORT} | Admin: /${db.getSetting('panel_path')||'panel_h'}\n`);
  setTimeout(async () => { for (const u of db.getUsers()) { try { await refreshSub(u.id); } catch {} } }, 5000);
});
process.on('SIGTERM', () => { wss.close(); server.close(); process.exit(0); });
