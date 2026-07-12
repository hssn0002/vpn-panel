// ═══ Admin Panel JS v2.0 ═══
const API = { token: '', sortBy: 'remaining_days', sortDir: 'ASC', currentPage: 'users', contactType: 'telegram', editingUserId: null, selectedUsers: new Set(), chatUserId: null, chatUsername: '', ws: null, markingSeen: false };

// ═══ Auth ═══
async function login() {
  const pass = document.getElementById('loginPassword').value;
  if (!pass) return;
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pass }) });
    if (!res.ok) { document.getElementById('loginError').style.display = 'block'; document.getElementById('loginError').textContent = 'رمز عبور اشتباه است'; return; }
    const data = await res.json();
    API.token = data.token;
    localStorage.setItem('admin_token', data.token);
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mainPanel').style.display = 'flex';
    initPanel();
  } catch { document.getElementById('loginError').style.display = 'block'; document.getElementById('loginError').textContent = 'خطا در ارتباط'; }
}

window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('admin_token');
  if (saved) {
    API.token = saved;
    fetch('/api/check-auth', { headers: { 'Authorization': `Bearer ${API.token}` } }).then(r => r.ok ? r.json() : Promise.reject()).then(d => {
      if (d.valid) { document.getElementById('loginScreen').style.display = 'none'; document.getElementById('mainPanel').style.display = 'flex'; initPanel(); }
    }).catch(() => localStorage.removeItem('admin_token'));
  }
  document.getElementById('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
});

function authHeaders() { return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API.token}` }; }

function initPanel() {
  connectAdminWS(); loadUsers(); loadSettings(); refreshChatBadge();
  setInterval(refreshChatBadge, 15000);
  setInterval(() => { if (API.currentPage === 'users' && !API.markingSeen) loadUsers(true); }, 30000);
}

function connectAdminWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  API.ws = new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(API.token)}&type=admin`);
  API.ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'refresh') { if (API.currentPage === 'users') loadUsers(true); }
    if (msg.type === 'sub_error') { if (API.currentPage === 'users') loadUsers(true); }
    if (msg.type === 'admin_chat') { refreshChatBadge();
      if (API.chatUserId === msg.userId && document.getElementById('chatModal').style.display !== 'none') appendChatMsg('modal', msg);
      if (API.currentPage === 'chatroom') loadChatRoom();
    }
    if (msg.type === 'message_deleted') { removeChatMsgElement(msg.messageId); }
    if (msg.type === 'message_edited') { updateChatMsgText(msg.messageId, msg.text); }
  };
  API.ws.onclose = () => setTimeout(connectAdminWS, 3000);
}

// ═══ Navigation ═══
function switchPage(page, el) {
  API.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.admin-sidebar nav a').forEach(a => a.classList.remove('active'));
  const pEl = document.getElementById('page-' + page);
  if (pEl) pEl.style.display = 'block';
  if (el) el.classList.add('active');
  if (page === 'users') loadUsers();
  if (page === 'chatroom') loadChatRoom();
  if (page === 'backup') loadBackups();
  if (page === 'telegram') loadTelegramSettings();
  if (page === 'settings') loadSettingsPage();
  if (page === 'adduser' && !API.editingUserId) resetAddUserForm();
  if (page === 'bulkrename') initBulkRename();
}

// ═══ Users Table ═══
async function loadUsers(silent) {
  if (!silent) document.getElementById('usersTableBody').innerHTML = '<tr><td colspan="8" class="text-center"><div class="spinner"></div></td></tr>';
  try {
    const res = await fetch(`/api/users?sort=${API.sortBy}&dir=${API.sortDir}`, { headers: authHeaders() });
    const users = await res.json();
    renderUsers(users);
  } catch { document.getElementById('usersTableBody').innerHTML = '<tr><td colspan="8" class="text-center text-red">خطا در بارگذاری</td></tr>'; }
}

function renderUsers(users) {
  const tbody = document.getElementById('usersTableBody'), empty = document.getElementById('usersEmpty');
  if (!users?.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = users.map(u => {
    const vc = u.remaining_volume === 'نامحدود' || u.remaining_volume === '∞' ? 'success' : (parseFloat(u.remaining_volume) <= 0 ? 'danger' : '');
    const dc = u.remaining_days <= 0 ? 'danger' : (u.remaining_days <= 3 ? 'warning' : 'success');
    const er = u.sub_error ? 'error-row' : '';
    const eb = u.sub_error ? '<span class="badge badge-danger blink">⚠ خطا</span>' : (u.remaining_days > 0 ? '<span class="badge badge-success">فعال</span>' : '<span class="badge badge-danger">منقضی</span>');
    
    let contactIcon = '📱';
    let contactLink = '#';
    const cid = (u.contact_id || '').replace('@', '');
    if (u.contact_type === 'telegram') { contactIcon = '📱 تلگرام'; contactLink = `https://t.me/${cid}`; }
    else if (u.contact_type === 'bale') { contactIcon = '💬 بله'; contactLink = `https://ble.ir/${cid}`; }
    else if (u.contact_type === 'whatsapp') { contactIcon = '💚 واتس‌اپ'; contactLink = `https://wa.me/${cid}`; }

    const userPageUrl = `${location.origin}/u/${encodeURIComponent(u.username)}`;
    const supportId = localStorage.getItem('support_id') || '';

    return `<tr class="${er}">
      <td onclick="event.stopPropagation();"><input type="checkbox" onchange="toggleUserSelect(${u.id},this)"/></td>
      <td><strong>${esc(u.username)}</strong></td>
      <td class="text-${dc}">${u.remaining_days} روز</td>
      <td class="text-${vc}">${u.remaining_volume || '0'}</td>
      <td><a href="${contactLink}" target="_blank" class="btn btn-outline btn-sm" style="font-size:0.7em;padding:3px 8px;" onclick="event.stopPropagation();">${contactIcon}</a></td>
      <td>${eb}</td>
      <td><button class="btn btn-outline btn-sm" style="font-size:0.7em;padding:3px 8px;" onclick="event.stopPropagation();copyToClipboard('${userPageUrl}')">🔗 کپی لینک</button></td>
      <td onclick="event.stopPropagation();">
        <div class="btn-group">
          <button class="btn btn-outline btn-sm" onclick="openUserDetail(${u.id})">✏️</button>
          <button class="btn btn-outline btn-sm" onclick="refreshSub(${u.id})">🔄</button>
          <button class="btn btn-outline btn-sm" onclick="openChatWithUser(${u.id},'${esc(u.username)}')">💬</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function toggleSelectAll() {
  const ca = document.getElementById('selectAll'); const cbs = document.querySelectorAll('#usersTableBody input[type="checkbox"]');
  API.selectedUsers.clear(); cbs.forEach(cb => { cb.checked = ca.checked; });
  if (ca.checked) { document.querySelectorAll('#usersTableBody tr').forEach((tr,i) => API.selectedUsers.add(API.allUserIds[i])); }
  updateBulkBtn();
}

function toggleUserSelect(id, cb) { cb.checked ? API.selectedUsers.add(id) : API.selectedUsers.delete(id); updateBulkBtn(); }

function updateBulkBtn() {
  const btn = document.getElementById('bulkDeleteBtn'); btn.style.display = API.selectedUsers.size > 0 ? '' : 'none';
  btn.textContent = `🗑️ حذف (${API.selectedUsers.size})`;
}

async function bulkDelete() {
  if (!API.selectedUsers.size) return;
  if (!confirm(`حذف ${API.selectedUsers.size} کاربر؟`)) return;
  await fetch('/api/users/bulk-delete', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ids: [...API.selectedUsers] }) });
  API.selectedUsers.clear(); updateBulkBtn(); loadUsers();
}

function sortUsers(field) {
  API.sortDir = (API.sortBy === field && API.sortDir === 'ASC') ? 'DESC' : 'ASC';
  API.sortBy = field; loadUsers();
}

async function refreshSub(id) { await fetch(`/api/users/${id}/refresh`, { method: 'POST', headers: authHeaders() }); loadUsers(true); }
async function refreshAllSubs() { await fetch('/api/users/refresh-all', { method: 'POST', headers: authHeaders() }); loadUsers(true); }

async function deleteUser(id) { if (!confirm('حذف این کاربر؟')) return; await fetch(`/api/users/${id}`, { method: 'DELETE', headers: authHeaders() }); loadUsers(); }

// ═══ User Modal ═══
async function openUserDetail(id) {
  API.editingUserId = id;
  const res = await fetch(`/api/users/${id}`, { headers: authHeaders() });
  const user = await res.json();
  renderUserModal(user);
  document.getElementById('userModal').style.display = 'flex';
}

function renderUserModal(user) {
  document.getElementById('modalTitle').textContent = `✏️ ${user.username}`;
  const links = (user.subscription_links || []).join('\n');
  const vlessLinks = (user.vless_links || []).join('\n');
  const sel = t => user.contact_type === t ? 'selected' : '';
  document.getElementById('modalContent').innerHTML = `
    <div class="form-group"><label>نام کاربری</label><input type="text" id="modalUsername" class="form-control" value="${esc(user.username)}"/></div>
    <div class="form-group"><label>نوع ارتباط</label><select id="modalContactType" class="form-control">
      <option value="telegram" ${sel('telegram')}>تلگرام</option><option value="bale" ${sel('bale')}>بله</option><option value="whatsapp" ${sel('whatsapp')}>واتس‌اپ</option></select></div>
    <div class="form-group"><label>شناسه</label><input type="text" id="modalContactId" class="form-control" value="${esc(user.contact_id||'')}" style="direction:ltr;"/></div>
    <div class="form-group"><label class="toggle-wrap"><span>حجم نامحدود</span><label class="toggle"><input type="checkbox" id="modalUnlimited" ${user.unlimited_volume?'checked':''} onchange="toggleModalUnlimited()"/><span class="slider"></span></label></label></div>
    <div id="modalSubSection" style="display:${user.unlimited_volume?'none':'block'};">
      <div class="form-group"><label>لینک‌های ساب</label><textarea id="modalSubLinks" class="form-control" rows="3" onblur="previewSubLinks('modalSubLinks','modalSubPreview')">${esc(links)}</textarea></div>
      <div id="modalSubPreview" class="mt-1" style="color:var(--text-dim);font-size:0.8em;"></div>
    </div>
    <div id="modalManualSection" style="display:${user.unlimited_volume?'block':'none'};">
      <div class="form-group"><label>تعداد روز</label><input type="number" id="modalManualDays" class="form-control" value="${user.manual_days||30}"/></div>
      <div class="form-group"><label>لینک‌های VLESS</label><textarea id="modalVlessLinks" class="form-control" rows="3">${esc(vlessLinks)}</textarea></div>
    </div>
    <div class="info-grid mt-2" style="background:var(--bg);padding:12px;border-radius:8px;">
      <div class="info-item"><div class="label">مانده حجم</div><div class="value">${user.remaining_volume||'0'}</div></div>
      <div class="info-item"><div class="label">مانده زمان</div><div class="value">${user.remaining_days||0} روز</div></div>
    </div>
    <div class="mt-2 flex gap-1 items-center"><span class="url-display">${location.origin}/u/${user.username}</span><button class="btn btn-outline btn-sm" onclick="copyToClipboard('${location.origin}/u/${user.username}')">📋</button></div>`;
}

function toggleModalUnlimited() {
  const c = document.getElementById('modalUnlimited').checked;
  document.getElementById('modalSubSection').style.display = c ? 'none' : 'block';
  document.getElementById('modalManualSection').style.display = c ? 'block' : 'none';
}

async function saveUserFromModal() {
  if (!API.editingUserId) return;
  const unlimited = document.getElementById('modalUnlimited').checked;
  const data = {
    username: document.getElementById('modalUsername').value.trim(),
    contact_type: document.getElementById('modalContactType').value,
    contact_id: document.getElementById('modalContactId').value.trim(),
    unlimited_volume: unlimited,
    manual_days: parseInt(document.getElementById('modalManualDays').value) || 30,
    subscription_links: unlimited ? [] : document.getElementById('modalSubLinks').value.split('\n').map(s=>s.trim()).filter(s=>s),
    vless_links: unlimited ? document.getElementById('modalVlessLinks').value.split('\n').map(s=>s.trim()).filter(s=>s) : []
  };
  await fetch(`/api/users/${API.editingUserId}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(data) });
  closeModal(); loadUsers();
}

function closeModal() { document.getElementById('userModal').style.display = 'none'; API.editingUserId = null; }

// ═══ Add User ═══
function setContactType(el) {
  API.contactType = el.dataset.contact;
  document.querySelectorAll('#page-adduser [data-contact]').forEach(b => b.classList.toggle('active', b.dataset.contact === API.contactType));
}

function toggleUnlimited() {
  const c = document.getElementById('userUnlimited').checked;
  document.getElementById('subLinksSection').style.display = c ? 'none' : 'block';
  document.getElementById('manualSection').style.display = c ? 'block' : 'none';
}

function addVlessBox() { document.getElementById('userVlessLinks').value += (document.getElementById('userVlessLinks').value ? '\n' : '') + 'vless://'; }

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
  document.getElementById('subPreview').innerHTML = '';
  toggleUnlimited();
  API.contactType = 'telegram';
  document.querySelectorAll('#page-adduser [data-contact]').forEach(b => b.classList.toggle('active', b.dataset.contact === 'telegram'));
}

async function previewSubLinks(sourceId, previewId) {
  const input = document.getElementById(sourceId);
  if (!input) return;
  const links = input.value.split('\n').map(s=>s.trim()).filter(s=>s);
  const preview = document.getElementById(previewId);
  if (!preview) return;
  if (!links.length) { preview.innerHTML = ''; return; }
  preview.innerHTML = '<div class="spinner"></div>';
  const lastLink = links[links.length - 1];
  try {
    const res = await fetch('/api/sub-preview', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ url: lastLink }) });
    const data = await res.json();
    if (data.error) preview.innerHTML = `<span class="text-red">❌ ${data.error}</span>`;
    else {
      const days = data.remainingDays || 0;
      preview.innerHTML = `<span class="text-${days>3?'green':'orange'}">📊 حجم: ${data.remainingVolume||'?'} | ⏳ ${days} روز | 🔗 ${data.linkCount||0} کانفیگ</span>`;
    }
  } catch { preview.innerHTML = '<span class="text-red">خطا</span>'; }
}

async function saveUser() {
  const usernameEl = document.getElementById('userUsername');
  if (!usernameEl) return alert('فرم یافت نشد');
  const username = usernameEl.value.trim();
  if (!username) return alert('نام کاربری الزامی است');
  if (!API.token) return alert('احراز هویت انجام نشده');
  const unlimited = document.getElementById('userUnlimited')?.checked || false;
  const data = {
    username,
    contact_type: API.contactType || 'telegram',
    contact_id: (document.getElementById('userContactId')?.value || '').trim(),
    unlimited_volume: unlimited,
    manual_days: parseInt(document.getElementById('userManualDays')?.value) || 30,
    subscription_links: unlimited ? [] : (document.getElementById('userSubLinks')?.value || '').split('\n').map(s=>s.trim()).filter(s=>s),
    vless_links: unlimited ? (document.getElementById('userVlessLinks')?.value || '').split('\n').map(s=>s.trim()).filter(s=>s) : []
  };
  try {
    const res = await fetch('/api/users', { method: 'POST', headers: authHeaders(), body: JSON.stringify(data) });
    if (!res.ok) { let e; try { e = await res.json(); } catch { e = { error: 'کد ' + res.status }; } return alert('❌ ' + (e.error || 'خطا')); }
    resetAddUserForm(); switchPage('users');
  } catch { alert('❌ خطا در ارتباط'); }
}

function cancelEdit() { resetAddUserForm(); switchPage('users'); }

// ═══ Bulk Rename ═══
async function initBulkRename() {
  const container = document.getElementById('bulkRenameList');
  try {
    const res = await fetch('/api/users', { headers: authHeaders() });
    const users = await res.json();
    container.innerHTML = users.map(u => `
      <div class="flex items-center gap-1 mb-1" style="padding:6px;background:var(--bg);border-radius:6px;">
        <span style="width:40px;color:var(--text-dim);">#${u.id}</span>
        <input type="text" class="form-control" value="${esc(u.username)}" data-id="${u.id}" style="padding:6px 10px;font-size:0.9em;" />
      </div>`).join('');
  } catch { container.innerHTML = '<p class="text-red">خطا</p>'; }
}

async function saveBulkRename() {
  const inputs = document.querySelectorAll('#bulkRenameList input');
  const renames = [];
  inputs.forEach(inp => renames.push({ id: parseInt(inp.dataset.id), newname: inp.value.trim() }));
  const valid = renames.filter(r => r.newname);
  if (!valid.length) return alert('هیچ نامی وارد نشده');
  try {
    await fetch('/api/users/bulk-rename', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ renames: valid }) });
    alert('✅ نام‌ها با موفقیت ذخیره شدند');
    switchPage('users');
  } catch { alert('خطا'); }
}

// ═══ Chat ═══
function openChatWithUser(userId, username) {
  API.chatUserId = userId; API.chatUsername = username;
  document.getElementById('chatModalTitle').textContent = `💬 چت با ${username}`;
  document.getElementById('chatModal').style.display = 'flex';
  document.getElementById('chatModalMessages').innerHTML = '';
  loadChatMessages(userId);
  markSeen(userId);
  if (API.ws?.readyState === WebSocket.OPEN) API.ws.send(JSON.stringify({ type: 'mark_seen', userId }));
}

function closeChatModal() { document.getElementById('chatModal').style.display = 'none'; API.chatUserId = null; refreshChatBadge(); }

async function loadChatMessages(userId) {
  const res = await fetch(`/api/messages/${userId}?limit=300`, { headers: authHeaders() });
  const msgs = await res.json();
  document.getElementById('chatModalMessages').innerHTML = msgs.map(m => renderChatMsg(m)).join('');
  scrollModalChat();
}

function renderChatMsg(m) {
  const cls = m.sender_type === 'user' ? 'msg-user' : 'msg-admin';
  let content = '';
  if (m.image) content += `<img src="${m.image}" class="msg-image" onclick="window.open('${m.image}')"/>`;
  if (m.message) content += esc(m.message).replace(/\n/g, '<br>');
  const editBtn = `<button class="btn btn-outline btn-sm" style="padding:1px 6px;font-size:0.65em;" onclick="event.stopPropagation();editMessage(${m.id},'${esc((m.message||'').replace(/'/g,"\\'"))}')">✏️</button>`;
  const delBtn = `<button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:0.65em;" onclick="event.stopPropagation();deleteMessage(${m.id})">🗑️</button>`;
  return `<div class="msg-bubble ${cls}" id="msg-${m.id}">${content}<div class="flex gap-1" style="justify-content:flex-end;margin-top:4px;">${editBtn}${delBtn}</div><div class="msg-time">${m.created_at||''}</div></div>`;
}

function appendChatMsg(target, msg) {
  const c = document.getElementById('chatModalMessages');
  if (!c) return;
  const div = document.createElement('div');
  div.id = 'msg-' + msg.id;
  div.className = 'msg-bubble ' + (msg.senderType === 'user' ? 'msg-user' : 'msg-admin');
  let content = '';
  if (msg.image) content += `<img src="${msg.image}" class="msg-image"/>`;
  if (msg.message) content += esc(msg.message).replace(/\n/g, '<br>');
  const editBtn = `<button class="btn btn-outline btn-sm" style="padding:1px 6px;font-size:0.65em;" onclick="event.stopPropagation();editMessage(${msg.id},'${esc((msg.message||'').replace(/'/g,"\\'"))}')">✏️</button>`;
  const delBtn = `<button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:0.65em;" onclick="event.stopPropagation();deleteMessage(${msg.id})">🗑️</button>`;
  div.innerHTML = content + `<div class="flex gap-1" style="justify-content:flex-end;margin-top:4px;">${editBtn}${delBtn}</div><div class="msg-time">${msg.time||''}</div>`;
  c.appendChild(div); scrollModalChat();
}

function removeChatMsgElement(id) {
  const el = document.getElementById('msg-' + id); if (el) el.remove();
  const modalEl = document.getElementById('chatModalMessages')?.querySelector('#msg-' + id); if (modalEl) modalEl.remove();
}

function updateChatMsgText(id, text) {
  const el = document.getElementById('msg-' + id);
  if (el) {
    const timeHtml = (el.querySelector('.msg-time')?.outerHTML || '');
    let btns = el.querySelector('.flex')?.outerHTML || '';
    el.innerHTML = esc(text).replace(/\n/g, '<br>') + btns + timeHtml;
  }
}

async function deleteMessage(id) {
  if (!confirm('حذف این پیام؟')) return;
  if (API.ws?.readyState === WebSocket.OPEN) {
    API.ws.send(JSON.stringify({ type: 'delete_message', messageId: id, userId: API.chatUserId }));
  }
  await fetch(`/api/messages/${id}`, { method: 'DELETE', headers: authHeaders() });
}

function editMessage(id, currentText) {
  const newText = prompt('ویرایش پیام:', currentText.replace(/\\'/g, "'"));
  if (!newText || newText === currentText) return;
  if (API.ws?.readyState === WebSocket.OPEN) {
    API.ws.send(JSON.stringify({ type: 'edit_message', messageId: id, text: newText, userId: API.chatUserId }));
  }
  fetch(`/api/messages/${id}`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ message: newText }) }).catch(()=>{});
}

async function sendChatMessage(target) {
  const input = document.getElementById('chatModalInput');
  const text = input.value.trim();
  if (!text || !API.chatUserId) return;
  input.value = '';
  if (API.ws?.readyState === WebSocket.OPEN) {
    API.ws.send(JSON.stringify({ type: 'chat', userId: API.chatUserId, text }));
  } else {
    await fetch(`/api/messages/${API.chatUserId}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ message: text }) });
  }
}

async function sendChatImage(target) {
  const file = document.getElementById('chatModalImageInput').files[0];
  if (!file || !API.chatUserId) return;
  const fd = new FormData(); fd.append('image', file);
  try {
    const res = await fetch('/api/upload-image', { method: 'POST', headers: { 'Authorization': `Bearer ${API.token}` }, body: fd });
    const data = await res.json();
    if (API.ws?.readyState === WebSocket.OPEN) {
      API.ws.send(JSON.stringify({ type: 'chat', userId: API.chatUserId, image: data.url }));
    }
  } catch {}
  document.getElementById('chatModalImageInput').value = '';
}

async function markSeen(userId) {
  API.markingSeen = true;
  try { await fetch(`/api/messages/${userId}/seen`, { method: 'POST', headers: authHeaders() }); } catch {}
  API.markingSeen = false;
}

async function refreshChatBadge() {
  try {
    const res = await fetch('/api/unread-messages', { headers: authHeaders() });
    const msgs = await res.json();
    const badge = document.getElementById('chatBadge');
    badge.style.display = msgs.length ? 'inline-block' : 'none';
    badge.textContent = msgs.length;
  } catch {}
}

function scrollModalChat() { const c = document.getElementById('chatModalMessages'); if (c) c.scrollTop = c.scrollHeight; }

// ═══ Chat Room ═══
async function loadChatRoom() {
  const container = document.getElementById('chatRoomList');
  try {
    const res = await fetch('/api/chat-room', { headers: authHeaders() });
    const chats = await res.json();
    if (!chats?.length) { container.innerHTML = '<div class="empty-state"><div class="icon">💬</div><p>هیچ گفتگویی ثبت نشده</p></div>'; return; }
    container.innerHTML = chats.map(c => `
      <div class="chat-room-item" onclick="openChatWithUser(${c.user_id},'${esc(c.username)}')">
        <div><strong>👤 ${esc(c.username)}</strong>${c.unread>0?` <span class="badge badge-danger">${c.unread} جدید</span>`:''}
        <p style="margin-top:6px;color:var(--text-dim);font-size:0.85em;">${c.last_message?esc(c.last_message.substring(0,80))+(c.last_message.length>80?'...':''):'بدون پیام'}</p></div>
        <span style="font-size:0.78em;color:var(--text-muted);white-space:nowrap;">${c.last_time||''}</span></div>`).join('');
  } catch { container.innerHTML = '<p class="text-center text-red">خطا</p>'; }
}

// ═══ Backup ═══
async function createBackup() { await fetch('/api/backup/create', { method: 'POST', headers: authHeaders() }); alert('✅ بکاپ ایجاد شد'); loadBackups(); }
async function sendBackupTelegram() { await fetch('/api/backup/send-telegram', { method: 'POST', headers: authHeaders() }); alert('✅ ارسال شد'); }

async function restoreBackup() {
  const file = document.getElementById('restoreFile').files[0];
  if (!file || !confirm('بازیابی بکاپ؟ اطلاعات فعلی جایگزین می‌شود.')) return;
  const fd = new FormData(); fd.append('backup', file);
  try {
    const res = await fetch('/api/backup/restore', { method: 'POST', headers: { 'Authorization': `Bearer ${API.token}` }, body: fd });
    const data = await res.json();
    alert(data.message || 'بازیابی شد');
  } catch { alert('خطا'); }
}

async function loadBackups() {
  const container = document.getElementById('backupList');
  try {
    const res = await fetch('/api/backups', { headers: authHeaders() });
    const backups = await res.json();
    if (!backups?.length) { container.innerHTML = '<p>هیچ بکاپی موجود نیست</p>'; return; }
    container.innerHTML = backups.map(b => `
      <div class="flex justify-between items-center mb-1" style="padding:8px;background:var(--bg);border-radius:6px;">
        <span>📦 ${b.name}</span><span style="color:var(--text-dim);font-size:0.85em;">${fmtSize(b.size)}</span>
        <a href="/api/backups/download/${b.name}" class="btn btn-outline btn-sm" download>📥</a></div>`).join('');
  } catch { container.innerHTML = '<p class="text-red">خطا</p>'; }
}

// ═══ Telegram ═══
async function loadTelegramSettings() {
  const res = await fetch('/api/settings', { headers: authHeaders() });
  const s = await res.json();
  document.getElementById('tgToken').value = s.telegram_token || '';
  document.getElementById('tgAdminId').value = s.telegram_admin_id || '';
}

async function testTelegram() {
  const resultEl = document.getElementById('tgTestResult');
  const token = document.getElementById('tgToken').value, adminId = document.getElementById('tgAdminId').value;
  if (!token || !adminId) { resultEl.innerHTML = '<span class="text-red">توکن و آیدی را وارد کنید</span>'; return; }
  resultEl.innerHTML = '<div class="spinner"></div>';
  const res = await fetch('/api/telegram/test', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ token, adminId }) });
  const data = await res.json();
  resultEl.innerHTML = data.ok ? `<span class="text-green">✅ @${data.bot?.username||'?'}</span>` : `<span class="text-red">❌ ${data.error}</span>`;
}

async function saveTelegram() {
  await fetch('/api/settings', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ telegram_token: document.getElementById('tgToken').value, telegram_admin_id: document.getElementById('tgAdminId').value }) });
  alert('ذخیره شد');
}

// ═══ Settings ═══
async function loadSettings() {
  const res = await fetch('/api/settings', { headers: authHeaders() });
  const s = await res.json();
  document.getElementById('siteUrl').value = s.site_url || '';
  document.getElementById('panelPath').value = s.panel_path || 'panel_h';
  document.getElementById('supportId').value = s.support_id || '';
  localStorage.setItem('support_id', s.support_id || '');
  updatePanelUrlPreview();
}

function loadSettingsPage() { loadSettings(); }

async function saveSiteUrl() { await fetch('/api/settings/url', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ url: document.getElementById('siteUrl').value }) }); alert('ذخیره شد'); }

async function uploadSSL() {
  const cert = document.getElementById('certFile').files[0], key = document.getElementById('keyFile').files[0];
  if (!cert && !key) return alert('فایلی انتخاب نشده');
  const fd = new FormData();
  if (cert) fd.append('cert', cert);
  if (key) fd.append('key', key);
  await fetch('/api/settings/ssl', { method: 'POST', headers: { 'Authorization': `Bearer ${API.token}` }, body: fd });
  alert('✅ آپلود شد');
}

async function saveAllSettings() {
  await fetch('/api/settings', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ site_url: document.getElementById('siteUrl').value, panel_path: document.getElementById('panelPath').value, support_id: document.getElementById('supportId').value }) });
  localStorage.setItem('support_id', document.getElementById('supportId').value);
  updatePanelUrlPreview();
  alert('✅ ذخیره شد');
}

function updatePanelUrlPreview() {
  document.getElementById('panelUrlPreview').textContent = `${location.origin}/${document.getElementById('panelPath').value||'panel_h'}`;
}

// ═══ Password ═══
async function changePassword() {
  const c = document.getElementById('currentPass').value, n = document.getElementById('newPass').value, r = document.getElementById('passResult');
  if (!c || !n) { r.innerHTML = '<span class="text-red">هر دو فیلد الزامی است</span>'; return; }
  if (n.length < 4) { r.innerHTML = '<span class="text-red">حداقل ۴ کاراکتر</span>'; return; }
  try {
    const res = await fetch('/api/change-password', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ currentPassword: c, newPassword: n }) });
    const d = await res.json();
    r.innerHTML = res.ok ? '<span class="text-green">✅ تغییر کرد</span>' : `<span class="text-red">${d.error}</span>`;
    if (res.ok) { document.getElementById('currentPass').value = ''; document.getElementById('newPass').value = ''; }
  } catch { r.innerHTML = '<span class="text-red">خطا</span>'; }
}

// ═══ Helpers ═══
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function fmtSize(b) { if (!b) return '0B'; const k = 1024, s = ['B','KB','MB','GB']; const i = Math.floor(Math.log(b)/Math.log(k)); return parseFloat((b/Math.pow(k,i)).toFixed(1))+' '+s[i]; }
