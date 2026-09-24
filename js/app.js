(function(){
"use strict";
/* =================================================================
   PLD Spelling Activities
   ================================================================= */
const DATA = window.PLD_DATA;
const CONTENT = window.CONTENT || {};
const CONFIG = window.APP_CONFIG || {};
const ROOMS = {};
(window.CLASS_LISTS||[]).forEach(r=>{ ROOMS[r.room] = r.students.slice().sort((a,b)=>a.classNumber-b.classNumber); });

const $ = (s,r=document)=>r.querySelector(s);
const app = $('#app');
const esc = s => String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shuffle = a => { a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const store = {
  get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }
};

/* ---------- state ---------- */
const SESSION_KEY='pldSpell.session.v2';
const BLANK={role:null,room:null,student:null,firstName:null,classNumber:null,term:null,stage:null,week:null,stageLocked:false,screen:'role'};
let S=Object.assign({},BLANK,store.get(SESSION_KEY,{}));
if(S.role!=='student'||!S.student) S=Object.assign({},BLANK);
function save(){ if(S.role==='student') store.set(SESSION_KEY,S); }
let teacher=null;            // {room,password} – kept in memory only, never saved on the device
let screenAC=null;           // aborts screen-level listeners on navigation

/* ---------- Google Sheet connection ---------- */
const API={
  has(){ return !!String(CONFIG.SHEETS_URL||'').trim(); },
  async call(method,payload){
    const url=String(CONFIG.SHEETS_URL||'').trim();
    if(!url) throw Object.assign(new Error('The Google Sheet link is not set up in js/config.js.'),{kind:'nourl'});
    const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),20000);
    let res;
    try{
      res = method==='GET'
        ? await fetch(url+'?'+new URLSearchParams(payload),{signal:ctl.signal})
        : await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),signal:ctl.signal});
    }catch(e){ throw Object.assign(new Error("Couldn't reach the Google Sheet. Check the internet connection and try again."),{kind:'network'}); }
    finally{ clearTimeout(t); }
    let j; try{ j=await res.json(); }catch(e){ throw Object.assign(new Error('The Google Sheet sent back something unexpected. Check the Apps Script deployment.'),{kind:'network'}); }
    if(!j.ok) throw Object.assign(new Error(j.error||'The Google Sheet returned an error.'),{kind:'server'});
    return j;
  },
  get(p){ return this.call('GET',p); },
  post(p){ return this.call('POST',p); }
};

/* ---------- progress (assessed activities) ---------- */
const ASSESSED=['testEasy','defEasy','clozeEasy','testHard','defHard','clozeHard'];
const DONE_KEY='pldSpell.done.v2', PEND_KEY='pldSpell.pending.v1', STAGE_KEY='pldSpell.stages.v1';
const pkey=(term,stage,week)=>[S.room,S.classNumber,term,stage,week].join('|');
function markDone(r){
  const m=store.get(DONE_KEY,{}); const k=pkey(r.term,r.stage,r.week);
  m[k]=m[k]||{}; const prev=m[k][r.activity];
  if(!prev||r.score/r.total>prev.score/prev.total) m[k][r.activity]={score:r.score,total:r.total};
  store.set(DONE_KEY,m);
}
function weekDone(){ return store.get(DONE_KEY,{})[pkey(S.term,S.stage,S.week)]||{}; }
function medalFor(n){ return n>=6?'gold':n>=4?'silver':n>=2?'bronze':null; }
const isPerfect=d=>!!d&&d.total>0&&d.score===d.total;
function perfectCount(done){ return ASSESSED.filter(a=>isPerfect(done[a])).length; }   // number of activities at 100%
function recordResult(activity,score,total){
  const rec={action:'addResult',id:Date.now().toString(36)+Math.random().toString(36).slice(2,8),timestamp:new Date().toISOString(),
    room:S.room,classNumber:S.classNumber,student:S.student,term:S.term,stage:S.stage,week:S.week,list:(weekData()||{}).l||'',activity,score,total};
  markDone(rec);
  const q=store.get(PEND_KEY,[]); q.push(rec); store.set(PEND_KEY,q);
  flushResults();
}
let flushing=false;
async function flushResults(){
  if(flushing||!API.has()) return; flushing=true;
  try{
    while(true){
      const q=store.get(PEND_KEY,[]); if(!q.length) break;
      try{ await API.post(q[0]); }
      catch(e){ if(e.kind!=='server') break; }          // network problem: keep it and try again later
      const q2=store.get(PEND_KEY,[]); if(q2.length&&q2[0].id===q[0].id){ q2.shift(); store.set(PEND_KEY,q2); }
    }
  } finally { flushing=false; }
}
async function syncProgress(){
  if(!API.has()||!S.term||S.classNumber==null) return false;
  const j=await API.get({action:'getResults',room:S.room,classNumber:S.classNumber,term:S.term});
  const m=store.get(DONE_KEY,{}); const pre=[S.room,S.classNumber,S.term].join('|')+'|';
  Object.keys(m).forEach(k=>{ if(k.startsWith(pre)) delete m[k]; }); store.set(DONE_KEY,m);
  (j.results||[]).forEach(r=>markDone(Object.assign({},r,{term:S.term})));
  store.get(PEND_KEY,[]).filter(r=>r.room===S.room&&r.classNumber===S.classNumber&&r.term===S.term).forEach(markDone);
  return true;
}
async function resolveStage(){
  const cache=store.get(STAGE_KEY,{}); const ck=S.room+'|'+S.term;
  let checked=false;
  try{
    if(API.has()){
      const j=await API.get({action:'getStages',room:S.room,term:S.term});
      const map={}; (j.stages||[]).forEach(s=>map[s.classNumber]=s.stage); cache[ck]=map; store.set(STAGE_KEY,cache); checked=true;
    }
  }catch(e){}
  const st=(cache[ck]||{})[S.classNumber]||null;
  if(st){ S.stage=+st; S.stageLocked=true; }
  else { S.stage=null; S.stageLocked=false; }
  save();
  return st?'ready':(checked||(ck in cache)?'unassigned':'offline');
}

/* ---------- data helpers ---------- */
function weekData(){ const st=DATA[S.stage]; return st ? (st.weeks[S.term+'-'+S.week]||null) : null; }
function listData(){ const w=weekData(); return w&&w.l ? DATA[S.stage].lists[w.l] : null; }
function passageData(){ const w=weekData(); return w&&w.p!=null ? DATA[S.stage].passages[w.p] : null; }
function chunk(wordArr,{colour=true}={}){
  const pal=DATA[S.stage].pal;
  if(!colour) return '<span class="chunk-word" style="color:#1a1a1a">'+esc(wordArr[0])+'</span>';
  return '<span class="chunk-word">'+wordArr[1].map(([t,c])=>'<span style="color:'+(pal[c]||'#1a1a1a')+'">'+esc(t)+'</span>').join('')+'</span>';
}
function contentFor(word){ const c=CONTENT[S.stage]||{}; return c[word]||null; }
function same(given,target){
  const g=String(given).trim().replace(/\s+/g,' '), t=String(target).trim();
  return /[A-Z]/.test(t) ? g===t : g.toLowerCase()===t.toLowerCase();   // capitals only count for words that need them
}
function toks(s){ return String(s).trim().split(/\s+/).filter(Boolean); }
function lcs(a,b){
  const n=a.length,m=b.length, dp=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  const ma=new Array(n).fill(false), mb=new Array(m).fill(false); let i=0,j=0;
  while(i<n&&j<m){ if(a[i]===b[j]){ma[i]=mb[j]=true;i++;j++;} else if(dp[i+1][j]>=dp[i][j+1]) i++; else j++; }
  return {ma,mb};
}
function countMistakes(correct,given){
  const c=toks(correct), g=toks(given), r=lcs(c,g);
  return Math.max(r.ma.filter(x=>!x).length, r.mb.filter(x=>!x).length);   // a changed word counts once; extra or missing words count too
}

/* ---------- speech ---------- */
let voice=null;
function pickVoice(){ const vs=speechSynthesis.getVoices(); voice=vs.find(v=>/en-AU/i.test(v.lang))||vs.find(v=>/en-GB/i.test(v.lang))||vs.find(v=>/^en/i.test(v.lang))||null; }
if('speechSynthesis' in window){ pickVoice(); speechSynthesis.onvoiceschanged=pickVoice; }
function utter(text,rate){ const u=new SpeechSynthesisUtterance(text); if(voice) u.voice=voice; u.lang=voice?voice.lang:'en-AU'; u.rate=rate||0.85; return u; }
function speak(text,rate){ if(!('speechSynthesis' in window)) return; speechSynthesis.cancel(); speechSynthesis.speak(utter(text,rate)); }
function stopSpeech(){ if('speechSynthesis' in window) speechSynthesis.cancel(); }

/* ---------- on-screen text field ---------- */
function TextField(el,opts={}){
  const f={el,value:opts.value||'',caret:(opts.value||'').length,active:false};
  el.classList.add('tf'); if(opts.multiline) el.classList.add('multi');
  el.setAttribute('role','textbox'); el.setAttribute('aria-label',opts.label||'Answer'); 
  f.render=function(){
    const v=f.value; let h='';
    for(let i=0;i<=v.length;i++){
      if(i===f.caret) h+='<span class="caret" aria-hidden="true"></span>';
      if(i<v.length) h+='<span data-i="'+i+'">'+esc(v[i])+'</span>';
    }
    if(!v.length&&opts.placeholder) h+='<span class="ph">'+esc(opts.placeholder)+'</span>';
    el.innerHTML=h;
    if(f.active){ const c=el.querySelector('.caret'); if(c&&c.scrollIntoView) c.scrollIntoView({block:'nearest'}); }
  };
  const changed=()=>{ f.render(); if(opts.onChange) opts.onChange(f.value); };
  f.set=v=>{ f.value=v; f.caret=v.length; changed(); };
  f.insert=s=>{ f.value=f.value.slice(0,f.caret)+s+f.value.slice(f.caret); f.caret+=s.length; changed(); };
  f.back=()=>{ if(!f.caret) return; f.value=f.value.slice(0,f.caret-1)+f.value.slice(f.caret); f.caret--; changed(); };
  f.move=d=>{ f.caret=Math.max(0,Math.min(f.value.length,f.caret+d)); f.render(); };
  el.addEventListener('pointerdown',e=>{
    e.preventDefault();
    const sp=e.target.closest('[data-i]');
    if(sp){ const r=sp.getBoundingClientRect(); const i=+sp.dataset.i; f.caret=e.clientX>r.left+r.width/2?i+1:i; }
    else f.caret=f.value.length;
    KB.attach(f); f.render();
  });
  f.render();
  return f;
}

/* ---------- on-screen keyboard (no predictive text) ---------- */
const KB={el:null,field:null,mode:'word',layer:'abc',shift:false,onEnter:null,
  show(field,mode,onEnter){
    this.mode=mode||'word'; this.layer='abc'; this.shift=false; this.onEnter=onEnter||null;
    if(!this.el){
      this.el=document.createElement('div'); this.el.id='kb'; this.el.setAttribute('role','group'); this.el.setAttribute('aria-label','Keyboard');
      this.el.addEventListener('pointerdown',e=>this.press(e));
      document.body.appendChild(this.el);
    }
    this.attach(field); this.draw(); document.body.classList.add('kb-open');
  },
  attach(field){
    if(this.field&&this.field!==field){ this.field.active=false; this.field.el.classList.remove('active'); this.field.render(); }
    this.field=field; field.active=true; field.el.classList.add('active');
  },
  hide(){
    if(this.el) this.el.remove(); this.el=null; this.field=null; this.onEnter=null;
    document.body.classList.remove('kb-open'); document.documentElement.style.setProperty('--kbh','0px');
  },
  rows(){
    const L=['qwertyuiop'.split(''),'asdfghjkl'.split(''),['shift',...'zxcvbnm'.split(''),'back']];
    if(this.layer==='sym') return [['1','2','3','4','5','6','7','8','9','0'],['-',':',';','(',')','"',"'",'%'],['?','!',',','.','back'],['abc','space','left','right']];
    if(this.mode==='passage') return [...L,['sym',',','space','.','left','right']];
    return [...L,["'",'-','space','left','right']];
  },
  label(k){ return ({shift:'⇧',back:'⌫',space:'space',left:'◀',right:'▶',sym:'123 ?!',abc:'abc'})[k] || (this.shift&&/^[a-z]$/.test(k)?k.toUpperCase():k); },
  aria(k){ return ({shift:'Shift',back:'Delete',space:'Space',left:'Move left',right:'Move right',sym:'Numbers and punctuation',abc:'Letters'})[k]||k; },
  draw(){
    if(!this.el) return;
    this.el.innerHTML='<div class="kb-inner">'+this.rows().map(r=>'<div class="kb-row">'+r.map(k=>
      '<button type="button" class="key k-'+(k.length>1?k:'c')+(k==='shift'&&this.shift?' on':'')+'" data-k="'+esc(k)+'" aria-label="'+esc(this.aria(k))+'">'+esc(this.label(k))+'</button>').join('')+'</div>').join('')+'</div>';
    requestAnimationFrame(()=>{ if(this.el) document.documentElement.style.setProperty('--kbh',this.el.offsetHeight+'px'); });
  },
  key(k){
    const f=this.field; if(!f) return;
    switch(k){
      case 'shift': this.shift=!this.shift; this.draw(); return;
      case 'back': f.back(); return;
      case 'space': f.insert(' '); return;
      case 'left': f.move(-1); return;
      case 'right': f.move(1); return;
      case 'sym': this.layer='sym'; this.draw(); return;
      case 'abc': this.layer='abc'; this.draw(); return;
      default:
        f.insert(this.shift&&/^[a-z]$/.test(k)?k.toUpperCase():k);
        if(this.shift){ this.shift=false; this.draw(); }
    }
  },
  press(e){ const b=e.target.closest('[data-k]'); if(!b) return; e.preventDefault(); this.key(b.dataset.k); }
};
// typing on a physical or native keyboard is deliberately ignored: students must use the on-screen keys

/* ---------- dialog + toast ---------- */
function confirmDlg(message,yes,no){
  return new Promise(res=>{
    const d=document.createElement('div'); d.className='modal';
    d.innerHTML='<div class="dlg" role="alertdialog" aria-modal="true"><p>'+message+'</p><div class="tools"><button class="btn primary" data-r="1">'+esc(yes)+'</button><button class="btn" data-r="0">'+esc(no)+'</button></div></div>';
    d.addEventListener('click',e=>{ const b=e.target.closest('[data-r]'); if(!b) return; d.remove(); res(b.dataset.r==='1'); });
    document.body.appendChild(d); d.querySelector('[data-r="1"]').focus();
  });
}
function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.setAttribute('role','status'); t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),4000); }

/* ---------- top bar ---------- */
const topbar=$('#topbar');
function updateTopbar(){
  topbar.classList.toggle('hidden', !(S.role==='student'&&S.student&&S.screen!=='studentLogin'));
  $('#tbName').textContent=(S.firstName||S.student||'Name')+' ▾';
  $('#tbTerm').textContent='Term '+(S.term||'–')+' ▾';
  $('#tbWeek').textContent='Week '+(S.week||'–')+' ▾';
}
function closeDD(){ document.querySelectorAll('.dd').forEach(d=>d.remove()); document.querySelectorAll('.tb>button').forEach(b=>b.setAttribute('aria-expanded','false')); }
topbar.addEventListener('click',e=>{
  const b=e.target.closest('.tb>button'); if(!b) return;
  const tb=b.parentElement, k=tb.dataset.k;
  const wasOpen=b.getAttribute('aria-expanded')==='true'; closeDD();
  if(k==='progress'){ go('progress'); return; }
  if(wasOpen) return;
  const dd=document.createElement('div'); dd.className='dd';
  if(k==='name') dd.innerHTML='<button class="logout" style="padding:0 16px">Log Out</button>';
  else{
    const range={term:[1,4],week:[1,9]}[k];
    for(let i=range[0];i<=range[1];i++){
      dd.insertAdjacentHTML('beforeend','<button data-v="'+i+'" class="'+(S[k]==i?'sel':'')+'">'+i+'</button>');
    }
  }
  dd.addEventListener('click',async ev=>{
    ev.stopPropagation();
    const o=ev.target.closest('button'); if(!o||o.disabled) return;
    if(o.classList.contains('logout')){ closeDD(); logout(); return; }
    S[k]=+o.dataset.v; closeDD(); save();
    if(k==='term'){ updateTopbar(); await resolveStage(); }
    go(S.term&&S.stage&&S.stageLocked&&S.week?'menu':'calib');
  });
  tb.appendChild(dd); b.setAttribute('aria-expanded','true');
});
document.addEventListener('click',e=>{ if(!e.target.closest('.tb')) closeDD(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDD(); });
function logout(){ stopAll(); S=Object.assign({},BLANK); teacher=null; try{localStorage.removeItem(SESSION_KEY);}catch(e){} go('role'); }

/* ---------- router ---------- */
let timers=[]; function clearTimers(){ timers.forEach(t=>{clearInterval(t);clearTimeout(t);}); timers=[]; }
let reader=null;
function stopAll(){ stopSpeech(); clearTimers(); if(reader){ reader.stop(); reader=null; } KB.hide(); if(screenAC){ screenAC.abort(); screenAC=null; } }
const SCREENS={};
function go(screen,arg){
  stopAll(); screenAC=new AbortController();
  S.screen=screen; save(); updateTopbar(); window.scrollTo(0,0);
  if(SCREENS[screen]) SCREENS[screen](arg);
  else if(ACTS[screen]) ACTS[screen]();
}

/* ---------- login ---------- */
SCREENS.role=function(){
  app.innerHTML=`<div class="centre"><h1>Spelling time</h1><p class="muted" style="margin-bottom:28px">Who is logging in?</p>
  <div class="rolegrid"><button class="tile role" id="rStu"><span class="ic" aria-hidden="true">🎒</span><span class="nm">Student</span></button>
  <button class="tile role" id="rTch"><span class="ic" aria-hidden="true">🍎</span><span class="nm">Teacher</span></button></div></div>`;
  $('#rStu').onclick=()=>go('studentLogin'); $('#rTch').onclick=()=>go('teacherLogin');
};
function roomOptions(sel){ const rooms=Object.keys(ROOMS); return '<option value="">Choose a room…</option>'+rooms.map(r=>`<option ${(sel===r||rooms.length===1)?'selected':''}>${esc(r)}</option>`).join(''); }
SCREENS.studentLogin=function(){
  app.innerHTML=`<div class="centre"><h1>Student log in</h1><p class="muted" style="margin-bottom:26px">Find your room, then your name.</p>
  <div class="home">
    <div class="field"><label for="room">Select room</label><select id="room">${roomOptions(S.room)}</select></div>
    <div class="field"><label for="stu">Select student</label><select id="stu" disabled><option value="">Choose your name…</option></select></div>
    <div class="tools"><button class="btn" id="back">Back</button><button class="btn primary" id="goCal" disabled>That's me</button></div>
  </div></div>`;
  const room=$('#room'), stu=$('#stu'), btn=$('#goCal');
  function fill(){
    const names=ROOMS[room.value]||[];
    stu.innerHTML='<option value="">Choose your name…</option>'+names.map(n=>`<option value="${n.classNumber}">${esc(n.displayName)}</option>`).join('');
    stu.disabled=!names.length; btn.disabled=true;
  }
  room.onchange=fill; stu.onchange=()=>btn.disabled=!stu.value; if(room.value) fill();
  $('#back').onclick=()=>go('role');
  btn.onclick=()=>{
    const s=ROOMS[room.value].find(n=>String(n.classNumber)===stu.value);
    Object.assign(S,BLANK,{role:'student',room:room.value,student:s.displayName,firstName:s.firstName,classNumber:s.classNumber});
    go('calib');
  };
};
SCREENS.teacherLogin=function(){
  app.innerHTML=`<div class="centre"><h1>Teacher log in</h1>
  <div class="home" style="margin-top:20px">
    <div class="field"><label for="room">Select room</label><select id="room">${roomOptions()}</select></div>
    <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" class="pw"></div>
    <div class="fb bad" id="err" role="alert"></div>
    <div class="tools"><button class="btn" id="back">Back</button><button class="btn primary" id="login">Log in</button></div>
  </div></div>`;
  $('#back').onclick=()=>go('role');
  const submit=async()=>{
    const room=$('#room').value, pw=$('#pw').value, err=$('#err'), btn=$('#login');
    if(!room){ err.textContent='Choose a room first.'; return; }
    if(!pw){ err.textContent='Enter the teacher password.'; return; }
    btn.disabled=true; btn.textContent='Checking…'; err.textContent='';
    try{ await API.post({action:'teacherLogin',password:pw}); teacher={room,password:pw}; go('teacherHome'); }
    catch(e){ err.textContent=e.kind==='server'?'That password is not right.':e.message; btn.disabled=false; btn.textContent='Log in'; }
  };
  $('#login').onclick=submit; $('#pw').onkeydown=e=>{ if(e.key==='Enter') submit(); };
};

/* ---------- teacher ---------- */
SCREENS.teacherHome=function(msg){
  if(!teacher) return go('teacherLogin');
  app.innerHTML=`<div class="act-head"><div><div class="crumb">Teacher</div><h2>${esc(teacher.room)}</h2></div><button class="btn small" id="out">Log out</button></div>
  <div class="grid single"><button class="tile" id="setSt"><span class="ic" aria-hidden="true">🗂️</span><span class="nm">Set Student Stages</span></button>
  <button class="tile" id="seeProg"><span class="ic" aria-hidden="true">📊</span><span class="nm">See Student Progress</span></button></div>`;
  $('#out').onclick=()=>{ teacher=null; go('role'); };
  $('#setSt').onclick=()=>go('stagesTerm');
  $('#seeProg').onclick=()=>go('teacherData');
  if(msg) toast(msg);
};
SCREENS.stagesTerm=function(){
  if(!teacher) return go('teacherLogin');
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(teacher.room)}</div><h2>Set student stages</h2></div><button class="btn small" id="back">Back</button></div>
  <div class="cal-group centre"><h3>Which term?</h3><div class="btnrow" id="terms">${[1,2,3,4].map(t=>`<button class="btn" data-v="${t}">${t}</button>`).join('')}</div></div>
  <div id="msg" role="status"></div>`;
  $('#back').onclick=()=>go('teacherHome');
  $('#terms').onclick=async e=>{
    const b=e.target.closest('button'); if(!b) return; const term=+b.dataset.v;
    $('#terms').querySelectorAll('button').forEach(x=>{x.classList.toggle('sel',x===b);x.disabled=true;});
    $('#msg').innerHTML='<p class="muted">Loading Term '+term+'…</p>';
    try{
      const j=await API.get({action:'getStages',room:teacher.room,term});
      const existing={}; (j.stages||[]).forEach(s=>existing[s.classNumber]=s.stage);
      if(Object.keys(existing).length){
        const ok=await confirmDlg(`<b>Stages have already been set for Term ${term}.</b><br>Changing a student's stage will reset their activity progress for this term.`,'Continue','Cancel');
        if(!ok){ $('#terms').querySelectorAll('button').forEach(x=>{x.disabled=false;x.classList.remove('sel');}); $('#msg').innerHTML=''; return; }
      }
      go('stagesBoard',{term,existing});
    }catch(err){
      $('#msg').innerHTML='<div class="notice">'+esc(err.message)+'</div>';
      $('#terms').querySelectorAll('button').forEach(x=>x.disabled=false);
    }
  };
};
SCREENS.stagesBoard=function({term,existing}){
  if(!teacher) return go('teacherLogin');
  const students=ROOMS[teacher.room]||[];
  const assign={}; students.forEach(s=>assign[s.classNumber]=existing[s.classNumber]?+existing[s.classNumber]:null);
  let selected=null;
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(teacher.room)}, Term ${term}</div><h2>Set student stages</h2></div><button class="btn small" id="cancel">Cancel</button></div>
  <p>Drag each student into their stage. You can also tap a student, then tap a stage.</p>
  <div id="board">
    <div class="pool zone" data-z=""></div>
    <div class="tbl-wrap"><table class="stagetbl"><thead><tr>${[2,3,4,5,6].map(s=>`<th>Stage ${s} <span class="cnt" data-cnt="${s}"></span></th>`).join('')}</tr></thead>
    <tbody><tr>${[2,3,4,5,6].map(s=>`<td class="zone" data-z="${s}"></td>`).join('')}</tr></tbody></table></div>
  </div>
  <div class="fb bad" id="err" role="alert"></div>
  <div class="tools"><button class="btn primary" id="setBtn">Set Stages</button></div>`;
  const board=$('#board');
  const tile=s=>`<div class="stile${selected===s.classNumber?' picked':''}" data-c="${s.classNumber}">${esc(s.displayName)}</div>`;
  function draw(){
    board.querySelectorAll('.zone').forEach(z=>{
      const v=z.dataset.z?+z.dataset.z:null;
      const list=students.filter(s=>assign[s.classNumber]===v);
      z.innerHTML=list.map(tile).join('')||(v===null?'<p class="muted empty">Every student has a stage.</p>':'');
    });
    [2,3,4,5,6].forEach(s=>{ board.querySelector(`[data-cnt="${s}"]`).textContent='('+students.filter(x=>assign[x.classNumber]===s).length+')'; });
  }
  draw();
  let drag=null; const sig={signal:screenAC.signal};
  const zoneAt=(x,y)=>{ const el=document.elementFromPoint(x,y); return el?el.closest('#board .zone'):null; };
  board.addEventListener('pointerdown',e=>{
    const t=e.target.closest('.stile');
    if(!t){ const z=e.target.closest('.zone'); if(z&&selected!==null){ assign[selected]=z.dataset.z?+z.dataset.z:null; selected=null; draw(); } return; }
    e.preventDefault(); drag={t,cn:+t.dataset.c,x:e.clientX,y:e.clientY,moved:false,ghost:null,over:null};
  },sig);
  window.addEventListener('pointermove',e=>{
    if(!drag) return;
    if(!drag.moved&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<8) return;
    if(!drag.moved){ drag.moved=true; drag.ghost=drag.t.cloneNode(true); drag.ghost.classList.add('ghost'); document.body.appendChild(drag.ghost); drag.t.classList.add('dragging'); }
    drag.ghost.style.left=e.clientX+'px'; drag.ghost.style.top=e.clientY+'px';
    const z=zoneAt(e.clientX,e.clientY); if(drag.over&&drag.over!==z) drag.over.classList.remove('over'); if(z) z.classList.add('over'); drag.over=z;
  },sig);
  const end=e=>{
    if(!drag) return; const d=drag; drag=null;
    if(d.ghost) d.ghost.remove(); if(d.over) d.over.classList.remove('over');
    if(d.moved){ const z=zoneAt(e.clientX,e.clientY); if(z){ assign[d.cn]=z.dataset.z?+z.dataset.z:null; } selected=null; }
    else selected=selected===d.cn?null:d.cn;
    draw();
  };
  window.addEventListener('pointerup',end,sig); window.addEventListener('pointercancel',end,sig);
  $('#cancel').onclick=()=>go('teacherHome');
  $('#setBtn').onclick=async()=>{
    const un=students.filter(s=>!assign[s.classNumber]);
    if(un.length&&!await confirmDlg(`${un.length} student${un.length>1?'s don\'t':' doesn\'t'} have a stage yet. Set stages anyway?`,'Set stages','Go back')) return;
    const btn=$('#setBtn'); btn.disabled=true; btn.textContent='Saving…'; $('#err').textContent='';
    try{
      const j=await API.post({action:'setStages',password:teacher.password,room:teacher.room,term,
        stages:students.filter(s=>assign[s.classNumber]).map(s=>({classNumber:s.classNumber,student:s.displayName,stage:assign[s.classNumber]}))});
      go('teacherHome',`Stages set for Term ${term}.`+(j.reset?` Progress was reset for ${j.reset} student${j.reset>1?'s':''} whose stage changed.`:''));
    }catch(err){ $('#err').textContent=err.message; btn.disabled=false; btn.textContent='Set Stages'; }
  };
};

/* ---------- teacher: student progress ---------- */
let roomData=null;   // {stages:{term:{cn:stage}}, perfect:{cn:{term:{week:count}}}}
function tMedal(cn,term,week){
  const c=(((roomData.perfect[cn]||{})[term])||{})[week]||0; return medalFor(c);
}
function tStage(cn,term){ return ((roomData.stages[term]||{})[cn])||null; }
function tTermTrophy(cn,term){ for(let w=1;w<=9;w++) if(tMedal(cn,term,w)!=='gold') return false; return true; }
function mIcon(m,size,label){ return `<span class="mi ${size}${m?'':' sil'}" title="${esc(label)}${m?': '+MEDAL[m][1]:': no medal'}"><span aria-hidden="true">${m?MEDAL[m][0]:'🥇'}</span><span class="sr">${esc(label)} ${m?MEDAL[m][1]:'no medal'}</span></span>`; }
function tIcon(emoji,earned,size,label){ return `<span class="mi ${size}${earned?'':' sil'}" title="${esc(label)}${earned?'':' (not earned)'}"><span aria-hidden="true">${emoji}</span><span class="sr">${esc(label)}${earned?' earned':' not earned'}</span></span>`; }
SCREENS.teacherData=function(view){
  if(!teacher) return go('teacherLogin');
  const students=ROOMS[teacher.room]||[];
  let tab=(view&&view.tab)||'student', term=(view&&view.term)||1, cn=(view&&view.cn!=null)?view.cn:null;
  const TABS=[['student','Student overview'],['term','Term overview'],['year','Year overview'],['trophy','Trophy overview']];
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(teacher.room)}</div><h2>Student progress</h2></div>
    <div class="tools" style="margin:0"><button class="btn small" id="back">Back</button><button class="btn small" id="reload">Refresh</button></div></div>
    <div class="btnrow tabs" role="tablist">${TABS.map(([k,l])=>`<button class="btn small" role="tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="dv" style="margin-top:18px"></div>`;
  $('#back').onclick=()=>go('teacherHome');
  $('#reload').onclick=()=>{ roomData=null; load(); };
  app.querySelector('.tabs').onclick=e=>{ const b=e.target.closest('[data-tab]'); if(!b) return; tab=b.dataset.tab; draw(); };
  const dv=$('#dv');
  async function load(){
    dv.innerHTML='<p class="muted centre">Loading results from the Google Sheet…</p>';
    try{ const j=await API.post({action:'getRoomProgress',password:teacher.password,room:teacher.room}); roomData={stages:j.stages||{},perfect:j.perfect||{}}; draw(); }
    catch(e){ dv.innerHTML='<div class="notice">'+esc(e.message)+(e.kind==='server'&&/Unknown action/.test(e.message)?' The Apps Script needs updating: paste in the new Code.gs and deploy a new version.':'')+'</div>'; }
  }
  function draw(){
    app.querySelectorAll('[data-tab]').forEach(b=>{ const on=b.dataset.tab===tab; b.classList.toggle('sel',on); b.setAttribute('aria-selected',on); });
    if(!roomData) return;
    const nameCell=s=>`<th scope="row" class="nm">${esc(s.displayName)}</th>`;
    const wk=[1,2,3,4,5,6,7,8,9];
    if(tab==='student'){
      dv.innerHTML=`<div class="field centre" style="max-width:420px;margin:0 auto 16px"><label for="pick">Select student</label><select id="pick"><option value="">Choose a student…</option>${students.map(s=>`<option value="${s.classNumber}" ${cn===s.classNumber?'selected':''}>${esc(s.displayName)}</option>`).join('')}</select></div><div id="stu"></div>`;
      const show=()=>{
        if(cn==null){ $('#stu').innerHTML=''; return; }
        const s=students.find(x=>x.classNumber===cn);
        $('#stu').innerHTML=`<div class="tbl-wrap"><table class="dt"><caption>${esc(s.displayName)}</caption><thead><tr><th scope="col">Term</th><th scope="col">Stage</th>${wk.map(w=>`<th scope="col">Wk ${w}</th>`).join('')}</tr></thead><tbody>
          ${[1,2,3,4].map(t=>`<tr><th scope="row">Term ${t}</th><td>${tStage(cn,t)||'–'}</td>${wk.map(w=>`<td>${mIcon(tMedal(cn,t,w),'md','Week '+w)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      };
      $('#pick').onchange=e=>{ cn=e.target.value===''?null:+e.target.value; show(); };
      show();
    }
    else if(tab==='term'){
      dv.innerHTML=`<div class="btnrow" id="terms">${[1,2,3,4].map(t=>`<button class="btn small ${t===term?'sel':''}" data-t="${t}">Term ${t}</button>`).join('')}</div>
      <div class="tbl-wrap" style="margin-top:14px"><table class="dt"><thead><tr><th scope="col">Name</th><th scope="col">Stage</th>${wk.map(w=>`<th scope="col">Wk ${w}</th>`).join('')}</tr></thead><tbody>
      ${students.map(s=>`<tr>${nameCell(s)}<td>${tStage(s.classNumber,term)||'–'}</td>${wk.map(w=>`<td>${mIcon(tMedal(s.classNumber,term,w),'md','Week '+w)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      $('#terms').onclick=e=>{ const b=e.target.closest('[data-t]'); if(!b) return; term=+b.dataset.t; draw(); };
    }
    else if(tab==='year'){
      dv.innerHTML=`<div class="tbl-wrap"><table class="dt year"><thead><tr><th scope="col">Name</th>${[1,2,3,4].map(t=>`<th scope="col">Term ${t}</th>`).join('')}</tr></thead><tbody>
      ${students.map(s=>`<tr>${nameCell(s)}${[1,2,3,4].map(t=>`<td><span class="mrow">${wk.map(w=>mIcon(tMedal(s.classNumber,t,w),'xs','Term '+t+' week '+w)).join('')}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    else{
      dv.innerHTML=`<div class="tbl-wrap"><table class="dt trophy"><thead><tr><th scope="col">Name</th>${[1,2,3,4].map(t=>`<th scope="col">Term ${t}</th>`).join('')}<th scope="col">Overall</th></tr></thead><tbody>
      ${students.map(s=>{ const tt=[1,2,3,4].map(t=>tTermTrophy(s.classNumber,t));
        return `<tr>${nameCell(s)}${tt.map((ok,i)=>`<td>${tIcon(TERM_TROPHY[i+1],ok,'lg','Term '+(i+1)+' trophy')}</td>`).join('')}<td>${tIcon('🏆',tt.every(Boolean),'lg','Whole year trophy')}</td></tr>`; }).join('')}</tbody></table></div>`;
    }
  }
  draw(); if(roomData) draw(); else load();
};

/* ---------- calibration ---------- */
SCREENS.calib=function(){
  if(S.role!=='student') return go('role');
  const btns=(k,a1,b1)=>{ let h=''; for(let i=a1;i<=b1;i++) h+=`<button class="btn ${S[k]==i?'sel':''}" data-v="${i}" aria-pressed="${S[k]==i}">${i}</button>`; return h; };
  app.innerHTML=`<div class="centre"><h2>Hi ${esc(S.firstName||S.student)}!</h2><p class="muted" style="margin-bottom:24px">Choose your term.</p>
   <div class="cal-group"><h3>Term</h3><div class="btnrow" id="terms">${btns('term',1,4)}</div></div>
   <div id="rest"></div></div>`;
  const rest=$('#rest');
  function drawRest(status){
    if(!S.term){ rest.innerHTML=''; return; }
    if(status==='checking'){ rest.innerHTML='<p class="muted">Checking your stage…</p>'; return; }
    const stageHTML = S.stage&&S.stageLocked
      ? `<div class="stagebadge">Stage ${S.stage}</div>`
      : `<div class="notice slim">${status==='offline'
          ? "Couldn't check your stage. Check the internet connection, then tap your term again."
          : `Your teacher hasn't assigned your stage for Term ${S.term} yet.`}</div>`;
    const ok=!!(S.stage&&S.stageLocked);
    rest.innerHTML=`<div class="cal-group"><h3>Your stage</h3>${stageHTML}</div>
      <div class="cal-group"><h3>Week</h3><div class="btnrow" id="weeks">${btns('week',1,9)}</div>
      ${ok?'':'<p class="note">You can choose a week once your stage has been assigned.</p>'}</div>`;
    rest.querySelectorAll('#weeks button').forEach(b=>b.disabled=!ok);
    $('#weeks').onclick=e=>{
      const b=e.target.closest('button'); if(!b||b.disabled) return;
      S.week=+b.dataset.v; save(); updateTopbar();
      $('#weeks').querySelectorAll('button').forEach(x=>{x.classList.toggle('sel',x===b);x.setAttribute('aria-pressed',x===b);});
      timers.push(setTimeout(()=>go('menu'),320));
    };
  }
  drawRest(S.term?'ready':null);
  $('#terms').onclick=async e=>{
    const b=e.target.closest('button'); if(!b||b.disabled) return;
    S.term=+b.dataset.v; S.week=null; save(); updateTopbar();
    $('#terms').querySelectorAll('button').forEach(x=>{x.classList.toggle('sel',x===b);x.setAttribute('aria-pressed',x===b);x.disabled=true;});
    drawRest('checking');
    const st=await resolveStage(); if(S.screen!=='calib') return;
    $('#terms').querySelectorAll('button').forEach(x=>x.disabled=false);
    updateTopbar(); drawRest(st);
  };
};

/* ---------- menu ---------- */
const NAMES={wordlist:'Word List',passage:'Phonic Passage',testEasy:'Spelling Test 1',defEasy:'Definitions Quiz 1',clozeEasy:'Cloze Activity 1',
  editing:'Editing Passage',dictation:'Dictation',testHard:'Spelling Test 2',defHard:'Definitions Quiz 2',clozeHard:'Cloze Activity 2'};
const RESOURCES=['wordlist','passage'], MIDGREY=['editing','dictation'];
const ICONS={wordlist:'📝',passage:'📖',testEasy:'✏️',defEasy:'💡',clozeEasy:'🧩',editing:'🔍',dictation:'🎧',testHard:'✏️',defHard:'💡',clozeHard:'🧩'};
const MEDAL={gold:['🥇','Gold medal'],silver:['🥈','Silver medal'],bronze:['🥉','Bronze medal']};
function medalHTML(med,cls){
  return med ? `<span class="medal ${cls||''}" title="${MEDAL[med][1]}"><span aria-hidden="true">${MEDAL[med][0]}</span><span class="sr">${MEDAL[med][1]}</span></span>`
             : `<span class="medal sil ${cls||''}" title="No medal yet"><span aria-hidden="true">🥇</span><span class="sr">No medal yet</span></span>`;
}
SCREENS.menu=function(){
  if(S.role!=='student') return go('role');
  function draw(){
    if(S.screen!=='menu') return;
    const w=weekData(), L=listData(), done=weekDone();
    const med=medalFor(perfectCount(done));
    const tileH=id=>{ const d=done[id];
      const st=d?(isPerfect(d)?'done':'tried'):'';
      return `<button class="tile ${st}${RESOURCES.includes(id)?' resource':''}${MIDGREY.includes(id)?' midgrey':''}" data-a="${id}" ${!L?'disabled':''}>${d?`<span class="tag ${isPerfect(d)?'ok':'part'}">${isPerfect(d)?'✓ ':''}${d.score}/${d.total}</span>`:''}<span class="ic" aria-hidden="true">${ICONS[id]}</span><span class="nm">${NAMES[id]}</span></button>`; };
    const row=ids=>`<div class="grid r${ids.length}">${ids.map(tileH).join('')}</div>`;
    const intro=!w?`<div class="notice">There are no Stage ${S.stage} lessons for Term ${S.term} in the PLD teaching sequence. Tap <b>Term</b> at the top to choose another term, or ask your teacher.</div>`
      :`<h2 class="wk">Week ${S.week} ${medalHTML(med)}</h2>
       <p class="muted" style="margin:0">Stage ${S.stage}, Term ${S.term}${w.l?`, List ${w.l}`:''}</p>
       <p class="medalkey">Get 100% to turn an activity green. 2 green for 🥉, 4 for 🥈, all 6 for 🥇.</p>`;
    app.innerHTML=`<div class="intro">${intro}</div>`+row(['wordlist','passage'])+row(['testEasy','defEasy','clozeEasy'])+row(['editing','dictation'])+row(['testHard','defHard','clozeHard']);
    app.querySelectorAll('.tile').forEach(t=>t.onclick=()=>go(t.dataset.a));
  }
  draw();
  flushResults().then(()=>syncProgress()).then(ok=>{ if(ok) draw(); }).catch(()=>{});
};
const TERM_TROPHY={1:'🪐',2:'💫',3:'🔱',4:'⚜️'};
function stageForTerm(term){ const m=(store.get(STAGE_KEY,{})[S.room+'|'+term])||{}; return m[S.classNumber]?+m[S.classNumber]:null; }
function weekMedal(term,stage,week){
  if(!stage) return null;
  const done=store.get(DONE_KEY,{})[[S.room,S.classNumber,term,stage,week].join('|')]||{};
  return medalFor(perfectCount(done));
}
async function syncTerm(term){
  const j=await API.get({action:'getResults',room:S.room,classNumber:S.classNumber,term});
  const m=store.get(DONE_KEY,{}); const pre=[S.room,S.classNumber,term].join('|')+'|';
  Object.keys(m).forEach(k=>{ if(k.startsWith(pre)) delete m[k]; }); store.set(DONE_KEY,m);
  (j.results||[]).forEach(r=>markDone(Object.assign({},r,{term})));
  store.get(PEND_KEY,[]).filter(r=>r.room===S.room&&r.classNumber===S.classNumber&&r.term===term).forEach(markDone);
}
async function syncStages(term){
  const j=await API.get({action:'getStages',room:S.room,term});
  const cache=store.get(STAGE_KEY,{}); const map={}; (j.stages||[]).forEach(s=>map[s.classNumber]=s.stage);
  cache[S.room+'|'+term]=map; store.set(STAGE_KEY,cache);
}
SCREENS.progress=function(){
  if(S.role!=='student') return go('role');
  const back=()=>go(S.term&&S.stage&&S.stageLocked&&S.week?'menu':'calib');
  function draw(status){
    if(S.screen!=='progress') return;
    const terms=[1,2,3,4].map(t=>{
      const stage=stageForTerm(t);
      const weeks=[1,2,3,4,5,6,7,8,9].map(w=>weekMedal(t,stage,w));
      return {t,stage,weeks,trophy:weeks.every(m=>m==='gold')};
    });
    const year=terms.every(x=>x.trophy);
    const item=(emoji,earned,label,cls)=>`<div class="slot ${cls}"><span class="gem${earned?'':' sil'}" aria-hidden="true">${emoji}</span><span class="sr">${esc(label)}${earned?'':' (not earned yet)'}</span></div>`;
    app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(S.student)}</div><h2>Trophy cabinet</h2></div><button class="btn small" id="back">Back to activities</button></div>
    <p class="muted centre" style="margin-top:-4px">${status==='loading'?'Getting your latest results…':status==='offline'?"Couldn't reach the Google Sheet, so this shows what's saved on this iPad.":'Tap a week label to go to that week. A term trophy for gold in all 9 weeks, and the big trophy for all 4 term trophies.'}</p>
    <div class="cabinet">
      <div class="shelf top">${item('🏆',year,'Whole year trophy','giant')}</div>
      <div class="shelf terms">${terms.map(x=>`<div class="tcell">${item(TERM_TROPHY[x.t],x.trophy,'Term '+x.t+' trophy','large')}<span class="plate">Term ${x.t}</span></div>`).join('')}</div>
      ${terms.slice().reverse().map(x=>`<div class="shelf weeks"><div class="shelf-label">Term ${x.t}${x.stage?`<small>Stage ${x.stage}</small>`:''}</div><div class="wrow">${x.weeks.map((m,i)=>`<div class="wcell">${m?item(MEDAL[m][0],true,'Week '+(i+1)+' '+MEDAL[m][1],'med'):item('🥇',false,'Week '+(i+1)+' medal','med')}<button class="plate" data-t="${x.t}" data-s="${x.stage||''}" data-w="${i+1}" ${x.stage&&DATA[x.stage]&&DATA[x.stage].weeks[x.t+'-'+(i+1)]?'':'disabled'} aria-label="Go to Term ${x.t} Week ${i+1}">Wk ${i+1}</button></div>`).join('')}</div></div>`).join('')}
    </div>`;
    $('#back').onclick=back;
    app.querySelectorAll('button.plate').forEach(b=>b.onclick=()=>{
      if(b.disabled) return;
      S.term=+b.dataset.t; S.stage=+b.dataset.s; S.stageLocked=true; S.week=+b.dataset.w; save(); go('menu');
    });
  }
  draw(API.has()?'loading':'offline');
  if(!API.has()) return;
  flushResults().then(()=>Promise.all([1,2,3,4].flatMap(t=>[syncStages(t),syncTerm(t)])))
    .then(()=>draw('ready')).catch(()=>draw('offline'));
};

/* ---------- activity helpers ---------- */
function shell(id){
  const w=weekData();
  app.innerHTML=`<div class="act-head"><div><div class="crumb">Stage ${S.stage}, Term ${S.term}, Week ${S.week}${w&&w.l?`, List ${w.l}`:''}</div>
  <h2>${NAMES[id]}</h2></div>
  <button class="btn small" id="toMenu">Back to activities</button></div><div id="body"></div>`;
  $('#toMenu').onclick=()=>go('menu');
  return $('#body');
}
function missingContent(body,what){
  body.innerHTML=`<div class="notice"><p><b>${what} aren't ready for this week yet.</b></p><p style="margin:0">Your teacher needs to add them for List ${weekData().l}. Try another activity for now.</p></div>`;
}
function prog(n,i){ return '<div class="prog" aria-label="Question '+(i+1)+' of '+n+'">'+Array.from({length:n},(_,k)=>`<i class="${k<i?'past':k===i?'now':''}"></i>`).join('')+'</div>'; }
function scoreBlock(score,total){
  const pct=Math.round(score/total*100), dec=(score/total).toFixed(2);
  return `<div class="stats"><div><span class="lbl">Fraction</span><b>${score}/${total}</b></div><div><span class="lbl">Percentage</span><b>${pct}%</b></div><div><span class="lbl">Decimal</span><b>${dec}</b></div></div>`;
}
function finishScored(body,activity,rows,clueHead){
  KB.hide(); stopSpeech();
  const score=rows.filter(r=>r.ok).length, total=rows.length;
  recordResult(activity,score,total);
  const msg=score===total?'Every one right. Brilliant work!':score>=total*0.7?'Great effort! Check the ones in red.':'Keep practising. Look carefully at the ones in red.';
  body.innerHTML=`<h3>Your results</h3>${scoreBlock(score,total)}<p style="font-size:22px">${msg}</p>
  <div class="tbl-wrap"><table class="fbt"><thead><tr><th scope="col"><span class="sr">Result</span></th>${clueHead?`<th scope="col">${clueHead}</th>`:''}<th scope="col">Your answer</th><th scope="col">Correct answer</th></tr></thead><tbody>
  ${rows.map(r=>`<tr class="${r.ok?'ok':'bad'}"><td class="mk">${r.ok?'✓':'✗'}</td>${clueHead?`<td>${r.clue}</td>`:''}<td class="given">${r.given?esc(r.given):'<span class="muted">(blank)</span>'}</td><td>${r.correct}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="tools"><button class="btn primary" id="again">Try again</button><button class="btn" id="menu2">Back to activities</button></div>`;
  $('#again').onclick=()=>go(activity); $('#menu2').onclick=()=>go('menu');
  window.scrollTo(0,0);
}
function modeChoice(body,intro,onPick){
  body.innerHTML=`<p style="font-size:22px">${intro}</p><div class="grid r2" style="max-width:640px">
    <button class="tile" data-m="type"><span class="ic" aria-hidden="true">⌨️</span><span class="nm">Typing</span></button>
    <button class="tile" data-m="hand"><span class="ic" aria-hidden="true">✍️</span><span class="nm">Handwriting</span></button></div>`;
  body.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>onPick(b.dataset.m));
}
function answerField(host,{multiline=false,value='',label,placeholder,mode='word',onEnter}={}){
  const f=TextField(host,{multiline,value,label,placeholder});
  KB.show(f,mode,onEnter); f.render(); return f;
}

/* ---------- Word list ---------- */
function actWordList(){
  const L=listData(); const w=weekData(); const body=shell('wordlist');
  body.innerHTML=`<p style="margin-bottom:4px"><b>${esc(L.t)}</b></p>${w.n?`<p class="muted">${esc(w.n)}</p>`:''}
  <p class="muted">Tap a word to hear it.</p>
  <div class="wl">${L.w.map((x,i)=>`<button class="wcard" data-i="${i}">${chunk(x)}${x[2]&1?'<span class="hf" title="High frequency word">HF</span>':''}</button>`).join('')}</div>`;
  body.querySelectorAll('.wcard').forEach(b=>b.onclick=()=>speak(L.w[+b.dataset.i][0]));
}

/* ---------- Phonic passage ---------- */
function listWordMatcher(){
  const set=new Set(listData().w.map(x=>x[0].toLowerCase())); const sfx=['s','es','ed','d','ing','ly','er','ers'];
  return tok=>{ const t=tok.toLowerCase().replace(/[^a-z'-]/g,'').replace(/'s$/,''); if(set.has(t)) return true;
    for(const w of set){ for(const s of sfx){ if(t===w+s) return true; } if(w.endsWith('e')&&(t===w.slice(0,-1)+'ing'||t===w.slice(0,-1)+'ed')) return true; } return false; };
}
function noPassage(body){
  const w=weekData();
  body.innerHTML=`<div class="notice">${w.ps==='custom'?"The PLD teaching sequence says to create your own passage for this week, and one hasn't been added yet.":'There is no passage for this week.'}</div>`;
}
function actPassage(){
  const body=shell('passage'); const P=passageData(); if(!P) return noPassage(body);
  const m=listWordMatcher();
  const html=P.c.split(/(\s+)/).map(t=>/^\s+$/.test(t)?t:(m(t)?`<mark>${esc(t)}</mark>`:esc(t))).join('');
  body.innerHTML=`<h3>${esc(P.t)}</h3>
  <div class="tools"><button class="btn primary small" id="read">🔊 Read it to me</button><button class="btn small" id="stop">Stop</button><button class="btn small" id="hl">Hide list words</button></div>
  <div class="passage" id="ptxt">${html}</div>`;
  $('#read').onclick=()=>speak(P.c,0.9); $('#stop').onclick=stopSpeech;
  let on=true; $('#hl').onclick=e=>{ on=!on; $('#ptxt').classList.toggle('nohl',!on); e.target.textContent=on?'Hide list words':'Show list words'; };
}

/* ---------- Definitions / Cloze ---------- */
function quiz(activity,kind,hard){
  const body=shell(activity); const L=listData();
  const ready=L.w.filter(x=>{const c=contentFor(x[0]); return c&&(kind==='def'?c.d:c.s);});
  if(ready.length<L.w.length) return missingContent(body,kind==='def'?'Definitions':'Cloze sentences');
  const items=shuffle(L.w), options=shuffle(L.w), answers=[]; let i=0;
  const clueText=x=>{ const c=contentFor(x[0]); return kind==='def'?c.d:c.s; };
  const clueHTML=(x,fill)=>kind==='def'?`“${esc(clueText(x))}”`:esc(clueText(x)).replace('___',`<span class="blank">${fill||'&nbsp;'}</span>`);
  function next(){
    if(i>=items.length){
      return finishScored(body,activity,items.map((x,k)=>({ok:same(answers[k]||'',x[0]),given:answers[k]||'',correct:chunk(x),clue:clueHTML(x)})), kind==='def'?'Definition':'Sentence');
    }
    const x=items[i];
    const head=`<div class="qcard">${prog(items.length,i)}${kind==='def'?'<p class="muted" style="margin-bottom:4px">Which word means…</p>':'<p class="muted" style="margin-bottom:4px">Which word fits in the gap?</p>'}<div class="clue">${clueHTML(x)}</div>`;
    if(!hard){
      body.innerHTML=head+`<div class="opts all">${options.map(o=>`<button class="btn" data-w="${esc(o[0])}">${esc(o[0])}</button>`).join('')}</div></div>`;
      body.querySelectorAll('.opts .btn').forEach(b=>b.onclick=()=>{ answers[i]=b.dataset.w; i++; next(); });
    }else{
      body.innerHTML=head+`<div class="answer"><div id="ansf"></div></div><div class="tools"><button class="btn primary" id="sub">${i+1<items.length?'Next':'Finish'}</button></div></div>`;
      const submit=()=>{ answers[i]=f.value.trim(); i++; next(); };
      const f=answerField($('#ansf'),{label:'Type the word',placeholder:'Type the word',onEnter:submit});
      $('#sub').onclick=submit;
    }
    window.scrollTo(0,0);
  }
  next();
}

/* ---------- Spelling test (Easy) – Look, Say, Cover, Write, Check ---------- */
function testEasy(){
  const activity='testEasy'; const body=shell(activity); const L=listData();
  const items=shuffle(L.w), answers=[]; let i=0;
  const STEPS=['Look','Say','Cover','Write','Check'];
  const stepBar=k=>'<div class="steps">'+STEPS.map((s,j)=>`<span class="${j===k?'on':j<k?'past':''}">${s}</span>`).join('')+'</div>';
  const frame=(k,inner,btns)=>{ body.innerHTML=`${prog(items.length,i)}${stepBar(k)}<div class="stage">${inner}</div><div class="tools">${btns||''}</div>`; };
  function word(){
    if(i>=items.length) return finishScored(body,activity,items.map((x,k)=>({ok:same(answers[k]||'',x[0]),given:answers[k]||'',correct:chunk(x)})));
    look();
  }
  function look(){
    const x=items[i];
    frame(0,`<div class="bigword">${chunk(x)}</div>`,`<button class="btn" id="hear">🔊 Hear it</button><button class="btn primary" id="n">I've looked at it</button>`);
    $('#hear').onclick=()=>speak(x[0]); $('#n').onclick=say;
  }
  function say(){
    const x=items[i];
    frame(1,`<div><div class="bigword">${chunk(x)}</div><p class="muted">Say the word out loud.</p></div>`,`<button class="btn" id="hear">🔊 Hear it</button><button class="btn primary" id="n">I said it. Cover it</button>`);
    $('#hear').onclick=()=>speak(x[0]); $('#n').onclick=cover;
  }
  function cover(){ frame(2,`<div class="cover">Covered!</div>`); timers.push(setTimeout(()=>write(''),900)); }
  function write(prefill){
    const x=items[i];
    frame(3,`<div style="width:100%"><div class="boxes" aria-label="${x[0].length} characters">${'<i></i>'.repeat(x[0].length)}</div><div id="ansf"></div></div>`,
      `<button class="btn" id="hear">🔊 Hear it</button><button class="btn primary" id="n">Check it</button>`);
    const goCheck=()=>{ if(f.value.trim()) check(f.value.trim()); };
    const f=answerField($('#ansf'),{value:prefill,label:'Write the word',onEnter:goCheck});
    $('#hear').onclick=()=>speak(x[0]); $('#n').onclick=goCheck;
  }
  function check(att){
    KB.hide();
    const x=items[i];
    frame(4,`<div class="checkpair"><div><p class="muted">The word</p><div class="bigword">${chunk(x)}</div></div>
      <div><p class="muted">You wrote</p><div class="bigword mine">${esc(att)}</div></div>
      <p class="checkq">Check every letter. Are they the same?</p></div>`,
      `<button class="btn" id="edit">Edit</button><button class="btn primary" id="sub">Submit</button>`);
    $('#edit').onclick=()=>write(att);
    $('#sub').onclick=()=>{ answers[i]=att; i++; word(); };
  }
  word();
}

/* ---------- Spelling test (Hard) – traditional test ---------- */
function testHard(){
  const activity='testHard'; const body=shell(activity); const L=listData();
  const items=shuffle(L.w), answers=[]; let i=0;
  function next(){
    if(i>=items.length) return finishScored(body,activity,items.map((x,k)=>({ok:same(answers[k]||'',x[0]),given:answers[k]||'',correct:chunk(x)})));
    const x=items[i];
    body.innerHTML=`<div class="qcard">${prog(items.length,i)}<p class="muted">Listen to the word, then spell it.</p>
      <button class="btn big-audio" id="hear">🔊 Play word</button>
      <div class="answer" style="margin-top:20px"><div id="ansf"></div></div>
      <div class="tools"><button class="btn primary" id="sub">${i+1<items.length?'Next':'Finish'}</button></div></div>`;
    const submit=()=>{ answers[i]=f.value.trim(); i++; next(); };
    const f=answerField($('#ansf'),{label:'Spell the word',placeholder:'Type the word',onEnter:submit});
    $('#hear').onclick=()=>speak(x[0]); $('#sub').onclick=submit;
    speak(x[0]);
  }
  next();
}

/* ---------- Editing passage ---------- */
function actEditing(){
  const body=shell('editing'); const P=passageData(); if(!P) return noPassage(body);
  const pick=()=>modeChoice(body,'Will you type or handwrite your corrections?',m=>m==='hand'?hand():type());
  pick();
  function hand(){
    body.innerHTML=`<h3>${esc(P.t)}</h3><p>Rewrite this passage in your book. Fix the spelling, capital letter and punctuation mistakes as you go.</p>
    <div class="passage readonly">${esc(P.e)}</div><div class="tools"><button class="btn small" id="chg">Change to typing</button></div>`;
    $('#chg').onclick=type;
  }
  function type(){
    body.innerHTML=`<h3>${esc(P.t)}</h3><p>This passage has spelling, capital letter and punctuation mistakes. Tap where you want to make a change, then use the keyboard.</p>
    <div id="edf"></div>
    <div class="tools"><button class="btn primary" id="chk">Check my work</button><button class="btn" id="rst">Start again</button></div><div id="out" role="status"></div>`;
    const f=answerField($('#edf'),{multiline:true,value:P.e,label:'Passage to edit',mode:'passage'});
    f.caret=0; f.render();
    $('#rst').onclick=async()=>{ if(await confirmDlg('Start again? Your changes will be lost.','Start again','Keep my changes')){ f.set(P.e); f.caret=0; f.render(); $('#out').innerHTML=''; } };
    $('#chk').onclick=()=>{
      const n=countMistakes(P.c,f.value);
      $('#out').innerHTML=`<div class="notice result-line">${n?`There ${n===1?'is':'are'} still <b>${n}</b> mistake${n===1?'':'s'} in this passage.`:'There are no mistakes left in this passage. Well done!'}</div>`;
      $('#out').scrollIntoView({block:'nearest'});
    };
  }
}

/* ---------- Dictation ---------- */
function Reader(text,onState){
  // reads continuously, one sentence after another with no added pauses; tracks the current word so Pause / Back work
  const words=toks(text);
  let pos=0, cur=0, gen=0, state='idle';
  const set=s=>{ state=s; onState&&onState(s); };
  const sentEnd=a1=>{ let j=a1; while(j<words.length){ j++; if(/[.!?]['")]*$/.test(words[j-1])) break; } return j; };
  function speakFrom(i){
    gen++; const run=gen; speechSynthesis.cancel();
    pos=cur=Math.max(0,Math.min(i,words.length));
    if(pos>=words.length){ set('done'); return; }
    setTimeout(()=>{
      if(run!==gen) return;
      let a1=pos;
      while(a1<words.length){
        const b1=sentEnd(a1), part=words.slice(a1,b1), start=a1, last=b1>=words.length;
        const u=utter(part.join(' '),0.85);
        u.onstart=()=>{ if(run===gen){ cur=start; pos=start; } };
        u.onboundary=e=>{ if(run!==gen||(e.name&&e.name!=='word')) return; const before=part.join(' ').slice(0,e.charIndex); cur=start+(before.trim()?toks(before).length:0); };
        u.onend=()=>{ if(run!==gen) return; cur=pos=b1; if(last) set('done'); };
        speechSynthesis.speak(u); a1=b1;
      }
      set('playing');
    },60);
  }
  return {
    play(){ speakFrom(0); },
    pause(){ gen++; speechSynthesis.cancel(); set('paused'); },
    resume(){ speakFrom(cur); },
    back(n){ speakFrom(cur-n); },
    restart(){ speakFrom(0); },
    stop(){ gen++; if('speechSynthesis' in window) speechSynthesis.cancel(); },
    get state(){ return state; }
  };
}
function actDictation(){
  const body=shell('dictation'); const P=passageData(); if(!P) return noPassage(body);
  if(!('speechSynthesis' in window)){ body.innerHTML='<div class="notice">This device can\'t play spoken audio, so dictation isn\'t available here.</div>'; return; }
  modeChoice(body,'Will you type or handwrite the dictation?',m=>run(m));
  function run(mode){
    body.innerHTML=`<p>${mode==='hand'?'Listen carefully and write the passage in your book.':'Listen carefully and type the passage.'} Use Pause and Back if you need more time.</p>
    <div class="audiobar" role="group" aria-label="Audio controls">
      <button class="btn primary" id="play">▶ Play</button>
      <button class="btn" id="pause" disabled>⏸ Pause</button>
      <button class="btn" id="b5" disabled>⏪ Back 5 words</button>
      <button class="btn" id="b10" disabled>⏪ Back 10 words</button>
      <button class="btn" id="rs" disabled>↺ Restart</button>
      <span class="astate" id="ast" role="status"></span>
    </div>
    ${mode==='type'?`<div id="dtf" style="margin-top:14px"></div><div class="tools"><button class="btn primary" id="chk">Check my work</button></div><div id="out" role="status"></div>`:''}`;
    const ast=$('#ast'), pb=$('#pause');
    reader=Reader(P.c,s=>{
      ast.textContent={playing:'Playing…',paused:'Paused',done:'Finished'}[s]||'';
      pb.textContent=s==='paused'?'▶ Resume':'⏸ Pause'; pb.disabled=s==='done';
    });
    const enable=()=>['pause','b5','b10','rs'].forEach(id=>$('#'+id).disabled=false);
    $('#play').onclick=()=>{ reader.play(); enable(); };
    pb.onclick=()=>{ reader.state==='paused'?reader.resume():reader.pause(); };
    $('#b5').onclick=()=>{ reader.back(5); pb.disabled=false; };
    $('#b10').onclick=()=>{ reader.back(10); pb.disabled=false; };
    $('#rs').onclick=()=>{ reader.restart(); pb.disabled=false; };
    if(mode==='type'){
      const f=answerField($('#dtf'),{multiline:true,label:'Type the dictation',placeholder:'Start typing here…',mode:'passage'});
      $('#chk').onclick=()=>{
        const n=countMistakes(P.c,f.value);
        $('#out').innerHTML=`<div class="notice result-line">${n?`There ${n===1?'is':'are'} <b>${n}</b> mistake${n===1?'':'s'} in your dictation.`:'There are no mistakes in your dictation. Well done!'}</div>`;
        $('#out').scrollIntoView({block:'nearest'});
      };
    }
  }
}

/* ---------- activity registry ---------- */
const ACTS={
  wordlist:actWordList, passage:actPassage, editing:actEditing, dictation:actDictation,
  testEasy, testHard,
  defEasy:()=>quiz('defEasy','def',false), defHard:()=>quiz('defHard','def',true),
  clozeEasy:()=>quiz('clozeEasy','cloze',false), clozeHard:()=>quiz('clozeHard','cloze',true)
};

/* ---------- boot ---------- */
flushResults();
if(S.role!=='student'||!S.student) go('role');
else if(!(S.term&&S.stage&&S.stageLocked&&S.week)) go('calib');
else{
  go(ACTS[S.screen]||S.screen==='progress'?S.screen:'menu');
  // re-check the stage in the background; only interrupt if the teacher has changed it
  const before=S.stage;
  resolveStage().then(st=>{
    if(st==='offline'){ if(!S.stage){ S.stage=before; S.stageLocked=true; save(); } return; }
    if(S.stage!==before){ S.week=null; save(); go('calib'); }
  });
}
})();
