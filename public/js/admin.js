const API={token:'',sortBy:'remaining_days',sortDir:'ASC',currentPage:'users',contactType:'telegram',editingUserId:null,selectedUsers:new Set(),chatUserId:null,chatUsername:'',ws:null,markingSeen:false,allUserIds:[]};

async function login(){
  const pass=document.getElementById('loginPassword').value;if(!pass)return;
  try{
    const res=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pass})});
    if(!res.ok){document.getElementById('loginError').style.display='block';document.getElementById('loginError').textContent='رمز عبور اشتباه است';return;}
    const d=await res.json();API.token=d.token;localStorage.setItem('admin_token',d.token);
    document.getElementById('loginScreen').style.display='none';document.getElementById('mainPanel').style.display='flex';
    initPanel();
  }catch{document.getElementById('loginError').style.display='block';document.getElementById('loginError').textContent='خطا در ارتباط';}
}

window.addEventListener('DOMContentLoaded',()=>{
  const s=localStorage.getItem('admin_token');if(s){API.token=s;
    fetch('/api/check-auth',{headers:{'Authorization':`Bearer ${API.token}`}}).then(r=>r.ok?r.json():Promise.reject()).then(d=>{if(d.valid){document.getElementById('loginScreen').style.display='none';document.getElementById('mainPanel').style.display='flex';initPanel();}}).catch(()=>localStorage.removeItem('admin_token'));}
  document.getElementById('loginPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login();});
});

function authHeaders(){return{'Content-Type':'application/json','Authorization':`Bearer ${API.token}`};}

function initPanel(){connectAdminWS();loadUsers();loadSettings();refreshChatBadge();setInterval(refreshChatBadge,15000);setInterval(()=>{if(API.currentPage==='users'&&!API.markingSeen)loadUsers(true);},30000);}

function connectAdminWS(){
  const p=location.protocol==='https:'?'wss:':'ws:';
  API.ws=new WebSocket(`${p}//${location.host}/ws?token=${encodeURIComponent(API.token)}&type=admin`);
  API.ws.onmessage=e=>{
    const msg=JSON.parse(e.data);
    if(msg.type==='refresh'){if(API.currentPage==='users')loadUsers(true);}
    if(msg.type==='sub_error'){if(API.currentPage==='users')loadUsers(true);}
    if(msg.type==='admin_chat'){refreshChatBadge();
      if(API.chatUserId===msg.userId&&document.getElementById('chatModal').style.display!=='none')appendChatMsg(msg);
      if(API.currentPage==='chatroom')loadChatRoom();}
    if(msg.type==='message_deleted')removeChatEl(msg.messageId);
    if(msg.type==='message_edited')updateChatText(msg.messageId,msg.text);
  };
  API.ws.onclose=()=>setTimeout(connectAdminWS,3000);
}

function switchPage(page,el){
  API.currentPage=page;
  document.querySelectorAll('.page').forEach(p=>p.style.display='none');
  document.querySelectorAll('.admin-sidebar nav a').forEach(a=>a.classList.remove('active'));
  const pe=document.getElementById('page-'+page);if(pe)pe.style.display='block';
  if(el)el.classList.add('active');
  if(page==='users')loadUsers();
  if(page==='chatroom')loadChatRoom();
  if(page==='backup')loadBackups();
  if(page==='telegram')loadTelegram();
  if(page==='settings')loadSettingsPage();
  if(page==='adduser'&&!API.editingUserId)resetAddUserForm();
}

// ═══ Users ═══
let debounceTimer=null;
function searchUsers(){
  clearTimeout(debounceTimer);
  debounceTimer=setTimeout(()=>loadUsers(),300);
}

async function loadUsers(silent){
  if(!silent)document.getElementById('usersTableBody').innerHTML='<tr><td colspan="9" class="text-center"><div class="spinner"></div></td></tr>';
  try{
    const search=document.getElementById('userSearch')?.value||'';
    const[ur,sr]=await Promise.all([fetch(`/api/users?sort=${API.sortBy}&dir=${API.sortDir}&search=${encodeURIComponent(search)}`,{headers:authHeaders()}),fetch('/api/stats',{headers:authHeaders()})]);
    const users=await ur.json(),stats=await sr.json();
    API.allUserIds=users.map(u=>u.id);
    renderUsers(users,stats);
  }catch{document.getElementById('usersTableBody').innerHTML='<tr><td colspan="9" class="text-center text-red">خطا</td></tr>';}
}

function renderUsers(users,stats){
  const tb=document.getElementById('usersTableBody'),em=document.getElementById('usersEmpty');
  if(!users?.length){tb.innerHTML='';em.style.display='block';document.getElementById('statsBar').style.display='none';return;}
  em.style.display='none';
  
  // Stats bar
  const sb=document.getElementById('statsBar');
  if(sb) sb.innerHTML=`📊 کل: ${stats.total} | ✅ فعال: ${stats.active} | ❌ غیرفعال: ${stats.inactive} | ⚠️ خطا: ${stats.errors}`;
  
  tb.innerHTML=users.map(u=>{
    const vc=u.remaining_volume==='نامحدود'||u.remaining_volume==='∞'?'success':(parseFloat(u.remaining_volume)<=0?'danger':'');
    const dc=u.remaining_days<=0?'danger':(u.remaining_days<=3?'warning':'success');
    const er=u.sub_error?'error-row':'';
    const eb=u.sub_error?`<span class="badge badge-danger blink" style="cursor:pointer;" onclick="event.stopPropagation();ackError(${u.id})">⚠ خطا</span>`:
      (u.suspended?'<span class="badge badge-danger">⛔ غیرفعال</span>':(u.remaining_days>0?`<span class="badge badge-success">فعال</span>`:`<span class="badge badge-danger">منقضی</span>`));
    
    let ci='📱',cl='#';
    const cid=(u.contact_id||'').replace('@','');
    if(u.contact_type==='telegram'){ci='📱';cl=`https://t.me/${cid}`;}
    else if(u.contact_type==='bale'){ci='💬';cl=`https://ble.ir/${cid}`;}
    else if(u.contact_type==='whatsapp'){ci='💚';cl=`https://wa.me/${cid}`;}
    const url=`${location.origin}/u/${encodeURIComponent(u.username)}`;
    const contactId=u.contact_id||'-';

    return `<tr class="${er}">
      <td onclick="event.stopPropagation();"><input type="checkbox" onchange="toggleUserSelect(${u.id},this)"/></td>
      <td><strong>${esc(u.username)}</strong><br><small style="color:var(--text-muted);">${esc(contactId)}</small></td>
      <td class="text-${dc}">${u.remaining_days} روز</td>
      <td class="text-${vc}">${u.remaining_volume||'0'}</td>
      <td><a href="${cl}" target="_blank" class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:0.7em;border-color:var(--green);color:var(--green-glow);" onclick="event.stopPropagation();">${ci}</a></td>
      <td>${eb}</td>
      <td>
        <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:0.7em;" onclick="event.stopPropagation();copyText('${url}')">📋 کپی</button>
        <button class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:0.7em;" onclick="event.stopPropagation();window.open('${url}')">🔗 باز کردن</button>
      </td>
      <td onclick="event.stopPropagation();">
        <div class="btn-group">
          <button class="btn btn-outline btn-sm" onclick="openUserDetail(${u.id})">✏️</button>
          <button class="btn btn-outline btn-sm" onclick="refreshSub(${u.id})">🔄</button>
          <button class="btn btn-outline btn-sm" onclick="openChatWithUser(${u.id},'${esc(u.username)}')">💬</button>
          <button class="btn ${u.suspended?'btn-success':'btn-warning'} btn-sm" onclick="toggleSuspend(${u.id},${u.suspended?0:1})">${u.suspended?'▶️ فعال':'⏸️ غیرفعال'}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function copyText(t){navigator.clipboard.writeText(t).catch(()=>{});}

async function toggleSuspend(id,suspended){
  await fetch(`/api/users/${id}/suspend`,{method:'POST',headers:authHeaders(),body:JSON.stringify({suspended})});
  loadUsers(true);
}
async function ackError(id){
  await fetch(`/api/users/${id}/ack-error`,{method:'POST',headers:authHeaders()});
  loadUsers(true);
}
function toggleSelectAll(){
  const ca=document.getElementById('selectAll');API.selectedUsers.clear();
  document.querySelectorAll('#usersTableBody input[type="checkbox"]').forEach(cb=>{cb.checked=ca.checked;});
  if(ca.checked)API.allUserIds.forEach(id=>API.selectedUsers.add(id));
  updateBulkBtn();
}
function toggleUserSelect(id,cb){cb.checked?API.selectedUsers.add(id):API.selectedUsers.delete(id);updateBulkBtn();}
function updateBulkBtn(){
  const btn=document.getElementById('bulkDeleteBtn');btn.style.display=API.selectedUsers.size?'':'none';
  btn.textContent=`🗑️ حذف (${API.selectedUsers.size})`;
}
async function bulkDelete(){
  if(!API.selectedUsers.size||!confirm(`حذف ${API.selectedUsers.size} کاربر؟`))return;
  await fetch('/api/users/bulk-delete',{method:'POST',headers:authHeaders(),body:JSON.stringify({ids:[...API.selectedUsers]})});
  API.selectedUsers.clear();updateBulkBtn();loadUsers();
}
function sortUsers(f){
  API.sortDir=(API.sortBy===f&&API.sortDir==='ASC')?'DESC':'ASC';API.sortBy=f;loadUsers();
}
async function refreshSub(id){await fetch(`/api/users/${id}/refresh`,{method:'POST',headers:authHeaders()});loadUsers(true);}
async function refreshAllSubs(){await fetch('/api/users/refresh-all',{method:'POST',headers:authHeaders()});loadUsers(true);}
async function deleteUser(id){if(!confirm('حذف؟'))return;await fetch(`/api/users/${id}`,{method:'DELETE',headers:authHeaders()});loadUsers();}

// ═══ User Detail Modal ═══
async function openUserDetail(id){
  API.editingUserId=id;
  const res=await fetch(`/api/users/${id}`,{headers:authHeaders()});
  const user=await res.json();
  renderUserModal(user);
  document.getElementById('userModal').style.display='flex';
}

function renderUserModal(user){
  document.getElementById('modalTitle').textContent=`✏️ ${user.username}`;
  const links=(user.subscription_links||[]).join('\n');
  const manualVless=(user.manual_vless||[]).join('\n');
  const vlessLinks=(user.vless_links||[]).join('\n');
  const sel=t=>user.contact_type===t?'selected':'';
  document.getElementById('modalContent').innerHTML=`
    <div class="form-group"><label>نام کاربری</label><input type="text" id="modalUsername" class="form-control" value="${esc(user.username)}"/></div>
    <div class="form-group"><label>نوع ارتباط</label><select id="modalContactType" class="form-control">
      <option value="telegram" ${sel('telegram')}>تلگرام</option><option value="bale" ${sel('bale')}>بله</option><option value="whatsapp" ${sel('whatsapp')}>واتس‌اپ</option></select></div>
    <div class="form-group"><label>شناسه</label><input type="text" id="modalContactId" class="form-control" value="${esc(user.contact_id||'')}" style="direction:ltr;"/></div>
    <div class="form-group"><label class="toggle-wrap"><span>حجم نامحدود</span><label class="toggle"><input type="checkbox" id="modalUnlimited" ${user.unlimited_volume?'checked':''} onchange="toggleModalUnlimited()"/><span class="slider"></span></label></label></div>
    <div id="modalSubSection" style="display:${user.unlimited_volume?'none':'block'};">
      <div class="form-group"><label>لینک‌های ساب (هر خط یک لینک)</label><textarea id="modalSubLinks" class="form-control" rows="3">${esc(links)}</textarea></div>
      <button class="btn btn-outline btn-sm" onclick="checkSubPreview('modal')">🔍 بررسی محتوا</button>
      <div id="modalSubPreview" class="mt-1" style="color:var(--text-dim);font-size:0.8em;"></div>
      <div class="form-group mt-2"><label>اشتراک‌های VLESS دستی (هر خط یک لینک)</label><textarea id="modalManualVless" class="form-control" rows="3">${esc(manualVless)}</textarea></div>
    </div>
    <div id="modalManualSection" style="display:${user.unlimited_volume?'block':'none'};">
      <div class="form-group"><label>تعداد روز</label><input type="number" id="modalManualDays" class="form-control" value="${user.manual_days||30}"/></div>
      <div class="form-group"><label>لینک‌های VLESS</label><textarea id="modalVlessLinks" class="form-control" rows="3">${esc(vlessLinks)}</textarea></div>
    </div>
    <div class="info-grid mt-2" style="background:var(--bg);padding:12px;border-radius:8px;">
      <div class="info-item"><div class="label">مانده حجم</div><div class="value">${user.remaining_volume||'0'}</div></div>
      <div class="info-item"><div class="label">مانده زمان</div><div class="value">${user.remaining_days||0} روز</div></div>
    </div>
    <div class="mt-2 flex gap-1 items-center"><span class="url-display">${location.origin}/u/${user.username}</span><button class="btn btn-outline btn-sm" onclick="copyText('${location.origin}/u/${user.username}')">📋</button><button class="btn btn-outline btn-sm" onclick="window.open('${location.origin}/u/${user.username}')">🔗</button></div>`;
}

function toggleModalUnlimited(){
  const c=document.getElementById('modalUnlimited').checked;
  document.getElementById('modalSubSection').style.display=c?'none':'block';
  document.getElementById('modalManualSection').style.display=c?'block':'none';
}

async function checkSubPreview(source){
  const src=source==='modal'?document.getElementById('modalSubLinks'):document.getElementById('userSubLinks');
  const prev=source==='modal'?document.getElementById('modalSubPreview'):document.getElementById('subPreview');
  if(!src||!prev)return;
  const links=src.value.split('\n').map(s=>s.trim()).filter(s=>s);
  if(!links.length){prev.innerHTML='';return;}
  prev.innerHTML='<div class="spinner"></div> در حال بررسی...';
  let html='';
  for(const link of links){
    try{
      const res=await fetch('/api/sub-preview',{method:'POST',headers:authHeaders(),body:JSON.stringify({url:link})});
      const d=await res.json();
      if(d.error)html+=`<div class="text-red" style="font-size:0.75em;">❌ ${link.substring(0,40)}... — ${d.error}</div>`;
      else{
        const days=d.remainingDays||0;
        html+=`<div style="font-size:0.78em;margin:2px 0;color:var(--text-dim);">📊 ${link.substring(0,35)}... — <span class="text-${days>3?'green':'orange'}">${d.remainingVolume||'?'} | ${days} روز | ${d.linkCount||0} کانفیگ</span></div>`;
      }
    }catch{html+=`<div class="text-red" style="font-size:0.75em;">❌ خطا در ${link.substring(0,40)}...</div>`;}
  }
  prev.innerHTML=html;
}

async function saveUserFromModal(){
  if(!API.editingUserId)return;
  const unlimited=document.getElementById('modalUnlimited').checked;
  const data={
    username:document.getElementById('modalUsername').value.trim(),
    contact_type:document.getElementById('modalContactType').value,
    contact_id:document.getElementById('modalContactId').value.trim(),
    unlimited_volume:unlimited,
    manual_days:parseInt(document.getElementById('modalManualDays').value)||30,
    subscription_links:unlimited?[]:document.getElementById('modalSubLinks').value.split('\n').map(s=>s.trim()).filter(s=>s),
    manual_vless:unlimited?[]:document.getElementById('modalManualVless').value.split('\n').map(s=>s.trim()).filter(s=>s),
    vless_links:unlimited?document.getElementById('modalVlessLinks').value.split('\n').map(s=>s.trim()).filter(s=>s):[]
  };
  await fetch(`/api/users/${API.editingUserId}`,{method:'PUT',headers:authHeaders(),body:JSON.stringify(data)});
  closeModal();loadUsers();
}
function closeModal(){document.getElementById('userModal').style.display='none';API.editingUserId=null;}

// ═══ Add User ═══
function setContactType(el){API.contactType=el.dataset.contact;document.querySelectorAll('#page-adduser [data-contact]').forEach(b=>b.classList.toggle('active',b.dataset.contact===API.contactType));}
function toggleUnlimited(){const c=document.getElementById('userUnlimited').checked;document.getElementById('subLinksSection').style.display=c?'none':'block';document.getElementById('manualSection').style.display=c?'block':'none';}
function resetAddUserForm(){
  API.editingUserId=null;document.getElementById('addUserTitle').textContent='➕ افزودن کاربر جدید';
  document.getElementById('editUserId').value='';document.getElementById('userUsername').value='';
  document.getElementById('userContactId').value='';document.getElementById('userSubLinks').value='';
  document.getElementById('userManualVless').value='';document.getElementById('userVlessLinks').value='';
  document.getElementById('userManualDays').value='30';document.getElementById('userUnlimited').checked=false;
  document.getElementById('subPreview').innerHTML='';toggleUnlimited();
  API.contactType='telegram';
  document.querySelectorAll('#page-adduser [data-contact]').forEach(b=>b.classList.toggle('active',b.dataset.contact==='telegram'));
}

async function saveUser(){
  const ue=document.getElementById('userUsername');if(!ue)return alert('فرم یافت نشد');
  const username=ue.value.trim();if(!username)return alert('نام کاربری الزامی است');
  if(!API.token)return alert('احراز هویت نشده');
  const unlimited=document.getElementById('userUnlimited')?.checked||false;
  const data={
    username,display_name:username,
    contact_type:API.contactType||'telegram',
    contact_id:(document.getElementById('userContactId')?.value||'').trim(),
    unlimited_volume:unlimited,
    manual_days:parseInt(document.getElementById('userManualDays')?.value)||30,
    subscription_links:unlimited?[]:(document.getElementById('userSubLinks')?.value||'').split('\n').map(s=>s.trim()).filter(s=>s),
    manual_vless:unlimited?[]:(document.getElementById('userManualVless')?.value||'').split('\n').map(s=>s.trim()).filter(s=>s),
    vless_links:unlimited?(document.getElementById('userVlessLinks')?.value||'').split('\n').map(s=>s.trim()).filter(s=>s):[]
  };
  try{
    const res=await fetch('/api/users',{method:'POST',headers:authHeaders(),body:JSON.stringify(data)});
    if(!res.ok){let e;try{e=await res.json();}catch{e={error:'کد '+res.status}};return alert('❌ '+(e.error||'خطا'));}
    resetAddUserForm();switchPage('users');
  }catch{alert('❌ خطا در ارتباط');}
}
function cancelEdit(){resetAddUserForm();switchPage('users');}

// ═══ Chat ═══
function openChatWithUser(uid,uname){
  API.chatUserId=uid;API.chatUsername=uname;
  document.getElementById('chatModalTitle').textContent=`💬 چت با ${uname}`;
  document.getElementById('chatModal').style.display='flex';
  document.getElementById('chatModalMessages').innerHTML='';
  loadChatMessages(uid);markSeen(uid);
  if(API.ws?.readyState===WebSocket.OPEN)API.ws.send(JSON.stringify({type:'mark_seen',userId:uid}));
}
function closeChatModal(){document.getElementById('chatModal').style.display='none';API.chatUserId=null;refreshChatBadge();}

async function loadChatMessages(uid){
  const res=await fetch(`/api/messages/${uid}?limit=300`,{headers:authHeaders()});
  const msgs=await res.json();
  document.getElementById('chatModalMessages').innerHTML=msgs.map(renderChatMsg).join('');
  scrollModalChat();
}

function renderChatMsg(m){
  const cls=m.sender_type==='user'?'msg-user':'msg-admin';
  let c='';
  if(m.image)c+=`<img src="${m.image}" class="msg-image" onclick="window.open('${m.image}')"/>`;
  if(m.message)c+=esc(m.message).replace(/\n/g,'<br>');
  const eb=`<button class="btn btn-outline btn-sm" style="padding:1px 6px;font-size:0.65em;" onclick="event.stopPropagation();editMsg(${m.id},'${esc((m.message||'').replace(/'/g,"\\'"))}')">✏️</button>`;
  const db=`<button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:0.65em;" onclick="event.stopPropagation();delMsg(${m.id})">🗑️</button>`;
  return `<div class="msg-bubble ${cls}" id="msg-${m.id}">${c}<div class="flex gap-1" style="justify-content:flex-end;margin-top:4px;">${eb}${db}</div><div class="msg-time">${m.created_at||''}</div></div>`;
}

function appendChatMsg(msg){
  const container=document.getElementById('chatModalMessages');if(!container)return;
  const div=document.createElement('div');div.id='msg-'+msg.id;
  div.className='msg-bubble '+(msg.senderType==='user'?'msg-user':'msg-admin');
  let c='';
  if(msg.image)c+=`<img src="${msg.image}" class="msg-image"/>`;
  if(msg.message)c+=esc(msg.message).replace(/\n/g,'<br>');
  const eb=`<button class="btn btn-outline btn-sm" style="padding:1px 6px;font-size:0.65em;" onclick="event.stopPropagation();editMsg(${msg.id},'${esc((msg.message||'').replace(/'/g,"\\'"))}')">✏️</button>`;
  const db=`<button class="btn btn-danger btn-sm" style="padding:1px 6px;font-size:0.65em;" onclick="event.stopPropagation();delMsg(${msg.id})">🗑️</button>`;
  div.innerHTML=c+`<div class="flex gap-1" style="justify-content:flex-end;margin-top:4px;">${eb}${db}</div><div class="msg-time">${msg.time||''}</div>`;
  container.appendChild(div);scrollModalChat();
}

function removeChatEl(id){const e=document.getElementById('msg-'+id);if(e)e.remove();}
function updateChatText(id,text){
  const e=document.getElementById('msg-'+id);if(!e)return;
  const te=e.querySelector('.msg-time'),be=e.querySelector('.flex');
  e.innerHTML=esc(text).replace(/\n/g,'<br>')+(be?be.outerHTML:'')+(te?te.outerHTML:'');
}

async function delMsg(id){if(!confirm('حذف؟'))return;
  if(API.ws?.readyState===WebSocket.OPEN)API.ws.send(JSON.stringify({type:'delete_message',messageId:id}));
  await fetch(`/api/messages/${id}`,{method:'DELETE',headers:authHeaders()});
}
function editMsg(id,ct){const nt=prompt('ویرایش:',ct.replace(/\\\\'/g,"'"));if(!nt||nt===ct)return;
  if(API.ws?.readyState===WebSocket.OPEN)API.ws.send(JSON.stringify({type:'edit_message',messageId:id,text:nt}));
  fetch(`/api/messages/${id}`,{method:'PUT',headers:authHeaders(),body:JSON.stringify({message:nt})}).catch(()=>{});}

async function sendChatMsg(){
  const inp=document.getElementById('chatModalInput'),text=inp.value.trim();
  if(!text||!API.chatUserId)return;inp.value='';
  if(API.ws?.readyState===WebSocket.OPEN)API.ws.send(JSON.stringify({type:'chat',userId:API.chatUserId,text}));
  else await fetch(`/api/messages/${API.chatUserId}`,{method:'POST',headers:authHeaders(),body:JSON.stringify({message:text})});
}

async function sendChatImage(){
  const f=document.getElementById('chatModalImageInput').files[0];if(!f||!API.chatUserId)return;
  const fd=new FormData();fd.append('image',f);
  try{
    const res=await fetch('/api/upload-image',{method:'POST',headers:{'Authorization':`Bearer ${API.token}`},body:fd});
    const d=await res.json();
    if(API.ws?.readyState===WebSocket.OPEN)API.ws.send(JSON.stringify({type:'chat',userId:API.chatUserId,image:d.url}));
  }catch{}
  document.getElementById('chatModalImageInput').value='';
}

async function markSeen(uid){API.markingSeen=true;try{await fetch(`/api/messages/${uid}/seen`,{method:'POST',headers:authHeaders()});}catch{}API.markingSeen=false;}
function scrollModalChat(){const c=document.getElementById('chatModalMessages');if(c)c.scrollTop=c.scrollHeight;}

async function refreshChatBadge(){
  try{
    const res=await fetch('/api/unread-messages',{headers:authHeaders()});
    const msgs=await res.json();
    const b=document.getElementById('chatBadge');b.style.display=msgs.length?'inline-block':'none';b.textContent=msgs.length;
  }catch{}
}

// ═══ Chat Room ═══
async function loadChatRoom(){
  const c=document.getElementById('chatRoomList');
  try{
    const res=await fetch('/api/chat-room',{headers:authHeaders()});
    const chats=await res.json();
    if(!chats?.length){c.innerHTML='<div class="empty-state"><div class="icon">💬</div><p>هیچ گفتگویی ثبت نشده</p></div>';return;}
    c.innerHTML=chats.map(ch=>`<div class="chat-room-item" onclick="openChatWithUser(${ch.user_id},'${esc(ch.username)}')"><div><strong>👤 ${esc(ch.username)}</strong>${ch.unread>0?`<span class="badge badge-danger">${ch.unread} جدید</span>`:''}<p style="margin-top:6px;color:var(--text-dim);font-size:0.85em;">${ch.last_message?esc(ch.last_message.substring(0,80))+(ch.last_message.length>80?'...':''):'بدون پیام'}</p></div><span style="font-size:0.78em;color:var(--text-muted);">${ch.last_time||''}</span></div>`).join('');
  }catch{c.innerHTML='<p class="text-center text-red">خطا</p>';}
}

// ═══ Backup ═══
async function createBackup(){await fetch('/api/backup/create',{method:'POST',headers:authHeaders()});alert('✅ ذخیره شد');loadBackups();}
async function sendBackupTelegram(){await fetch('/api/backup/send-telegram',{method:'POST',headers:authHeaders()});alert('✅ ارسال شد');}
async function restoreBackup(){
  const f=document.getElementById('restoreFile').files[0];if(!f||!confirm('بازیابی؟'))return;
  const fd=new FormData();fd.append('backup',f);
  const res=await fetch('/api/backup/restore',{method:'POST',headers:{'Authorization':`Bearer ${API.token}`},body:fd});
  const d=await res.json();alert(d.message||'بازیابی شد');
}
async function loadBackups(){
  const c=document.getElementById('backupList');
  try{
    const res=await fetch('/api/backups',{headers:authHeaders()});
    const bs=await res.json();
    if(!bs?.length){c.innerHTML='<p>هیچ بکاپی موجود نیست</p>';return;}
    c.innerHTML=bs.map(b=>`<div class="flex justify-between items-center mb-1" style="padding:8px;background:var(--bg);border-radius:6px;"><span>📦 ${b.name}</span><span style="color:var(--text-dim);">${fmtSize(b.size)}</span><a href="/api/backups/download/${b.name}" class="btn btn-outline btn-sm" download>📥</a></div>`).join('');
  }catch{c.innerHTML='<p class="text-red">خطا</p>';}
}

// ═══ Telegram ═══
async function loadTelegram(){
  const res=await fetch('/api/settings',{headers:authHeaders()});
  const s=await res.json();
  document.getElementById('tgToken').value=s.telegram_token||'';document.getElementById('tgAdminId').value=s.telegram_admin_id||'';
  document.getElementById('proxyUrl').value=s.proxy_url||'';document.getElementById('proxyType').value=s.proxy_type||'http';
}

async function testTelegram(){
  const re=document.getElementById('tgTestResult');
  const t=document.getElementById('tgToken').value,a=document.getElementById('tgAdminId').value;
  if(!t||!a){re.innerHTML='<span class="text-red">توکن و آیدی را وارد کنید</span>';return;}
  re.innerHTML='<div class="spinner"></div>';
  const res=await fetch('/api/telegram/test',{method:'POST',headers:authHeaders(),body:JSON.stringify({token:t,adminId:a})});
  const d=await res.json();
  re.innerHTML=d.ok?`<span class="text-green">✅ @${d.bot?.username||'?'}</span>`:`<span class="text-red">❌ ${d.error}</span>`;
}

async function testProxy(){
  const re=document.getElementById('tgTestResult');
  const pu=document.getElementById('proxyUrl').value,pt=document.getElementById('proxyType').value;
  if(!pu){re.innerHTML='<span class="text-red">آدرس پروکسی را وارد کنید</span>';return;}
  re.innerHTML='<div class="spinner"></div> تست پروکسی...';
  const res=await fetch('/api/telegram/test-proxy',{method:'POST',headers:authHeaders(),body:JSON.stringify({proxyUrl:pu,proxyType:pt})});
  const d=await res.json();
  re.innerHTML=d.ok?`<span class="text-green">✅ پروکسی وصل شد | @${d.bot?.username||'?'}</span>`:`<span class="text-red">❌ ${d.error}</span>`;
}

async function saveTelegram(){
  await fetch('/api/settings',{method:'POST',headers:authHeaders(),body:JSON.stringify({
    telegram_token:document.getElementById('tgToken').value,
    telegram_admin_id:document.getElementById('tgAdminId').value,
    proxy_url:document.getElementById('proxyUrl').value,
    proxy_type:document.getElementById('proxyType').value
  })});
  alert('✅ ذخیره شد');
}

// ═══ Settings ═══
async function loadSettings(){
  const res=await fetch('/api/settings',{headers:authHeaders()});
  const s=await res.json();
  document.getElementById('siteUrl').value=s.site_url||'';
  document.getElementById('panelPath').value=s.panel_path||'panel_h';
  document.getElementById('supportId').value=s.support_id||'';
  updatePanelUrlPreview();
}
function loadSettingsPage(){loadSettings();}
async function saveAllSettings(){
  await fetch('/api/settings',{method:'POST',headers:authHeaders(),body:JSON.stringify({
    site_url:document.getElementById('siteUrl').value,
    panel_path:document.getElementById('panelPath').value,
    support_id:document.getElementById('supportId').value
  })});
  alert('✅ ذخیره شد');updatePanelUrlPreview();
}
function updatePanelUrlPreview(){
  document.getElementById('panelUrlPreview').textContent=`${location.origin}/${document.getElementById('panelPath').value||'panel_h'}`;
}
async function uploadSSL(){
  const cert=document.getElementById('certFile').files[0],key=document.getElementById('keyFile').files[0];
  if(!cert&&!key)return alert('فایلی انتخاب نشده');
  const fd=new FormData();if(cert)fd.append('cert',cert);if(key)fd.append('key',key);
  await fetch('/api/settings/ssl',{method:'POST',headers:{'Authorization':`Bearer ${API.token}`},body:fd});
  alert('✅ آپلود شد');
}

// ═══ Password ═══
async function changePassword(){
  const c=document.getElementById('currentPass').value,n=document.getElementById('newPass').value,r=document.getElementById('passResult');
  if(!c||!n){r.innerHTML='<span class="text-red">هر دو فیلد الزامی است</span>';return;}
  if(n.length<4){r.innerHTML='<span class="text-red">حداقل ۴ کاراکتر</span>';return;}
  try{
    const res=await fetch('/api/change-password',{method:'POST',headers:authHeaders(),body:JSON.stringify({currentPassword:c,newPassword:n})});
    const d=await res.json();
    r.innerHTML=res.ok?'<span class="text-green">✅ تغییر کرد</span>':`<span class="text-red">${d.error}</span>`;
    if(res.ok){document.getElementById('currentPass').value='';document.getElementById('newPass').value='';}
  }catch{r.innerHTML='<span class="text-red">خطا</span>';}
}

function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function fmtSize(b){if(!b)return'0B';const k=1024,ss=['B','KB','MB','GB'];return parseFloat((b/Math.pow(k,ss.findIndex((_,i)=>b<Math.pow(k,i+1)||i===3))).toFixed(1))+' '+ss[ss.findIndex((_,i)=>b<Math.pow(k,i+1)||i===3)];}
