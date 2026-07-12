// ── Admin Panel JS ──
const API = {
  token: '',
  sortBy: 'remaining_days',
  sortDir: 'ASC',
  currentPage: 'users',
  contactType: 'telegram',
  editingUserId: null,
  selectedUsers: new Set(),
  chatUserId: null,
  chatUsername: '',
  ws: null
};

// ── Auth ──
async function login() {
  const pass = document.getElementById('loginPassword').value;
  if (!pass) return;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });

    if (!res.ok) {
      document.getElementById('loginError').style.display = 'block';
      document.getElementById('loginError').textContent = 'رمز عبور اشتباه است';
      return;
    }

    const data = await res.json();
    API.token = data.token;
    localStorage.setItem('admin_token', data.token);
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainPanel').style.display = 'flex';
    initPanel();
  } catch (e) {
    document.getElementById('loginError').style.display = 'block';
    document.getElementById('loginError').textContent = 'خطا در ارتباط';
  }
}

// Auto-login
window.addEventListener('DOMContentLoaded', () => {
  const savedToken = localStorage.getItem('admin_token');
  if (savedToken) {
    API.token = savedToken;
    fetch('/api/check-auth', { headers: { 'Authorization': `Bearer ${API.token}` } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => {
        if (data.valid) {
          document.getElementById('loginScreen').style.display = 'none';
          document.getElementById('mainPanel').style.display = 'flex';
          initPanel();
        }
      })
      .catch(() => localStorage.removeItem('admin_token'));
  }

  document.getElementById('loginPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login();
  });
});

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${API.token}`
  };
}

// ── Panel Init ──
function initPanel() {
  connectAdminWS();
  loadUsers();
  loadSettings();
  refreshChatBadge();
  setInterval(refreshChatBadge, 15000);
  setInterval(() => { if (API.currentPage === 'users') loadUsers(true); }, 30000);
}

function connectAdminWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  API.ws = new WebSocket(`${proto}//${location.host}/ws?token=${API.token}&type=admin`);

  API.ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'refresh') {
      if (API.currentPage === 'users') loadUsers(true);
    }
    if (msg.type === 'sub_error') {
      if (API.currentPage === 'users') loadUsers(true);
    }
    if (msg.type === 'admin_chat') {
      refreshChatBadge();
      // If chat modal is open for this user, append message
      if (API.chatUserId === msg.userId && document.getElementById('chatModal').style.display !== 'none') {
        appendChatMessage('modal', msg);
      }
      if (API.currentPage === 'chatroom') loadChatRoom();
    }
  };

  API.ws.onclose = () => {
    setTimeout(connectAdminWS, 3000);
  };
}

// ── Navigation ──
function switchPage(page, el) {
  API.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.admin-sidebar nav a').forEach(a => a.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.style.display = 'block';
  if (el) el.classList.add('active');

  if (page === 'users') loadUsers();
  if (page === 'chatroom') loadChatRoom();
  if (page === 'backup') loadBackups();
  if (page === 'telegram') loadTelegramSettings();
  if (page === 'settings') loadSettingsPage();
  if (page === 'adduser' && !API.editingUserId) resetAddUserForm();
}

// ── Users ──
async function loadUsers(silent = false) {
  if (!silent) {
    document.getElementById('usersTableBody').innerHTML = '<tr><td colspan="7" class="text-center"><div class="spinner"></div></td></tr>';
  }

  try {
    const res = await fetch(`/api/users?sort=${API.sortBy}&dir=${API.sortDir}`, { headers: authHeaders() });
    const users = await res.json();
    renderUsers(users);
  } catch (e) {
    document.getElementById('usersTableBody').innerHTML = '<tr><td colspan="7" class="text-center text-red">خطا در بارگذاری</td></tr>';
  }
}

function renderUsers(users) {
  const tbody = document.getElementById('usersTableBody');
  const empty = document.getElementById('usersEmpty');

  if (!users || users.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  tbody.innerHTML = users.map(u => {
    const volClass = u.remaining_volume === 'نامحدود' ? 'success' : 
      (parseFloat(u.remaining_volume) <= 0 ? 'danger' : '');
    const dayClass = u.remaining_days <= 0 ? 'danger' : (u.remaining_days <= 3 ? 'warning' : 'success');
    const errorRow = u.sub_error ? 'error-row' : '';
    const errorBadge = u.sub_error ? '<span class="badge badge-danger blink">⚠ خطا</span>' : 
      (u.remaining_days > 0 ? '<span class="badge badge-success">فعال</span>' : '<span class="badge badge-danger">منقضی</span>');

    return `
      <tr class="${errorRow}" onclick="openUserDetail(${u.id})" style="cursor:pointer;">
        <td onclick="event.stopPropagation();">
          <input type="checkbox" onchange="toggleUserSelect(${u.id}, this)" />
        </td>
        <td><strong>${escapeHtml(u.username)}</strong></td>
        <td class="text-${dayClass}">${u.remaining_days} روز</td>
        <td class="text-${volClass}">${u.remaining_volume || '0'}</td>
        <td>${u.contact_id || '-'}</td>
        <td>${errorBadge}</td>
        <td onclick="event.stopPropagation();">
          <div class="btn-group">
            <button class="btn btn-outline btn-sm" onclick="openUserDetail(${u.id})">✏️</button>
            <button class="btn btn-outline btn-sm" onclick="refreshSub(${u.id})">🔄</button>
            <button class="btn btn-outline btn-sm" onclick="openChatWithUser(${u.id},'${escapeHtml(u.username)}')">💬</button>
            <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleSelectAll() {
  const checkAll = document.getElementById('selectAll');
  const checkboxes = document.querySelectorAll('#usersTableBody input[type="checkbox"]');
  API.selectedUsers.clear();
  checkboxes.forEach(cb => {
    cb.checked = checkAll.checked;
    // We need to get user ID from onclick attribute
    const onclick = cb.getAttribute('onchange') || '';
    const match = onclick.match(/toggleUserSelect\((\d+)/);
    if (match && checkAll.checked) API.selectedUsers.add(parseInt(match[1]));
  });
  updateBulkDeleteBtn();
}

function toggleUserSelect(id, cb) {
  if (cb.checked) API.selectedUsers.add(id);
  else API.selectedUsers.delete(id);
  updateBulkDeleteBtn();
}

function updateBulkDeleteBtn() {
  const btn = document.getElementById('bulkDeleteBtn');
  btn.style.display = API.selectedUsers.size > 0 ? '' : 'none';
  btn.textContent = `🗑️ حذف (${API.selectedUsers.size})`;
}

async function bulkDelete() {
  if (API.selectedUsers.size === 0) return;
  if (!confirm(`آیا از حذف ${API.selectedUsers.size} کاربر اطمینان دارید؟`)) return;

  try {
    await fetch('/api/users/bulk-delete', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ ids: Array.from(API.selectedUsers) })
    });
    API.selectedUsers.clear();
    updateBulkDeleteBtn();
    loadUsers();
  } catch (e) { alert('خطا در حذف'); }
}

function sortUsers(field) {
  if (API.sortBy === field) {
    API.sortDir = API.sortDir === 'ASC' ? 'DESC' : 'ASC';
  } else {
    API.sortBy = field;
    API.sortDir = 'ASC';
  }
  loadUsers();
}

async function refreshSub(id) {
  try {
    await fetch(`/api/users/${id}/refresh`, { method: 'POST', headers: authHeaders() });
    loadUsers(true);
  } catch (e) {}
}

async function refreshAllSubs() {
  try {
    await fetch('/api/users/refresh-all', { method: 'POST', headers: authHeaders() });
    loadUsers(true);
  } catch (e) {}
}

async function deleteUser(id) {
  if (!confirm('آیا از حذف این کاربر اطمینان دارید؟')) return;
  try {
    await fetch(`/api/users/${id}`, { method: 'DELETE', headers: authHeaders() });
    loadUsers();
  } catch (e) { alert('خطا در حذف'); }
}

// ── User Detail Modal ──
async function openUserDetail(id) {
  API.editingUserId = id;
  try {
    const res = await fetch(`/api/users/${id}`, { headers: authHeaders() });
    const user = await res.json();
    renderUserModal(user);
    document.getElementById('userModal').style.display = 'flex';
  } catch (e) {}
}

function renderUserModal(user) {
  document.getElementById('modalTitle').textContent = `✏️ ${user.username}`;
  const links = (user.subscription_links || []).join('\n');
  const vlessLinks = (user.vless_links || []).join('\n');

  document.getElementById('modalContent').innerHTML = `
    <div class="form-group">
      <label>نام کاربری</label>
      <input type="text" id="modalUsername" class="form-control" value="${escapeHtml(user.username)}" />
    </div>
    <div class="form-group">
      <label>نوع ارتباط</label>
      <select id="modalContactType" class="form-control">
        <option value="telegram" ${user.contact_type === 'telegram' ? 'selected' : ''}>تلگرام</option>
        <option value="bale" ${user.contact_type === 'bale' ? 'selected' : ''}>بله</option>
      </select>
    </div>
    <div class="form-group">
      <label>شناسه</label>
      <input type="text" id="modalContactId" class="form-control" value="${escapeHtml(user.contact_id || '')}" />
    </div>
    <div class="form-group">
      <label class="toggle-wrap">
        <span>حجم نامحدود</span>
        <label class="toggle">
          <input type="checkbox" id="modalUnlimited" ${user.unlimited_volume ? 'checked' : ''} onchange="toggleModalUnlimited()" />
          <span class="slider"></span>
        </label>
      </label>
    </div>
    <div id="modalSubSection" style="display:${user.unlimited_volume ? 'none' : 'block'};">
      <div class="form-group">
        <label>لینک‌های ساب</label>
        <textarea id="modalSubLinks" class="form-control" rows="3">${escapeHtml(links)}</textarea>
      </div>
    </div>
    <div id="modalManualSection" style="display:${user.unlimited_volume ? 'block' : 'none'};">
      <div class="form-group">
        <label>تعداد روز</label>
        <input type="number" id="modalManualDays" class="form-control" value="${user.manual_days || 30}" />
      </div>
      <div class="form-group">
        <label>لینک‌های VLESS</label>
        <textarea id="modalVlessLinks" class="form-control" rows="3">${escapeHtml(vlessLinks)}</textarea>
      </div>
    </div>
    <div class="info-grid mt-2" style="background:var(--bg);padding:12px;border-radius:8px;">
      <div class="info-item">
        <div class="label">مانده حجم</div>
        <div class="value">${user.remaining_volume || '0'}</div>
      </div>
      <div class="info-item">
        <div class="label">مانده زمان</div>
        <div class="value">${user.remaining_days || 0} روز</div>
      </div>
    </div>
    <div class="mt-2">
      <span class="url-display" style="font-size:0.85em;">${location.origin}/u/${user.username}</span>
      <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('${location.origin}/u/${user.username}')">📋 کپی</button>
    </div>
  `;
}

function toggleModalUnlimited() {
  const checked = document.getElementById('modalUnlimited').checked;
  document.getElementById('modalSubSection').style.display = checked ? 'none' : 'block';
  document.getElementById('modalManualSection').style.display = checked ? 'block' : 'none';
}

async function saveUserFromModal() {
  if (!API.editingUserId) return;
  const unlimited = document.getElementById('modalUnlimited').checked;
  const subLinks = unlimited ? [] : 
    document.getElementById('modalSubLinks').value.split('\n').map(s => s.trim()).filter(s => s);
  const vlessLinks = unlimited ?
    document.getElementById('modalVlessLinks').value.split('\n').map(s => s.trim()).filter(s => s) : [];

  const data = {
    username: document.getElementById('modalUsername').value.trim(),
    contact_type: document.getElementById('modalContactType').value,
    contact_id: document.getElementById('modalContactId').value.trim(),
    unlimited_volume: unlimited,
    manual_days: parseInt(document.getElementById('modalManualDays').value) || 30,
    subscription_links: subLinks,
    vless_links: vlessLinks
  };

  try {
    await fetch(`/api/users/${API.editingUserId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(data)
    });
    closeModal();
    loadUsers();
  } catch (e) { alert('خطا در ذخیره'); }
}

function closeModal() {
  document.getElementById('userModal').style.display = 'none';
  API.editingUserId = null;
}

// ── Add User ──
function setContactType(el) {
  API.contactType = el.dataset.contact;
  document.querySelectorAll('#page-adduser [data-contact]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
}

function toggleUnlimited() {
  const checked = document.getElementById('userUnlimited').checked;
  document.getElementById('subLinksSection').style.display = checked ? 'none' : 'block';
  document.getElementById('manualSection').style.display = checked ? 'block' : 'none';
}

function addVlessBox() {
  const container = document.getElementById('userVlessLinks');
  container.value += (container.value ? '\n' : '') + 'vless://';
}

function resetAddUserForm() {
  API.editingUserId = null;
  document.getElementById('addUserTitle').textContent = '➕ افزودن کاربر جدید';
  document.getElementById('editUserId').value = '';
  document.getElementById('userUsername').value = '';
  document.getElementById('userContactId').value = '';
  document.getElementById('userSubLinks').value = '';
  document.getElementById('userVlessLinks').value = '';
  document.getElementById('userManualDays').value = '30';
  document.getElementById('userUnlimited').checked = false;
  toggleUnlimited();
  API.contactType = 'telegram';
  document.querySelectorAll('#page-adduser [data-contact]').forEach(b => {
    b.classList.toggle('active', b.dataset.contact === 'telegram');
  });
}

async function saveUser() {
  const usernameEl = document.getElementById('userUsername');
  if (!usernameEl) return alert('خطا: فرم کاربر یافت نشد. لطفا صفحه را رفرش کنید.');
  
  const username = usernameEl.value.trim();
  if (!username) return alert('نام کاربری الزامی است');

  if (!API.token) return alert('خطا: احراز هویت انجام نشده. لطفا دوباره وارد شوید.');

  const unlimited = document.getElementById('userUnlimited')?.checked || false;
  const subLinks = unlimited ? [] :
    (document.getElementById('userSubLinks')?.value || '').split('\n').map(s => s.trim()).filter(s => s);
  const vlessLinks = unlimited ?
    (document.getElementById('userVlessLinks')?.value || '').split('\n').map(s => s.trim()).filter(s => s) : [];

  const data = {
    username,
    contact_type: API.contactType || 'telegram',
    contact_id: (document.getElementById('userContactId')?.value || '').trim(),
    unlimited_volume: unlimited,
    manual_days: parseInt(document.getElementById('userManualDays')?.value) || 30,
    subscription_links: subLinks,
    vless_links: vlessLinks
  };

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(data)
    });

    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch { err = { error: 'خطای سرور (کد ' + res.status + ')' }; }
      return alert('❌ ' + (err.error || 'خطا در ذخیره'));
    }

    resetAddUserForm();
    switchPage('users');
  } catch (e) {
    console.error('saveUser error:', e);
    alert('❌ خطا در ارتباط با سرور. آیا سرور روشن است؟');
  }
}

function cancelEdit() {
  resetAddUserForm();
  switchPage('users');
}

// ── Chat ──
function openChatWithUser(userId, username) {
  API.chatUserId = userId;
  API.chatUsername = username;
  document.getElementById('chatModalTitle').textContent = `💬 چت با ${username}`;
  document.getElementById('chatModal').style.display = 'flex';
  document.getElementById('chatModalMessages').innerHTML = '';
  loadChatMessages(userId, 'modal');
  markMessagesSeen(userId);
  
  // Notify WS we're viewing
  if (API.ws && API.ws.readyState === WebSocket.OPEN) {
    API.ws.send(JSON.stringify({ type: 'mark_seen', userId }));
  }
}

function closeChatModal() {
  document.getElementById('chatModal').style.display = 'none';
  API.chatUserId = null;
  refreshChatBadge();
}

async function loadChatMessages(userId, target) {
  try {
    const res = await fetch(`/api/users/${userId}/messages?limit=200`, { headers: authHeaders() });
    const messages = await res.json();
    const container = target === 'modal' ? 
      document.getElementById('chatModalMessages') : 
      document.getElementById(`chatMessages_${userId}`);
    if (!container) return;

    container.innerHTML = messages.map(m => renderMessage(m)).join('');
    container.scrollTop = container.scrollHeight;
  } catch (e) {}
}

function renderMessage(m) {
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

function appendChatMessage(target, msg) {
  const container = document.getElementById('chatModalMessages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'msg-bubble ' + (msg.senderType === 'user' ? 'msg-user' : 'msg-admin');
  let content = '';
  if (msg.image) content += `<img src="${msg.image}" class="msg-image" onclick="window.open('${msg.image}')" />`;
  if (msg.message) content += escapeHtml(msg.message).replace(/\n/g, '<br>');
  div.innerHTML = content + `<div class="msg-time">${msg.time || ''}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendChatMessage(target) {
  const input = document.getElementById('chatModalInput');
  const text = input.value.trim();
  if (!text || !API.chatUserId) return;

  input.value = '';

  // Add to UI immediately
  const container = document.getElementById('chatModalMessages');
  const div = document.createElement('div');
  div.className = 'msg-bubble msg-admin';
  div.innerHTML = escapeHtml(text).replace(/\n/g, '<br>') + `<div class="msg-time">همین الان</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  // Send via WebSocket
  if (API.ws && API.ws.readyState === WebSocket.OPEN) {
    API.ws.send(JSON.stringify({
      type: 'chat',
      userId: API.chatUserId,
      text: text
    }));
  }

  // Also send via REST as fallback
  try {
    await fetch(`/api/users/${API.chatUserId}/messages`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: text })
    });
  } catch (e) {}
}

async function sendChatImage(target) {
  const fileInput = document.getElementById('chatModalImageInput');
  const file = fileInput.files[0];
  if (!file || !API.chatUserId) return;

  const formData = new FormData();
  formData.append('image', file);

  try {
    const res = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API.token}` },
      body: formData
    });
    const data = await res.json();

    // Send via WS
    if (API.ws && API.ws.readyState === WebSocket.OPEN) {
      API.ws.send(JSON.stringify({
        type: 'chat',
        userId: API.chatUserId,
        image: data.url
      }));
    }
  } catch (e) {}

  fileInput.value = '';
}

async function markMessagesSeen(userId) {
  try {
    await fetch(`/api/users/${userId}/messages/seen`, {
      method: 'POST',
      headers: authHeaders()
    });
  } catch (e) {}
}

async function refreshChatBadge() {
  try {
    const res = await fetch('/api/unread-messages', { headers: authHeaders() });
    const messages = await res.json();
    const badge = document.getElementById('chatBadge');
    if (messages.length > 0) {
      badge.style.display = 'inline-block';
      badge.textContent = messages.length;
    } else {
      badge.style.display = 'none';
    }
  } catch (e) {}
}

// ── Chat Room ──
async function loadChatRoom() {
  const container = document.getElementById('chatRoomList');
  try {
    const res = await fetch('/api/chat-room', { headers: authHeaders() });
    const chats = await res.json();

    if (!chats || chats.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="icon">💬</div><p>هیچ گفتگویی ثبت نشده</p></div>';
      return;
    }

    container.innerHTML = chats.map(c => `
      <div class="chat-room-item" onclick="openChatWithUser(${c.user_id},'${escapeHtml(c.username)}')">
        <div>
          <strong>👤 ${escapeHtml(c.username)}</strong>
          ${c.unread > 0 ? `<span class="badge badge-danger">${c.unread} پیام جدید</span>` : ''}
          <p style="margin-top:6px;color:var(--text-dim);font-size:0.85em;">${c.last_message ? escapeHtml(c.last_message.substring(0, 80)) + (c.last_message.length > 80 ? '...' : '') : 'بدون پیام'}</p>
        </div>
        <span style="font-size:0.78em;color:var(--text-muted);white-space:nowrap;">${c.last_time || ''}</span>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<p class="text-center text-red">خطا در بارگذاری</p>';
  }
}

// ── Backup ──
async function createBackup() {
  try {
    const res = await fetch('/api/backup/create', { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    alert('بکاپ با موفقیت ایجاد شد');
    loadBackups();
  } catch (e) { alert('خطا در ایجاد بکاپ'); }
}

async function sendBackupTelegram() {
  try {
    const res = await fetch('/api/backup/send-telegram', { method: 'POST', headers: authHeaders() });
    const data = await res.json();
    alert('بکاپ به تلگرام ارسال شد');
  } catch (e) { alert('خطا در ارسال به تلگرام: ' + e.message); }
}

async function restoreBackup() {
  const file = document.getElementById('restoreFile').files[0];
  if (!file) return;
  if (!confirm('آیا از بازیابی بکاپ اطمینان دارید؟ اطلاعات فعلی جایگزین می‌شود.')) return;

  const formData = new FormData();
  formData.append('backup', file);

  try {
    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API.token}` },
      body: formData
    });
    const data = await res.json();
    alert(data.message || 'بکاپ بازیابی شد');
  } catch (e) { alert('خطا در بازیابی'); }
}

async function loadBackups() {
  const container = document.getElementById('backupList');
  try {
    const res = await fetch('/api/backups', { headers: authHeaders() });
    const backups = await res.json();

    if (!backups || backups.length === 0) {
      container.innerHTML = '<p>هیچ بکاپی موجود نیست</p>';
      return;
    }

    container.innerHTML = backups.map(b => `
      <div class="flex justify-between items-center mb-1" style="padding:8px;background:var(--bg);border-radius:6px;">
        <span>📦 ${b.name}</span>
        <span style="color:var(--text2);font-size:0.85em;">${formatSize(b.size)}</span>
        <a href="/api/backups/download/${b.name}" class="btn btn-outline btn-sm" download>📥 دانلود</a>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<p class="text-red">خطا در بارگذاری</p>';
  }
}

// ── Telegram Settings ──
async function loadTelegramSettings() {
  try {
    const res = await fetch('/api/settings', { headers: authHeaders() });
    const settings = await res.json();
    document.getElementById('tgToken').value = settings.telegram_token || '';
    document.getElementById('tgAdminId').value = settings.telegram_admin_id || '';
  } catch (e) {}
}

async function testTelegram() {
  const token = document.getElementById('tgToken').value;
  const adminId = document.getElementById('tgAdminId').value;
  const resultEl = document.getElementById('tgTestResult');

  if (!token || !adminId) {
    resultEl.innerHTML = '<span class="text-red">توکن و آیدی ادمین را وارد کنید</span>';
    return;
  }

  resultEl.innerHTML = '<div class="spinner"></div> در حال تست...';

  try {
    const res = await fetch('/api/telegram/test', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ token, adminId })
    });
    const data = await res.json();
    if (data.ok) {
      resultEl.innerHTML = `<span class="text-green">✅ اتصال موفق | بات: @${data.bot?.username || 'unknown'}</span>`;
    } else {
      resultEl.innerHTML = `<span class="text-red">❌ ${data.error}</span>`;
    }
  } catch (e) {
    resultEl.innerHTML = '<span class="text-red">خطا در تست اتصال</span>';
  }
}

async function saveTelegram() {
  const token = document.getElementById('tgToken').value;
  const adminId = document.getElementById('tgAdminId').value;

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ telegram_token: token, telegram_admin_id: adminId })
    });
    alert('تنظیمات تلگرام ذخیره شد');
  } catch (e) { alert('خطا در ذخیره'); }
}

// ── Settings ──
async function loadSettings() {
  try {
    const res = await fetch('/api/settings', { headers: authHeaders() });
    const settings = await res.json();
    document.getElementById('siteUrl').value = settings.site_url || '';
    document.getElementById('panelPath').value = settings.panel_path || 'panel_h';
    updatePanelUrlPreview();
  } catch (e) {}
}

function loadSettingsPage() {
  loadSettings();
}

async function saveSiteUrl() {
  const url = document.getElementById('siteUrl').value;
  try {
    await fetch('/api/settings/url', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ url })
    });
    alert('آدرس سایت ذخیره شد');
  } catch (e) { alert('خطا در ذخیره'); }
}

async function uploadSSL() {
  const certFile = document.getElementById('certFile').files[0];
  const keyFile = document.getElementById('keyFile').files[0];

  if (!certFile && !keyFile) return alert('حداقل یک فایل انتخاب کنید');

  const formData = new FormData();
  if (certFile) formData.append('cert', certFile);
  if (keyFile) formData.append('key', keyFile);

  try {
    await fetch('/api/settings/ssl', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API.token}` },
      body: formData
    });
    alert('فایل‌های SSL با موفقیت آپلود شدند');
  } catch (e) { alert('خطا در آپلود'); }
}

function updatePanelUrlPreview() {
  const panelPath = document.getElementById('panelPath').value || 'panel_h';
  document.getElementById('panelUrlPreview').textContent = `${location.origin}/${panelPath}`;
}

async function savePanelPath() {
  const panelPath = document.getElementById('panelPath').value || 'panel_h';
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ panel_path: panelPath })
    });
    alert('مسیر پنل ذخیره شد. توجه: پس از تغییر مسیر باید از آدرس جدید وارد شوید.');
    updatePanelUrlPreview();
  } catch (e) { alert('خطا در ذخیره'); }
}

// ── Change Password ──
async function changePassword() {
  const current = document.getElementById('currentPass').value;
  const newPass = document.getElementById('newPass').value;
  const resultEl = document.getElementById('passResult');

  if (!current || !newPass) {
    resultEl.innerHTML = '<span class="text-red">هر دو فیلد الزامی است</span>';
    return;
  }
  if (newPass.length < 4) {
    resultEl.innerHTML = '<span class="text-red">رمز جدید حداقل ۴ کاراکتر باشد</span>';
    return;
  }

  try {
    const res = await fetch('/api/change-password', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ currentPassword: current, newPassword: newPass })
    });
    const data = await res.json();
    if (res.ok) {
      resultEl.innerHTML = '<span class="text-green">✅ رمز عبور با موفقیت تغییر کرد</span>';
      document.getElementById('currentPass').value = '';
      document.getElementById('newPass').value = '';
    } else {
      resultEl.innerHTML = `<span class="text-red">${data.error}</span>`;
    }
  } catch (e) {
    resultEl.innerHTML = '<span class="text-red">خطا در تغییر رمز</span>';
  }
}

// ── Helpers ──
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
