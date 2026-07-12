let userData=null,token='',ws=null,allConfigs=[];
const pathParts=location.pathname.split('/'),uName=pathParts[pathParts.length-1];

async function init(){
  if(!uName)return showErr('آدرس نامعتبر');
  try{
    const res=await fetch('/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:uName})});
    if(!res.ok)return showErr('کاربر یافت نشد');
    const data=await res.json();
    token=data.t…ser;
    localStorage.setItem('token_'+uName,token);
    render();connectWS();loadMsgs();loadCfgs();setInterval(refresh,30000);
  }catch{showErr('خطا در ارتباط');}
}

function showErr(m){document.getElementById('loadingScreen').innerHTML='<p class="text-center text-red">❌ '+m+'</p>';}

function render(){
  document.getElementById('loadingScreen').style.display='none';
  document.getElementById('userPanel').style.display='block';
  document.getElementById('userWelcome').textContent='👋 '+userData.username+' عزیز، خوش آمدید';
  updateInfo();
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
  const sm=document.getElementById('statusMsg');
  if(userData.suspended){
    sm.innerHTML='<div class="card" style="border-color:var(--red);background:rgba(239,68,68,0.1);"><span class="text-red">⛔ اشتراک شما غیرفعال شده است. لطفا با پشتیبانی تماس بگیرید.</span></div>';
  }else if(days<=0&&!userData.unlimited_volume){
    sm.innerHTML='<div class="card" style="border-color:var(--orange);background:rgba(245,158,11,0.1);"><span class="text-orange">⏰ زمان اشتراک شما به پایان رسیده است. در صورت تمایل به تمدید با پشتیبانی تماس بگیرید.</span></div>';
  }else if(parseFloat(vol)<=0&&vol!=='نامحدود'&&vol!=='∞'){
    sm.innerHTML='<div class="card" style="border-color:var(--orange);background:rgba(245,158,11,0.1);"><span class="text-orange">📊 حجم اشتراک شما به پایان رسیده است. در صورت تمایل به شارژ مجدد با پشتیبانی تماس بگیرید.</span></div>';
  }else{sm.innerHTML='';}
}

async function loadCfgs(){
  try{
    const res=await fetch('/api/me/configs',{headers:{'Authorization':`Bearer ${token}`}});
    if(res.ok){const d=await res.json();allConfigs=d.configs||[];document.getElementById('configCount').textContent=d.count+' عدد';}
  }catch{}
  document.getElementById('subUrl').textContent=location.origin+'/sub/'+encodeURIComponent(uName);
}

async function copyAllConfigs(){
  if(!allConfigs.length)return alert('کانفیگی موجود نیست');
  const text=allConfigs.join('\n');
  try{
    await navigator.clipboard.writeText(text);
    const btn=document.getElementById('copyAllBtn');
    btn.innerHTML='<span>✅ کپی شد ('+allConfigs.length+' کانفیگ)</span>';btn.classList.add('copied');
    setTimeout(function(){btn.innerHTML='<span>📋 کپی همه کانفیگ‌ها</span>';btn.classList.remove('copied');},2000);
  }catch{
    const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    alert('✅ کپی شد');
  }
}

function copySubLink(){
  const subUrl=location.origin+'/sub/'+encodeURIComponent(uName);
  navigator.clipboard.writeText(subUrl).catch(function(){});
  const btn=document.getElementById('copySubBtn');
  btn.innerHTML='<span>✅ لینک ساب کپی شد (برای v2ray)</span>';
  setTimeout(function(){btn.innerHTML='<span>🔗 کپی لینک اشتراک (برای نرم‌افزار)</span>';},2000);
}

function toggleChat(){document.getElementById('chatContainer').classList.toggle('open');scrollChat();}

function connectWS(){
  const proto=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(proto+'//'+location.host+'/ws?token='+encodeURIComponent(token)+'&type=user');
  ws.onmessage=function(e){
    const msg=JSON.parse(e.data);
    if(msg.type==='chat'&&msg.senderType==='admin'){appendMsg(msg);document.getElementById('chatContainer').classList.add('open');}
    if(msg.type==='message_deleted')removeMsgEl(msg.messageId);
    if(msg.type==='message_edited')updateMsgEl(msg.messageId,msg.text);
  };
  ws.onclose=function(){setTimeout(connectWS,3000);};
}

async function loadMsgs(){
  try{
    const res=await fetch('/api/me/messages',{headers:{'Authorization':`Bearer ${token}`}});
    const msgs=await res.json();
    document.getElementById('userChatMessages').innerHTML=msgs.map(renderMsg).join('');
    scrollChat();
  }catch{}
}

function renderMsg(m){
  var cls=m.sender_type==='user'?'msg-user':'msg-admin',c='';
  if(m.image)c+='<img src="'+m.image+'" class="msg-image" onclick="window.open(\''+m.image+'\')"/>';
  if(m.message)c+=esc(m.message).replace(/\n/g,'<br>');
  var copyBtn='';
  if(m.sender_type==='admin'&&m.message){
    copyBtn='<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg(\''+esc(m.message).replace(/'/g,"\\'")+'\')">📋 کپی</button>';
  }
  return '<div class="msg-bubble '+cls+'" id="msg-'+m.id+'">'+c+copyBtn+'<div class="msg-time">'+(m.created_at||'')+'</div></div>';
}

function appendMsg(msg){
  var container=document.getElementById('userChatMessages'),div=document.createElement('div');
  div.id='msg-'+msg.id;div.className='msg-bubble '+(msg.senderType==='user'?'msg-user':'msg-admin');
  var c='';
  if(msg.image)c+='<img src="'+msg.image+'" class="msg-image"/>';
  if(msg.message)c+=esc(msg.message).replace(/\n/g,'<br>');
  var copyBtn='';
  if(msg.senderType==='admin'&&msg.message)copyBtn='<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg(\''+esc(msg.message).replace(/'/g,"\\'")+'\')">📋 کپی</button>';
  div.innerHTML=c+copyBtn+'<div class="msg-time">'+(msg.time||'')+'</div>';
  container.appendChild(div);scrollChat();
}

function removeMsgEl(id){var e=document.getElementById('msg-'+id);if(e)e.remove();}
function updateMsgEl(id,text){
  var e=document.getElementById('msg-'+id);if(!e)return;
  var te=e.querySelector('.msg-time');
  var copyBtn=e.classList.contains('msg-admin')&&text?'<button class="btn btn-outline btn-sm" style="padding:2px 8px;margin-top:6px;font-size:0.7em;" onclick="event.stopPropagation();copyMsg(\''+esc(text).replace(/'/g,"\\'")+'\')">📋 کپی</button>':'';
  e.innerHTML=esc(text).replace(/\n/g,'<br>')+copyBtn+(te?te.outerHTML:'');
}

function copyMsg(text){
  navigator.clipboard.writeText(text).catch(function(){});
}

function sendMsg(){
  var input=document.getElementById('chatInput'),text=input.value.trim();
  if(!text)return;input.value='';
  var c=document.getElementById('userChatMessages'),div=document.createElement('div');
  div.className='msg-bubble msg-user';
  div.innerHTML=esc(text).replace(/\n/g,'<br>')+'<div class="msg-time">همین الان</div>';
  c.appendChild(div);scrollChat();
  if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'chat',userId:userData.id,text:text}));
  else fetch('/api/messages/'+userData.id,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({message:text})}).catch(function(){});
}

async function sendImage(){
  var file=document.getElementById('imgInput').files[0];if(!file)return;
  var fd=new FormData();fd.append('image',file);
  try{
    var res=await fetch('/api/upload-image',{method:'POST',headers:{'Authorization':'Bearer '+token},body:fd});
    var data=await res.json();
    if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'chat',userId:userData.id,image:data.url}));
    var c=document.getElementById('userChatMessages'),div=document.createElement('div');
    div.className='msg-bubble msg-user';
    div.innerHTML='<img src="'+data.url+'" class="msg-image"/><div class="msg-time">همین الان</div>';
    c.appendChild(div);scrollChat();
  }catch(e){}
  document.getElementById('imgInput').value='';
}

function scrollChat(){var c=document.getElementById('userChatMessages');if(c)c.scrollTop=c.scrollHeight;}

async function refresh(){
  try{
    var res=await fetch('/api/me',{headers:{'Authorization':'Bearer '+token}});
    if(res.ok){userData=await res.json();updateInfo();}
  }catch(e){}
  try{
    var res=await fetch('/api/me/unread',{headers:{'Authorization':'Bearer '+token}});
    if(res.ok){var d=await res.json(),b=document.getElementById('chatBadge');
      if(d.count>0){b.style.display='inline-block';b.textContent=d.count;}else b.style.display='none';}
  }catch(e){}
}

function esc(s){if(!s)return'';var d=document.createElement('div');d.textContent=s;return d.innerHTML;}
init();
