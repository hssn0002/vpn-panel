/**
 * VLESS Subscription Link Parser
 * Parses subscription links and extracts usage info from response headers
 * Supports: subscription-userinfo header + base64 body decoding
 */
const https = require('https');
const http = require('http');

/**
 * Parse a single subscription URL and extract usage info
 */
function parseSubscription(url) {
  return new Promise((resolve) => {
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return resolve({ error: 'Invalid URL', remainingVolume: '0', remainingDays: 0, totalVolume: '0', totalDays: 0, usedVolume: '0', noHeader: false });
    }

    const client = url.startsWith('https://') ? https : http;
    const req = client.get(url, { timeout: 20000, headers: { 'User-Agent': 'v2rayN/6.23' } }, (res) => {
      // Check for subscription-userinfo header (case-insensitive)
      let userInfo = '';
      for (const key of Object.keys(res.headers)) {
        if (key.toLowerCase() === 'subscription-userinfo') {
          userInfo = res.headers[key] || '';
          break;
        }
      }

      let data = '';

      res.on('data', chunk => { data += chunk.toString(); });
      res.on('end', () => {
        const info = parseUserInfo(userInfo);
        
        // Try to decode body for link count
        try {
          const decoded = Buffer.from(data.trim(), 'base64').toString('utf-8');
          const lines = decoded.split('\n').filter(l => l.trim() && (l.startsWith('vless://') || l.startsWith('vmess://') || l.startsWith('trojan://') || l.startsWith('ss://') || l.startsWith('ssr://') || l.startsWith('hysteria2://') || l.startsWith('hy2://') || l.startsWith('tuic://') || l.startsWith('socks://') || l.startsWith('http://') || l.startsWith('https://')));
          info.linkCount = lines.length;
          info.allConfigs = lines; // Store for later use
        } catch (e) {
          info.linkCount = 0;
          info.allConfigs = [];
        }
        
        resolve(info);
      });
    });

    req.on('error', (err) => {
      resolve({ error: err.message, remainingVolume: '0', remainingDays: 0, totalVolume: '0', totalDays: 0, usedVolume: '0', noHeader: false });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ error: 'Timeout', remainingVolume: '0', remainingDays: 0, totalVolume: '0', totalDays: 0, usedVolume: '0', noHeader: false });
    });
  });
}

/**
 * Parse subscription-userinfo header
 * Format: upload=1234; download=5678; total=10737418240; expire=1735689600
 */
function parseUserInfo(header) {
  // No header at all — still return something useful
  if (!header || !header.trim()) {
    return { remainingVolume: 'نامشخص', remainingDays: 0, totalVolume: 'نامشخص', totalDays: 0, usedVolume: 'نامشخص', unlimited: false, noHeader: true };
  }

  const result = { remainingVolume: '0', remainingDays: 0, totalVolume: '0', totalDays: 0, usedVolume: '0', unlimited: false, noHeader: false };
  
  let upload = 0, download = 0, total = 0, expire = 0;

  // Split by semicolon and parse key=value
  header.split(';').forEach(pair => {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) return;
    const key = pair.substring(0, eqIdx).trim().toLowerCase();
    const valStr = pair.substring(eqIdx + 1).trim();
    const numVal = parseInt(valStr, 10);
    if (isNaN(numVal)) return;

    switch (key) {
      case 'upload': upload = numVal; break;
      case 'download': download = numVal; break;
      case 'total': total = numVal; break;
      case 'expire': expire = numVal; break;
    }
  });

  const used = upload + download;

  if (total === 0) {
    result.totalVolume = '∞';
    result.remainingVolume = '∞';
    result.unlimited = true;
  } else {
    const remaining = Math.max(0, total - used);
    result.totalVolume = formatBytes(total);
    result.remainingVolume = formatBytes(remaining);
    result.usedVolume = formatBytes(used);
  }

  if (expire === 0) {
    result.totalDays = 9999;
    result.remainingDays = 9999;
    result.unlimited = true; // No expire = unlimited time too
  } else {
    const now = Math.floor(Date.now() / 1000);
    const remainingSecs = expire - now;
    result.remainingDays = Math.max(0, Math.ceil(remainingSecs / 86400));
    result.totalDays = result.remainingDays;
  }

  return result;
}

/**
 * Parse multiple subscriptions and aggregate results
 */
async function parseMultipleSubscriptions(urls) {
  if (!urls || urls.length === 0) {
    return { error: 'No subscriptions', remainingVolume: '0', remainingDays: 0, totalVolume: '0', totalDays: 0, usedVolume: '0', noHeader: false };
  }

  const results = await Promise.all(urls.map(url => parseSubscription(url)));
  
  const errors = results.filter(r => r.error);
  const successes = results.filter(r => !r.error);
  const noHeaders = successes.filter(r => r.noHeader);

  if (successes.length === 0) {
    return { ...results[0], error: errors.map(e => e.error).join('; '), linkCount: 0 };
  }

  // Separate unlimited/normal for volume aggregation
  let totalBytes = 0;
  let usedBytes = 0;
  let maxDays = 0;
  let hasUnlimited = false;
  let hasNoHeader = noHeaders.length > 0;

  for (const r of successes) {
    if (r.unlimited || r.remainingVolume === '∞') {
      hasUnlimited = true;
    } else if (r.noHeader) {
      // No header links: don't add to totals, but still count configs
      // Just use maxDays = max(maxDays, 0) — won't affect
    } else {
      totalBytes += parseBytesToNum(r.totalVolume);
      usedBytes += parseBytesToNum(r.usedVolume);
    }
    maxDays = Math.max(maxDays, r.remainingDays);
  }

  const totalLinkCount = successes.reduce((sum, r) => sum + (r.linkCount || 0), 0);

  const agg = {
    error: errors.length > 0 ? errors.map(e => e.error).join('; ') : null,
    totalVolume: hasUnlimited ? '∞' : formatBytes(totalBytes),
    usedVolume: hasUnlimited ? '∞' : formatBytes(usedBytes),
    remainingVolume: hasUnlimited ? '∞' : formatBytes(Math.max(0, totalBytes - usedBytes)),
    remainingDays: maxDays,
    totalDays: maxDays,
    linkCount: totalLinkCount,
    subCount: successes.length,
    unlimited: hasUnlimited,
    noHeaderCount: noHeaders.length
  };

  return agg;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes > 1e15 || !isFinite(bytes)) return '∞';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function parseBytesToNum(str) {
  if (!str || str === '∞' || str === 'نامحدود' || str === 'نامشخص') return 0;
  const match = str.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/);
  if (!match) return 0;
  const num = parseFloat(match[1]);
  const unit = match[2];
  const multipliers = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
  return Math.floor(num * (multipliers[unit] || 1));
}

module.exports = { parseSubscription, parseMultipleSubscriptions, formatBytes };
