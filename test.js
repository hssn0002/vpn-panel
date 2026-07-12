const http = require('http');

function req(method, path, data, token) {
  return new Promise((resolve, reject) => {
    const body = data ? JSON.stringify(data) : '';
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(d); } catch(e) { parsed = { raw: d }; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    r.on('error', e => reject(e));
    r.write(body);
    r.end();
  });
}

(async () => {
  let errors = [];

  // Test 1: Login
  console.log('═══ 1. Login with correct password ═══');
  const login = await req('POST', '/api/login', { password: '427726' });
  console.log('  Status:', login.status);
  console.log('  Has token:', !!login.data.token);
  if (!login.data.token) errors.push('Login failed');

  const token = login.data.token;

  // Test 2: Login with wrong password
  console.log('\n═══ 2. Login with wrong password ═══');
  const badLogin = await req('POST', '/api/login', { password: 'wrong' });
  console.log('  Status:', badLogin.status, '| Error:', badLogin.data.error);
  if (badLogin.status !== 401) errors.push('Wrong password should return 401');

  // Test 3: Create user - no sub links
  console.log('\n═══ 3. Create user (no sub links) ═══');
  const create1 = await req('POST', '/api/users', {
    username: 'newuser1',
    contact_type: 'telegram',
    contact_id: '@test1',
    subscription_links: [],
    unlimited_volume: false,
    manual_days: 30,
    vless_links: []
  }, token);
  console.log('  Status:', create1.status, '| Result:', JSON.stringify(create1.data));
  if (create1.status !== 200) errors.push('Create user 1 failed: ' + create1.data.error);

  // Test 4: Create user with sub links
  console.log('\n═══ 4. Create user (with sub links) ═══');
  const create2 = await req('POST', '/api/users', {
    username: 'newuser2',
    contact_type: 'bale',
    contact_id: '@test2',
    subscription_links: ['https://sub.example.com/test1', 'https://sub2.example.com/test2'],
    unlimited_volume: false,
    manual_days: 30,
    vless_links: []
  }, token);
  console.log('  Status:', create2.status, '| Result:', JSON.stringify(create2.data));
  if (create2.status !== 200) errors.push('Create user 2 failed: ' + create2.data.error);

  // Test 5: Create duplicate user
  console.log('\n═══ 5. Create duplicate user ═══');
  const dup = await req('POST', '/api/users', {
    username: 'newuser1',
    contact_type: 'telegram',
    contact_id: '@dup',
    subscription_links: [],
    unlimited_volume: false,
    manual_days: 30,
    vless_links: []
  }, token);
  console.log('  Status:', dup.status, '| Error:', dup.data.error);
  if (dup.status !== 400) errors.push('Duplicate should return 400');

  // Test 6: Create user with unlimited volume
  console.log('\n═══ 6. Create user (unlimited volume) ═══');
  const create3 = await req('POST', '/api/users', {
    username: 'newuser3',
    contact_type: 'telegram',
    contact_id: '@test3',
    subscription_links: [],
    unlimited_volume: true,
    manual_days: 60,
    vless_links: ['vless://test@1.2.3.4:443?security=tls#Test']
  }, token);
  console.log('  Status:', create3.status, '| Result:', JSON.stringify(create3.data));
  if (create3.status !== 200) errors.push('Create user 3 failed: ' + create3.data.error);

  // Test 7: Create user without auth
  console.log('\n═══ 7. Create user (no auth) ═══');
  const noAuth = await req('POST', '/api/users', { username: 'hack', subscription_links: [] });
  console.log('  Status:', noAuth.status, '| Error:', noAuth.data.error);
  if (noAuth.status !== 401) errors.push('No auth should return 401');

  // Test 8: Create user with empty username
  console.log('\n═══ 8. Create user (empty username) ═══');
  const empty = await req('POST', '/api/users', {
    username: '',
    subscription_links: []
  }, token);
  console.log('  Status:', empty.status, '| Error:', empty.data.error);
  if (empty.status !== 400) errors.push('Empty username should return 400');

  // Test 9: Get users list
  console.log('\n═══ 9. Get users list ═══');
  const users = await req('GET', '/api/users', null, token);
  console.log('  Status:', users.status, '| Count:', Array.isArray(users.data) ? users.data.length : 'ERROR');
  
  // Test 10: Try without token at all
  console.log('\n═══ 10. Create user (invalid token) ═══');
  const badToken = await req('POST', '/api/users', { username: 'bad', subscription_links: [] }, 'fake-token-123');
  console.log('  Status:', badToken.status, '| Error:', badToken.data.error);
  if (badToken.status !== 401) errors.push('Bad token should return 401');

  // Summary
  console.log('\n═══════════════════════════════');
  if (errors.length === 0) {
    console.log('✅ ALL 10 TESTS PASSED');
  } else {
    console.log('❌ ERRORS FOUND:');
    errors.forEach(e => console.log('  -', e));
  }
  process.exit(errors.length);
})();
