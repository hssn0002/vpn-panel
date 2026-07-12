// ── User Panel JS ──
let userData = null;
let token = '';
let ws = null;
let allConfigs = '';

// Parse URL to get username
const pathParts = window.location.pathname.split('/');
const username = pathParts[pathParts.length - 1];

async function init() {
  if (!username) {
    showError('آدرس نامعتبر است');
    return;
  }

  try {
    const res = await fetch('/api/user-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });

    if (!res.ok) {
      showError('کاربر یافت نشد');
      return;
    }

    const data = await res.json();
    token = data.token;
    userData = data.user;
    localStorage.setItem('token_' + username, token);

    renderUserPanel();
    connectWS();
    loadConfigs();
    loadMessages();
    checkUnread();

    // Refresh every 30 seconds
    setInterval(refreshUserData, 30000);
  } catch (e) {
    showError('خطا در ارتباط با سرور');
  }
}

function showError(msg) {
  document.getElementById('loadingScreen').innerHTML = `<p class="text-center text-red">❌ ${msg}</p>`;
}

function renderUserPanel() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('userPanel').style.display = 'block';
  document.getElementById('userWelcome').textContent = `👋 ${userData.username} عزیز، خوش آمدید`;

  updateUsageInfo();

  // Support links
  if (userData.contact_id) {
    const supportCard = document.getElementById('supportCard');
    supportCard.style.display = 'block';
    const linksDiv = document.getElementById('supportLinks');
    const type = userData.contact_type;

    if (type === 'telegram') {
      const tid = userData.contact_id.replace('@', '');
      linksDiv.innerHTML = `<a href="https://t.me/${tid}" target="_blank" class="btn btn-outline">📱 تلگرام</a>`;
    } else if (type === 'bale') {
      linksDiv.innerHTML = `<a href="https://ble.ir/${userData.contact_id.replace('@','')}" target="_blank" class="btn btn-outline">💬 بله</a>`;
    }
  }

  // Auto-open chat if admin has unread messages
  checkUnread();
}

function updateUsageInfo() {
  if (!userData) return;

  const vol = userData.remaining_volume || '0';
  const days = userData.remaining_days || 0;

  const volEl = document.getElementById('remainingVolume');
  const dayEl = document.getElementById('remainingDays');
  const totalVol = document.getElementById('totalVolume');
  const configCount = document.getElementById('configCount');

  volEl.textContent = vol;
  dayEl.textContent = days + ' روز';
  totalVol.textContent = userData.total_volume || '--';

  // Color coding
  if (vol === 'نامحدود' || vol === '∞') {
    volEl.className = 'value success';
  } else if (parseFloat(vol) <= 0) {
    volEl.className = 'value danger';
  } else {
    volEl.className = 'value success';
  }

  if (days <= 0) {
    dayEl.className = 'value danger';
  } else if (days <= 3) {
    dayEl.className = 'value warning';
  } else {
    dayEl.className = 'value success';
  }
}

async function loadConfigs() {
  if (!userData) return;

  const configList = document.getElementById('configList');
  const vlessLinks = userData.vless_links || [];

  if (userData.unlimited_volume) {
    // Manual VLESS mode
    if (vlessLinks.length > 0) {
      allConfigs = vlessLinks.join('\n');
      configList.textContent = allConfigs;
      document.getElementById('configCount').textContent = vlessLinks.length + ' عدد';
    } else {
      configList.textContent = 'کانفیگی تعریف نشده';
      document.getElementById('copyAllBtn').style.display = 'none';
    }
    return;
  }

  // Subscription mode - fetch and decode configs
  const subLinks = userData.subscription_links || [];
  if (subLinks.length === 0) {
    configList.textContent = 'کانفیگی تعریف نشده';
    document.getElementById('copyAllBtn').style.display = 'none';
    return;
  }

  configList.innerHTML = '<div class="spinner"></div> در حال دریافت کانفیگ‌ها...';

  try {
    const allConfigsArr = [];
    for (const link of subLinks) {
      try {
        const res = await fetch(link, { headers: { 'User-Agent': 'v2rayN/6.23' } });
        const text = await res.text();
        const decoded = atob(text);
        const lines = decoded.split('\n').filter(l => l.trim());
        allConfigsArr.push(...lines);
      } catch (e) {
        // Skip failed subs
      }
    }

    if (allConfigsArr.length > 0) {
      allConfigs = allConfigsArr.join('\n');
      configList.textContent = allConfigs;
      document.getElementById('configCount').textContent = allConfigsArr.length + ' عدد';
    } else {
      configList.textContent = 'خطا در دریافت کانفیگ‌ها';
    }
  } catch (e) {
    configList.textContent = 'خطا در دریافت کانفیگ‌ها';
  }
}

async function copyAllConfigs() {
  if (!allConfigs) return;
  try {
    await navigator.clipboard.writeText(allConfigs);
    const btn = document.getElementById('copyAllBtn');
    btn.innerHTML = '<span>✅ کپی شد!</span>';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<span>📋 کپی همه کانفیگ‌ها</span>';
      btn.classList.remove('copied');
    }, 2000);
  } catch (e) {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = allConfigs;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('کانفیگ‌ها کپی شدند');
  }
}

async function copySubLink() {
  const pageUrl = window.location.href;
  try {
    await navigator.clipboard.writeText(pageUrl);
    alert('✅ لینک صفحه کپی شد');
  } catch (e) {
    alert(pageUrl);
  }
}

// ── Chat ──
function toggleChat() {
  const container = document.getElementById('chatContainer');
  container.classList.toggle('open');
  if (container.classList.contains('open')) {
    document.getElementById('userChatInput').focus();
    scrollChatToBottom();
  }
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?token=${token}&type=user`);

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'chat' && msg.senderType === 'admin') {
      appendChatMessage(msg);
      // Auto-open chat
      document.getElementById('chatContainer').classList.add('open');
    }
    if (msg.type === 'unread_count') {
      updateChatBadge(msg.count);
    }
  };

  ws.onclose = () => setTimeout(connectWS, 3000);
}

async function loadMessages() {
  try {
    const res = await fetch('/api/me/messages', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const messages = await res.json();

    const container = document.getElementById('userChatMessages');
    container.innerHTML = messages.map(m => renderChatMessage(m)).join('');
    scrollChatToBottom();
  } catch (e) {}
}

function renderChatMessage(m) {
  const bubbleClass = m.sender_type === 'user' ? 'msg-user' : 'msg-admin';
  let content = '';
  if (m.image) {
    content += `<img src="${m.image}" class="msg-image" onclick="window.open('${m.image}')" />`;
  }
  if (m.message) {
    content += escapeHtml(m.message).replace(/\n/g, '<br>');
  }
  return `
    <div class="msg-bubble ${bubbleClass}">
      ${content}
      <div class="msg-time">${m.created_at || ''}</div>
    </div>
  `;
}

function appendChatMessage(msg) {
  const container = document.getElementById('userChatMessages');
  const div = document.createElement('div');
  div.className = 'msg-bubble msg-admin';
  let content = '';
  if (msg.image) content += `<img src="${msg.image}" class="msg-image" />`;
  if (msg.message) content += escapeHtml(msg.message).replace(/\n/g, '<br>');
  div.innerHTML = content + `<div class="msg-time">${msg.time || ''}</div>`;
  container.appendChild(div);
  scrollChatToBottom();
}

async function sendUserChat() {
  const input = document.getElementById('userChatInput');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';

  // Add to UI
  const container = document.getElementById('userChatMessages');
  const div = document.createElement('div');
  div.className = 'msg-bubble msg-user';
  div.innerHTML = escapeHtml(text).replace(/\n/g, '<br>') + '<div class="msg-time">همین الان</div>';
  container.appendChild(div);
  scrollChatToBottom();

  // Send via WS
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'chat',
      userId: userData.id,
      text: text
    }));
  }

  // Also via REST
  try {
    await fetch(`/api/users/${userData.id}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ message: text })
    });
  } catch (e) {}

  // Show waiting message on first message
  if (container.querySelectorAll('.msg-user').length === 1) {
    setTimeout(() => {
      const waitMsg = document.createElement('div');
      waitMsg.className = 'msg-bubble msg-admin';
      waitMsg.innerHTML = 'لطفا چند لحظه منتظر باشید، همکاران ما به زودی پاسخ می‌دهند 🙏<div class="msg-time">همین الان</div>';
      container.appendChild(waitMsg);
      scrollChatToBottom();
    }, 1500);
  }
}

async function sendUserImage() {
  const fileInput = document.getElementById('userImageInput');
  const file = fileInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'chat',
        userId: userData.id,
        image: data.url
      }));
    }

    // Show in UI
    const container = document.getElementById('userChatMessages');
    const div = document.createElement('div');
    div.className = 'msg-bubble msg-user';
    div.innerHTML = `<img src="${data.url}" class="msg-image" /><div class="msg-time">همین الان</div>`;
    container.appendChild(div);
    scrollChatToBottom();
  } catch (e) {}

  fileInput.value = '';
}

function scrollChatToBottom() {
  const container = document.getElementById('userChatMessages');
  if (container) container.scrollTop = container.scrollHeight;
}

async function checkUnread() {
  try {
    const res = await fetch('/api/me/unread', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    updateChatBadge(data.count);
  } catch (e) {}
}

function updateChatBadge(count) {
  const badge = document.getElementById('chatNotifBadge');
  if (count > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = count;
  } else {
    badge.style.display = 'none';
  }
}

async function refreshUserData() {
  try {
    const res = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      userData = await res.json();
      updateUsageInfo();
    }
  } catch (e) {}
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Start
init();
