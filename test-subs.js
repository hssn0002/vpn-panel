const https = require('https');
const http = require('http');

const urls = [
  'https://hssn004.up.railway.app/sub/uh0x539eyx06ef9k',
  'https://abrout.com/sub/e2CrusZGtAVZLf4W0-YMWmnIfp6cYE0o_DViQlhDMgI',
  'http://188.121.104.23/sub/ta2q46gjo7ww9oz9',
  'https://ps1.kroute.ir/sub/djMsMTk0NjIsMTc4MjY0NTczNAabae2655f2',
  'https://ds1.kroute.ir/sub/c2hhbXNiYXZhZmFfMDEsMTc4MjA2NTU4OQ_v2BC6SXtR',
  'https://x4g-production-a4e0.up.railway.app/sub-group/_mqfO2_3DonybEagvEx6-Q'
];

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  if (bytes > 1e15) return '∞';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function parseHeader(header) {
  if (!header) return null;
  const result = { upload: 0, download: 0, total: 0, expire: 0 };
  const pairs = header.split(';').map(p => p.trim());
  for (const pair of pairs) {
    const [key, val] = pair.split('=').map(s => s.trim());
    const num = parseInt(val);
    if (isNaN(num)) continue;
    if (key === 'upload') result.upload = num;
    else if (key === 'download') result.download = num;
    else if (key === 'total') result.total = num;
    else if (key === 'expire') result.expire = num;
  }
  return result;
}

async function fetchSub(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https://') ? https : http;
    const req = client.get(url, { timeout: 15000, headers: { 'User-Agent': 'v2rayN/6.23' } }, (res) => {
      const headers = { ...res.headers };
      let data = '';
      res.on('data', chunk => { data += chunk.toString(); });
      res.on('end', () => {
        // Try to decode body
        let decoded = '';
        let configCount = 0;
        try {
          decoded = Buffer.from(data.trim(), 'base64').toString('utf-8');
          configCount = decoded.split('\n').filter(l => l.trim()).length;
        } catch (e) {}

        const info = parseHeader(headers['subscription-userinfo'] || '');
        resolve({
          url: url,
          status: res.statusCode,
          contentType: headers['content-type'] || '',
          subUserInfo: headers['subscription-userinfo'] || '(none)',
          parsed: info,
          configCount,
          bodyPreview: decoded.substring(0, 120),
          error: null
        });
      });
    });

    req.on('error', (err) => {
      resolve({
        url: url,
        status: 0,
        contentType: '',
        subUserInfo: '(none)',
        parsed: null,
        configCount: 0,
        bodyPreview: '',
        error: err.message
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({
        url: url,
        status: 0,
        contentType: '',
        subUserInfo: '(none)',
        parsed: null,
        configCount: 0,
        bodyPreview: '',
        error: 'Timeout'
      });
    });
  });
}

(async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     SUBSCRIPTION LINK ANALYSIS                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const shortUrl = url.replace(/^https?:\/\//, '').substring(0, 45);
    process.stdout.write(`[${i+1}/6] Testing: ${shortUrl}... `);
    
    const result = await fetchSub(url);
    results.push(result);
    
    if (result.error) {
      console.log(`❌ ${result.error}`);
    } else {
      console.log(`✅ HTTP ${result.status}`);
    }
  }

  console.log('\n═══ DETAILED RESULTS ═══\n');

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`┌─ #${i+1} ─────────────────────────────────────────────`);
    console.log(`│ URL: ${r.url}`);
    
    if (r.error) {
      console.log(`│ ❌ ERROR: ${r.error}`);
      console.log(`└──────────────────────────────────────────────────\n`);
      continue;
    }

    console.log(`│ Status: ${r.status} | Content-Type: ${r.contentType}`);
    console.log(`│ subscription-userinfo: ${r.subUserInfo}`);

    if (r.parsed) {
      const used = r.parsed.upload + r.parsed.download;
      const remaining = Math.max(0, r.parsed.total - used);
      const now = Math.floor(Date.now() / 1000);
      const remainDays = r.parsed.expire > 0 ? Math.max(0, Math.ceil((r.parsed.expire - now) / 86400)) : 'نامحدود';

      console.log(`│`);
      console.log(`│ 📊 PARSED DATA:`);
      console.log(`│   Upload:    ${formatBytes(r.parsed.upload)}`);
      console.log(`│   Download:  ${formatBytes(r.parsed.download)}`);
      console.log(`│   Used:      ${formatBytes(used)}`);
      console.log(`│   Total:     ${r.parsed.total === 0 ? '∞ (نامحدود)' : formatBytes(r.parsed.total)}`);
      console.log(`│   Remaining: ${r.parsed.total === 0 ? '∞ (نامحدود)' : formatBytes(remaining)}`);
      console.log(`│   Expire:    ${r.parsed.expire === 0 ? '∞ (نامحدود)' : new Date(r.parsed.expire * 1000).toLocaleString('fa-IR')}`);
      console.log(`│   Days left: ${remainDays} روز`);
    } else {
      console.log(`│ ⚠️  No subscription-userinfo header`);
    }

    console.log(`│ Configs: ${r.configCount}`);
    if (r.bodyPreview) {
      console.log(`│ Preview: ${r.bodyPreview.substring(0, 100)}...`);
    }
    console.log(`└──────────────────────────────────────────────────\n`);
  }

  // Summary
  console.log('═══ SUMMARY ═══');
  const ok = results.filter(r => !r.error);
  const withHeader = results.filter(r => r.parsed);
  const unlimited = results.filter(r => r.parsed && r.parsed.total === 0);
  console.log(`✅ Reachable:   ${ok.length}/${results.length}`);
  console.log(`📊 Has header:  ${withHeader.length}/${results.length}`);
  console.log(`∞  Unlimited:   ${unlimited.length}/${results.length}`);
})();
