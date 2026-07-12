/**
 * Telegram Bot Integration
 * Sends backups and notifications via Telegram
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

class TelegramBot {
  constructor() {
    this.token = '';
    this.adminId = '';
    this.initialized = false;
  }

  init(token, adminId) {
    this.token = token;
    this.adminId = adminId;
    this.initialized = !!(token && adminId);
    return this.initialized;
  }

  async testConnection() {
    if (!this.initialized) return { ok: false, error: 'Not configured' };
    try {
      const result = await this._api('getMe');
      return { ok: true, bot: result.result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async sendMessage(text) {
    if (!this.initialized) return null;
    return this._api('sendMessage', {
      chat_id: this.adminId,
      text: text,
      parse_mode: 'HTML'
    });
  }

  async sendDocument(filePath, caption = '') {
    if (!this.initialized) return null;
    const formData = await this._createFormData(filePath, caption);
    return this._apiFile('sendDocument', formData);
  }

  async sendBackup(backupPath, caption = '') {
    return this.sendDocument(backupPath, caption);
  }

  async notifyNewMessage(username, message) {
    const text = `📩 <b>پیام جدید از کاربر</b>\n👤 کاربر: ${username}\n💬 پیام: ${message}\n\n🕐 ${new Date().toLocaleString('fa-IR')}`;
    return this.sendMessage(text);
  }

  async notifySubError(username, error) {
    const text = `⚠️ <b>خطا در ساب کاربر</b>\n👤 کاربر: ${username}\n❌ خطا: ${error}\n🕐 ${new Date().toLocaleString('fa-IR')}`;
    return this.sendMessage(text);
  }

  _api(method, params = {}) {
    return new Promise((resolve, reject) => {
      const url = `/bot${this.token}/${method}`;
      let body = '';
      
      if (Object.keys(params).length > 0) {
        body = JSON.stringify(params);
      }

      const options = {
        hostname: 'api.telegram.org',
        path: url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 30000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) resolve(json);
            else reject(new Error(json.description || 'Telegram API error'));
          } catch (e) {
            reject(new Error('Failed to parse Telegram response'));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Telegram timeout')); });
      req.write(body);
      req.end();
    });
  }

  _apiFile(method, { boundary, body }) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.telegram.org',
        path: `/bot${this.token}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': Buffer.byteLength(body)
        },
        timeout: 120000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.ok) resolve(json);
            else reject(new Error(json.description || 'Telegram API error'));
          } catch (e) {
            reject(new Error('Failed to parse Telegram response'));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  _createFormData(filePath, caption) {
    return new Promise((resolve, reject) => {
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const chunks = [];

      // Chat ID
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      chunks.push(Buffer.from('Content-Disposition: form-data; name="chat_id"\r\n\r\n'));
      chunks.push(Buffer.from(this.adminId + '\r\n'));

      // Caption
      if (caption) {
        chunks.push(Buffer.from(`--${boundary}\r\n`));
        chunks.push(Buffer.from('Content-Disposition: form-data; name="caption"\r\n\r\n'));
        chunks.push(Buffer.from(caption + '\r\n'));
      }

      // Document
      const filename = path.basename(filePath);
      chunks.push(Buffer.from(`--${boundary}\r\n`));
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="document"; filename="${filename}"\r\n`));
      chunks.push(Buffer.from('Content-Type: application/zip\r\n\r\n'));

      // Read file
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
