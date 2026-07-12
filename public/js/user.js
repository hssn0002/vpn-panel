let userData = null, token = '', ws = null;
const pathParts = location.pathname.split('/');
const username = pathParts[pathParts.length - 1];

async function init() {
  if (!username) return showErr('آدرس نامعتبر');
  try {
    const res = await fetch('/api/user-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username }) });
    if (!res.ok) return showErr('کاربر یافت نشد');
    const data = await res.json();
    token = data.token; userData = data.user;
    localStorage.setItem('token_' + username, token);
    render();
    connectWS();
    loadMessages();
    loadConfigCount();
    setInterval(refresh, 30000);
  } catch { showErr('خطا در ارتباط'); }
}

function showErr(m) { document.getElementById('loadingScreen').innerHTML = `<p class="text-center text-red">❌ ${m}</p>`; }

function render() {
  document.getElementById('loadingScreen').style.display = 'none';
  document.getElementById('userPanel').style.display = 'block';
  document.getElementById('userWelcome').textContent = `👋 ${userData.username} عزیز، خوش آمدید`;
  updateInfo();
}

function updateInfo() {
  const vol = userData.remaining_volume || '0';
  const days = userData.remaining_days || 0;
  const ve = document.getElementById('remainingVolume'), de = document.getElementById('remainingDays');
  ve.textContent = vol; de.textContent = days + ' روز';
  document.getElementById('totalVolume').textContent = userData.total_volume || '--';
  const vc = (vol === 'نامحدود' || vol === '∞') ? 'success' : (parseFloat(vol) <= 0 ? 'danger' : 'success');
  const dc = days <= 0 ? 'danger' : (days <= 3 ? 'warning' : 'success');
  ve.className = 'value ' + vc; de.className = 'value ' + dc;
}

async function loadConfigCount() {
  try {
    const res = await fetch('/api/me/config-count', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      const d = await res.json();
      document.getElementById('configCount').textContent = d.count + ' عدد';
    }
  } catch {}
}

async function copySubLink() {
  try { await navigator.clipboard.writeText(location.href); document.getElementById('copySubBtn').textContent = '✅ کپی شد!';
    setTimeout(() => document.getElementById('copySubBtn').textContent = '🔗 کپی لینک اشتراک', 2000); }
  catch { alert(location.href); }
}
document.getElementById('copySubBtn').parentElement.onclick = copySubLink;

// ═══ Chat ═══
function toggleChat() {
  document.getElementById('chatContainer').classList.toggle('open');
  if (document.getElementById('chatContainer').classList.contains('open')) scrollChat();
}

function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}&type=user`);
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'chat' && msg.senderType === 'admin') { appendMsg(msg); document.getElementById('chatContainer').classList.add('open'); }
    if (msg.type === 'message_deleted') { removeMsgElement(msg.messageId); }
    if (msg.type === 'message_edited') { updateMsgElement(msg.messageId, msg.text); }
  };
  ws.onclose = () => setTimeout(connectWS, 3000);
}

async function loadMessages() {
  try {
    const res = await fetch('/api/me/messages', { headers: { 'Authorization': `Bearer ${token}` } });
    const msgs = await res.json();
    document.getElementById('userChatMessages').innerHTML = msgs.map(renderMsg).join('');
    scrollChat();
  } catch {}
}

function renderMsg(m) {
  const cls = m.sender_type === 'user' ? 'msg-user' : 'msg-admin';
  let content = '';
  if (m.image) content += `<img src="${m.image}" class="msg-image" onclick="window.open('${m.image}')" />`;
  if (m.message) content += esc(m.message).replace(/\n/g, '<br>');
  let copyBtn = '';
  if (m.sender_type === 'admin' && m.message) {
    copyBtn = `<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg('${esc(m.message.replace(/'/g,"\\'"))}')">📋 کپی</button>`;
  }
  return `<div class="msg-bubble ${cls}" id="msg-${m.id}">${content}${copyBtn}<div class="msg-time">${m.created_at || ''}</div></div>`;
}

function appendMsg(msg) {
  const c = document.getElementById('userChatMessages');
  const div = document.createElement('div');
  div.id = 'msg-' + msg.id;
  div.className = 'msg-bubble ' + (msg.senderType === 'user' ? 'msg-user' : 'msg-admin');
  let content = '';
  if (msg.image) content += `<img src="${msg.image}" class="msg-image" onclick="window.open('${msg.image}')" />`;
  if (msg.message) content += esc(msg.message).replace(/\n/g, '<br>');
  let copyBtn = '';
  if (msg.senderType === 'admin' && msg.message) {
    copyBtn = `<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg('${esc(msg.message.replace(/'/g,"\\'"))}')">📋 کپی</button>`;
  }
  div.innerHTML = content + copyBtn + `<div class="msg-time">${msg.time || ''}</div>`;
  c.appendChild(div); scrollChat();
}

function removeMsgElement(id) {
  const el = document.getElementById('msg-' + id);
  if (el) el.remove();
}

function updateMsgElement(id, text) {
  const el = document.getElementById('msg-' + id);
  if (el) {
    const bubble = el.querySelector('.msg-bubble') || el;
    const parts = el.innerHTML.split('<div class="msg-time">');
    let copyBtn = '';
    if (el.classList.contains('msg-admin') && text) {
      copyBtn = `<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg('${esc(text.replace(/'/g,"\\'"))}')">📋 کپی</button>`;
    }
    el.innerHTML = esc(text).replace(/\n/g, '<br>') + copyBtn + (parts[1] ? '<div class="msg-time">' + parts[1] : '');
  }
}

async function copyMsg(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
}

async function sendMsg() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return; input.value = '';
  
  const c = document.getElementById('userChatMessages');
  const div = document.createElement('div');
  div.className = 'msg-bubble msg-user';
  div.innerHTML = esc(text).replace(/\n/g, '<br>') + '<div class="msg-time">همین الان</div>';
  c.appendChild(div); scrollChat();

  // Only use WS — no REST fallback (fixes double-send)
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'chat', userId: userData.id, text }));
  } else {
    // Fallback to REST only if WS not connected
    try { await fetch(`/api/messages/${userData.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ message: text }) }); } catch {}
  }
}

async function sendImage() {
  const file = document.getElementById('imgInput').files[0];
  if (!file) return;
  const fd = new FormData(); fd.append('image', file);
  try {
    const res = await fetch('/api/upload-image', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: fd });
    const data = await res.json();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'chat', userId: userData.id, image: data.url }));
    } else {
      await fetch(`/api/messages/${userData.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ image: data.url }) });
    }
    const c = document.getElementById('userChatMessages');
    const div = document.createElement('div');
    div.className = 'msg-bubble msg-user';
    div.innerHTML = `<img src="${data.url}" class="msg-image" /><div class="msg-time">همین الان</div>`;
    c.appendChild(div); scrollChat();
  } catch {}
  document.getElementById('imgInput').value = '';
}

function scrollChat() {
  const c = document.getElementById('userChatMessages');
  if (c) c.scrollTop = c.scrollHeight;
}

async function refresh() {
  try {
    const res = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) { userData = await res.json(); updateInfo(); }
  } catch {}
  try {
    const res = await fetch('/api/me/unread', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      const d = await res.json();
      const b = document.getElementById('chatBadge');
      if (d.count > 0) { b.style.display = 'inline-block'; b.textContent = d.count; }
      else b.style.display = 'none';
    }
  } catch {}
}

function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
init();
