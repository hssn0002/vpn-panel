const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

class TelegramBot {
  constructor() {
    this.token = ''; this.adminId = ''; this.initialized = false;
    this.proxyUrl = ''; this.proxyType = 'http';
  }

  init(token, adminId, proxyUrl = '', proxyType = 'http') {
    this.token = token; this.adminId = adminId;
    this.proxyUrl = proxyUrl; this.proxyType = proxyType;
    this.initialized = !!(token && adminId);
    return this.initialized;
  }

  async testConnection() {
    if (!this.initialized) return { ok: false, error: 'Not configured' };
    try { const r = await this._api('getMe'); return { ok: true, bot: r.result }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  async testProxy() {
    if (!this.initialized) return { ok: false, error: 'No token configured' };
    try {
      const r = await this._apiWithProxy('getMe', {}, this.proxyUrl);
      return { ok: true, bot: r.result };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async sendMessage(text) {
    if (!this.initialized) return null;
    try {
      return await this._tryWithProxy('sendMessage', { chat_id: this.adminId, text, parse_mode: 'HTML' });
    } catch { return null; }
  }

  async sendDocument(filePath, caption = '') {
    if (!this.initialized) return null;
    try {
      const formData = await this._createFormData(filePath, caption);
      return await this._tryUpload('sendDocument', formData);
    } catch { return null; }
  }

  async sendBackup(backupPath, caption = '') { return this.sendDocument(backupPath, caption); }

  async notifyNewMessage(username, message) {
    return this.sendMessage(`📩 <b>پیام جدید</b>\n👤 ${username}\n💬 ${message}\n🕐 ${new Date().toLocaleString('fa-IR')}`);
  }

  async notifySubError(username, error) {
    return this.sendMessage(`⚠️ <b>خطای ساب</b>\n👤 ${username}\n❌ ${error}`);
  }

  async _tryWithProxy(method, params) {
    // Try direct first
    try { return await this._api(method, params); } catch {
      if (this.proxyUrl) return await this._apiWithProxy(method, params, this.proxyUrl);
      throw new Error('No proxy configured');
    }
  }

  async _tryUpload(method, formData) {
    try { return await this._apiFile(method, formData); } catch {
      if (this.proxyUrl) return await this._apiFileWithProxy(method, formData, this.proxyUrl);
      throw new Error('No proxy configured');
    }
  }

  _api(method, params = {}) {
    return new Promise((resolve, reject) => {
      const body = Object.keys(params).length ? JSON.stringify(params) : '';
      const req = https.request({
        hostname: 'api.telegram.org', path: `/bot${this.token}/${method}`, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 30000
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { const j = JSON.parse(d); j.ok ? resolve(j) : reject(new Error(j.description || 'API error')); } catch { reject(new Error('Parse error')); } });
      });
      req.on('error', reject); req.write(body); req.end();
    });
  }

  _apiWithProxy(method, params, proxyUrl) {
    return new Promise((resolve, reject) => {
      const body = Object.keys(params).length ? JSON.stringify(params) : '';
      const pu = new URL(proxyUrl);
      const opts = {
        hostname: pu.hostname, port: pu.port || 3128, method: 'POST',
        path: `https://api.telegram.org/bot${this.token}/${method}`,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Host': 'api.telegram.org' },
        timeout: 30000
      };
      if (pu.username) opts.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(pu.username + ':' + (pu.password || '')).toString('base64');
      const req = http.request(opts, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { const j = JSON.parse(d); j.ok ? resolve(j) : reject(new Error(j.description || 'Proxy error')); } catch { reject(new Error('Parse error')); } });
      });
      req.on('error', reject); req.write(body); req.end();
    });
  }

  _apiFile(method, { boundary, body }) {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.telegram.org', path: `/bot${this.token}/${method}`, method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(body) }, timeout: 120000
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { const j = JSON.parse(d); j.ok ? resolve(j) : reject(new Error(j.description || 'Upload error')); } catch { reject(new Error('Parse error')); } });
      });
      req.on('error', reject); req.write(body); req.end();
    });
  }

  _apiFileWithProxy(method, { boundary, body }, proxyUrl) {
    return new Promise((resolve, reject) => {
      const pu = new URL(proxyUrl);
      const req = http.request({
        hostname: pu.hostname, port: pu.port || 3128, method: 'POST',
        path: `https://api.telegram.org/bot${this.token}/${method}`,
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(body), 'Host': 'api.telegram.org' },
        timeout: 120000
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { const j = JSON.parse(d); j.ok ? resolve(j) : reject(new Error(j.description || 'Upload error')); } catch { reject(new Error('Parse error')); } });
      });
      req.on('error', reject); req.write(body); req.end();
    });
  }

  _createFormData(filePath, caption) {
    return new Promise((resolve, reject) => {
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const chunks = [];
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${this.adminId}\r\n`));
      if (caption) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`));
      const fn = path.basename(filePath);
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${fn}"\r\nContent-Type: application/zip\r\n\r\n`));
      fs.readFile(filePath, (err, data) => {
        if (err) return reject(err);
        chunks.push(data);
        chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
        resolve({ boundary, body: Buffer.concat(chunks) });
      });
    });
  }
}

module.exports = new TelegramBot();
