/**
 * VPN User Management Panel - Main Server
 * Standalone Node.js application with SQLite + WebSocket + Telegram
 */
const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const db = require('./db');
const subParser = require('./sub-parser');
const telegram = require('./telegram');
const backup = require('./backup');

const app = express();
const server = http.createServer(app);

// ── Middleware ──
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// File upload config
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ 
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Cert upload config
const certsDir = path.join(__dirname, 'certs');
const certUpload = multer({ dest: certsDir, limits: { fileSize: 10 * 1024 * 1024 } });

// ── JWT Secret ──
const JWT_SECRET = db.getSetting('jwt_secret') || require('crypto').randomBytes(32).toString('hex');
db.setSetting('jwt_secret', JWT_SECRET);

// Init admin password if not set
const storedPass = db.getSetting('admin_password');
if (!storedPass || storedPass === '$2a$10$dummy_hash_for_427726') {
  const hash = bcrypt.hashSync('427726', 10);
  db.setSetting('admin_password', hash);
}

// ── WebSocket Setup ──
const wss = new WebSocket.Server({ server });
const clients = new Map(); // userId -> ws
const adminClients = new Set();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const type = url.searchParams.get('type'); // 'admin' or 'user'
  
  if (!token) {
    ws.close();
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (type === 'admin') {
      ws.userId = 'admin';
      adminClients.add(ws);
    } else {
      ws.userId = decoded.userId;
      clients.set(decoded.userId, ws);
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleWSMessage(ws, msg);
      } catch (e) {}
    });

    ws.on('close', () => {
      if (type === 'admin') {
        adminClients.delete(ws);
      } else {
        clients.delete(decoded.userId);
      }
    });
  } catch (e) {
    ws.close();
  }
});

function handleWSMessage(ws, msg) {
  if (msg.type === 'chat' && msg.userId) {
    const userId = msg.userId;
    const message = msg.text || '';
    const image = msg.image || '';

    // Save to database
    const senderType = ws.userId === 'admin' ? 'admin' : 'user';
    db.addMessage(userId, senderType, message, image);

    const user = db.getUserById(userId);
    const chatMsg = {
      type: 'chat',
      userId: userId,
      username: user ? user.username : '',
      message: message,
      image: image,
      senderType: senderType,
      time: new Date().toLocaleString('fa-IR')
    };

    // Send to user
    const userWs = clients.get(userId);
    if (userWs && userWs.readyState === WebSocket.OPEN) {
      userWs.send(JSON.stringify(chatMsg));
    }

    // Send to all admin clients
    for (const adminWs of adminClients) {
      if (adminWs.readyState === WebSocket.OPEN) {
        adminWs.send(JSON.stringify({ ...chatMsg, type: 'admin_chat' }));
      }
    }

    // Notify Telegram if user sent message
    if (senderType === 'user' && user) {
      telegram.notifyNewMessage(user.username, message).catch(() => {});
    } else if (senderType === 'admin') {
      // Refresh unread count for user
      const unread = db.getUnreadCount(userId);
      if (userWs && userWs.readyState === WebSocket.OPEN) {
        userWs.send(JSON.stringify({ type: 'unread_count', count: unread }));
      }
    }
  }

  if (msg.type === 'mark_seen' && msg.userId) {
    db.markMessagesSeen(msg.userId);
  }

  if (msg.type === 'typing' && msg.userId) {
    const user = db.getUserById(msg.userId);
    for (const adminWs of adminClients) {
      if (adminWs.readyState === WebSocket.OPEN) {
        adminWs.send(JSON.stringify({ 
          type: 'typing', 
          userId: msg.userId, 
          username: user ? user.username : '' 
        }));
      }
    }
  }
}

// Broadcast to all admin clients
function broadcastAdmin(data) {
  for (const ws of adminClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}

// ── Auth Middleware ──
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── API Routes ──

// Login
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  const hash = db.getSetting('admin_password');
  
  if (!bcrypt.compareSync(password, hash)) {
    return res.status(401).json({ error: 'رمز عبور اشتباه است' });
  }

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token });
});

// User login (by username)
app.post('/api/user-login', (req, res) => {
  const { username } = req.body;
  const user = db.getUserByUsername(username);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });

  const token = jwt.sign({ userId: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: sanitizeUser(user) });
});

// Change password
app.post('/api/change-password', authMiddleware, adminMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const hash = db.getSetting('admin_password');

  if (!bcrypt.compareSync(currentPassword, hash)) {
    return res.status(400).json({ error: 'رمز عبور فعلی اشتباه است' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.setSetting('admin_password', newHash);
  res.json({ success: true });
});

// ── Admin API ──

// Get all users
app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const sortBy = req.query.sort || 'remaining_days';
  const sortDir = req.query.dir || 'ASC';
  const users = db.getUsers(sortBy, sortDir);
  res.json(users.map(sanitizeUser));
});

// Get single user
app.get('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json(sanitizeUser(user));
});

// Create user
app.post('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const { username, contact_type, contact_id, subscription_links, unlimited_volume, manual_days, vless_links } = req.body;

  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'نام کاربری الزامی است' });
  }

  const existing = db.getUserByUsername(username.trim());
  if (existing) {
    return res.status(400).json({ error: 'این نام کاربری قبلا ثبت شده' });
  }

  const data = {
    username: username.trim(),
    contact_type: contact_type || 'telegram',
    contact_id: contact_id || '',
    subscription_links: JSON.stringify(subscription_links || []),
    unlimited_volume: unlimited_volume ? 1 : 0,
    manual_days: parseInt(manual_days) || 30,
    vless_links: JSON.stringify(vless_links || [])
  };

  const result = db.createUser(data);
  
  // Immediately fetch sub data
  if (!unlimited_volume && subscription_links && subscription_links.length > 0) {
    fetchAndUpdateUserSub(result.lastInsertRowid).catch(() => {});
  }

  res.json({ id: result.lastInsertRowid, success: true });
});

// Update user
app.put('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  const user = db.getUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });

  const updates = {};
  const fields = ['username', 'contact_type', 'contact_id', 'unlimited_volume', 'manual_days'];
  
  for (const f of fields) {
    if (req.body[f] !== undefined) updates[f] = req.body[f];
  }

  if (req.body.subscription_links !== undefined) {
    updates.subscription_links = JSON.stringify(req.body.subscription_links);
  }
  if (req.body.vless_links !== undefined) {
    updates.vless_links = JSON.stringify(req.body.vless_links);
  }

  db.updateUser(req.params.id, updates);

  // Re-fetch sub data
  const updatedUser = db.getUserById(req.params.id);
  const links = JSON.parse(updatedUser.subscription_links || '[]');
  if (!updatedUser.unlimited_volume && links.length > 0) {
    fetchAndUpdateUserSub(req.params.id).catch(() => {});
  }

  res.json({ success: true });
});

// Delete user
app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
  db.deleteUser(req.params.id);
  res.json({ success: true });
});

// Bulk delete users
app.post('/api/users/bulk-delete', authMiddleware, adminMiddleware, (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'هیچ کاربری انتخاب نشده' });
  }
  db.deleteUsers(ids);
  res.json({ success: true });
});

// Refresh user subscription data
app.post('/api/users/:id/refresh', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const result = await fetchAndUpdateUserSub(req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Refresh all users' subscriptions
app.post('/api/users/refresh-all', authMiddleware, adminMiddleware, async (req, res) => {
  const users = db.getUsers();
  let updated = 0;
  
  for (const user of users) {
    try {
      await fetchAndUpdateUserSub(user.id);
      updated++;
    } catch (e) {}
  }

  res.json({ updated, total: users.length });
});

// Get messages for a user
app.get('/api/users/:id/messages', authMiddleware, (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  const messages = db.getMessages(req.params.id, limit);
  res.json(messages);
});

// Send message (REST fallback)
app.post('/api/users/:id/messages', authMiddleware, (req, res) => {
  const { message, image } = req.body;
  const senderType = req.user.role === 'admin' ? 'admin' : 'user';
  
  if (!message && !image) return res.status(400).json({ error: 'متن یا تصویر الزامی است' });

  db.addMessage(req.params.id, senderType, message || '', image || '');
  
  const user = db.getUserById(req.params.id);
  if (senderType === 'user' && user) {
    telegram.notifyNewMessage(user.username, message || '📷 تصویر').catch(() => {});
  }

  res.json({ success: true });
});

// Mark messages as seen
app.post('/api/users/:id/messages/seen', authMiddleware, (req, res) => {
  db.markMessagesSeen(req.params.id);
  res.json({ success: true });
});

// Get latest messages for chat room
app.get('/api/chat-room', authMiddleware, adminMiddleware, (req, res) => {
  const messages = db.getLatestMessages();
  res.json(messages);
});

// Get unread messages list
app.get('/api/unread-messages', authMiddleware, adminMiddleware, (req, res) => {
  const messages = db.getUnreadMessages();
  res.json(messages);
});

// ── User API (for user panel) ──
app.get('/api/me', authMiddleware, (req, res) => {
  const user = db.getUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'کاربر یافت نشد' });
  res.json(sanitizeUser(user));
});

app.get('/api/me/messages', authMiddleware, (req, res) => {
  const messages = db.getMessages(req.user.userId, 200);
  res.json(messages);
});

app.get('/api/me/unread', authMiddleware, (req, res) => {
  const count = db.getUnreadCount(req.user.userId);
  res.json({ count });
});

// ── Settings API ──
app.get('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  const settings = db.getAllSettings();
  // Don't expose password hash
  delete settings.admin_password;
  res.json(settings);
});

app.post('/api/settings', authMiddleware, adminMiddleware, (req, res) => {
  const allowedKeys = ['site_url', 'telegram_token', 'telegram_admin_id', 'panel_path'];
  
  for (const [key, value] of Object.entries(req.body)) {
    if (allowedKeys.includes(key)) {
      db.setSetting(key, String(value));
    }
  }

  // Init Telegram if credentials provided
  const token = req.body.telegram_token || db.getSetting('telegram_token');
  const adminId = req.body.telegram_admin_id || db.getSetting('telegram_admin_id');
  if (token && adminId) {
    telegram.init(token, adminId);
  }

  res.json({ success: true });
});

// SSL cert/key upload
app.post('/api/settings/ssl', authMiddleware, adminMiddleware, certUpload.fields([
  { name: 'cert', maxCount: 1 },
  { name: 'key', maxCount: 1 }
]), (req, res) => {
  if (req.files && req.files.cert) {
    const certPath = path.join(certsDir, 'cert.pem');
    fs.renameSync(req.files.cert[0].path, certPath);
    db.setSetting('ssl_cert', certPath);
  }
  if (req.files && req.files.key) {
    const keyPath = path.join(certsDir, 'key.pem');
    fs.renameSync(req.files.key[0].path, keyPath);
    db.setSetting('ssl_key', keyPath);
  }
  res.json({ success: true });
});

// Set site URL
app.post('/api/settings/url', authMiddleware, adminMiddleware, (req, res) => {
  const { url } = req.body;
  db.setSetting('site_url', url);
  res.json({ success: true });
});

// ── Telegram API ──
app.post('/api/telegram/test', authMiddleware, adminMiddleware, async (req, res) => {
  const { token, adminId } = req.body;
  
  if (token) db.setSetting('telegram_token', token);
  if (adminId) db.setSetting('telegram_admin_id', adminId);
  
  const tToken = token || db.getSetting('telegram_token');
  const tAdmin = adminId || db.getSetting('telegram_admin_id');
  
  telegram.init(tToken, tAdmin);
  const result = await telegram.testConnection();
  res.json(result);
});

// ── Backup API ──
app.post('/api/backup/create', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const filepath = await backup.createBackup();
    res.json({ success: true, path: filepath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/backup/send-telegram', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await backup.backupToTelegram();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/backups', authMiddleware, adminMiddleware, (req, res) => {
  const backups = backup.listLocalBackups();
  res.json(backups);
});

app.get('/api/backups/download/:name', authMiddleware, adminMiddleware, (req, res) => {
  const filepath = path.join(__dirname, 'backups', req.params.name);
  if (!fs.existsSync(filepath)) {
    return res.status(404).json({ error: 'فایل یافت نشد' });
  }
  res.download(filepath);
});

app.post('/api/backup/restore', authMiddleware, adminMiddleware, upload.single('backup'), async (req, res) => {
  try {
    await backup.restoreBackup(req.file.path);
    res.json({ success: true, message: 'بکاپ با موفقیت بازیابی شد. لطفا سرور را ریستارت کنید.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Image Upload for Chat ──
app.post('/api/upload-image', authMiddleware, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایلی آپلود نشد' });
  const ext = path.extname(req.file.originalname) || '.png';
  const newName = Date.now() + ext;
  const newPath = path.join(uploadDir, newName);
  fs.renameSync(req.file.path, newPath);
  res.json({ url: '/uploads/' + newName });
});

// ── Check password ──
app.get('/api/check-auth', authMiddleware, (req, res) => {
  res.json({ valid: true, role: req.user.role });
});

// ── User panel pages ──
app.get('/u/:username', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'user.html'));
});

// Admin panel - hidden path
const panelPath = '/' + (db.getSetting('panel_path') || 'panel_h');
app.get(panelPath, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── Helper Functions ──

function sanitizeUser(user) {
  if (!user) return null;
  return {
    ...user,
    subscription_links: safeJSON(user.subscription_links, []),
    vless_links: safeJSON(user.vless_links, []),
    last_data: safeJSON(user.last_data, {})
  };
}

function safeJSON(str, fallback) {
  try { return JSON.parse(str || ''); } catch { return fallback; }
}

async function fetchAndUpdateUserSub(userId) {
  const user = db.getUserById(userId);
  if (!user) throw new Error('User not found');

  // Handle unlimited volume mode
  if (user.unlimited_volume) {
    const days = user.manual_days || 30;
    db.updateUser(userId, {
      remaining_volume: 'نامحدود',
      remaining_days: days,
      total_volume: 'نامحدود',
      total_days: days,
      used_volume: 'نامحدود',
      sub_error: 0,
      last_checked: new Date().toISOString()
    });
    return { success: true, mode: 'unlimited' };
  }

  const links = safeJSON(user.subscription_links, []);
  
  if (links.length === 0) {
    db.updateUser(userId, {
      remaining_volume: '0',
      remaining_days: 0,
      sub_error: 0,
      last_checked: new Date().toISOString()
    });
    return { success: true, mode: 'no_subs' };
  }

  const result = await subParser.parseMultipleSubscriptions(links);
  
  const updateData = {
    remaining_volume: result.remainingVolume || '0',
    remaining_days: result.remainingDays || 0,
    total_volume: result.totalVolume || '0',
    total_days: result.remainingDays || 0,
    used_volume: result.usedVolume || '0',
    sub_error: result.error ? 1 : 0,
    last_checked: new Date().toISOString(),
    last_data: JSON.stringify(result)
  };

  db.updateUser(userId, updateData);

  // Notify on sub error
  if (result.error) {
    telegram.notifySubError(user.username, result.error).catch(() => {});
    broadcastAdmin({ type: 'sub_error', userId, username: user.username, error: result.error });
  }

  return result;
}

// ── Scheduled Tasks ──

// Refresh all subscriptions every 1 minute
cron.schedule('* * * * *', async () => {
  console.log('[Cron] Refreshing all subscriptions...');
  const users = db.getUsers();
  for (const user of users) {
    try {
      await fetchAndUpdateUserSub(user.id);
    } catch (e) {
      console.error(`[Cron] Error refreshing user ${user.id}:`, e.message);
    }
  }
  broadcastAdmin({ type: 'refresh' });
});

// Backup to Telegram every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[Cron] Creating backup...');
  try {
    await backup.backupToTelegram();
    db.setSetting('last_backup', new Date().toISOString());
  } catch (e) {
    console.error('[Cron] Backup error:', e.message);
  }
});

// ── Init Telegram on startup ──
const telegramToken = db.getSetting('telegram_token');
const telegramAdminId = db.getSetting('telegram_admin_id');
if (telegramToken && telegramAdminId) {
  telegram.init(telegramToken, telegramAdminId);
}

// ── Start Server ──
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║     VPN User Management Panel v1.0          ║
║     Server running on port ${PORT}              ║
║     Admin panel: ${panelPath}                     ║
║     Default password: 427726                 ║
╚══════════════════════════════════════════════╝
  `);
  
  // Initial sub refresh on startup (delayed)
  setTimeout(async () => {
    console.log('[Init] Performing initial subscription refresh...');
    const users = db.getUsers();
    for (const user of users) {
      try { await fetchAndUpdateUserSub(user.id); } catch (e) {}
    }
    console.log('[Init] Initial refresh complete.');
  }, 5000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  wss.close();
  server.close();
  process.exit(0);
});
