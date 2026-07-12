let userData=null,token='',ws=null,allConfigs=[];
const pathParts=location.pathname.split("/"),uName=pathParts[pathParts.length-1];

async function init(){
  if(!uName)return showErr("\u0622\u062f\u0631\u0633 \u0646\u0627\u0645\u0639\u062a\u0628\u0631");
  try{
    var res=await fetch("/api/user-login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:uName})});
    if(!res.ok)return showErr("\u06a9\u0627\u0631\u0628\u0631 \u06cc\u0627\u0641\u062a \u0646\u0634\u062f");
    var data=await res.json();
    token=data.token;
    userData=data.user;
    localStorage.setItem("token_"+uName,token);
    render();connectWS();loadMsgs();loadCfgs();setInterval(refresh,30000);
  }catch(e){showErr("\u062e\u0637\u0627 \u062f\u0631 \u0627\u0631\u062a\u0628\u0627\u0637");}
}

function showErr(m){document.getElementById("loadingScreen").innerHTML="<p class=\"text-center text-red\">\u274c "+m+"</p>";}

function render(){
  document.getElementById("loadingScreen").style.display="none";
  document.getElementById("userPanel").style.display="block";
  document.getElementById("userWelcome").textContent="\ud83d\udc4b "+userData.username+" \u0639\u0632\u06cc\u0632\u060c \u062e\u0648\u0634 \u0622\u0645\u062f\u06cc\u062f";
  updateInfo();
}

function updateInfo(){
  var vol=userData.remaining_volume||"0",days=userData.remaining_days||0;
  document.getElementById("remainingVolume").textContent=vol;
  document.getElementById("remainingDays").textContent=days+" \u0631\u0648\u0632";
  document.getElementById("totalVolume").textContent=userData.total_volume||"--";
  var vc=(vol==="\u0646\u0627\u0645\u062d\u062f\u0648\u062f"||vol==="\u221e")?"success":(parseFloat(vol)<=0?"danger":"success");
  var dc=days<=0?"danger":(days<=3?"warning":"success");
  document.getElementById("remainingVolume").className="value "+vc;
  document.getElementById("remainingDays").className="value "+dc;
  var sm=document.getElementById("statusMsg");
  if(userData.suspended){
    sm.innerHTML="<div class=\"card\" style=\"border-color:var(--red);background:rgba(239,68,68,0.1);\"><span class=\"text-red\">\u26d4 \u0627\u0634\u062a\u0631\u0627\u06a9 \u0634\u0645\u0627 \u063a\u06cc\u0631\u0641\u0639\u0627\u0644 \u0634\u062f\u0647 \u0627\u0633\u062a. \u0644\u0637\u0641\u0627 \u0628\u0627 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u062a\u0645\u0627\u0633 \u0628\u06af\u06cc\u0631\u06cc\u062f.</span></div>";
  }else if(days<=0&&!userData.unlimited_volume){
    sm.innerHTML="<div class=\"card\" style=\"border-color:var(--orange);background:rgba(245,158,11,0.1);\"><span class=\"text-orange\">\u23f0 \u0632\u0645\u0627\u0646 \u0627\u0634\u062a\u0631\u0627\u06a9 \u0634\u0645\u0627 \u0628\u0647 \u067e\u0627\u06cc\u0627\u0646 \u0631\u0633\u06cc\u062f\u0647 \u0627\u0633\u062a. \u062f\u0631 \u0635\u0648\u0631\u062a \u062a\u0645\u0627\u06cc\u0644 \u0628\u0647 \u062a\u0645\u062f\u06cc\u062f \u0628\u0627 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u062a\u0645\u0627\u0633 \u0628\u06af\u06cc\u0631\u06cc\u062f.</span></div>";
  }else if(parseFloat(vol)<=0&&vol!=="\u0646\u0627\u0645\u062d\u062f\u0648\u062f"&&vol!=="\u221e"){
    sm.innerHTML="<div class=\"card\" style=\"border-color:var(--orange);background:rgba(245,158,11,0.1);\"><span class=\"text-orange\">\ud83d\udcca \u062d\u062c\u0645 \u0627\u0634\u062a\u0631\u0627\u06a9 \u0634\u0645\u0627 \u0628\u0647 \u067e\u0627\u06cc\u0627\u0646 \u0631\u0633\u06cc\u062f\u0647 \u0627\u0633\u062a. \u062f\u0631 \u0635\u0648\u0631\u062a \u062a\u0645\u0627\u06cc\u0644 \u0628\u0647 \u0634\u0627\u0631\u0698 \u0645\u062c\u062f\u062f \u0628\u0627 \u067e\u0634\u062a\u06cc\u0628\u0627\u0646\u06cc \u062a\u0645\u0627\u0633 \u0628\u06af\u06cc\u0631\u06cc\u062f.</span></div>";
  }else{sm.innerHTML="";}
}

async function loadCfgs(){
  try{
    var res=await fetch("/api/me/configs",{headers:{"Authorization":"Bearer "+token}});
    if(res.ok){var d=await res.json();allConfigs=d.configs||[];document.getElementById("configCount").textContent=d.count+" \u0639\u062f\u062f";}
  }catch(e){}
  document.getElementById("subUrl").textContent=location.origin+"/sub/"+encodeURIComponent(uName);
}

async function copyAllConfigs(){
  if(!allConfigs.length)return alert("\u06a9\u0627\u0646\u0641\u06cc\u06af\u06cc \u0645\u0648\u062c\u0648\u062f \u0646\u06cc\u0633\u062a");
  var text=allConfigs.join("\n");
  try{
    await navigator.clipboard.writeText(text);
    var btn=document.getElementById("copyAllBtn");
    btn.innerHTML="<span>\u2705 \u06a9\u067e\u06cc \u0634\u062f ("+allConfigs.length+" \u06a9\u0627\u0646\u0641\u06cc\u06af)</span>";btn.classList.add("copied");
    setTimeout(function(){btn.innerHTML="<span>\ud83d\udccb \u06a9\u067e\u06cc \u0647\u0645\u0647 \u06a9\u0627\u0646\u0641\u06cc\u06af\u200c\u0647\u0627</span>";btn.classList.remove("copied");},2000);
  }catch(e){
    var ta=document.createElement("textarea");ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand("copy");document.body.removeChild(ta);
    alert("\u2705 \u06a9\u067e\u06cc \u0634\u062f");
  }
}

function copySubLink(){
  var subUrl=location.origin+"/sub/"+encodeURIComponent(uName);
  navigator.clipboard.writeText(subUrl).catch(function(){});
  var btn=document.getElementById("copySubBtn");
  btn.innerHTML="<span>\u2705 \u0644\u06cc\u0646\u06a9 \u0633\u0627\u0628 \u06a9\u067e\u06cc \u0634\u062f (\u0628\u0631\u0627\u06cc v2ray)</span>";
  setTimeout(function(){btn.innerHTML="<span>\ud83d\udd17 \u06a9\u067e\u06cc \u0644\u06cc\u0646\u06a9 \u0627\u0634\u062a\u0631\u0627\u06a9 (\u0628\u0631\u0627\u06cc \u0646\u0631\u0645\u200c\u0627\u0641\u0632\u0627\u0631)</span>";},2000);
}

function toggleChat(){document.getElementById("chatContainer").classList.toggle("open");scrollChat();}

function connectWS(){
  var proto=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(proto+"//"+location.host+"/ws?token="+encodeURIComponent(token)+"&type=user");
  ws.onmessage=function(e){
    var msg=JSON.parse(e.data);
    if(msg.type==="chat"&&msg.senderType==="admin"){appendMsg(msg);document.getElementById("chatContainer").classList.add("open");}
    if(msg.type==="message_deleted")removeMsgEl(msg.messageId);
    if(msg.type==="message_edited")updateMsgEl(msg.messageId,msg.text);
  };
  ws.onclose=function(){setTimeout(connectWS,3000);};
}

async function loadMsgs(){
  try{
    var res=await fetch("/api/me/messages",{headers:{"Authorization":"Bearer "+token}});
    var msgs=await res.json();
    document.getElementById("userChatMessages").innerHTML=msgs.map(renderMsg).join("");
    scrollChat();
  }catch(e){}
}

function renderMsg(m){
  var cls=m.sender_type==="user"?"msg-user":"msg-admin",c="";
  if(m.image)c+="<img src=\""+m.image+"\" class=\"msg-image\" onclick=\"window.open('"+m.image+"')\"/>";
  if(m.message)c+=esc(m.message).replace(/\n/g,"<br>");
  var copyBtn="";
  if(m.sender_type==="admin"&&m.message){
    copyBtn="<button class=\"btn btn-outline btn-sm\" style=\"padding:2px 8px;margin-top:6px;font-size:0.7em;\" onclick=\"event.stopPropagation();copyMsg('"+esc(m.message).replace(/'/g,"\\'")+"')\">\ud83d\udccb \u06a9\u067e\u06cc</button>";
  }
  return "<div class=\"msg-bubble "+cls+"\" id=\"msg-"+m.id+"\">"+c+copyBtn+"<div class=\"msg-time\">"+(m.created_at||"")+"</div></div>";
}

function appendMsg(msg){
  var container=document.getElementById("userChatMessages"),div=document.createElement("div");
  div.id="msg-"+msg.id;div.className="msg-bubble "+(msg.senderType==="user"?"msg-user":"msg-admin");
  var c="";
  if(msg.image)c+="<img src=\""+msg.image+"\" class=\"msg-image\"/>";
  if(msg.message)c+=esc(msg.message).replace(/\n/g,"<br>");
  var copyBtn="";
  if(msg.senderType==="admin"&&msg.message)copyBtn="<button class=\"btn btn-outline btn-sm\" style=\"padding:2px 8px;margin-top:6px;font-size:0.7em;\" onclick=\"event.stopPropagation();copyMsg('"+esc(msg.message).replace(/'/g,"\\'")+"')\">\ud83d\udccb \u06a9\u067e\u06cc</button>";
  div.innerHTML=c+copyBtn+"<div class=\"msg-time\">"+(msg.time||"")+"</div>";
  container.appendChild(div);scrollChat();
}

function removeMsgEl(id){var e=document.getElementById("msg-"+id);if(e)e.remove();}
function updateMsgEl(id,text){
  var e=document.getElementById("msg-"+id);if(!e)return;
  var te=e.querySelector(".msg-time");
  var copyBtn=e.classList.contains("msg-admin")&&text?"<button class=\"btn btn-outline btn-sm\" style=\"padding:2px 8px;margin-top:6px;font-size:0.7em;\" onclick=\"event.stopPropagation();copyMsg('"+esc(text).replace(/'/g,"\\'")+"')\">\ud83d\udccb \u06a9\u067e\u06cc</button>":"";
  e.innerHTML=esc(text).replace(/\n/g,"<br>")+copyBtn+(te?te.outerHTML:"");
}

function copyMsg(text){
  navigator.clipboard.writeText(text).catch(function(){});
}

function sendMsg(){
  var input=document.getElementById("chatInput"),text=input.value.trim();
  if(!text)return;input.value="";
  var c=document.getElementById("userChatMessages"),div=document.createElement("div");
  div.className="msg-bubble msg-user";
  div.innerHTML=esc(text).replace(/\n/g,"<br>")+"<div class=\"msg-time\">\u0647\u0645\u06cc\u0646 \u0627\u0644\u0627\u0646</div>";
  c.appendChild(div);scrollChat();
  if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"chat",userId:userData.id,text:text}));
  else fetch("/api/messages/"+userData.id,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},body:JSON.stringify({message:text})}).catch(function(){});
}

async function sendImage(){
  var file=document.getElementById("imgInput").files[0];if(!file)return;
  var fd=new FormData();fd.append("image",file);
  try{
    var res=await fetch("/api/upload-image",{method:"POST",headers:{"Authorization":"Bearer "+token},body:fd});
    var data=await res.json();
    if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:"chat",userId:userData.id,image:data.url}));
    var c=document.getElementById("userChatMessages"),div=document.createElement("div");
    div.className="msg-bubble msg-user";
    div.innerHTML="<img src=\""+data.url+"\" class=\"msg-image\"/><div class=\"msg-time\">\u0647\u0645\u06cc\u0646 \u0627\u0644\u0627\u0646</div>";
    c.appendChild(div);scrollChat();
  }catch(e){}
  document.getElementById("imgInput").value="";
}

function scrollChat(){var c=document.getElementById("userChatMessages");if(c)c.scrollTop=c.scrollHeight;}

async function refresh(){
  try{
    var res=await fetch("/api/me",{headers:{"Authorization":"Bearer "+token}});
    if(res.ok){userData=await res.json();updateInfo();}
  }catch(e){}
  try{
    var res=await fetch("/api/me/unread",{headers:{"Authorization":"Bearer "+token}});
    if(res.ok){var d=await res.json(),b=document.getElementById("chatBadge");
      if(d.count>0){b.style.display="inline-block";b.textContent=d.count;}else b.style.display="none";}
  }catch(e){}
}

function esc(s){if(!s)return"";var d=document.createElement("div");d.textContent=s;return d.innerHTML;}
init();
