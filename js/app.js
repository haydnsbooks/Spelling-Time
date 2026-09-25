(function(){
"use strict";
/* =================================================================
   PLD Spelling Activities
   ================================================================= */
const DATA = window.PLD_DATA;
const CONTENT = window.CONTENT || {};
const CONFIG = window.APP_CONFIG || {};
const SHOP = window.SUPERMARKET || {version:0,aisles:[]};

/* ---------- app version ----------
   When you upload a new version to GitHub, change APP_VERSION here AND "version" in version.json
   to the same new value (e.g. the date plus a number). When a login button is pressed, the app
   compares the two; if the iPad is running an older copy, it asks the student/teacher to update. */
const APP_VERSION = '2026-09-25.3';
const APP_FILES = ['index.html','css/styles.css','js/app.js','js/config.js','data/class-list.js','data/pld-data.js','data/content.js','data/supermarket.js'];
async function latestVersion(){
  const ctl=new AbortController(), t=setTimeout(()=>ctl.abort(),5000);
  try{
    const r=await fetch('version.json?t='+Date.now(),{cache:'no-store',signal:ctl.signal});
    if(!r.ok) return null;
    const j=await r.json(); return j&&j.version?String(j.version):null;
  }catch(e){ return null; }                          // offline or no version.json: carry on as normal
  finally{ clearTimeout(t); }
}
async function hardRefresh(latest){
  // re-download every app file, skipping the browser's saved copies, then reload the page
  try{ if(window.caches) for(const k of await caches.keys()) await caches.delete(k); }catch(e){}
  await Promise.all(APP_FILES.map(f=>fetch(f,{cache:'reload'}).catch(()=>{})));
  const u=new URL(location.href); u.searchParams.set('v',latest||Date.now()); u.hash='';
  location.replace(u.toString());
}
/* resolves true if this copy is up to date (or the check couldn't run); otherwise shows the update pop-up */
async function ensureLatest(btn){
  const label=btn?btn.textContent:'';
  if(btn){ btn.disabled=true; btn.textContent='Checking for updates…'; }
  const latest=await latestVersion();
  if(btn){ btn.disabled=false; btn.textContent=label; }
  if(!latest||latest===APP_VERSION) return true;
  const d=document.createElement('div'); d.className='modal';
  d.innerHTML=`<div class="dlg update" role="alertdialog" aria-modal="true" aria-labelledby="updH">
    <div class="up-ic" aria-hidden="true">🔄</div><h2 id="updH">Update needed</h2>
    <p>There's a newer version of the spelling app.<br>Tap the button to get it. It only takes a moment.</p>
    <p class="muted up-v">This iPad has version ${esc(APP_VERSION)}. The newest is ${esc(latest)}.</p>
    <div class="tools"><button class="btn primary" id="updBtn">Update the app</button></div></div>`;
  document.body.appendChild(d);
  const b=d.querySelector('#updBtn'); b.focus();
  b.onclick=()=>{ b.disabled=true; b.textContent='Updating…'; hardRefresh(latest); };
  return false;
}
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
const SESSION_KEY='pldSpell.session.v3';   // v3: students now log in with a password, so older sessions are ignored
const BLANK={role:null,room:null,student:null,firstName:null,classNumber:null,term:null,stage:null,week:null,stageLocked:false,authed:false,screen:'role'};
let S=Object.assign({},BLANK,store.get(SESSION_KEY,{}));
if(S.role!=='student'||!S.student||!S.authed) S=Object.assign({},BLANK);
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
    if(!res.ok) throw Object.assign(new Error(res.status===404
      ? "The Google Sheet web app couldn't be found (error 404). In Apps Script, open Deploy → Manage deployments, copy the Web app URL and check it matches js/config.js. Also check \"Who has access\" is set to Anyone."
      : `The Google Sheet web app sent back an error (${res.status}). Check the Apps Script deployment.`),{kind:'network',status:res.status});
    let j; try{ j=await res.json(); }catch(e){ throw Object.assign(new Error('The Google Sheet sent back a web page instead of data. In Apps Script, check Deploy → Manage deployments: "Execute as" should be Me and "Who has access" should be Anyone.'),{kind:'network'}); }
    if(!j.ok) throw Object.assign(new Error(j.error||'The Google Sheet returned an error.'),{kind:'server'});
    return j;
  },
  get(p){ return this.call('GET',p); },
  post(p){ return this.call('POST',p); }
};

/* ---------- progress (assessed activities) ---------- */
const ALL_ACTS=['wordlist','passage','testEasy','defEasy','clozeEasy','editing','dictation','testHard','defHard','clozeHard'];
const ASSESSED=['testEasy','defEasy','clozeEasy','testHard','defHard','clozeHard'];
const DONE_KEY='pldSpell.done.v2', PEND_KEY='pldSpell.pending.v1', STAGE_KEY='pldSpell.stages.v1', ACTS_KEY='pldSpell.acts.v1';

/* ---------- medal rules (keep these the same as Code.gs) ----------
   Gold   = every medal activity switched on for the term is at 100%
   Silver = SILVER_PERCENT of them at 100%, rounded up
   Bronze = BRONZE_PERCENT of them at 100%, rounded up                */
const SILVER_PERCENT=60, BRONZE_PERCENT=30;
const FR_PAY={bronze:3,silver:5,gold:10};          // Fremantium for reaching each medal for the first time in a week
function termActs(term,room){ const m=((store.get(ACTS_KEY,{})[room||S.room])||{})[term]; return Array.isArray(m)&&m.length?m:ALL_ACTS; }
function medalActs(term,room){ const on=termActs(term,room); return ASSESSED.filter(a=>on.includes(a)); }
function thresholds(total){ return {bronze:Math.ceil(total*BRONZE_PERCENT/100),silver:Math.ceil(total*SILVER_PERCENT/100),gold:total}; }
function medalFor(n,total){
  if(!(total>0)) return null;
  const t=thresholds(total);
  return n>=t.gold?'gold':n>=t.silver?'silver':n>=t.bronze?'bronze':null;
}
function medalValue(m){ return m==='gold'?FR_PAY.bronze+FR_PAY.silver+FR_PAY.gold:m==='silver'?FR_PAY.bronze+FR_PAY.silver:m==='bronze'?FR_PAY.bronze:0; }
function medalRule(mt){
  if(!mt) return 'There are no medal activities this term.';
  const t=thresholds(mt), p=[];
  if(t.bronze<t.gold) p.push(`${t.bronze} green for 🥉`);
  if(t.silver<t.gold&&t.silver>t.bronze) p.push(`${t.silver} for 🥈`);
  p.push(`${mt===1?'1':'all '+mt} for 🥇`);
  return 'Get 100% to turn an activity green. '+p.join(', ')+'.';
}
async function syncActs(room){
  const j=await API.get({action:'getActivities',room});
  const all=store.get(ACTS_KEY,{}); all[room]=j.terms||{}; store.set(ACTS_KEY,all);
  return all[room];
}
const pkey=(term,stage,week)=>[S.room,S.classNumber,term,stage,week].join('|');
function markDone(r){
  const m=store.get(DONE_KEY,{}); const k=pkey(r.term,r.stage,r.week);
  m[k]=m[k]||{}; const prev=m[k][r.activity];
  if(!prev||r.score/r.total>prev.score/prev.total) m[k][r.activity]={score:r.score,total:r.total};
  store.set(DONE_KEY,m);
}
function weekDone(){ return store.get(DONE_KEY,{})[pkey(S.term,S.stage,S.week)]||{}; }
const isPerfect=d=>!!d&&d.total>0&&d.score===d.total;
function perfectCount(done,term){ return medalActs(term).filter(a=>isPerfect(done[a])).length; }   // switched-on medal activities at 100%
function medalFromDone(done,term){ return medalFor(perfectCount(done,term),medalActs(term).length); }
function recordResult(activity,score,total){
  const rec={action:'addResult',id:Date.now().toString(36)+Math.random().toString(36).slice(2,8),timestamp:new Date().toISOString(),
    room:S.room,classNumber:S.classNumber,student:S.student,term:S.term,stage:S.stage,week:S.week,list:(weekData()||{}).l||'',activity,score,total};
  markDone(rec);
  const q=store.get(PEND_KEY,[]); q.push(rec); store.set(PEND_KEY,q);
  flushResults();
}
let flushP=null;
function flushResults(){
  if(!API.has()) return Promise.resolve();
  if(flushP) return flushP;                          // already sending: wait for the same run
  flushP=(async()=>{
    while(true){
      const q=store.get(PEND_KEY,[]); if(!q.length) break;
      try{ await API.post(q[0]); }
      catch(e){ if(e.kind!=='server') break; }          // network problem: keep it and try again later
      const q2=store.get(PEND_KEY,[]); if(q2.length&&q2[0].id===q[0].id){ q2.shift(); store.set(PEND_KEY,q2); }
    }
  })().finally(()=>{ flushP=null; });
  return flushP;
}

/* ---------- Fremantium wallet ----------
   The Google Sheet works out the balance: Fremantium earned from medals, minus what has been spent.
   The latest copy is kept on the iPad so the top bar can show it straight away. */
const WALLET_KEY='pldSpell.wallet.v1';
let wallet=null;                                   // {earned,spent,balance,owned:[itemIds]}
function walletId(){ return S.room+'|'+S.classNumber; }
function loadWallet(){ wallet=(S.authed&&store.get(WALLET_KEY,{})[walletId()])||null; }
function setWallet(j){
  wallet={earned:+j.earned||0,spent:+j.spent||0,balance:+j.balance||0,owned:(j.owned||[]).map(String)};
  const all=store.get(WALLET_KEY,{}); all[walletId()]=wallet; store.set(WALLET_KEY,all);
  updateTopbar();
}
async function refreshWallet(){
  if(!API.has()||!S.authed) return null;
  await flushResults().catch(()=>{});
  const who=walletId();
  const j=await API.get({action:'getWallet',room:S.room,classNumber:S.classNumber,catalogVersion:SHOP.version});
  if(!S.authed||walletId()!==who) return null;     // logged out while waiting
  setWallet(j);
  if(j.reset) toast(`The supermarket has been restocked, so you have ${wallet.balance} Fremantium to spend again.`);
  return wallet;
}
function frIcon(cls){
  return `<svg class="fr-ic ${cls||''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11" fill="#17a398" stroke="#0b5f5a" stroke-width="1.6"/><circle cx="12" cy="12" r="8.2" fill="none" stroke="#8ff0e6" stroke-width="1"/><path d="M12 5.2l2.1 3.6-2.1 1.3-2.1-1.3z" fill="#d9fffb"/><text x="12" y="17.6" text-anchor="middle" font-size="9.5" font-weight="800" fill="#fff" font-family="'Baloo 2',Andika,sans-serif">F</text></svg>`;
}
function frAmt(n,cls){ return `<span class="fr-amt ${cls||''}">${frIcon()}<b>${n}</b><span class="sr"> Fremantium</span></span>`; }
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
function toast(msg){ document.querySelectorAll('.toast').forEach(x=>x.remove()); const t=document.createElement('div'); t.className='toast'; t.setAttribute('role','status'); t.textContent=msg; document.body.appendChild(t); setTimeout(()=>t.remove(),4000); }

/* ---------- top bar ---------- */
const topbar=$('#topbar');
$('#tbFrIc').innerHTML=frIcon();
function updateTopbar(){
  topbar.classList.toggle('hidden', !(S.role==='student'&&S.student&&S.authed));
  $('#tbName').textContent=(S.firstName||S.student||'Name')+' ▾';
  $('#tbTerm').textContent='Term '+(S.term||'–')+' ▾';
  $('#tbWeek').textContent='Week '+(S.week||'–')+' ▾';
  const n=wallet?wallet.balance:'–';
  $('#tbFrN').textContent=n;
  $('#tbFr').setAttribute('aria-label',`Fremantium: ${n}. Open the supermarket`);
  document.querySelectorAll('.tb[data-k="shop"]>button,.tb[data-k="fridge"]>button,.tb[data-k="progress"]>button').forEach(b=>{
    b.classList.toggle('here',({shop:'shop',fridge:'fridge',progress:'progress'})[b.parentElement.dataset.k]===S.screen);
  });
}
function bumpFr(){ const b=$('#tbFr'); b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
function closeDD(){ document.querySelectorAll('.dd').forEach(d=>d.remove()); document.querySelectorAll('.tb>button').forEach(b=>b.setAttribute('aria-expanded','false')); }
topbar.addEventListener('click',e=>{
  const b=e.target.closest('.tb>button'); if(!b) return;
  const tb=b.parentElement, k=tb.dataset.k;
  const wasOpen=b.getAttribute('aria-expanded')==='true'; closeDD();
  if(k==='progress'){ go('progress'); return; }
  if(k==='shop'||k==='fr'){ go('shop'); return; }
  if(k==='fridge'){ go('fridge'); return; }
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
function logout(){ stopAll(); S=Object.assign({},BLANK); teacher=null; wallet=null; try{localStorage.removeItem(SESSION_KEY);}catch(e){} go('role'); }

/* ---------- router ---------- */
let timers=[]; function clearTimers(){ timers.forEach(t=>{clearInterval(t);clearTimeout(t);}); timers=[]; }
let reader=null;
function stopAll(){ stopSpeech(); clearTimers(); if(reader){ reader.stop(); reader=null; } KB.hide(); if(screenAC){ screenAC.abort(); screenAC=null; } }
const SCREENS={};
function go(screen,arg){
  if(ACTS[screen]&&S.role==='student'&&!termActs(S.term).includes(screen)) screen='menu';   // activity switched off by the teacher
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
  btn.onclick=async()=>{
    if(!await ensureLatest(btn)) return;
    const s=ROOMS[room.value].find(n=>String(n.classNumber)===stu.value);
    Object.assign(S,BLANK,{role:'student',room:room.value,student:s.displayName,firstName:s.firstName,classNumber:s.classNumber});
    go('studentPassword');
  };
};
/* ---------- student password ----------
   First log in: the student makes a password (saved in the Passwords tab of the Google Sheet).
   After that: they type it each time. To reset a forgotten password, clear it in the Passwords tab. */
SCREENS.studentPassword=function(){
  if(S.role!=='student'||!S.student) return go('studentLogin');
  const who={room:S.room,classNumber:S.classNumber};
  app.innerHTML=`<div class="centre"><h1>Hi ${esc(S.firstName||S.student)}!</h1><div id="pbody"><p class="muted">Checking…</p></div></div>`;
  const pbody=$('#pbody');
  const notMe=()=>{ S=Object.assign({},BLANK,{room:S.room}); go('studentLogin'); };
  const pwInput=(id,label,ac)=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" type="password" class="pw" autocomplete="${ac}" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="30"></div>`;
  const done=()=>{ S.authed=true; save(); loadWallet(); refreshWallet().catch(()=>{}); go('calib'); };
  function offline(msg){
    pbody.innerHTML=`<div class="notice" style="max-width:520px;margin:0 auto 14px">${esc(msg)}</div><div class="tools"><button class="btn" id="nm">Back</button><button class="btn primary" id="retry">Try again</button></div>`;
    $('#nm').onclick=notMe; $('#retry').onclick=check;
  }
  async function check(){
    pbody.innerHTML='<p class="muted">Checking…</p>';
    try{ const j=await API.get(Object.assign({action:'studentStatus'},who)); if(S.screen!=='studentPassword') return; j.hasPassword?enter():create(); }
    catch(e){ if(S.screen==='studentPassword') offline(e.message); }
  }
  function create(){
    pbody.innerHTML=`<p class="muted" style="margin-bottom:18px">This is your first time logging in. Make a password so only you can use your account.</p>
    <div class="pwtips" role="note"><div><span aria-hidden="true">🧠</span> Choose a password you will remember.</div>
      <div><span aria-hidden="true">✏️</span> Write it down somewhere safe so you don't lose it.</div>
      <div><span aria-hidden="true">🤫</span> Keep it secret from other students.</div></div>
    <div class="home">${pwInput('pw1','Make a password','new-password')}${pwInput('pw2','Type it again','new-password')}
      <label class="showpw"><input type="checkbox" id="show"> Show my password</label>
      <div class="fb bad" id="err" role="alert"></div>
      <div class="tools"><button class="btn" id="nm">That's not me</button><button class="btn primary" id="save">Save my password</button></div></div>`;
    const p1=$('#pw1'), p2=$('#pw2'), err=$('#err'), btn=$('#save');
    $('#nm').onclick=notMe;
    $('#show').onchange=e=>{ p1.type=p2.type=e.target.checked?'text':'password'; };
    p1.focus();
    const submit=async()=>{
      const a=p1.value, b=p2.value; err.textContent='';
      if(a.length<4){ err.textContent='Your password needs at least 4 characters.'; p1.focus(); return; }
      if(a!==b){ err.textContent="The two passwords don't match. Try typing them again."; p2.value=''; p2.focus(); return; }
      btn.disabled=true; btn.textContent='Saving…';
      try{
        await API.post(Object.assign({action:'setStudentPassword',student:S.student,password:a},who));
        saved(a);
      }catch(e){ err.textContent=e.message; btn.disabled=false; btn.textContent='Save my password'; }
    };
    btn.onclick=submit; p2.onkeydown=e=>{ if(e.key==='Enter') submit(); }; p1.onkeydown=e=>{ if(e.key==='Enter') p2.focus(); };
  }
  function saved(pw){
    pbody.innerHTML=`<div class="pwsaved"><div class="big" aria-hidden="true">🔐</div><h2>Password saved!</h2>
      <p>Your password is <span class="pwshow" id="pws">••••••</span> <button class="btn small" id="peek">Show it</button></p>
      <p><b>Have you written it down somewhere safe?</b><br>You'll need it every time you log in.</p>
      <div class="tools"><button class="btn primary" id="ok">Yes, I've written it down</button></div></div>`;
    let shown=false;
    $('#peek').onclick=()=>{ shown=!shown; $('#pws').textContent=shown?pw:'••••••'; $('#peek').textContent=shown?'Hide it':'Show it'; };
    $('#ok').onclick=done;
  }
  function enter(){
    pbody.innerHTML=`<p class="muted" style="margin-bottom:18px">Type your password to log in.</p>
    <div class="home">${pwInput('pw1','Password','current-password')}
      <label class="showpw"><input type="checkbox" id="show"> Show my password</label>
      <div class="fb bad" id="err" role="alert"></div>
      <div class="tools"><button class="btn" id="nm">That's not me</button><button class="btn primary" id="go">Log in</button></div>
      <p class="note centre">Forgotten your password? Ask your teacher.</p></div>`;
    const p1=$('#pw1'), err=$('#err'), btn=$('#go');
    $('#nm').onclick=notMe;
    $('#show').onchange=e=>{ p1.type=e.target.checked?'text':'password'; };
    p1.focus();
    const submit=async()=>{
      if(!p1.value){ err.textContent='Type your password first.'; return; }
      btn.disabled=true; btn.textContent='Checking…'; err.textContent='';
      try{
        const j=await API.post(Object.assign({action:'studentLogin',password:p1.value},who));
        if(j.needsPassword) return create();
        done();
      }catch(e){ err.textContent=e.message; btn.disabled=false; btn.textContent='Log in'; p1.select(); }
    };
    btn.onclick=submit; p1.onkeydown=e=>{ if(e.key==='Enter') submit(); };
  }
  if(!API.has()) return offline('The Google Sheet link is not set up in js/config.js, so passwords can\'t be checked.');
  check();
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
    if(!await ensureLatest(btn)) return;
    btn.disabled=true; btn.textContent='Checking…'; err.textContent='';
    try{ await API.post({action:'teacherLogin',password:pw}); teacher={room,password:pw}; go('teacherHome'); }
    catch(e){ err.textContent=/wrong teacher password/i.test(e.message)?'That password is not right.':e.message; btn.disabled=false; btn.textContent='Log in'; }
  };
  $('#login').onclick=submit; $('#pw').onkeydown=e=>{ if(e.key==='Enter') submit(); };
};

/* ---------- teacher ---------- */
SCREENS.teacherHome=function(msg){
  if(!teacher) return go('teacherLogin');
  app.innerHTML=`<div class="act-head"><div><div class="crumb">Teacher</div><h2>${esc(teacher.room)}</h2></div><button class="btn small" id="out">Log out</button></div>
  <div class="grid single"><button class="tile" id="setSt"><span class="ic" aria-hidden="true">🗂️</span><span class="nm">Set Student Stages</span></button>
  <button class="tile" id="setActs"><span class="ic" aria-hidden="true">☑️</span><span class="nm">Set Activities</span></button>
  <button class="tile" id="seeProg"><span class="ic" aria-hidden="true">📊</span><span class="nm">See Student Progress</span></button>
  <button class="tile" id="celeb"><span class="ic" aria-hidden="true">🎉</span><span class="nm">Preview Celebrations</span></button></div>`;
  $('#out').onclick=()=>{ teacher=null; go('role'); };
  $('#setSt').onclick=()=>go('stagesTerm');
  $('#setActs').onclick=()=>go('actsTerm');
  $('#seeProg').onclick=()=>go('teacherData');
  $('#celeb').onclick=()=>go('celebPreview');
  if(msg) toast(msg);
};
SCREENS.celebPreview=function(){
  if(!teacher) return go('teacherLogin');
  const L=[[1,'Under 100%'],[2,'100%, no new medal'],[3,'Bronze medal'],[4,'Silver medal'],[5,'Gold medal'],[6,'Term trophy'],[7,'Year trophy']];
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(teacher.room)}</div><h2>Preview celebrations</h2></div><button class="btn small" id="back">Back</button></div>
  <p class="centre">Tap one to see the pop-up a student gets when they finish an activity. Nothing is saved.</p>
  <div class="btnrow" id="cp">${L.map(([t,l])=>`<button class="btn" data-t="${t}">${t}. ${l}</button>`).join('')}</div>`;
  $('#back').onclick=()=>go('teacherHome');
  $('#cp').onclick=e=>{
    const b=e.target.closest('[data-t]'); if(!b) return; const t=+b.dataset.t;
    showCelebration(t,{score:t===1?7:10,total:10,term:3,week:5,n:{1:1,2:3,3:2,4:4,5:6,6:6,7:6}[t],mt:6,fr:{3:FR_PAY.bronze,4:FR_PAY.silver,5:FR_PAY.gold,6:FR_PAY.gold,7:FR_PAY.gold}[t]||0,goldWeeks:t>=6?9:4,name:'Sam'});
  };
};

/* ---------- teacher: set activities for a term ---------- */
const MENU_ROWS=[['wordlist','passage'],['testEasy','defEasy','clozeEasy'],['editing','dictation'],['testHard','defHard','clozeHard']];
SCREENS.actsTerm=function(){
  if(!teacher) return go('teacherLogin');
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(teacher.room)}</div><h2>Set activities</h2></div><button class="btn small" id="back">Back</button></div>
  <div class="cal-group centre"><h3>Which term?</h3><div class="btnrow" id="terms">${[1,2,3,4].map(t=>`<button class="btn" data-v="${t}">${t}</button>`).join('')}</div></div>
  <div id="msg" role="status"></div>`;
  $('#back').onclick=()=>go('teacherHome');
  $('#terms').onclick=async e=>{
    const b=e.target.closest('button'); if(!b) return; const term=+b.dataset.v;
    $('#terms').querySelectorAll('button').forEach(x=>{x.classList.toggle('sel',x===b);x.disabled=true;});
    $('#msg').innerHTML='<p class="muted centre">Loading Term '+term+'…</p>';
    try{
      const j=await API.get({action:'getActivities',room:teacher.room});
      const cur=(j.terms||{})[term];
      go('actsBoard',{term,current:Array.isArray(cur)&&cur.length?cur:ALL_ACTS.slice()});
    }catch(err){
      $('#msg').innerHTML='<div class="notice">'+esc(err.message)+(/Unknown action/.test(err.message)?' The Apps Script needs updating: paste in the new Code.gs and deploy a new version.':'')+'</div>';
      $('#terms').querySelectorAll('button').forEach(x=>{x.disabled=false;x.classList.remove('sel');});
    }
  };
};
SCREENS.actsBoard=function({term,current}){
  if(!teacher) return go('teacherLogin');
  const on=new Set(current);
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(teacher.room)}, Term ${term}</div><h2>Set activities</h2></div><button class="btn small" id="cancel">Cancel</button></div>
  <p class="centre">Untick an activity to hide it from your students in Term ${term}.<br><span class="muted">Activities marked 🏅 count towards medals.</span></p>
  <div class="tools"><button class="btn small" id="all">Select all</button></div>
  <div class="actlist">${MENU_ROWS.map(r=>`<div class="actrow">${r.map(id=>`<label class="actchk${ASSESSED.includes(id)?' medal':''}">
      <input type="checkbox" value="${id}" ${on.has(id)?'checked':''}>
      <span class="box" aria-hidden="true"></span><span class="ic" aria-hidden="true">${ICONS[id]}</span>
      <span class="nm">${NAMES[id]}</span>${ASSESSED.includes(id)?'<span class="mtag" title="Counts towards medals">🏅</span>':''}</label>`).join('')}</div>`).join('')}</div>
  <div class="mpreview" id="mp" role="status"></div>
  <div class="fb bad centre" id="err" role="alert"></div>
  <div class="tools"><button class="btn primary" id="confirm">Confirm</button></div>`;
  const boxes=[...app.querySelectorAll('.actchk input')];
  const chosen=()=>ALL_ACTS.filter(a=>boxes.find(b=>b.value===a).checked);
  function preview(){
    const list=chosen(), mt=ASSESSED.filter(a=>list.includes(a)).length, t=thresholds(mt);
    $('#mp').innerHTML=`<b>${list.length} of ${ALL_ACTS.length}</b> activities visible. `+(mt
      ?`Medals from ${mt} activit${mt===1?'y':'ies'}: `+[t.bronze<t.gold?`🥉 ${t.bronze}`:'',t.silver<t.gold&&t.silver>t.bronze?`🥈 ${t.silver}`:'',`🥇 all ${mt}`].filter(Boolean).join(' · ')+' at 100%.'
      :'<span class="warn">No medal activities are ticked, so students can\'t earn medals or Fremantium this term.</span>');
    boxes.forEach(b=>b.closest('.actchk').classList.toggle('off',!b.checked));
  }
  boxes.forEach(b=>b.onchange=preview); preview();
  $('#all').onclick=()=>{ boxes.forEach(b=>b.checked=true); preview(); };
  $('#cancel').onclick=()=>go('teacherHome');
  $('#confirm').onclick=async()=>{
    const list=chosen(), err=$('#err'); err.textContent='';
    if(!list.length){ err.textContent='Leave at least one activity ticked.'; return; }
    if(list.join(',')===ALL_ACTS.filter(a=>on.has(a)).join(',')){ go('teacherHome',`Nothing changed for Term ${term}.`); return; }
    const hidden=ALL_ACTS.filter(a=>!list.includes(a)).map(a=>NAMES[a]);
    if(!await confirmDlg(`<b>Save these activities for Term ${term}?</b><br>${hidden.length?`Hidden from students: ${esc(hidden.join(', '))}.`:'Every activity will be visible.'}
      <span class="dlgwarn">⚠️ Changing the activities during a term may alter student rewards. Medals are worked out again from the activities that are switched on, and every student's supermarket is restocked with their Fremantium given back.</span>`,'Continue','Go back')) return;
    if(!await confirmDlg(`<b>Are you sure?</b><br>Students will see the new activity list for Term ${term} straight away, and their rewards may change.`,'Yes, save the changes','Cancel')) return;
    const btn=$('#confirm'); btn.disabled=true; btn.textContent='Saving…';
    try{
      const j=await API.post({action:'setActivities',password:teacher.password,room:teacher.room,term,activities:list});
      go('teacherHome',`Activities set for Term ${term}.`+(j.restocked?` ${j.restocked} student${j.restocked>1?"s'":"'s"} supermarket${j.restocked>1?'s were':' was'} restocked.`:''));
    }catch(e){ err.textContent=e.message; btn.disabled=false; btn.textContent='Confirm'; }
  };
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
let roomData=null;   // {stages:{term:{cn:stage}}, perfect:{cn:{term:{week:[activities at 100%]}}}, activities:{term:[..]|null}}
function tMedalActs(term){ const a=(roomData.activities||{})[term]; const on=Array.isArray(a)&&a.length?a:ALL_ACTS; return ASSESSED.filter(x=>on.includes(x)); }
function tMedal(cn,term,week){
  const list=(((roomData.perfect[cn]||{})[term])||{})[week]||[], on=tMedalActs(term);
  return medalFor(list.filter(a=>on.includes(a)).length,on.length);
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
    try{ const j=await API.post({action:'getRoomProgress',password:teacher.password,room:teacher.room}); roomData={stages:j.stages||{},perfect:j.perfect||{},activities:j.activities||{}}; draw(); }
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
    const med=medalFromDone(done,S.term), on=termActs(S.term);
    const tileH=id=>{ const d=done[id];
      const st=d?(isPerfect(d)?'done':'tried'):'';
      return `<button class="tile ${st}${RESOURCES.includes(id)?' resource':''}${MIDGREY.includes(id)?' midgrey':''}" data-a="${id}" ${!L?'disabled':''}>${d?`<span class="tag ${isPerfect(d)?'ok':'part'}">${isPerfect(d)?'✓ ':''}${d.score}/${d.total}</span>`:''}<span class="ic" aria-hidden="true">${ICONS[id]}</span><span class="nm">${NAMES[id]}</span></button>`; };
    const row=ids=>{ ids=ids.filter(id=>on.includes(id)); return ids.length?`<div class="grid r${ids.length}">${ids.map(tileH).join('')}</div>`:''; };
    const intro=!w?`<div class="notice">There are no Stage ${S.stage} lessons for Term ${S.term} in the PLD teaching sequence. Tap <b>Term</b> at the top to choose another term, or ask your teacher.</div>`
      :`<h2 class="wk">Week ${S.week} ${medalHTML(med)}</h2>
       <p class="muted" style="margin:0">Stage ${S.stage}, Term ${S.term}${w.l?`, List ${w.l}`:''}</p>
       <p class="medalkey">${medalRule(medalActs(S.term).length)}</p>`;
    app.innerHTML=`<div class="intro">${intro}</div>`+MENU_ROWS.map(row).join('');
    app.querySelectorAll('.tile').forEach(t=>t.onclick=()=>go(t.dataset.a));
  }
  draw();
  if(!API.has()) return;
  flushResults().then(()=>Promise.all([syncProgress(),syncActs(S.room)])).then(()=>draw()).catch(()=>{});
  refreshWallet().catch(()=>{});
};
const TERM_TROPHY={1:'🪐',2:'💫',3:'🔱',4:'⚜️'};
function stageForTerm(term){ const m=(store.get(STAGE_KEY,{})[S.room+'|'+term])||{}; return m[S.classNumber]?+m[S.classNumber]:null; }
function weekMedal(term,stage,week){
  if(!stage) return null;
  const done=store.get(DONE_KEY,{})[[S.room,S.classNumber,term,stage,week].join('|')]||{};
  return medalFromDone(done,term);
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
  flushResults().then(()=>Promise.all([syncActs(S.room),...[1,2,3,4].flatMap(t=>[syncStages(t),syncTerm(t)])]))
    .then(()=>draw('ready')).catch(()=>draw('offline'));
};

/* ---------- supermarket + fridge ---------- */
const SHOP_AISLE_KEY='pldSpell.aisle.v1';
const TIER_NAMES=['Top shelf','Second shelf','Third shelf','Bottom shelf'];
const ITEM={};
SHOP.aisles.forEach(a=>a.shelves.forEach((sh,t)=>sh.forEach(([id,em,name,price])=>{ ITEM[id]={id,em,name,price,aisle:a.id,tier:t}; })));
const aisleItems=a=>a.shelves.flat().map(x=>ITEM[x[0]]);
function studentBack(){ go(S.term&&S.stage&&S.stageLocked&&S.week?'menu':'calib'); }
function kaching(){
  const s=SFX.session(0.25); if(!s) return;
  const t=s.now()+0.02; s.pop(t,0,0.25); s.bell(88,t+0.05,0.14,0.6); s.bell(95,t+0.14,0.14,1); s.sparkle(t+0.3,4,0.04);
  setTimeout(()=>s.stop(),2500);
}
SCREENS.shop=function(arg){
  if(S.role!=='student'||!S.authed) return go('role');
  let ai=arg&&arg.aisle?SHOP.aisles.findIndex(a=>a.id===arg.aisle):+store.get(SHOP_AISLE_KEY,0);
  if(!(ai>=0&&ai<SHOP.aisles.length)) ai=0;
  let status=API.has()?'loading':'offline', busy=false;
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(S.student)}</div><h2>Supermarket</h2></div>
    <div class="tools" style="margin:0"><button class="btn small" id="back">Back to activities</button><button class="btn small" id="toFridge">🧊 My fridge</button></div></div>
    <div class="aisletabs" role="tablist" aria-label="Aisles">${SHOP.aisles.map((a,i)=>`<button role="tab" class="atab" data-i="${i}" style="--ac:${a.colour}"><span class="ic" aria-hidden="true">${a.icon}</span><span class="an">${esc(a.name)}</span></button>`).join('')}</div>
    <p id="shopmsg" class="shopmsg" role="status"></p>
    <div id="aisle"></div>`;
  $('#back').onclick=studentBack; $('#toFridge').onclick=()=>go('fridge');
  app.querySelector('.aisletabs').onclick=e=>{ const b=e.target.closest('[data-i]'); if(!b) return; ai=+b.dataset.i; store.set(SHOP_AISLE_KEY,ai); draw(); };
  function draw(){
    if(S.screen!=='shop') return;
    const a=SHOP.aisles[ai], owned=new Set(wallet?wallet.owned:[]), bal=wallet?wallet.balance:0;
    app.querySelectorAll('.atab').forEach((b,i)=>{ b.classList.toggle('sel',i===ai); b.setAttribute('aria-selected',i===ai); });
    const left=aisleItems(a).filter(it=>!owned.has(it.id)).length;
    $('#shopmsg').innerHTML=status==='loading'&&!wallet?'Checking your Fremantium…'
      :status==='offline'?"Couldn't reach the Google Sheet. You can look around, but you can't buy anything until the internet is back."
      :`You have ${frAmt(bal)} to spend. Tap something to buy it.`;
    $('#aisle').innerHTML=`<div class="market" style="--ac:${a.colour}">
      <div class="aisle-sign"><span class="num">Aisle ${ai+1}</span><span class="nm">${a.icon} ${esc(a.name)}</span><span class="left">${left?`${left} left`:'All sold out!'}</span></div>
      <div class="shelving">${a.shelves.map((sh,t)=>`<div class="mshelf t${t}"><div class="goods">${sh.map(([id])=>{ const it=ITEM[id], sold=owned.has(id), dear=!sold&&wallet&&it.price>bal;
          return `<button class="good${sold?' sold':''}${dear?' dear':''}" data-id="${id}" aria-label="${esc(it.name)}, ${it.price} Fremantium${sold?', sold out':dear?', not enough Fremantium yet':''}">
            <span class="g-em" aria-hidden="true">${it.em}</span><span class="g-nm" aria-hidden="true">${esc(it.name)}</span>
            <span class="g-tag" aria-hidden="true">${frIcon()}${it.price}</span>${sold?'<span class="g-sold" aria-hidden="true">SOLD OUT</span>':''}</button>`; }).join('')}</div>
          <div class="rail"><span>${TIER_NAMES[t]||''}</span></div></div>`).join('')}</div>
    </div>`;
  }
  $('#aisle').onclick=async e=>{
    const b=e.target.closest('.good'); if(!b||busy) return;
    const it=ITEM[b.dataset.id];
    if(wallet&&wallet.owned.includes(it.id)){ toast(`${it.em} Sold out! The ${it.name} is already in your fridge.`); return; }
    if(status!=='ready'||!wallet){ toast("You can't buy anything until the Google Sheet can be reached."); return; }
    if(wallet.balance<it.price){ const need=it.price-wallet.balance; toast(`You need ${need} more Fremantium for the ${it.name}. Earn medals to get more!`); return; }
    if(!await confirmDlg(`<span class="dlg-em" aria-hidden="true">${it.em}</span><br>Buy the <b>${esc(it.name)}</b> for <b>${it.price}</b> Fremantium?<br><span class="muted">You'll have ${wallet.balance-it.price} left.</span>`,'Buy it!','Not yet')) return;
    busy=true; b.classList.add('buying');
    try{
      const j=await API.post({action:'buyItem',room:S.room,classNumber:S.classNumber,student:S.student,itemId:it.id,price:it.price,catalogVersion:SHOP.version});
      setWallet(j); kaching(); bumpFr(); draw();
      const nb=$('#aisle')&&$('#aisle').querySelector(`[data-id="${it.id}"]`); if(nb) nb.classList.add('justsold');
      toast(`${it.em} The ${it.name} is in your fridge!`);
    }catch(err){ toast(err.message); refresh(); }
    finally{ busy=false; }
  };
  async function refresh(){ try{ await refreshWallet(); status='ready'; }catch(e){ status='offline'; } draw(); }
  draw(); if(API.has()) refresh();
};

/* the fridge: each supermarket aisle has its own compartment */
const FRIDGE_SPOT={frozen:'freezer',dairy:'shelf',butcher:'shelf',fruit:'drawer',veg:'drawer',drinks:'door'};
const COMP={freezer:{rows:2,lift:38,base:6},fshelf:{rows:2,lift:32,base:6},drawer:{rows:3,lift:36,base:21},rack:{rows:2,lift:30,base:16}};
function packItems(items,kind,owned){
  // back rows hold more, smaller items; the front row is bigger and sits between them, so it looks 3D
  const c=COMP[kind], R=Math.min(c.rows,items.length)||1, sizes=[]; let rem=items.length;
  for(let r=0;r<R;r++){ const k=Math.ceil(rem/(R-r)); sizes.push(k); rem-=k; }
  const list=items.slice().sort((a,b)=>a.price-b.price);   // the dearest items go at the front
  let idx=0, h='';
  sizes.forEach((k,r)=>{
    const depth=R===1?1:r/(R-1), sc=(0.62+0.38*depth).toFixed(2), bottom=(c.base+(1-depth)*c.lift).toFixed(1);
    for(let i=0;i<k;i++){
      const it=list[idx++], own=owned.has(it.id);
      const x=(r%2?(i+1)/(k+1):(i+0.5)/k), left=(5+90*x).toFixed(1);
      h+=`<span class="fi${own?(depth<1?' back':''):' sil'}" style="left:${left}%;bottom:${bottom}%;--sc:${sc};z-index:${r+1}" title="${own?esc(it.name):'Not bought yet'}">${it.em}</span>`;
    }
  });
  return h;
}
SCREENS.fridge=function(){
  if(S.role!=='student'||!S.authed) return go('role');
  let status=API.has()?'loading':'offline';
  const total=Object.keys(ITEM).length;
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(S.student)}</div><h2>My fridge</h2></div>
    <div class="tools" style="margin:0"><button class="btn small" id="back">Back to activities</button><button class="btn small" id="toShop">🛒 Supermarket</button><button class="btn small" id="reset">↺ Reset</button></div></div>
    <p id="fmsg" class="shopmsg" role="status"></p><div id="fbox"></div>`;
  $('#back').onclick=studentBack; $('#toShop').onclick=()=>go('shop');
  function comp(a,kind,owned,extra){
    const its=aisleItems(a), got=its.filter(it=>owned.has(it.id)).length;
    return `<div class="comp ${kind}" style="--ac:${a.colour}">
      <button class="clabel" data-aisle="${a.id}" aria-label="${esc(a.fridge||a.name)}: ${got} of ${its.length}. Open the ${esc(a.name)} aisle">${a.icon} ${esc(a.fridge||a.name)} <b>${got}/${its.length}</b></button>
      <div class="items" aria-hidden="true">${packItems(its,kind,owned)}</div>${extra||''}</div>`;
  }
  function door(a,owned){
    const its=aisleItems(a).slice().sort((x,y)=>x.price-y.price), got=its.filter(it=>owned.has(it.id)).length;
    const racks=[], n=3; let rem=its.length, idx=0;
    for(let r=0;r<n;r++){ const k=Math.ceil(rem/(n-r)); racks.push(its.slice(idx,idx+k)); idx+=k; rem-=k; }
    return `<div class="fr-door" style="--ac:${a.colour}"><button class="clabel" data-aisle="${a.id}" aria-label="${esc(a.fridge||a.name)}: ${got} of ${its.length}. Open the ${esc(a.name)} aisle">${a.icon} ${esc(a.fridge||a.name)} <b>${got}/${its.length}</b></button>
      ${racks.map(rk=>`<div class="comp rack"><div class="items" aria-hidden="true">${packItems(rk,'rack',owned)}</div><div class="rfront"></div></div>`).join('')}</div>`;
  }
  function draw(){
    if(S.screen!=='fridge') return;
    const owned=new Set(wallet?wallet.owned:[]), n=owned.size;
    $('#fmsg').innerHTML=(status==='offline'?"Couldn't reach the Google Sheet, so this shows what's saved on this iPad. ":'')
      +`${n} of ${total} items in your fridge.`+(wallet?` You have ${frAmt(wallet.balance)} to spend.`:'')+(n<total?' Tap a label to go to that aisle.':' Your fridge is FULL. Amazing!');
    const by=k=>SHOP.aisles.filter(a=>(FRIDGE_SPOT[a.id]||'shelf')===k);
    $('#fbox').innerHTML=`<div class="fridge">
      <div class="fz">${by('freezer').map(a=>comp(a,'freezer',owned)).join('')}<span class="handle h-fz" aria-hidden="true"></span></div>
      <div class="fr-body"><div class="fr-inside">
          ${by('shelf').map(a=>comp(a,'fshelf',owned,'<div class="glass"></div>')).join('')}
          <div class="drawers">${by('drawer').map(a=>comp(a,'drawer',owned,'<div class="dfront"></div>')).join('')}</div>
        </div>${by('door').map(a=>door(a,owned)).join('')}<span class="handle h-fr" aria-hidden="true"></span></div>
      <div class="feet" aria-hidden="true"><i></i><i></i></div></div>`;
    $('#reset').disabled=!(wallet&&n)||status!=='ready';
  }
  $('#fbox').onclick=e=>{ const b=e.target.closest('[data-aisle]'); if(b) go('shop',{aisle:b.dataset.aisle}); };
  $('#reset').onclick=async()=>{
    if(!wallet||!wallet.owned.length) return;
    if(!await confirmDlg(`<b>Empty your fridge?</b><br>Everything goes back on the supermarket shelves, and you get all ${wallet.spent} Fremantium back to spend again.`,'Yes, reset','Keep my food')) return;
    const btn=$('#reset'); btn.disabled=true;
    try{ const j=await API.post({action:'resetPurchases',room:S.room,classNumber:S.classNumber,catalogVersion:SHOP.version}); setWallet(j); draw(); toast(`The supermarket is restocked. You have ${wallet.balance} Fremantium to spend.`); }
    catch(err){ toast(err.message); btn.disabled=false; }
  };
  draw();
  if(API.has()) refreshWallet().then(()=>{ status='ready'; draw(); }).catch(()=>{ status='offline'; draw(); });
};

/* ---------- celebration pop-ups ----------
   Tier 1  under 100%                 plain results card
   Tier 2  100%, no new medal          small confetti pop
   Tier 3  100% + new bronze           confetti burst, medal drops in
   Tier 4  100% + new silver           bigger bursts, side cannons, sparkles
   Tier 5  100% + new gold             corner cannons, gold rain, shake
   Tier 6  100% + new term trophy      night sky, fireworks, light rays
   Tier 7  100% + new year trophy      full fireworks show with a finale
   ------------------------------------------------ */
const MRANK={bronze:1,silver:2,gold:3};
const CEL_COLS=['#ff4d6d','#ffd23f','#3ec1d3','#7bd389','#a06cd5','#ff8c42','#4d96ff','#ffffff'];
const CEL_METAL={bronze:['#cd7f32','#e8a36a','#8c5220','#ffd9b0'],silver:['#c0c7d4','#ffffff','#8a94a6','#e6ebf2'],gold:['#ffd23f','#f5b700','#fff3b0','#e09f00']};
function termTrophyFor(term){
  const st=term===S.term?S.stage:stageForTerm(term); if(!st) return false;
  for(let w=1;w<=9;w++) if(weekMedal(term,st,w)!=='gold') return false;
  return true;
}
function awardState(){ const n=perfectCount(weekDone(),S.term), mt=medalActs(S.term).length; return {n,mt,medal:medalFor(n,mt),term:termTrophyFor(S.term)}; }
function goldWeeks(){ let c=0; for(let w=1;w<=9;w++) if(weekMedal(S.term,S.stage,w)==='gold') c++; return c; }
const withTimeout=(p,ms)=>Promise.race([p,new Promise(r=>setTimeout(r,ms))]);
async function celebrateResult(score,total,before){
  const after=awardState(); let tier=1;
  if(score===total){
    tier=2;
    if(after.medal&&(MRANK[after.medal]||0)>(MRANK[before.medal]||0)) tier=2+MRANK[after.medal];
    if(after.term&&!before.term){
      tier=6;
      // bring the other terms up to date before deciding on the whole year trophy
      if(API.has()) await withTimeout(Promise.all([1,2,3,4].filter(t=>t!==S.term).flatMap(t=>[syncStages(t),syncTerm(t)])).catch(()=>{}),5000);
      if([1,2,3,4].every(termTrophyFor)) tier=7;
    }
  }
  // Fremantium for reaching a medal for the first time this week (3 bronze, 5 silver, 10 gold)
  const fr=Math.max(0,medalValue(after.medal)-medalValue(before.medal));
  if(fr&&wallet){ wallet.earned+=fr; wallet.balance+=fr; updateTopbar(); bumpFr(); }
  showCelebration(tier,{score,total,term:S.term,week:S.week,n:after.n,mt:after.mt,fr,goldWeeks:goldWeeks(),name:S.firstName||S.student});
  refreshWallet().catch(()=>{});
}
function nextHint(n,mt){
  if(!mt||n>=mt) return '';
  const t=thresholds(mt);
  const [need,m]=n<t.bronze?[t.bronze-n,'🥉']:(n<t.silver&&t.silver<mt)?[t.silver-n,'🥈']:[mt-n,'🥇'];
  return `${need} more green ${need===1?'activity':'activities'} for ${m}`;
}
function celText(tier,d){
  const tt=TERM_TROPHY[d.term]||'🏆';
  switch(tier){
    case 1: return {h:'Activity finished',ic:'📝',msg:(d.score>=d.total*0.7?'Great effort! ':'Keep practising! ')+'Get 100% to turn this activity green.',btn:'OK'};
    case 2: return {h:'100%!',ic:'⭐',msg:'Every one right! This activity is now green.',sub:nextHint(d.n,d.mt),btn:'Awesome!'};
    case 3: return {h:'Bronze medal!',ic:'🥉',msg:`You earned a bronze medal for Week ${d.week}!`,sub:nextHint(d.n,d.mt),btn:'Awesome!'};
    case 4: return {h:'Silver medal!',ic:'🥈',msg:`You earned a silver medal for Week ${d.week}!`,sub:nextHint(d.n,d.mt),btn:'Amazing!'};
    case 5: return {h:'GOLD MEDAL!',ic:'🥇',msg:`All ${d.mt} activit${d.mt===1?'y':'ies'} at 100%. Gold for Week ${d.week}!`,sub:`${d.goldWeeks} of 9 gold weeks for the Term ${d.term} trophy ${tt}`,btn:'Incredible!'};
    case 6: return {h:`TERM ${d.term} TROPHY!`,ic:tt,msg:`Gold in all 9 weeks of Term ${d.term}. The Term ${d.term} trophy is yours!`,sub:`🥇 Plus a gold medal for Week ${d.week}`,btn:"Let's go!"};
    default: return {h:'SPELLING CHAMPION!',ic:'🏆',msg:`${esc(d.name||'You')}, you've won all four term trophies and the WHOLE YEAR TROPHY!`,row:[1,2,3,4].map(t=>TERM_TROPHY[t]),btn:"I'm a legend!"};
  }
}
/* ---------- sound effects ----------
   Every sound is made in the browser with the Web Audio API, so there are no audio files to upload.
   Turn all sound off for the whole class by adding  SOUND: false  to js/config.js.
   ------------------------------------------------ */
const SOUND_KEY='pldSpell.sound.v1';
const SFX=(function(){
  let ctx=null, out=null, rev=null, noiseBuf=null;
  const allowed=()=>CONFIG.SOUND!==false;
  const enabled=()=>allowed()&&store.get(SOUND_KEY,true)!==false;
  const supported=()=>!!(window.AudioContext||window.webkitAudioContext);
  function init(){
    if(ctx) return ctx;
    const AC=window.AudioContext||window.webkitAudioContext; if(!AC) return null;
    try{ ctx=new AC(); }catch(e){ return null; }
    const comp=ctx.createDynamicsCompressor(); comp.threshold.value=-16; comp.ratio.value=4;
    const lim=ctx.createDynamicsCompressor(); lim.threshold.value=-4; lim.knee.value=0; lim.ratio.value=20; lim.attack.value=0.002; lim.release.value=0.15;
    out=ctx.createGain(); out.gain.value=0.65; out.connect(comp); comp.connect(lim); lim.connect(ctx.destination);
    const len=Math.floor(ctx.sampleRate*2.6), ir=ctx.createBuffer(2,len,ctx.sampleRate);      // concert-hall echo
    for(let ch=0;ch<2;ch++){ const dd=ir.getChannelData(ch); for(let i=0;i<len;i++) dd[i]=(Math.random()*2-1)*Math.pow(1-i/len,3); }
    rev=ctx.createConvolver(); rev.buffer=ir; rev.connect(out);
    noiseBuf=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    const nd=noiseBuf.getChannelData(0); for(let i=0;i<nd.length;i++) nd[i]=Math.random()*2-1;
    return ctx;
  }
  // iPads only allow sound after a tap, so wake the audio on every tap
  function unlock(){ if(!allowed()) return; const c=init(); if(c&&c.state==='suspended') c.resume().catch(()=>{}); }
  function session(wet){
    if(!enabled()) return null;
    const c=init(); if(!c) return null;
    if(c.state==='suspended') c.resume().catch(()=>{});
    const bus=c.createGain(); bus.connect(out);
    const send=c.createGain(); send.gain.value=wet; bus.connect(send); send.connect(rev);
    const hz=m=>440*Math.pow(2,(m-69)/12);
    const dest=pan=>{ if(pan==null||!c.createStereoPanner) return bus; const p=c.createStereoPanner(); p.pan.value=Math.max(-1,Math.min(1,pan)); p.connect(bus); return p; };
    const env=(g,t,a,peak,d)=>{ g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(Math.max(peak,0.0002),t+a); g.gain.exponentialRampToValueAtTime(0.0001,t+a+d); };
    const S={
      now:()=>c.currentTime,
      tone(m,t,d,o={}){ const osc=c.createOscillator(), g=c.createGain(); osc.type=o.type||'sine';
        osc.frequency.setValueAtTime(o.f||hz(m),t); if(o.to) osc.frequency.exponentialRampToValueAtTime(o.to,t+d);
        env(g,t,o.a||0.01,o.v||0.2,d); osc.connect(g); g.connect(dest(o.pan)); osc.start(t); osc.stop(t+(o.a||0.01)+d+0.05); },
      bell(m,t,v=0.18,d=1.2,pan){ S.tone(m,t,d,{v,pan}); S.tone(0,t,d*0.6,{f:hz(m)*2.76,v:v*0.3,pan}); S.tone(0,t,d*0.3,{f:hz(m)*5.4,v:v*0.1,pan}); },
      brass(m,t,d,v=0.14,pan){
        const f=c.createBiquadFilter(); f.type='lowpass'; f.Q.value=2;
        f.frequency.setValueAtTime(500,t); f.frequency.exponentialRampToValueAtTime(3200,t+0.06); f.frequency.exponentialRampToValueAtTime(1600,t+Math.max(0.12,d));
        const g=c.createGain(); g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(v,t+0.03);
        g.gain.setValueAtTime(v*0.8,t+Math.max(0.05,d-0.05)); g.gain.exponentialRampToValueAtTime(0.0001,t+d+0.25);
        f.connect(g); g.connect(dest(pan));
        [-7,7].forEach(dt=>{ const o=c.createOscillator(); o.type='sawtooth'; o.frequency.value=hz(m); o.detune.value=dt; o.connect(f); o.start(t); o.stop(t+d+0.3); });
      },
      pad(ms,t,d,v=0.05){ ms.forEach(m=>{
        const o=c.createOscillator(), g=c.createGain(), lfo=c.createOscillator(), lg=c.createGain();
        o.type='triangle'; o.frequency.value=hz(m); lfo.frequency.value=5; lg.gain.value=5; lfo.connect(lg); lg.connect(o.detune);
        g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(v,t+0.2); g.gain.setValueAtTime(v,t+d); g.gain.exponentialRampToValueAtTime(0.0001,t+d+0.9);
        o.connect(g); g.connect(bus); o.start(t); lfo.start(t); o.stop(t+d+1); lfo.stop(t+d+1); }); },
      noise(t,d,o={}){ const src=c.createBufferSource(); src.buffer=noiseBuf; const f=c.createBiquadFilter(); f.type=o.ft||'bandpass';
        f.frequency.setValueAtTime(o.fq||1500,t); if(o.fto) f.frequency.exponentialRampToValueAtTime(o.fto,t+(o.a||0)+d); f.Q.value=o.q||1;
        const g=c.createGain(); env(g,t,o.a||0.003,o.v||0.3,d); src.connect(f); f.connect(g); g.connect(dest(o.pan));
        src.start(t,Math.random()*1.5); src.stop(t+(o.a||0.003)+d+0.05); },
      pop(t,pan,v=0.45){ S.noise(t,0.07,{fq:1800,q:0.8,v,pan}); S.tone(0,t,0.08,{f:620,to:180,v:v*0.5,pan}); },
      kick(t,v=0.6){ S.tone(0,t,0.35,{f:140,to:45,v}); },
      snare(t,v=0.25){ S.noise(t,0.11,{ft:'highpass',fq:1400,v}); },
      roll(t,d,v0=0.03,v1=0.3){ const n=Math.floor(d/0.045); for(let i=0;i<n;i++) S.snare(t+i*0.045,v0+(v1-v0)*i/n); },
      timpani(m,t,v=0.45){ S.tone(m,t,1.1,{v}); S.tone(0,t,0.35,{f:hz(m)*1.5,v:v*0.3}); S.noise(t,0.08,{ft:'lowpass',fq:400,v:v*0.5}); },
      timroll(m,t,d,v0=0.05,v1=0.4){ const n=Math.floor(d/0.07); for(let i=0;i<n;i++) S.tone(m,t+i*0.07,0.25,{v:v0+(v1-v0)*i/n}); },
      crash(t,v=0.3){ S.noise(t,1.9,{ft:'highpass',fq:5000,q:0.5,v}); S.noise(t,0.5,{fq:3000,v:v*0.5}); },
      whoosh(t,d=0.6,v=0.18,pan){ S.noise(t,d*0.4,{fq:400,fto:4000,q:1.5,a:d*0.6,v,pan}); },
      riser(t,d,v=0.12){ S.noise(t,0.15,{fq:300,fto:6000,q:2,a:d,v}); },
      chime(t,v=0.05,pan){ S.bell(84+[0,4,7,12,16,19][Math.floor(Math.random()*6)],t,v,0.5,pan); },
      sparkle(t,n=5,v=0.05){ for(let i=0;i<n;i++) S.chime(t+i*0.05,v,Math.random()*1.6-0.8); },
      gliss(t,from,steps,gap,v=0.08){ const sc=[0,2,4,5,7,9,11]; for(let i=0;i<steps;i++) S.bell(from+12*Math.floor(i/7)+sc[i%7],t+i*gap,v,0.6,-0.8+1.6*i/steps); },
      whistle(t,d,pan){ const o=c.createOscillator(), g=c.createGain(), vib=c.createOscillator(), vg=c.createGain();
        o.type='sine'; o.frequency.setValueAtTime(650,t); o.frequency.exponentialRampToValueAtTime(1900+Math.random()*700,t+d);
        vib.frequency.value=16; vg.gain.value=25; vib.connect(vg); vg.connect(o.frequency);
        g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.03,t+0.12); g.gain.exponentialRampToValueAtTime(0.0001,t+d);
        o.connect(g); g.connect(dest(pan)); o.start(t); vib.start(t); o.stop(t+d+0.05); vib.stop(t+d+0.05); },
      crackle(t,d,pan){ for(let i=0;i<12;i++) S.noise(t+Math.random()*d,0.02,{ft:'highpass',fq:3000,v:0.04+Math.random()*0.1,pan:pan==null?null:pan+Math.random()*0.4-0.2}); },
      boom(t,pan,v=0.5){ S.tone(0,t,0.9,{f:95,to:32,v}); S.noise(t,1.1,{ft:'lowpass',fq:1000,fto:120,v:v*0.8,pan}); S.crackle(t+0.15,0.7,pan); },
      applause(t,d,v=0.12){ const n=Math.floor(d*40); for(let i=0;i<n;i++){ const tt=t+Math.random()*d, sh=Math.sin(Math.PI*Math.min(1,(tt-t)/d));
        S.noise(tt,0.03,{fq:900+Math.random()*1400,q:1.2,v:Math.max(0.005,v*(0.3+0.7*sh)*(0.5+Math.random()*0.5)),pan:Math.random()*1.6-0.8}); } },
      melody(notes,t,beat,v,shift=0,voice='brass'){ let tt=t; notes.forEach(([m,b])=>{ if(m) S[voice](m+shift,tt,b*beat*0.9,v); tt+=b*beat; }); return tt; },
      stop(){ try{ bus.gain.setTargetAtTime(0.0001,c.currentTime,0.06); setTimeout(()=>{ try{ bus.disconnect(); }catch(e){} },800); }catch(e){} }
    };
    return S;
  }
  return {unlock,session,enabled,allowed,supported,set(v){ store.set(SOUND_KEY,!!v); }};
})();
document.addEventListener('pointerdown',SFX.unlock,{capture:true,passive:true});
document.addEventListener('touchend',SFX.unlock,{capture:true,passive:true});

// the music for each tier gets longer, louder and grander (C major; MIDI note 60 = middle C)
const CEL_WET={1:0.08,2:0.15,3:0.22,4:0.3,5:0.38,6:0.48,7:0.6};
function playTierMusic(S,tier){
  const T=S.now()+0.05;
  if(tier===1){                                   // a quiet "done" blip
    S.tone(72,T,0.18,{type:'triangle',v:0.1}); S.tone(79,T+0.13,0.3,{type:'triangle',v:0.1});
  }else if(tier===2){                             // bright twinkly run
    [84,88,91,96].forEach((m,i)=>S.bell(m,T+i*0.08,0.15,0.9));
    S.sparkle(T+0.4,4,0.04);
  }else if(tier===3){                             // short fanfare
    const end=S.melody([[67,1],[72,1],[76,1],[79,4]],T+0.1,0.13,0.12);
    S.pad([60,64,67],end-0.52,0.6,0.04);
    S.bell(91,end-0.4,0.12,1.2); S.kick(T+0.35,0.35);
  }else if(tier===4){                             // longer fanfare with harmony and a shimmer
    const mel=[[72,1],[72,1],[72,1],[79,3],[76,1],[79,1],[84,6]];
    const end=S.melody(mel,T+0.1,0.13,0.12);
    S.melody(mel,T+0.1,0.13,0.06,-5);
    S.pad([60,64,67,72],end-0.78,1.0,0.05);
    S.kick(T+0.35,0.4); S.snare(T+0.35,0.2);
    S.gliss(T+0.9,72,15,0.04,0.07);
    S.crash(end-0.78,0.15);
  }else if(tier===5){                             // triumphant brass, drums and cymbals
    S.roll(T,0.25,0.03,0.22);
    S.crash(T+0.25,0.3); S.kick(T+0.25,0.6); S.timpani(36,T+0.25,0.45);
    const mel=[[67,1],[67,1],[67,1],[72,3],[76,2],[79,2],[84,8]];
    const st=T+0.3, end=S.melody(mel,st,0.14,0.13);
    S.melody(mel,st,0.14,0.07,-12);
    S.melody([[64,1],[64,1],[64,1],[67,3],[72,2],[76,2],[79,8]],st,0.14,0.06);
    S.timpani(36,end-1.12,0.5); S.pad([48,55,60,64,67],end-1.12,1.4,0.05);
    S.crash(end-1.12,0.28); S.whoosh(T+0.8,0.7,0.12);
    S.gliss(end-0.9,84,10,0.035,0.05);
  }else if(tier===6){                             // big entrance, full fanfare, applause
    S.crash(T,0.3); S.timpani(36,T,0.5); S.riser(T,0.9,0.1); S.timroll(36,T+0.1,0.9,0.05,0.35);
    const mel=[[72,1],[67,1],[72,1],[76,1],[79,3],[76,1],[79,2],[84,2],[83,1],[84,1],[86,1],[88,8]];
    const st=T+1.05, beat=0.16, end=S.melody(mel,st,beat,0.13);
    S.melody(mel,st,beat,0.07,-12);
    S.crash(st,0.32); S.kick(st,0.7);
    [0,4,8].forEach(b=>S.timpani(36,st+b*beat,0.4)); S.timpani(43,st+10*beat,0.45);
    S.pad([48,55,60,64],st,10*beat,0.045); S.pad([55,59,62,67],st+10*beat,5*beat,0.045);
    S.pad([48,55,60,64,67,72],end-8*beat,2.2,0.055);
    S.crash(end-8*beat,0.32); S.timpani(36,end-8*beat,0.55); S.kick(end-8*beat,0.6);
    S.gliss(end-8*beat+0.1,84,14,0.035,0.05);
    S.applause(end-8*beat+0.2,5,0.11);
  }else{                                          // the whole show
    S.riser(T,1.2,0.14); S.roll(T,1.25,0.02,0.3); S.timroll(31,T,1.25,0.04,0.4);
    const mel=[[67,1],[72,1],[76,1],[79,3],[76,1],[79,1],[84,4],[81,1],[79,1],[77,1],[76,1],[74,1],[76,1],[79,2],[84,10]];
    const har=[[64,1],[67,1],[72,1],[76,3],[72,1],[76,1],[79,4],[77,1],[76,1],[74,1],[72,1],[71,1],[72,1],[76,2],[79,10]];
    const st=T+1.3, beat=0.17, end=S.melody(mel,st,beat,0.14);
    S.melody(mel,st,beat,0.07,-12); S.melody(har,st,beat,0.07);
    S.crash(st,0.35); S.kick(st,0.8); S.timpani(36,st,0.55); S.bell(96,st,0.1,1.5);
    S.pad([48,55,60,64],st,12*beat,0.05);
    S.timpani(41,st+12*beat,0.45); S.pad([53,57,60,65],st+12*beat,4*beat,0.05);
    S.timpani(43,st+16*beat,0.45); S.pad([55,59,62,67],st+16*beat,4*beat,0.05);
    const fin=st+20*beat;                         // lines up with the fireworks finale
    S.pad([36,48,55,60,64,67,72,76],fin,2.6,0.05);
    S.crash(fin,0.4); S.crash(fin+0.05,0.3); S.kick(fin,0.9); S.timpani(36,fin,0.6); S.timroll(36,fin+0.1,1.2,0.4,0.05);
    S.gliss(fin+0.1,84,21,0.03,0.05);
    S.applause(fin,7,0.14);
    S.melody([[84,1],[79,1],[84,1],[88,1],[91,1],[96,6]],end+0.6,0.14,0.06,0,'bell');
  }
}

function Fireworks(canvas,hooks){
  hooks=hooks||{};
  const ctx=canvas.getContext('2d'), P=[]; let W=0,H=0,raf=0,alive=true;
  const rnd=(a,b)=>a+Math.random()*(b-a), pick=a=>a[Math.floor(Math.random()*a.length)];
  function size(){ const dpr=Math.min(window.devicePixelRatio||1,2); W=canvas.clientWidth; H=canvas.clientHeight; canvas.width=Math.round(W*dpr); canvas.height=Math.round(H*dpr); ctx.setTransform(dpr,0,0,dpr,0,0); }
  size(); window.addEventListener('resize',size);
  const add=p=>{ if(P.length<1800) P.push(p); };
  function burst(x,y,col){
    col=col||pick(CEL_COLS);
    if(hooks.burst) hooks.burst(x/W);
    const n=rnd(70,120)|0, col2=Math.random()<.4?pick(CEL_COLS):null, ring=Math.random()<.25, big=rnd(5,8);
    for(let i=0;i<n;i++){ const a=i/n*6.283+rnd(-.04,.04), v=ring?big:rnd(1,big);
      add({k:'s',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,col:col2&&i%2?col2:col,t:0,life:rnd(60,95),g:.05}); }
  }
  const api={
    get W(){ return W; }, get H(){ return H; },
    burst,
    confetti(x,y,n,o={}){
      if(hooks.confetti) hooks.confetti(x/W,n);
      const ang=o.angle==null?-Math.PI/2:o.angle, spr=o.spread==null?Math.PI*2:o.spread, sp=o.speed||[4,12], cols=o.cols||CEL_COLS;
      for(let i=0;i<n;i++){ const a=ang+rnd(-spr/2,spr/2), v=rnd(sp[0],sp[1]);
        add({k:'c',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,w:rnd(6,11),h:rnd(9,16),r:rnd(0,6.3),vr:rnd(-.25,.25),col:pick(cols),t:0,life:rnd(170,260),wob:rnd(0,6.3)}); }
    },
    rain(n,cols){ for(let i=0;i<n;i++) add({k:'c',x:rnd(0,W),y:rnd(-H*.8,-10),vx:rnd(-1,1),vy:rnd(1,3),w:rnd(6,11),h:rnd(9,16),r:rnd(0,6.3),vr:rnd(-.2,.2),col:pick(cols||CEL_COLS),t:0,life:420,wob:rnd(0,6.3)}); },
    emoji(chars,n){ for(let i=0;i<n;i++) add({k:'e',ch:pick(chars),x:rnd(20,W-20),y:rnd(-H,-40),vx:rnd(-.4,.4),vy:rnd(1.6,3.4),r:rnd(-.4,.4),vr:rnd(-.03,.03),s:rnd(26,46)|0,t:0,life:700}); },
    sparkle(x,y,n,cols){ if(hooks.sparkle) hooks.sparkle(x/W); for(let i=0;i<n;i++){ const a=rnd(0,6.3),v=rnd(1,4.5); add({k:'s',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,col:pick(cols||['#ffffff','#fff3b0','#ffd23f']),t:0,life:rnd(30,55),g:.02}); } },
    rocket(x){ const tx=x==null?rnd(W*.12,W*.88):x, ty=rnd(H*.1,H*.42), g=.12, vy=-Math.sqrt(2*g*(H+8-ty));
      if(hooks.launch) hooks.launch(tx/W,(-vy-1)/g/60);
      add({k:'r',x:tx,y:H+8,vx:rnd(-.8,.8),vy,g,col:pick(CEL_COLS),t:0,life:600}); },
    stop(){ alive=false; cancelAnimationFrame(raf); window.removeEventListener('resize',size); P.length=0; }
  };
  function frame(){
    if(!alive) return;
    ctx.clearRect(0,0,W,H);
    for(let i=P.length-1;i>=0;i--){
      const p=P[i]; p.t++;
      if(p.k==='c'){                       // confetti
        p.vx*=.985; p.vy=Math.min(p.vy*.985+.2,3.4);
        p.x+=p.vx+Math.sin(p.t*.08+p.wob)*.7; p.y+=p.vy; p.r+=p.vr;
        ctx.save(); ctx.globalAlpha=Math.max(0,Math.min(1,(p.life-p.t)/40)); ctx.translate(p.x,p.y); ctx.rotate(p.r); ctx.scale(1,Math.cos(p.t*.12+p.wob));
        ctx.fillStyle=p.col; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
        if(p.y>H+30) p.t=p.life;
      }else if(p.k==='e'){                 // falling emoji
        p.x+=p.vx; p.y+=p.vy; p.r+=p.vr;
        ctx.save(); ctx.globalAlpha=Math.max(0,Math.min(1,(p.life-p.t)/40)); ctx.translate(p.x,p.y); ctx.rotate(p.r);
        ctx.font=p.s+'px "Apple Color Emoji","Segoe UI Emoji",system-ui,sans-serif'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(p.ch,0,0); ctx.restore();
        if(p.y>H+60) p.t=p.life;
      }else if(p.k==='r'){                 // rocket going up
        p.vy+=p.g; p.x+=p.vx; p.y+=p.vy;
        ctx.globalAlpha=1; ctx.strokeStyle=p.col; ctx.lineWidth=3; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(p.x-p.vx*3,p.y-p.vy*3); ctx.lineTo(p.x,p.y); ctx.stroke();
        if(Math.random()<.6) add({k:'s',x:p.x,y:p.y,vx:rnd(-.6,.6),vy:rnd(.5,1.5),col:'#ffcf8a',t:0,life:rnd(15,30),g:.02});
        if(p.vy>=-1){ burst(p.x,p.y,p.col); p.t=p.life; }
      }else{                               // spark
        p.vx*=.965; p.vy=p.vy*.965+p.g; p.x+=p.vx; p.y+=p.vy;
        ctx.globalAlpha=Math.max(0,1-p.t/p.life); ctx.strokeStyle=p.col; ctx.lineWidth=2.4; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(p.x-p.vx*3,p.y-p.vy*3); ctx.lineTo(p.x,p.y); ctx.stroke();
      }
      if(p.t>=p.life) P.splice(i,1);
    }
    ctx.globalAlpha=1;
    raf=requestAnimationFrame(frame);
  }
  raf=requestAnimationFrame(frame);
  return api;
}
let closeCelebration=null;
function showCelebration(tier,d){
  if(closeCelebration) closeCelebration();
  KB.hide(); stopSpeech();
  const reduce=!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches);
  const c=celText(tier,d), pct=Math.round(d.score/d.total*100);
  const el=document.createElement('div');
  el.className='cel t'+tier; el.setAttribute('role','dialog'); el.setAttribute('aria-modal','true'); el.setAttribute('aria-labelledby','celH');
  el.innerHTML=`<canvas class="cel-fx" aria-hidden="true"></canvas>
    <div class="cel-card">
      ${SFX.allowed()&&SFX.supported()?`<button class="cel-snd" type="button" aria-pressed="${!SFX.enabled()}" aria-label="${SFX.enabled()?'Turn sound off':'Turn sound on'}">${SFX.enabled()?'🔊':'🔇'}</button>`:''}
      <div class="cel-icwrap">${tier>=6?'<div class="cel-rays" aria-hidden="true"></div>':''}<div class="cel-ic" aria-hidden="true">${c.ic}</div></div>
      <h2 class="cel-h" id="celH">${c.h}</h2>
      <div class="cel-score">${d.score}/${d.total} · ${pct}%</div>
      <p class="cel-msg">${c.msg}</p>
      ${c.row?`<div class="cel-row" aria-hidden="true">${c.row.map((e,i)=>`<span style="animation-delay:${(0.6+i*0.25).toFixed(2)}s">${e}</span>`).join('')}</div>`:''}
      ${c.sub?`<p class="cel-sub">${c.sub}</p>`:''}
      ${d.fr?`<div class="cel-fr"><span class="amt"><b>+${d.fr}</b> ${frIcon()} Fremantium</span><span class="why">to spend in the supermarket!</span></div>`:''}
      <button class="btn primary cel-btn" type="button">${c.btn}</button>
    </div>`;
  document.body.appendChild(el);
  const btn=el.querySelector('.cel-btn'), card=el.querySelector('.cel-card'), ic=el.querySelector('.cel-ic');
  const tms=[]; const at=(ms,fn)=>tms.push(setTimeout(fn,ms)); const every=(ms,fn)=>tms.push(setInterval(fn,ms));
  let S=SFX.session(CEL_WET[tier]||0.2);
  let lastBoom=0,lastPop=0,lastChime=0;
  const pan=xn=>xn*2-1;
  const hooks={
    launch:(xn,d)=>{ if(S) S.whistle(S.now(),Math.max(0.4,Math.min(d,2.5)),pan(xn)); },
    burst:xn=>{ if(!S) return; const n=S.now(); if(n-lastBoom<0.07) return; lastBoom=n; S.boom(n,pan(xn),tier===7?0.55:0.45); },
    confetti:xn=>{ if(!S) return; const n=S.now(); if(n-lastPop<0.05) return; lastPop=n; S.pop(n,pan(xn),tier>=5?0.5:0.35); },
    sparkle:xn=>{ if(!S) return; const n=S.now(); if(n-lastChime<0.45) return; lastChime=n; S.sparkle(n,3,0.035); }
  };
  if(S) playTierMusic(S,tier);
  const fx=(tier>=2&&!reduce)?Fireworks(el.querySelector('.cel-fx'),hooks):null;
  const pt=(node,fy)=>{ const r=node.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height*(fy==null?.5:fy)}; };
  const flash=()=>{ if(reduce) return; const f=document.createElement('div'); f.className='cel-flash'; el.appendChild(f); at(700,()=>f.remove()); };
  const shake=()=>{ if(reduce) return; card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); };
  const cannons=(n,cols)=>{ const W=fx.W,H=fx.H;
    fx.confetti(0,H,n,{angle:-Math.PI*0.32,spread:0.5,speed:[13,22],cols});
    fx.confetti(W,H,n,{angle:-Math.PI*0.68,spread:0.5,speed:[13,22],cols}); };
  if(fx){
    const mix=m=>[...CEL_METAL[m],...CEL_METAL[m],...CEL_COLS];
    if(tier===2){
      at(200,()=>{ const p=pt(ic); fx.confetti(p.x,p.y,60,{speed:[3,9]}); });
    }else if(tier===3){
      at(350,()=>{ const p=pt(ic); fx.confetti(p.x,p.y,110,{cols:mix('bronze')}); });
      at(800,()=>{ const p=pt(card,0); fx.confetti(p.x,p.y,40,{speed:[3,8],cols:CEL_METAL.bronze}); });
    }else if(tier===4){
      at(350,()=>{ const p=pt(ic); fx.confetti(p.x,p.y,130,{cols:mix('silver')}); });
      at(750,()=>{ fx.confetti(0,fx.H*.6,70,{angle:-Math.PI*0.3,spread:.6,speed:[8,15],cols:mix('silver')}); fx.confetti(fx.W,fx.H*.6,70,{angle:-Math.PI*0.7,spread:.6,speed:[8,15],cols:mix('silver')}); });
      [900,1500,2100].forEach(ms=>at(ms,()=>{ const p=pt(ic); fx.sparkle(p.x,p.y,24,['#ffffff','#e6ebf2']); }));
    }else if(tier===5){
      at(250,()=>cannons(120,mix('gold')));
      at(600,()=>{ const p=pt(ic); fx.confetti(p.x,p.y,90,{cols:mix('gold')}); });
      at(900,()=>fx.rain(200,mix('gold')));
      at(1300,()=>cannons(80,mix('gold')));
      at(950,shake);
      every(700,()=>{ const p=pt(ic); fx.sparkle(p.x,p.y,18); });
    }else if(tier===6){
      flash();
      at(300,()=>cannons(110,mix('gold')));
      for(let i=0;i<14;i++) at(400+i*330,()=>fx.rocket());
      at(1200,shake);
      at(2000,()=>fx.rain(220));
      at(6000,()=>every(1300,()=>fx.rocket()));
      every(600,()=>{ const p=pt(ic); fx.sparkle(p.x,p.y,16); });
    }else{
      flash();
      at(200,()=>fx.emoji(['🏆','🥇','🎉','⭐','🎆','✨',...Object.values(TERM_TROPHY)],70));
      for(let i=0;i<18;i++) at(300+i*220,()=>{ fx.rocket(); if(i%2) fx.rocket(); });
      at(600,()=>cannons(130,mix('gold')));
      at(1400,shake);
      at(4600,()=>{                         // grand finale
        flash(); shake();
        for(let i=0;i<16;i++) at(i*70,()=>fx.burst(fx.W*(0.08+Math.random()*0.84),fx.H*(0.08+Math.random()*0.45)));
        cannons(150);
      });
      at(5300,()=>{ fx.emoji(['🏆','🥇','🎉','⭐','👑','🌟'],70); fx.rain(260); });
      at(7200,()=>every(520,()=>{ fx.rocket(); if(Math.random()<.4) fx.rocket(); }));
      at(8000,()=>every(5000,()=>fx.emoji(['🏆','🎉','⭐','🌟'],8)));
      every(500,()=>{ const p=pt(ic); fx.sparkle(p.x,p.y,18); });
    }
  }
  if(tier===7){ btn.disabled=true; at(reduce?0:2500,()=>{ btn.disabled=false; btn.focus(); }); }
  else btn.focus();
  function close(){
    tms.forEach(t=>{ clearTimeout(t); clearInterval(t); });
    if(fx) fx.stop();
    if(S) S.stop();
    el.remove(); closeCelebration=null;
  }
  closeCelebration=close;
  btn.onclick=close;
  const snd=el.querySelector('.cel-snd');
  if(snd) snd.onclick=()=>{
    const on=!SFX.enabled(); SFX.set(on);
    snd.textContent=on?'🔊':'🔇'; snd.setAttribute('aria-pressed',!on); snd.setAttribute('aria-label',on?'Turn sound off':'Turn sound on');
    if(!on&&S){ S.stop(); S=null; }
    else if(on&&!S){ S=SFX.session(CEL_WET[tier]||0.2); }
  };
}

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
  const before=awardState();
  recordResult(activity,score,total);
  const msg=score===total?'Every one right. Brilliant work!':score>=total*0.7?'Great effort! Check the ones in red.':'Keep practising. Look carefully at the ones in red.';
  body.innerHTML=`<h3>Your results</h3>${scoreBlock(score,total)}<p style="font-size:22px">${msg}</p>
  <div class="tbl-wrap"><table class="fbt"><thead><tr><th scope="col"><span class="sr">Result</span></th>${clueHead?`<th scope="col">${clueHead}</th>`:''}<th scope="col">Your answer</th><th scope="col">Correct answer</th></tr></thead><tbody>
  ${rows.map(r=>`<tr class="${r.ok?'ok':'bad'}"><td class="mk">${r.ok?'✓':'✗'}</td>${clueHead?`<td>${r.clue}</td>`:''}<td class="given">${r.given?esc(r.given):'<span class="muted">(blank)</span>'}</td><td>${r.correct}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="tools"><button class="btn primary" id="again">Try again</button><button class="btn" id="menu2">Back to activities</button></div>`;
  $('#again').onclick=()=>go(activity); $('#menu2').onclick=()=>go('menu');
  window.scrollTo(0,0);
  celebrateResult(score,total,before);
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
loadWallet();
if(S.role!=='student'||!S.student||!S.authed) go('role');
else if(['shop','fridge'].includes(S.screen)){ go(S.screen); if(S.term) resolveStage(); }
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
