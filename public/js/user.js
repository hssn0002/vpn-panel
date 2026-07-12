let userData=null,token='',ws=null,allConfigs=[];
const pathParts=location.pathname.split('/'),username=pathParts[pathParts.length-1];

async function init(){
  if(!username)return showErr('آدرس نامعتبر');
  try{
    const res=await fetch('/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username})});
    if(!res.ok)return showErr('کاربر یافت نشد');
    const data=await res.json();
    token=data.token;userData=data.user;
    localStorage.setItem('token_'+username,token);
    render();connectWS();loadMessages();loadConfigs();setInterval(refresh,30000);
  }catch{showErr('خطا در ارتباط');}
}

function showErr(m){document.getElementById('loadingScreen').innerHTML=`<p class="text-center text-red">❌ ${m}</p>`;}

function render(){
  document.getElementById('loadingScreen').style.display='none';
  document.getElementById('userPanel').style.display='block';
  document.getElementById('userWelcome').textContent=`👋 ${userData.username} عزیز، خوش آمدید`;
  updateInfo();
  // Support ID
  if(userData.support_id)document.getElementById('supportId').textContent=userData.support_id;
}

function updateInfo(){
  const vol=userData.remaining_volume||'0',days=userData.remaining_days||0;
  document.getElementById('remainingVolume').textContent=vol;
  document.getElementById('remainingDays').textContent=days+' روز';
  document.getElementById('totalVolume').textContent=userData.total_volume||'--';
  const vc=(vol==='نامحدود'||vol==='∞')?'success':(parseFloat(vol)<=0?'danger':'success');
  const dc=days<=0?'danger':(days<=3?'warning':'success');
  document.getElementById('remainingVolume').className='value '+vc;
  document.getElementById('remainingDays').className='value '+dc;
  
  // Status message
  const sm=document.getElementById('statusMsg');
  if(userData.suspended){
    sm.innerHTML='<div class="card" style="border-color:var(--red);background:rgba(239,68,68,0.1);"><span class="text-red">⛔ اشتراک شما غیرفعال شده است. لطفا با پشتیبانی تماس بگیرید.</span></div>';
  }else if(days<=0&&!userData.unlimited_volume){
    sm.innerHTML='<div class="card" style="border-color:var(--orange);background:rgba(245,158,11,0.1);"><span class="text-orange">⏰ زمان اشتراک شما به پایان رسیده است. در صورت تمایل به تمدید با پشتیبانی تماس بگیرید.</span></div>';
  }else if(parseFloat(vol)<=0&&vol!=='نامحدود'&&vol!=='∞'){
    sm.innerHTML='<div class="card" style="border-color:var(--orange);background:rgba(245,158,11,0.1);"><span class="text-orange">📊 حجم اشتراک شما به پایان رسیده است. در صورت تمایل به شارژ مجدد با پشتیبانی تماس بگیرید.</span></div>';
  }else{sm.innerHTML='';}
}

async function loadConfigs(){
  try{
    const res=await fetch('/api/me/configs',{headers:{'Authorization':`Bearer ${token}`}});
    if(res.ok){
      const d=await res.json();
      allConfigs=d.configs||[];
      document.getElementById('configCount').textContent=d.count+' عدد';
    }
  }catch{}
}

async function copyAllConfigs(){
  if(!allConfigs.length)return alert('کانفیگی موجود نیست');
  const text=allConfigs.join('\n');
  try{
    await navigator.clipboard.writeText(text);
    const btn=document.getElementById('copyAllBtn');
    btn.innerHTML='<span>✅ کپی شد! ('+allConfigs.length+' کانفیگ)</span>';
    btn.classList.add('copied');
    setTimeout(()=>{btn.innerHTML='<span>📋 کپی همه کانفیگ‌ها</span>';btn.classList.remove('copied');},2000);
  }catch{
    const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    alert('✅ کپی شد!');
  }
}

function copySubLink(){
  navigator.clipboard.writeText(location.href).catch(()=>{});
  const btn=document.getElementById('copySubBtn');
  btn.innerHTML='<span>✅ لینک کپی شد</span>';
  setTimeout(()=>btn.innerHTML='<span>🔗 کپی لینک اشتراک</span>',2000);
}

// Chat
function toggleChat(){document.getElementById('chatContainer').classList.toggle('open');scrollChat();}

function connectWS(){
  const proto=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(`${proto}//${location.host}/ws?token=${encodeURIComponent(token)}&type=user`);
  ws.onmessage=e=>{
    const msg=JSON.parse(e.data);
    if(msg.type==='chat'&&msg.senderType==='admin'){appendMsg(msg);document.getElementById('chatContainer').classList.add('open');}
    if(msg.type==='message_deleted')removeMsgEl(msg.messageId);
    if(msg.type==='message_edited')updateMsgEl(msg.messageId,msg.text);
  };
  ws.onclose=()=>setTimeout(connectWS,3000);
}

async function loadMessages(){
  try{
    const res=await fetch('/api/me/messages',{headers:{'Authorization':`Bearer ${token}`}});
    const msgs=await res.json();
    document.getElementById('userChatMessages').innerHTML=msgs.map(renderMsg).join('');
    scrollChat();
  }catch{}
}

function renderMsg(m){
  const cls=m.sender_type==='user'?'msg-user':'msg-admin';
  let c='';
  if(m.image)c+=`<img src="${m.image}" class="msg-image" onclick="window.open('${m.image}')"/>`;
  if(m.message)c+=esc(m.message).replace(/\n/g,'<br>');
  let copyBtn='';
  if(m.sender_type==='admin'&&m.message){
    copyBtn=`<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg(\`${esc(m.message).replace(/`/g,'\\`').replace(/'/g,"\\'")}\`)">📋 کپی</button>`;
  }
  return `<div class="msg-bubble ${cls}" id="msg-${m.id}">${c}${copyBtn}<div class="msg-time">${m.created_at||''}</div></div>`;
}

function appendMsg(msg){
  const container=document.getElementById('userChatMessages');
  const div=document.createElement('div');div.id='msg-'+msg.id;
  div.className='msg-bubble '+(msg.senderType==='user'?'msg-user':'msg-admin');
  let c='';
  if(msg.image)c+=`<img src="${msg.image}" class="msg-image"/>`;
  if(msg.message)c+=esc(msg.message).replace(/\n/g,'<br>');
  let copyBtn='';
  if(msg.senderType==='admin'&&msg.message){
    copyBtn=`<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg(\`${esc(msg.message).replace(/`/g,'\\`').replace(/'/g,"\\'")}\`)">📋 کپی</button>`;
  }
  div.innerHTML=c+copyBtn+`<div class="msg-time">${msg.time||''}</div>`;
  container.appendChild(div);scrollChat();
}

function removeMsgEl(id){const e=document.getElementById('msg-'+id);if(e)e.remove();}
function updateMsgEl(id,text){
  const e=document.getElementById('msg-'+id);if(!e)return;
  const timeEl=e.querySelector('.msg-time');
  let copyBtn='';
  if(e.classList.contains('msg-admin')&&text){
    copyBtn=`<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg(\`${esc(text).replace(/`/g,'\\`').replace(/'/g,"\\'")}\`)">📋 کپی</button>`;
  }
  e.innerHTML=esc(text).replace(/\n/g,'<br>')+copyBtn+(timeEl?timeEl.outerHTML:'');
}

async function copyMsg(text){
  try{await navigator.clipboard.writeText(text);}catch{
    const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
  }
}

function sendMsg(){
  const input=document.getElementById('chatInput'),text=input.value.trim();
  if(!text)return;input.value='';
  const c=document.getElementById('userChatMessages');
  const div=document.createElement('div');div.className='msg-bubble msg-user';
  div.innerHTML=esc(text).replace(/\n/g,'<br>')+'<div class="msg-time">همین الان</div>';
  c.appendChild(div);scrollChat();
  if(ws&&ws.readyState===WebSocket.OPEN){
    ws.send(JSON.stringify({type:'chat',userId:userData.id,text}));
  }else{
    fetch(`/api/messages/${userData.id}`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({message:text})}).catch(()=>{});
  }
}

async function sendImage(){
  const file=document.getElementById('imgInput').files[0];if(!file)return;
  const fd=new FormData();fd.append('image',file);
  try{
    const res=await fetch('/api/upload-image',{method:'POST',headers:{'Authorization':`Bearer ${token}`},body:fd});
    const data=await res.json();
    if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'chat',userId:userData.id,image:data.url}));
    const c=document.getElementById('userChatMessages');
    const div=document.createElement('div');div.className='msg-bubble msg-user';
    div.innerHTML=`<img src="${data.url}" class="msg-image"/><div class="msg-time">همین الان</div>`;
    c.appendChild(div);scrollChat();
  }catch{}
  document.getElementById('imgInput').value='';
}

function scrollChat(){const c=document.getElementById('userChatMessages');if(c)c.scrollTop=c.scrollHeight;}

async function refresh(){
  try{
    const res=await fetch('/api/me',{headers:{'Authorization':`Bearer ${token}`}});
    if(res.ok){userData=await res.json();updateInfo();}
  }catch{}
  try{
    const res=await fetch('/api/me/unread',{headers:{'Authorization':`Bearer ${token}`}});
    if(res.ok){const d=await res.json();
      const b=document.getElementById('chatBadge');
      if(d.count>0){b.style.display='inline-block';b.textContent=d.count;}else b.style.display='none';
    }
  }catch{}
}

function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
init();
