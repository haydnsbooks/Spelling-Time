(function(){
"use strict";
/* =================================================================
   Spelling Time
   ================================================================= */
const APP_NAME = 'Spelling Time';
document.title = APP_NAME;
const DATA = window.PLD_DATA;
const CONTENT = window.CONTENT || {};
const WORD_INFO = window.WORD_INFO || {};
const CONFIG = window.APP_CONFIG || {};
const SHOP = window.SUPERMARKET || {version:0,aisles:[]};

/* ---------- app version ----------
   When you upload a new version to GitHub, change APP_VERSION here AND "version" in version.json
   to the same new value (e.g. the date plus a number). When a login button is pressed, the app
   compares the two; if the iPad is running an older copy, it asks the student/teacher to update. */
const APP_VERSION = '2026-11-18.2';
const APP_FILES = ['index.html','css/styles.css','js/app.js','js/config.js','data/class-list.js','data/pld-data.js','data/content.js','data/word-info.js','data/supermarket.js','data/dictionary.js'];
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
    <p>There's a newer version of Spelling Time.<br>Tap the button to get it. It only takes a moment.</p>
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
const BLANK={role:null,room:null,student:null,firstName:null,classNumber:null,term:null,stage:null,week:null,stageLocked:false,authed:false,demo:false,screen:'role'};
let S=Object.assign({},BLANK,store.get(SESSION_KEY,{}));
if(S.role!=='student'||!S.student||!S.authed||S.demo) S=Object.assign({},BLANK);
else{ const me=(ROOMS[S.room]||[]).find(n=>n.classNumber===S.classNumber); if(me){ S.student=me.displayName; S.firstName=me.firstName; } }   // names are now first name + last initial
function save(){ if(S.role==='student'&&!S.demo) store.set(SESSION_KEY,S); }   // teacher view is never saved on the device
let teacher=null;            // {room,password} – kept in memory only, never saved on the device
                             // relief teacher: {room:RELIEF,relief:true}, with no teacher password at all
const RELIEF='Relief Teacher';   // the extra choice in the teacher log in: student view only
const TEACHER_ONLY=['teacherHome','stagesTerm','stagesBoard','actsTerm','actsBoard','teacherData','resetPw'];
let screenAC=null;           // aborts screen-level listeners on navigation

/* ---------- Google Sheet connection ----------
   Google runs at most 30 Apps Script requests at the same time for one account, and every iPad's
   requests count towards the teacher's account. So: each student screen asks for everything in ONE
   request (see sync below), finished activities are saved in batches rather than one request each
   (see saving results in batches below), an iPad never sends more than 2 requests at once, and a
   request that fails because the sheet is busy is tried again after a random wait that gets longer
   each time, so a whole class doesn't try again at the same moment. */
const API_TIMEOUT=30000, API_RETRIES=2, API_MAX_ACTIVE=2;
const API_RETRY_WAIT=[3000,8000];                   // average wait before the 1st and 2nd retry (each is spread from half to double this)
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let apiActive=0; const apiWaiting=[];
async function apiSlot(){ if(apiActive>=API_MAX_ACTIVE) await new Promise(r=>apiWaiting.push(r)); apiActive++; }
function apiFree(){ apiActive--; const next=apiWaiting.shift(); if(next) next(); }
const NET_MSG={
  offline:"This iPad isn't connected to the internet. Check the Wi-Fi, then try again.",
  timeout:"The Google Sheet took too long to answer. It's probably busy with lots of students at once. Wait a moment, then try again.",
  blocked:"The Google Sheet didn't answer. This usually happens when lots of students are using it at the same moment. Wait a moment, then try again. If it keeps happening, open the web app link from js/config.js in a browser to check the Apps Script."
};
const API={
  has(){ return !!String(CONFIG.SHEETS_URL||'').trim(); },
  async once(method,payload){
    const url=String(CONFIG.SHEETS_URL||'').trim();
    if(!url) throw Object.assign(new Error('The Google Sheet link is not set up in js/config.js.'),{kind:'nourl'});
    await apiSlot();
    const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),API_TIMEOUT);
    try{
      let res;
      try{
        res = method==='GET'
          ? await fetch(url+'?'+new URLSearchParams(payload),{signal:ctl.signal})
          : await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload),signal:ctl.signal});
      }catch(e){
        const reason=navigator.onLine===false?'offline':ctl.signal.aborted?'timeout':'blocked';
        throw Object.assign(new Error(NET_MSG[reason]),{kind:'network',reason});
      }
      if(!res.ok) throw Object.assign(new Error(res.status===404
        ? "The Google Sheet web app couldn't be found (error 404). In Apps Script, open Deploy → Manage deployments, copy the Web app URL and check it matches js/config.js. Also check \"Who has access\" is set to Anyone."
        : `The Google Sheet web app sent back an error (${res.status}). Wait a moment and try again. If it keeps happening, check the Apps Script deployment.`),{kind:'network',status:res.status,reason:res.status===404?'notfound':'http'});
      let j; try{ j=await res.json(); }catch(e){ throw Object.assign(new Error('The Google Sheet sent back a web page instead of data. In Apps Script, check Deploy → Manage deployments: "Execute as" should be Me and "Who has access" should be Anyone.'),{kind:'network',reason:'html'}); }
      if(!j.ok) throw Object.assign(new Error(j.error||'The Google Sheet returned an error.'),{kind:j.busy?'busy':'server'});
      return j;
    }finally{ clearTimeout(t); apiFree(); }
  },
  async call(method,payload){
    for(let attempt=0;;attempt++){
      try{ return await this.once(method,payload); }
      catch(e){
        const retry=e.reason==='timeout' ? attempt<1        // a request that timed out is only tried once more
          : attempt<API_RETRIES && (e.kind==='busy' || (e.kind==='network' && ['blocked','http'].includes(e.reason)));
        if(!retry) throw e;
        const base=API_RETRY_WAIT[Math.min(attempt,API_RETRY_WAIT.length-1)];
        await sleep(base*(0.5+Math.random()*1.5));   // a random wait, so the class doesn't all try again at once
      }
    }
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
function termActs(term,room){ if(S.demo) return ALL_ACTS; const m=((store.get(ACTS_KEY,{})[room||S.room])||{})[term]; return Array.isArray(m)&&m.length?m:ALL_ACTS; }
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
const pkey=(term,stage,week)=>[S.room,S.classNumber,term,stage,week].join('|');
function markDone(r){
  const m=store.get(DONE_KEY,{}); const k=pkey(r.term,r.stage,r.week);
  m[k]=m[k]||{}; const prev=m[k][r.activity];
  if(!prev||r.score/r.total>prev.score/prev.total) m[k][r.activity]={score:r.score,total:r.total};
  store.set(DONE_KEY,m);
}
function weekDone(){ if(S.demo) return {}; return store.get(DONE_KEY,{})[pkey(S.term,S.stage,S.week)]||{}; }
const isPerfect=d=>!!d&&d.total>0&&d.score===d.total;
function perfectCount(done,term){ return medalActs(term).filter(a=>isPerfect(done[a])).length; }   // switched-on medal activities at 100%
function medalFromDone(done,term){ return medalFor(perfectCount(done,term),medalActs(term).length); }
function recordResult(activity,score,total){
  if(S.demo) return;                                 // teacher view: nothing is saved
  const rec={action:'addResult',id:Date.now().toString(36)+Math.random().toString(36).slice(2,8),timestamp:new Date().toISOString(),
    room:S.room,classNumber:S.classNumber,student:S.student,term:S.term,stage:S.stage,week:S.week,list:(weekData()||{}).l||'',activity,score,total};
  markDone(rec);
  const q=store.get(PEND_KEY,[]); q.push(rec); store.set(PEND_KEY,q);
  scheduleFlush();                                   // saved with the next batch, not straight away
}

/* ---------- saving results in batches ----------
   A finished activity is kept on the iPad (it counts for medals straight away) and sent to the
   Google Sheet a little later, together with any others finished in the meantime. Every iPad picks
   its own random moment, so a class finishing together doesn't all send at once. Results also go
   with any other request the student's screens make, and are sent straight away when the student
   opens the supermarket or fridge, or logs out. If the iPad goes offline they wait and are sent later. */
const BATCH_MIN_MS=45000, BATCH_SPREAD_MS=45000;    // the first try is 45 to 90 seconds after an activity is finished
const BATCH_RETRY_MS=90000;                         // after a failed try, about 1 to 2 minutes
let batchTimer=null, batchDue=0;
function pendingCount(){ return store.get(PEND_KEY,[]).length; }
function scheduleFlush(ms){
  if(S.demo) return;
  if(ms==null) ms=BATCH_MIN_MS+Math.random()*BATCH_SPREAD_MS;
  const due=Date.now()+ms;
  if(batchTimer&&batchDue<=due) return;              // a batch is already on its way sooner
  if(batchTimer) clearTimeout(batchTimer);
  batchDue=due;
  batchTimer=setTimeout(()=>{ batchTimer=null; flushResults(); },ms);
}
function clearFlush(){ if(batchTimer) clearTimeout(batchTimer); batchTimer=null; }
/* send results waiting on this iPad (and get everything else back in the same request) */
async function flushResults(){
  if(!pendingCount()) return true;
  if(!API.has()) return false;
  try{
    if(S.authed&&!S.demo) await sync({force:true});
    else await sendOrphans();
  }catch(e){}
  if(pendingCount()) scheduleFlush(BATCH_RETRY_MS*(0.75+Math.random()*0.75));
  return !pendingCount();
}
/* results left on the iPad by someone who has logged out: send them on their own */
async function sendOrphans(){
  const list=store.get(PEND_KEY,[]); if(!list.length||!API.has()) return;
  const j=await API.post({action:'addResults',results:list});
  dropPending(j.saved);
}
window.addEventListener('pagehide',()=>{ clearFlush(); });   // the results stay on the iPad and are sent next time
window.addEventListener('pageshow',e=>{ if(e.persisted&&pendingCount()) scheduleFlush(3000+Math.random()*12000); });

/* ---------- sync: everything a student's screens need, in ONE request ----------
   Sends any results waiting on this iPad and gets back the student's stages, results (every term),
   the activities switched on and their Fremantium wallet. Screens opened again within SYNC_FRESH_MS
   reuse the last answer, so moving between screens doesn't keep asking the Google Sheet (the iPad
   already knows about the student's own new results, so their medals still show straight away).
   force: ask now no matter what.  flush: ask now if there are results waiting to be saved. */
const SYNC_FRESH_MS=60000;
let syncP=null, syncQ=null, lastSync=0, lastSyncWho='', legacyApi=false, syncSending=new Set();
function dropPending(ids){
  if(!ids||!ids.length) return;
  const set=new Set(ids.map(String));
  store.set(PEND_KEY,store.get(PEND_KEY,[]).filter(r=>!set.has(String(r.id))));
}
function applySync(j){
  const m=store.get(DONE_KEY,{}), pre=[S.room,S.classNumber].join('|')+'|';
  Object.keys(m).forEach(k=>{ if(k.startsWith(pre)) delete m[k]; }); store.set(DONE_KEY,m);
  (j.results||[]).forEach(markDone);
  store.get(PEND_KEY,[]).filter(r=>r.room===S.room&&r.classNumber===S.classNumber).forEach(markDone);
  const cache=store.get(STAGE_KEY,{});
  [1,2,3,4].forEach(t=>{
    const ck=S.room+'|'+t, map=Object.assign({},cache[ck]||{}), st=(j.stages||{})[t];
    if(st) map[S.classNumber]=+st; else delete map[S.classNumber];
    cache[ck]=map;
  });
  store.set(STAGE_KEY,cache);
  const all=store.get(ACTS_KEY,{}); all[S.room]=j.activities||{}; store.set(ACTS_KEY,all);
  if(j.wallet){
    setWallet(j.wallet);
    if(j.wallet.reset) toast(`The supermarket has been restocked, so you have ${wallet.balance} Fremantium to spend again.`);
  }
}
/* for an Apps Script that hasn't been updated yet: the old one-thing-at-a-time requests, sent one after another */
async function legacySync(){
  const sent=store.get(PEND_KEY,[]); syncSending=new Set(sent.map(r=>String(r.id)));
  for(const r of sent){
    try{ await API.post(Object.assign({},r,{action:'addResult'})); dropPending([r.id]); }
    catch(e){ if(e.kind==='server') dropPending([r.id]); else break; }
  }
  const room=S.room, cn=S.classNumber, j={stages:{},results:[]};
  j.activities=(await API.get({action:'getActivities',room})).terms||{};
  for(const t of [1,2,3,4]){
    const st=((await API.get({action:'getStages',room,term:t})).stages||[]).find(s=>s.classNumber===cn);
    if(st) j.stages[t]=st.stage;
    ((await API.get({action:'getResults',room,classNumber:cn,term:t})).results||[]).forEach(r=>j.results.push(Object.assign({},r,{term:t})));
  }
  j.wallet=await API.get({action:'getWallet',room,classNumber:cn,catalogVersion:SHOP.version});
  return j;
}
function sync({force=false,flush=false,jitter=false}={}){
  if(!API.has()||!S.authed) return Promise.resolve(false);
  const who=walletId(), pending=store.get(PEND_KEY,[]).some(r=>!syncSending.has(String(r.id)));   // results not already on their way
  const now=force||(flush&&pending);
  if(syncP){
    if(!now) return syncP;                           // already asking: share the same answer
    return syncQ=syncQ||syncP.catch(()=>{}).then(()=>{ syncQ=null; return sync({force:true}); });
  }
  if(!now&&lastSyncWho===who&&Date.now()-lastSync<SYNC_FRESH_MS) return Promise.resolve(true);
  syncP=(async()=>{
    if(jitter) await sleep(Math.random()*3000);      // a class opening the app together doesn't all ask in the same second
    let j;
    if(!legacyApi){
      const sent=store.get(PEND_KEY,[]); syncSending=new Set(sent.map(r=>String(r.id)));
      try{ j=await API.post({action:'studentSync',room:S.room,classNumber:S.classNumber,catalogVersion:SHOP.version,results:sent}); dropPending(j.saved); }
      catch(e){ if(e.kind==='server'&&/Unknown action/.test(e.message)) legacyApi=true; else throw e; }
    }
    if(legacyApi) j=await legacySync();
    if(!pendingCount()) clearFlush();                // everything is saved, so the waiting batch has nothing to send
    if(!S.authed||walletId()!==who) return false;    // logged out while waiting
    applySync(j); lastSync=Date.now(); lastSyncWho=who;
    return true;
  })().finally(()=>{ syncP=null; syncSending=new Set(); });
  return syncP;
}

/* ---------- Fremantium wallet ----------
   The Google Sheet works out the balance: Fremantium earned from medals, minus what has been spent.
   The latest copy is kept on the iPad so the top bar can show it straight away. */
const WALLET_KEY='pldSpell.wallet.v1';
let wallet=null;                                   // {earned,spent,balance,owned:[itemIds],resetToday}
function walletId(){ return S.room+'|'+S.classNumber; }
function loadWallet(){ wallet=(S.authed&&store.get(WALLET_KEY,{})[walletId()])||null; }
function setWallet(j){
  wallet={earned:+j.earned||0,spent:+j.spent||0,balance:+j.balance||0,owned:(j.owned||[]).map(String),resetToday:!!j.resetToday};
  if(wallet.resetToday) markResetUsed();
  const all=store.get(WALLET_KEY,{}); all[walletId()]=wallet; store.set(WALLET_KEY,all);
  updateTopbar();
}
/* the fridge Reset (all Fremantium given back) can only be used once a day.
   The Google Sheet checks this too; the copy on the iPad lets the button switch off straight away. */
const RESET_KEY='pldSpell.resetDay.v1';
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function markResetUsed(){ const m=store.get(RESET_KEY,{}); m[walletId()]=todayStr(); store.set(RESET_KEY,m); }
function resetUsedToday(){ return !!(wallet&&wallet.resetToday) || store.get(RESET_KEY,{})[walletId()]===todayStr(); }
async function refreshWallet(opts){
  if(!API.has()||!S.authed) return null;
  return (await sync(opts))?wallet:null;
}
function frIcon(cls){
  return `<svg class="fr-ic ${cls||''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="11" fill="#17a398" stroke="#0b5f5a" stroke-width="1.6"/><circle cx="12" cy="12" r="8.2" fill="none" stroke="#8ff0e6" stroke-width="1"/><path d="M12 5.2l2.1 3.6-2.1 1.3-2.1-1.3z" fill="#d9fffb"/><text x="12" y="17.6" text-anchor="middle" font-size="9.5" font-weight="800" fill="#fff" font-family="'Baloo 2',Andika,sans-serif">F</text></svg>`;
}
function frAmt(n,cls){ return `<span class="fr-amt ${cls||''}">${frIcon()}<b>${n}</b><span class="sr"> Fremantium</span></span>`; }
async function resolveStage(){
  const ck=S.room+'|'+S.term;
  let checked=false;
  try{ if(API.has()) checked=await sync(); }catch(e){}
  const cache=store.get(STAGE_KEY,{});
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
  topbar.classList.toggle('hidden', !(S.role==='student'&&S.student&&(S.authed||S.demo)));
  topbar.classList.toggle('demo', !!S.demo);
  $('#tbName').textContent=(S.demo?(teacher&&teacher.relief?'🍎 Relief teacher':'🍎 Teacher view'):(S.firstName||S.student||'Name'))+' ▾';
  $('#tbTerm').textContent='Term '+(S.term||'–')+' ▾';
  $('#tbStage').textContent='Stage '+(S.stage||'–')+' ▾';
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
  if(k==='name') dd.innerHTML=S.demo&&!(teacher&&teacher.relief)?'<button class="logout" style="padding:0 16px">Back to teacher page</button>':'<button class="logout" style="padding:0 16px">Log Out</button>';
  else{
    const range={term:[1,4],week:[1,9],stage:[2,6]}[k];
    for(let i=range[0];i<=range[1];i++){
      dd.insertAdjacentHTML('beforeend','<button data-v="'+i+'" class="'+(S[k]==i?'sel':'')+'">'+i+'</button>');
    }
  }
  dd.addEventListener('click',async ev=>{
    ev.stopPropagation();
    const o=ev.target.closest('button'); if(!o||o.disabled) return;
    if(o.classList.contains('logout')){ closeDD(); if(S.demo) exitDemo(); else logout(); return; }
    S[k]=+o.dataset.v; closeDD(); save();
    if(S.demo){ go(S.term&&S.stage&&S.week?'menu':'demoPick'); return; }
    if(k==='term'){ updateTopbar(); await resolveStage(); }
    go(S.term&&S.stage&&S.stageLocked&&S.week?'menu':'calib');
  });
  tb.appendChild(dd); b.setAttribute('aria-expanded','true');
});
document.addEventListener('click',e=>{ if(!e.target.closest('.tb')) closeDD(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDD(); });
function logout(){
  stopAll(); clearFlush();
  S=Object.assign({},BLANK); teacher=null; wallet=null; try{localStorage.removeItem(SESSION_KEY);}catch(e){}
  if(pendingCount()) flushResults();                 // results still waiting on this iPad are sent now
  go('role');
}

/* ---------- router ---------- */
let timers=[]; function clearTimers(){ timers.forEach(t=>{clearInterval(t);clearTimeout(t);}); timers=[]; }
let reader=null;
function stopAll(){ stopSpeech(); clearTimers(); if(reader){ reader.stop(); reader=null; } KB.hide(); closeWordPopup(); if(screenAC){ screenAC.abort(); screenAC=null; } }
const SCREENS={};
function go(screen,arg){
  if(teacher&&teacher.relief&&TEACHER_ONLY.includes(screen)) screen='demoPick';            // a relief teacher only gets the student view
  if(ACTS[screen]&&S.role==='student'&&!termActs(S.term).includes(screen)) screen='menu';   // activity switched off by the teacher
  stopAll(); screenAC=new AbortController();
  S.screen=screen; save(); updateTopbar(); window.scrollTo(0,0);
  if(SCREENS[screen]) SCREENS[screen](arg);
  else if(ACTS[screen]) ACTS[screen]();
}

/* ---------- login ---------- */
SCREENS.role=function(){
  app.innerHTML=`<div class="centre"><h1>Spelling Time</h1><p class="muted" style="margin-bottom:28px">Who is logging in?</p>
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
   After that: they type it each time. To reset a forgotten password, the teacher uses
   Teacher → Reset a Password (or clears it in the Passwords tab). */
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
    <div class="field"><label for="room">Select room</label><select id="room">${roomOptions()}<option value="${RELIEF}">${RELIEF}</option></select></div>
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
    try{
      if(room===RELIEF){ await API.post({action:'reliefLogin',password:pw}); teacher={room,relief:true}; go('demoPick'); }   // straight to the student view
      else{ await API.post({action:'teacherLogin',password:pw,room}); teacher={room,password:pw}; go('teacherHome'); }
    }
    catch(e){ err.textContent=/wrong teacher password/i.test(e.message)?'That password is not right.':/Unknown action/.test(e.message)?'The Apps Script needs updating: paste in the new Code.gs and deploy a new version.':e.message; btn.disabled=false; btn.textContent='Log in'; }
  };
  $('#login').onclick=submit; $('#pw').onkeydown=e=>{ if(e.key==='Enter') submit(); };
};

/* ---------- teacher ---------- */
SCREENS.teacherHome=function(msg){
  if(!teacher) return go('teacherLogin');
  if(S.demo){ S=Object.assign({},BLANK); updateTopbar(); }
  app.innerHTML=`<div class="act-head"><div><div class="crumb">Teacher</div><h2>${esc(teacher.room)}</h2></div><button class="btn small" id="out">Log out</button></div>
  <div class="grid single"><button class="tile" id="setSt"><span class="ic" aria-hidden="true">🗂️</span><span class="nm">Set Student Stages</span></button>
  <button class="tile" id="setActs"><span class="ic" aria-hidden="true">☑️</span><span class="nm">Set Activities</span></button>
  <button class="tile" id="seeProg"><span class="ic" aria-hidden="true">📊</span><span class="nm">See Student Progress</span></button>
  <button class="tile" id="stuView"><span class="ic" aria-hidden="true">🖥️</span><span class="nm">Open Student Activities</span></button>
  <button class="tile" id="resetPw"><span class="ic" aria-hidden="true">🔑</span><span class="nm">Reset a Password</span></button></div>`;
  $('#out').onclick=()=>{ teacher=null; go('role'); };
  $('#setSt').onclick=()=>go('stagesTerm');
  $('#setActs').onclick=()=>go('actsTerm');
  $('#seeProg').onclick=()=>go('teacherData');
  $('#stuView').onclick=()=>go('demoPick');
  $('#resetPw').onclick=()=>go('resetPw');
  if(msg) toast(msg);
};
/* ---------- teacher: reset a student's password ----------
   Only the students in the room the teacher logged into are listed, and the Apps Script checks the
   teacher password against that same room before it clears anything (see ROOM_PASSWORDS in Code.gs).
   The student makes a new password the next time they log in. */
SCREENS.resetPw=function(){
  if(!teacher) return go('teacherLogin');
  const students=ROOMS[teacher.room]||[];
  let has=null;                                      // class numbers that have a password, or null if that couldn't be checked
  app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(teacher.room)}</div><h2>Reset a password</h2></div><button class="btn small" id="back">Back</button></div>
  <p class="centre">Choose a student from ${esc(teacher.room)}, then tap <b>Reset password</b>.<br><span class="muted">Their old password stops working, and they make a new one the next time they log in.</span></p>
  <div class="centre"><div class="home">
    <div class="field"><label for="pick">Select student</label><select id="pick" disabled><option value="">Loading…</option></select></div>
    <div class="fb bad" id="err" role="alert"></div>
    <div class="tools"><button class="btn primary" id="reset" disabled>Reset password</button></div>
    <p class="note centre" id="note" role="status"></p>
  </div></div>`;
  const pick=$('#pick'), btn=$('#reset'), err=$('#err'), note=$('#note');
  $('#back').onclick=()=>go('teacherHome');
  const who=()=>pick.value===''?null:students.find(s=>String(s.classNumber)===pick.value);
  function fill(){
    const keep=pick.value;
    pick.innerHTML='<option value="">Choose a student…</option>'+students.map(s=>
      `<option value="${s.classNumber}">${esc(s.displayName)}${has&&!has.has(s.classNumber)?' (no password yet)':''}</option>`).join('');
    pick.value=keep; pick.disabled=!students.length; show();
  }
  function show(){
    const s=who(); err.textContent='';
    if(!s){ btn.disabled=true; note.textContent=''; return; }
    const none=has&&!has.has(s.classNumber);
    btn.disabled=!!none;
    note.textContent=none?`${s.firstName||s.displayName} hasn't made a password yet, so there's nothing to reset.`:'';
  }
  pick.onchange=show;
  btn.onclick=async()=>{
    const s=who(); if(!s) return;
    const first=s.firstName||s.displayName;
    if(!await confirmDlg(`<b>Reset ${esc(s.displayName)}'s password?</b><br>Their old password will stop working. The next time ${esc(first)} logs in, they'll make a new one.`,'Reset password','Cancel')) return;
    btn.disabled=true; btn.textContent='Resetting…'; err.textContent='';
    try{
      const j=await API.post({action:'resetStudentPassword',password:teacher.password,room:teacher.room,classNumber:s.classNumber,student:s.displayName});
      if(S.screen!=='resetPw') return;
      if(has) has.delete(s.classNumber);
      btn.textContent='Reset password'; fill();
      toast(j.reset?`${s.displayName}'s password has been reset.`:`${s.displayName} didn't have a password, so nothing changed.`);
      note.textContent=`${first} will make a new password the next time they log in.`;
    }catch(e){
      if(S.screen!=='resetPw') return;
      btn.textContent='Reset password'; btn.disabled=false;
      err.textContent=/Unknown action/.test(e.message)?'The Apps Script needs updating: paste in the new Code.gs and deploy a new version.':e.message;
    }
  };
  if(!API.has()){ pick.innerHTML='<option value="">Choose a student…</option>'; err.textContent='The Google Sheet link is not set up in js/config.js.'; return; }
  API.post({action:'getPasswordStatus',password:teacher.password,room:teacher.room})
    .then(j=>{ if(S.screen!=='resetPw') return; has=new Set((j.classNumbers||[]).map(Number)); fill(); })
    .catch(e=>{
      if(S.screen!=='resetPw') return;
      fill();                                         // still let the teacher choose a student
      err.textContent=/Unknown action/.test(e.message)?'The Apps Script needs updating: paste in the new Code.gs and deploy a new version.'
        :"Couldn't check which students have a password ("+e.message+"). You can still choose a student and reset.";
      if(/Unknown action/.test(e.message)){ pick.disabled=true; }
    });
};
/* ---------- teacher: open the student activities (for the smartboard) ----------
   Every term, stage and week is open, every activity is shown, and nothing is saved to the Google Sheet
   or the device. The top bar lets the teacher jump to any term, stage or week. */
function exitDemo(){ stopAll(); S=Object.assign({},BLANK); if(teacher&&teacher.relief) teacher=null; go(teacher?'teacherHome':'role'); }   // a relief teacher logs out from here
SCREENS.demoPick=function(){
  if(!teacher) return go('teacherLogin');
  if(!S.demo) S=Object.assign({},BLANK,{role:'student',demo:true,room:teacher.room,student:'Teacher',firstName:'Teacher',classNumber:-1});
  let term=S.term, stage=S.stage, week=S.week;
  const has=(st,t,w)=>!!(DATA[st]&&DATA[st].weeks[t+'-'+w]);
  const row=(k,a1,b1,v)=>{ let h=''; for(let i=a1;i<=b1;i++) h+=`<button class="btn ${v==i?'sel':''}" data-k="${k}" data-v="${i}" aria-pressed="${v==i}">${i}</button>`; return h; };
  function draw(){
    app.innerHTML=`<div class="act-head"><div><div class="crumb">${esc(teacher.room)}</div><h2>Student activities</h2></div><button class="btn small" id="back">${teacher.relief?'Log out':'Back to teacher page'}</button></div>
    <p class="centre muted" style="margin-top:-4px">Choose any term, stage and week to show on the smartboard. Every activity is open, and nothing is saved.</p>
    <div class="centre">
      <div class="cal-group"><h3>Term</h3><div class="btnrow">${row('term',1,4,term)}</div></div>
      <div class="cal-group"><h3>Stage</h3><div class="btnrow">${row('stage',2,6,stage)}</div></div>
      <div class="cal-group"><h3>Week</h3><div class="btnrow" id="dWeeks">${row('week',1,9,week)}</div>
        ${term&&stage&&![1,2,3,4,5,6,7,8,9].some(w=>has(stage,term,w))?`<p class="note">There are no Stage ${stage} lessons for Term ${term} in the PLD teaching sequence.</p>`:''}</div>
      <div class="tools"><button class="btn primary" id="open" ${term&&stage&&week?'':'disabled'}>Show the activities</button></div>
    </div>`;
    if(term&&stage) app.querySelectorAll('#dWeeks button').forEach(b=>{ if(!has(stage,term,+b.dataset.v)) b.classList.add('nolesson'); });
    $('#back').onclick=exitDemo;
    app.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{ const v=+b.dataset.v; if(b.dataset.k==='term') term=v; else if(b.dataset.k==='stage') stage=v; else week=v; Object.assign(S,{term,stage,week}); updateTopbar(); draw(); });
    $('#open').onclick=()=>{ Object.assign(S,{term,stage,week,stageLocked:true}); go('menu'); };
  }
  updateTopbar(); draw();
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
    const intro=!w?`<div class="notice">There are no Stage ${S.stage} lessons for Term ${S.term} in the PLD teaching sequence. Tap <b>${S.demo?'Term or Stage':'Term'}</b> at the top to choose another${S.demo?'':' term, or ask your teacher'}.</div>`
      :S.demo?`<h2 class="wk">Week ${S.week}</h2>
       <p class="muted" style="margin:0">Stage ${S.stage}, Term ${S.term}${w.l?`, List ${w.l}`:''}</p>
       <p class="medalkey">Teacher view: every activity is open and nothing is saved.</p>`
      :`<h2 class="wk">Week ${S.week} ${medalHTML(med)}</h2>
       <p class="muted" style="margin:0">Stage ${S.stage}, Term ${S.term}${w.l?`, List ${w.l}`:''}</p>
       <p class="medalkey">${medalRule(medalActs(S.term).length)}</p>`;
    const bonus=w&&(S.demo||med==='gold')&&bonusPool().length;   // the Bonus Zone opens once the week is gold
    app.innerHTML=(bonus?bonusBtnHTML():'')+`<div class="intro">${intro}</div>`+MENU_ROWS.map(row).join('');
    app.querySelectorAll('.tile').forEach(t=>t.onclick=()=>go(t.dataset.a));
    const bb=$('#bonusBtn'); if(bb) bb.onclick=()=>go('bonus');
  }
  draw();
  if(!API.has()||S.demo) return;
  sync({jitter:true}).then(ok=>{ if(ok) draw(); }).catch(()=>{});
};
const TERM_TROPHY={1:'🪐',2:'💫',3:'🔱',4:'⚜️'};
function stageForTerm(term){ const m=(store.get(STAGE_KEY,{})[S.room+'|'+term])||{}; return m[S.classNumber]?+m[S.classNumber]:null; }
function weekMedal(term,stage,week){
  if(!stage) return null;
  const done=store.get(DONE_KEY,{})[[S.room,S.classNumber,term,stage,week].join('|')]||{};
  return medalFromDone(done,term);
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
  sync({jitter:true}).then(ok=>draw(ok?'ready':'offline')).catch(()=>draw('offline'));
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
    <div class="tools" style="margin:0"><button class="btn small" id="back">Back to activities</button><button class="btn small" id="toFridge"><span aria-hidden="true">🧊</span> My fridge</button></div></div>
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
    }catch(err){
      // a slow connection can mean the first try went through: check before saying it failed
      if(/already sold out/i.test(err.message)){ try{ await sync({force:true}); }catch(e){} if(wallet&&wallet.owned.includes(it.id)){ draw(); toast(`${it.em} The ${it.name} is in your fridge!`); return; } }
      toast(err.message); refresh();
    }
    finally{ busy=false; }
  };
  // results still waiting on the iPad are saved first, so the Fremantium from them can be spent
  async function refresh(){ try{ await refreshWallet({flush:true}); status='ready'; }catch(e){ status='offline'; } draw(); }
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
    <div class="tools" style="margin:0"><button class="btn small" id="back">Back to activities</button><button class="btn small" id="toShop"><span aria-hidden="true">🛒</span> Supermarket</button><button class="btn small" id="reset"><span aria-hidden="true">↺</span> Reset</button></div></div>
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
    const owned=new Set(wallet?wallet.owned:[]), n=owned.size, used=resetUsedToday();
    $('#fmsg').innerHTML=(status==='offline'?"Couldn't reach the Google Sheet, so this shows what's saved on this iPad. ":'')
      +`${n} of ${total} items in your fridge.`+(wallet?` You have ${frAmt(wallet.balance)} to spend.`:'')+(n<total?' Tap a label to go to that aisle.':' Your fridge is FULL. Amazing!')
      +(used?'<br><span class="muted">You have used Reset today. You can reset your fridge again tomorrow.</span>':'');
    const by=k=>SHOP.aisles.filter(a=>(FRIDGE_SPOT[a.id]||'shelf')===k);
    $('#fbox').innerHTML=`<div class="fridge">
      <div class="fz">${by('freezer').map(a=>comp(a,'freezer',owned)).join('')}<span class="handle h-fz" aria-hidden="true"></span></div>
      <div class="fr-body"><div class="fr-inside">
          ${by('shelf').map(a=>comp(a,'fshelf',owned,'<div class="glass"></div>')).join('')}
          <div class="drawers">${by('drawer').map(a=>comp(a,'drawer',owned,'<div class="dfront"></div>')).join('')}</div>
        </div>${by('door').map(a=>door(a,owned)).join('')}<span class="handle h-fr" aria-hidden="true"></span></div>
      <div class="feet" aria-hidden="true"><i></i><i></i></div></div>`;
    const rb=$('#reset');
    rb.disabled=!(wallet&&n)||status!=='ready'||used;
    rb.title=used?'You can use Reset once a day.':'';
  }
  $('#fbox').onclick=e=>{ const b=e.target.closest('[data-aisle]'); if(b) go('shop',{aisle:b.dataset.aisle}); };
  $('#reset').onclick=async()=>{
    if(!wallet||!wallet.owned.length) return;
    if(resetUsedToday()){ toast('You have already used Reset today. You can reset your fridge again tomorrow.'); draw(); return; }
    if(!await confirmDlg(`<b>Empty your fridge?</b><br>Everything goes back on the supermarket shelves, and you get all ${wallet.spent} Fremantium back to spend again.<span class="dlgwarn">⚠️ You can only use Reset <b>once a day</b>.</span>`,'Yes, reset','Keep my food')) return;
    const btn=$('#reset'); btn.disabled=true;
    try{
      const j=await API.post({action:'resetPurchases',room:S.room,classNumber:S.classNumber,student:S.student,catalogVersion:SHOP.version});
      markResetUsed(); setWallet(Object.assign({},j,{resetToday:true})); draw();
      toast(`The supermarket is restocked. You have ${wallet.balance} Fremantium to spend.`);
    }
    catch(err){
      if(/already used reset/i.test(err.message)){ markResetUsed(); if(wallet) wallet.resetToday=true; draw(); }
      else btn.disabled=false;
      toast(err.message);
    }
  };
  draw();
  if(API.has()) refreshWallet({flush:true}).then(()=>{ status='ready'; draw(); }).catch(()=>{ status='offline'; draw(); });
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
  if(S.demo){ showCelebration(score===total?2:1,{score,total,term:S.term,week:S.week,n:0,mt:0,fr:0,goldWeeks:0,name:'Teacher'}); return; }
  const after=awardState(); let tier=1;
  // Fremantium for reaching a medal for the first time this week (3 bronze, 5 silver, 10 gold)
  const fr=Math.max(0,medalValue(after.medal)-medalValue(before.medal));
  if(fr&&wallet){ wallet.earned+=fr; wallet.balance+=fr; updateTopbar(); bumpFr(); }   // the Google Sheet's answer to the result being saved confirms it
  if(score===total){
    tier=2;
    if(after.medal&&(MRANK[after.medal]||0)>(MRANK[before.medal]||0)) tier=2+MRANK[after.medal];
    if(after.term&&!before.term){
      tier=6;
      // bring the other terms up to date before deciding on the whole year trophy
      if(API.has()) await withTimeout(sync().catch(()=>{}),8000);
      if([1,2,3,4].every(termTrophyFor)) tier=7;
    }
  }
  showCelebration(tier,{score,total,term:S.term,week:S.week,n:after.n,mt:after.mt,fr,goldWeeks:goldWeeks(),name:S.firstName||S.student});
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

/* ---------- word pop-up (tap a word in the Word List) ----------
   The information comes from data/word-info.js. Each entry can have:
     e   emoji(s)                     d   definition
     p   part of speech code(s), e.g. 'n', 'v', 'n/v', 'adj'; add '|' and a note for anything extra
     u   how the word is used in each part of speech: [[code, sentence], ...]. The pop-up shows this; p is the fallback
     s   synonyms   a  antonyms       r   root (put word parts in `backticks` to highlight them; 'base' = a base word)
     f   word family                  x   list of prefix/suffix sums, e.g. '`re` + act`ion` = reaction (a response)'
   Leave a field out (or empty) and the pop-up shows "n/a". */
const POS={
  n:['Noun','Names a person, place, thing or idea.'],
  pn:['Proper noun','Names one particular person, place, day, month or thing, so it starts with a capital letter.'],
  v:['Verb','A doing or being word. It tells what someone or something does, is or has.'],
  adj:['Adjective','Describes a noun. It tells what kind, which one or how many.'],
  adv:['Adverb','Tells how, when, where or how often something happens.'],
  pron:['Pronoun','Takes the place of a noun so you don\'t have to repeat it.'],
  prep:['Preposition','Shows where or when something is, or how it is connected to something else.'],
  conj:['Conjunction','Joins words, phrases or clauses together.'],
  det:['Determiner','Comes before a noun to show which one, whose or how many.'],
  num:['Number word','Tells how many or what order something is in.'],
  interj:['Interjection','A word said on its own to show a feeling or to greet someone.'],
  abbr:['Abbreviation','A short way of writing a longer word or title.'],
  contr:['Contraction','Two words squashed together, with an apostrophe showing where letters are missing.'],
  aux:['Helping verb','A verb that works with another verb, e.g. to show time or possibility.']
};
function morph(s){ return esc(s).replace(/`([^`]+)`/g,'<span class="morph">$1</span>'); }
function posHTML(info){
  const u=info.u, p=info.p;
  if(Array.isArray(u)&&u.length) return u.map(([c,t])=>`<b>${esc((POS[c]||[c])[0])}:</b> ${esc(t)}`).join('<br>');   // how this word is used in each part of speech
  if(!p) return 'n/a';
  const [codes,note]=String(p).split('|');
  const parts=codes.split('/').map(c=>POS[c.trim()]).filter(Boolean);
  const main=parts.length===1
    ? `<b>${parts[0][0]}.</b> ${esc(parts[0][1])}`
    : parts.map(x=>`<b>${x[0]}:</b> ${esc(x[1])}`).join('<br>');
  return (main||esc(codes))+(note?`<br><span class="muted">${morph(note.trim())}</span>`:'');
}
function listOrNA(v){
  if(Array.isArray(v)) v=v.join(', ');
  v=String(v==null?'':v).trim();
  return v?morph(v.replace(/\.?$/,'.')):'n/a';
}
let wordPopupEl=null;
function closeWordPopup(){ if(wordPopupEl){ wordPopupEl.remove(); wordPopupEl=null; document.removeEventListener('keydown',wordPopupKey); } }
function wordPopupKey(e){ if(e.key==='Escape') closeWordPopup(); }
function wordPopup(x){
  closeWordPopup();
  const word=x[0], info=WORD_INFO[word]||WORD_INFO[word.toLowerCase()]||{}, c=contentFor(word)||{};
  const def=info.d||c.d||'';
  const xs=Array.isArray(info.x)?info.x.filter(Boolean):[];
  const row=(label,html)=>`<div class="wp-row"><dt>${label}:</dt><dd>${html}</dd></div>`;
  const d=document.createElement('div'); d.className='modal wmodal';
  d.innerHTML=`<div class="dlg wpop" role="dialog" aria-modal="true" aria-labelledby="wpH">
    <button class="wp-x" type="button" aria-label="Close">✕</button>
    <h2 id="wpH" class="wp-h"><span class="wp-word">${chunk(x)}</span>${info.e?` <span class="wp-em" aria-hidden="true">${esc(info.e)}</span>`:''}</h2>
    <div class="tools wp-tools"><button class="btn small" type="button" id="wpHear"><span aria-hidden="true">🔊</span> Hear it</button></div>
    <dl class="wp-dl">
      ${row('Definition',def?esc(def):'n/a')}
      ${row('Part of Speech',posHTML(info))}
      ${row('Synonyms',listOrNA(info.s))}
      ${row('Antonyms',listOrNA(info.a))}
      ${row('Root',info.r==='base'?`${morph('`'+word+'`')} is a base word. It can't be split into smaller parts that have their own meaning.`:info.r?morph(info.r):'n/a')}
      ${row('Word family',listOrNA(info.f))}
      <div class="wp-row wp-affix"><dt>Prefixes and Suffixes:</dt><dd>${xs.length?`<ul>${xs.map(s=>`<li>${morph(s)}</li>`).join('')}</ul>`:'n/a'}</dd></div>
    </dl>
    <div class="tools"><button class="btn primary" type="button" id="wpClose">Close</button></div></div>`;
  d.addEventListener('click',e=>{ if(e.target===d||e.target.closest('.wp-x,#wpClose')) closeWordPopup(); });
  document.body.appendChild(d); wordPopupEl=d;
  document.addEventListener('keydown',wordPopupKey);
  d.querySelector('#wpHear').onclick=()=>speak(word);
  d.querySelector('#wpClose').focus({preventScroll:true});
  speak(word);
}

/* ---------- Word list ---------- */
function actWordList(){
  const L=listData(); const w=weekData(); const body=shell('wordlist');
  body.innerHTML=`<p style="margin-bottom:4px"><b>${esc(w.f||L.t)}</b></p>${w.m?`<p class="muted">${esc(w.m)}</p>`:''}
  <p class="muted">Tap a word to hear it and find out more about it.</p>
  <div class="wl">${L.w.map((x,i)=>`<button class="wcard" data-i="${i}">${chunk(x)}${x[2]&1?'<span class="hf" title="High frequency word">HF</span>':''}</button>`).join('')}</div>`;
  body.querySelectorAll('.wcard').forEach(b=>b.onclick=()=>wordPopup(L.w[+b.dataset.i]));
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
  <div class="tools"><button class="btn primary small" id="read"><span aria-hidden="true">🔊</span> Read it to me</button><button class="btn small" id="stop">Stop</button><button class="btn small" id="hl">Hide list words</button></div>
  <div class="passage" id="ptxt">${html}</div>`;
  $('#read').onclick=()=>speak(P.c,0.9); $('#stop').onclick=stopSpeech;
  let on=true; $('#hl').onclick=e=>{ on=!on; $('#ptxt').classList.toggle('nohl',!on); e.currentTarget.textContent=on?'Hide list words':'Show list words'; };
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
    frame(0,`<div class="bigword">${chunk(x)}</div>`,`<button class="btn" id="hear"><span aria-hidden="true">🔊</span> Hear it</button><button class="btn primary" id="n">I've looked at it</button>`);
    $('#hear').onclick=()=>speak(x[0]); $('#n').onclick=say;
  }
  function say(){
    const x=items[i];
    frame(1,`<div><div class="bigword">${chunk(x)}</div><p class="muted">Say the word out loud.</p></div>`,`<button class="btn" id="hear"><span aria-hidden="true">🔊</span> Hear it</button><button class="btn primary" id="n">I said it. Cover it</button>`);
    $('#hear').onclick=()=>speak(x[0]); $('#n').onclick=cover;
  }
  function cover(){ frame(2,`<div class="cover">Covered!</div>`); timers.push(setTimeout(()=>write(''),900)); }
  function write(prefill){
    const x=items[i];
    frame(3,`<div style="width:100%"><div class="boxes" aria-label="${x[0].length} characters">${'<i></i>'.repeat(x[0].length)}</div><div id="ansf"></div></div>`,
      `<button class="btn" id="hear"><span aria-hidden="true">🔊</span> Hear it</button><button class="btn primary" id="n">Check it</button>`);
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
      <button class="btn big-audio" id="hear"><span aria-hidden="true">🔊</span> Play word</button>
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

/* ---------- Bonus Zone ----------
   Opens once a student has gold for the week they are on (always open in teacher view).
   Just for fun: nothing here is sent to the Google Sheet. The words come from every list the student
   has had this year: every week of the earlier terms (in the stage they had that term) and this term
   up to the week they are on. Let it Go keeps each student's highest balloon on the iPad only.
   The three games: Spellsa (guess the letters), Ice Blocks (like Wordle) and Let it Go (speed spelling). */
const LETTERS=/^[A-Za-z]+$/;
const HANG_LIVES=6, WG_TRIES=6;
const LIG_KEY='pldSpell.letItGoBest.v1';            // the old Let it Go highest climb (still read as a starting best)
const BEST_KEY='pldSpell.bzBest.v1';
/* survival games: START is where the meter begins, DRAIN is how much it drops each second to begin with,
   and every EVERY seconds the drop grows by STEP. GAIN is added for a correct word, WRONG and SKIP are taken away. */
const LIG  ={START:100, CAP:100, DRAIN:1,   STEP:0.2,  EVERY:10, GAIN:3,   WRONG:1.5, SKIP:3,   MIN_LEN:3, CLIMB:10, BOOST:20, PX:4};   // % of air; the balloon climbs CLIMB m a second and BOOST m per correct word
const SNOW ={START:50,             DRAIN:0.5, STEP:0.1,  EVERY:10, GAIN:2,   WRONG:1,   SKIP:1};     // hp
const TROLL={START:10,             DRAIN:0.1, STEP:0.02, EVERY:10, GAIN:0.4, WRONG:0.2, SKIP:0.2, PX:10};   // metres a second (the Snowman numbers ÷ 5); PX = pixels a metre

/* ---------- weekly high scores ----------
   Each bonus game shows three high scores for this week (Monday to Sunday): the student's stage in their room,
   their stage across the whole school, and every stage across the whole school. They are kept in the
   HighScores tab of the Google Sheet. A score is only sent when it beats that student's own best for the
   week (in that game), so the sheet isn't written to after every game. */
const HS_GAMES={
  hang: {name:'Spellsa',                       ic:'👗', fmt:n=>n+' in a row'},
  word: {name:'Ice Blocks',                    ic:'🧊', fmt:n=>n+' in a row'},
  lig:  {name:'Let it Go',                     ic:'🎈', fmt:n=>fmtM(n)},
  snow: {name:'Do You Wanna Build a Snowman?', ic:'⛄', fmt:n=>fmtS(n)},
  troll:{name:'Troll Rolling',                 ic:'🧌', fmt:n=>fmtM(n)}
};
const HS_KEY='pldSpell.hsWeek.v1', HS_FRESH_MS=60000;
let hsData=null, hsAt=0, hsFor='', hsP=null, hsErr=null;
function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function weekKey(){ const d=new Date(); d.setDate(d.getDate()-((d.getDay()+6)%7)); return ymd(d); }   // this week's Monday
function hsLoad(force){
  if(!API.has()||!S.room||!S.stage) return Promise.resolve(null);
  const k=S.room+'|'+S.stage+'|'+S.classNumber;
  if(!force&&hsData&&hsFor===k&&Date.now()-hsAt<HS_FRESH_MS) return Promise.resolve(hsData);
  if(hsP&&hsFor===k) return hsP;
  if(hsFor!==k) hsData=null;
  hsFor=k;
  hsP=API.get({action:'getHighScores',room:S.room,stage:S.stage,classNumber:S.demo?'':S.classNumber})
    .then(j=>{ hsData=j; hsAt=Date.now(); hsErr=null; return j; })
    .catch(e=>{ hsErr=e; return null; })
    .finally(()=>{ hsP=null; });
  return hsP;
}
async function hsSubmit(game,score){
  score=Math.floor(score);
  if(S.demo||!S.authed||!API.has()||!(score>0)||!S.stage) return null;
  const wk=weekKey(), k=walletId()+'|'+S.stage+'|'+game, m=store.get(HS_KEY,{});
  if(m.week!==wk){ m.week=wk; m.best={}; }
  m.best=m.best||{};
  if((m.best[k]||0)>=score) return null;                 // not a new best for this week: nothing to send
  m.best[k]=score; store.set(HS_KEY,m);
  try{
    const j=await API.post({action:'addHighScore',game,score,room:S.room,classNumber:S.classNumber,student:S.student,stage:S.stage});
    if(j&&j.game){
      if(hsData&&hsFor===S.room+'|'+S.stage+'|'+S.classNumber){ hsData.games=hsData.games||{}; hsData.games[game]=j.game; }
      else await hsLoad(true);
    }
    return j;
  }catch(e){
    const m2=store.get(HS_KEY,{}); if(m2.best&&m2.best[k]===score){ delete m2.best[k]; store.set(HS_KEY,m2); }   // try again next time
    return null;
  }
}
function hsLabels(){ const rm=String(S.room||'').replace(/^Room\s*/i,'Rm '); return [`Stage ${S.stage} ${rm}`,`Stage ${S.stage} Whole School`,'All Stages Whole School']; }
function hsInner(game){
  if(!API.has()) return '<p class="muted hs-msg">High scores need the Google Sheet link in js/config.js.</p>';
  if(!hsData){
    if(hsErr) return `<p class="muted hs-msg">${/unknown action/i.test(hsErr.message||'')?'High scores will appear once the Google Sheet\'s Apps Script has been updated.':'High scores couldn\'t load just now.'}</p>`;
    return '<p class="muted hs-msg">Loading high scores…</p>';
  }
  const g=(hsData.games||{})[game]||{}, F=HS_GAMES[game].fmt, L=hsLabels();
  const cell=e=>e?`<b>${esc(e[0])}</b> <span class="hs-sc">(${esc(F(e[1]))})</span>`:'<span class="muted">No score yet</span>';
  return `<ul class="hs-list">${[['room','🏫'],['stage','🏅'],['all','🌏']].map(([k,ic],i)=>`<li><span class="hs-l"><span aria-hidden="true">${ic}</span> ${esc(L[i])}</span><span class="hs-v">${cell(g[k])}</span></li>`).join('')}</ul>
    ${!S.demo&&g.me?`<p class="hs-me">Your best this week: <b>${esc(F(g.me))}</b></p>`:''}`;
}
function hsBox(game,title){ return `<section class="hs-box" data-hs="${game}" aria-label="${esc(HS_GAMES[game].name)} high scores"><h3 class="hs-h">${title||'<span aria-hidden="true">🏆</span> This week\'s high scores'}</h3><div class="hs-in">${hsInner(game)}</div></section>`; }
function hsFill(){ app.querySelectorAll('[data-hs]').forEach(el=>{ const i=el.querySelector('.hs-in'); if(i) i.innerHTML=hsInner(el.dataset.hs); }); }
function hsShow(){ hsLoad().then(()=>hsFill()); }
function bonusOK(){ return S.role==='student'&&!!weekData()&&(S.demo||medalFromDone(weekDone(),S.term)==='gold'); }
function bonusPool(){
  const seen=new Set(), out=[];
  if(!S.term||!S.week) return out;
  for(let t=1;t<=S.term;t++){
    const st=(t===S.term||S.demo)?S.stage:stageForTerm(t);
    if(!st||!DATA[st]) continue;
    const last=t===S.term?S.week:9;
    for(let w=1;w<=last;w++){
      const wk=DATA[st].weeks[t+'-'+w]; if(!wk||!wk.l) continue;
      const L=DATA[st].lists[wk.l]; if(!L||!L.w) continue;
      L.w.forEach(x=>{ if(seen.has(x[0])) return; seen.add(x[0]); out.push({w:x[0],x,st}); });
    }
  }
  return out;
}
const wordGuessPool=()=>{ const all=bonusPool().filter(p=>LETTERS.test(p.w)); const mid=all.filter(p=>p.w.length>=4&&p.w.length<=8); return mid.length?mid:all; };
function chunkAt(x,st){ const pal=(DATA[st]||{}).pal||{}; return '<span class="chunk-word">'+x[1].map(([t,c])=>'<span style="color:'+(pal[c]||'#1a1a1a')+'">'+esc(t)+'</span>').join('')+'</span>'; }
function defFor(w,st){ const i=WORD_INFO[w]||WORD_INFO[w.toLowerCase()]; return (i&&i.d)||((CONTENT[st]||{})[w]||{}).d||''; }
function sentFor(w,st){ return ((CONTENT[st]||{})[w]||{}).s||''; }
const bzRecent={};
function bzPick(game,pool){
  const r=bzRecent[game]=bzRecent[game]||[];
  let opts=pool.filter(p=>!r.includes(p.w)); if(!opts.length){ r.length=0; opts=pool; }
  const p=opts[Math.floor(Math.random()*opts.length)];
  r.push(p.w); while(r.length>Math.min(15,Math.floor(pool.length/2))) r.shift();
  return p;
}
/* winning streaks for Spellsa and Ice Blocks: the streak keeps going while the student solves words in a row,
   and goes back to 0 when they run out of lives or tries. The best streak is kept on the iPad only. */
const STREAK_KEY='pldSpell.bzStreak.v1';
function streakAll(){ return store.get(STREAK_KEY,{}); }
function streakGet(game){ return Object.assign({cur:0,best:0},(streakAll()[S.demo?'teacher':walletId()]||{})[game]||{}); }
function streakSave(game,v){ const all=streakAll(), who=S.demo?'teacher':walletId(); all[who]=all[who]||{}; all[who][game]={cur:v.cur,best:v.best}; store.set(STREAK_KEY,all); }
/* a word that was shown but not finished (the page was reloaded, or the student left the game) breaks the streak */
const OPEN_KEY='pldSpell.bzOpen.v1';
function openWho(){ return S.demo?'teacher':walletId(); }
function wordOpen(game,on){ const m=store.get(OPEN_KEY,{}), w=openWho(); m[w]=m[w]||{}; if(on) m[w][game]=1; else delete m[w][game]; store.set(OPEN_KEY,m); }
function wordWasOpen(game){ return !!((store.get(OPEN_KEY,{})[openWho()]||{})[game]); }
function streakStartWord(game){
  let r=null;
  if(wordWasOpen(game)){ r=streakEnd(game,false); r.skipped=true; }
  wordOpen(game,true);
  return r;
}
function streakEnd(game,won){ wordOpen(game,false); const v=streakGet(game); if(won){ v.cur++; v.isBest=v.cur>v.best; if(v.isBest) v.best=v.cur; } else { v.lost=v.cur; v.cur=0; if(v.lost) hsSubmit(game,v.lost); } streakSave(game,v); return v; }
/* a streak that is still going counts for the weekly high scores when the student leaves the game */
function streakOnLeave(game){
  const send=()=>{ const c=streakGet(game).cur; if(c) hsSubmit(game,c); };
  screenAC.signal.addEventListener('abort',send);
  window.addEventListener('pagehide',send,{signal:screenAC.signal});
}
function streakHTML(game,last){
  const v=streakGet(game), nb=last&&last.isBest&&v.best>1;
  return `<div class="bz-streak${nb?' newbest':''}" role="status"><span class="st-cur${last&&!last.lost&&last.cur?' up':''}"><span aria-hidden="true">🔥</span> Streak <b>${v.cur}</b></span><span class="st-best"><span aria-hidden="true">🏆</span> Best streak <b>${v.best}</b></span>${nb?'<span class="st-new">New best!</span>':''}${last&&last.lost?`<span class="st-lost">${last.skipped?`The last word wasn't finished, so your streak of ${last.lost} has ended.`:`Your streak of ${last.lost} has ended.`}</span>`:''}</div>`;
}
/* each student's best score in each survival game, kept on the iPad only */
function gameBest(g){ const who=S.demo?'teacher':walletId(), v=+((store.get(BEST_KEY,{})[who]||{})[g]||0); return v||(g==='lig'?+(store.get(LIG_KEY,{})[who]||0):0); }
function setGameBest(g,n){ const all=store.get(BEST_KEY,{}), who=S.demo?'teacher':walletId(); all[who]=all[who]||{}; all[who][g]=n; store.set(BEST_KEY,all); }
const fmtM=n=>Math.floor(n).toLocaleString('en-AU')+' m';
/* real words for Ice Blocks: the dictionary in data/dictionary.js plus every PLD list word */
let realWords=null;
function isRealWord(w){
  w=String(w).toLowerCase();
  if(!realWords){
    realWords=new Set();
    const D=window.WORD_DICT||{};
    Object.keys(D).forEach(k=>{ const n=+k, s=D[k]; if(n>0&&typeof s==='string') for(let i=0;i+n<=s.length;i+=n) realWords.add(s.slice(i,i+n)); });
    (D.EXTRA||[]).forEach(x=>realWords.add(String(x).toLowerCase()));
    Object.keys(DATA).forEach(st=>Object.values(DATA[st].lists||{}).forEach(L=>(L.w||[]).forEach(x=>realWords.add(String(x[0]).toLowerCase()))));
  }
  return realWords.has(w);
}
function bzSnd(kind){
  const s=SFX.session(0.12); if(!s) return; const t=s.now()+0.02;
  if(kind==='ok'){ s.tone(76,t,0.12,{type:'triangle',v:0.12}); s.tone(83,t+0.08,0.2,{type:'triangle',v:0.12}); }
  else if(kind==='bad') s.tone(0,t,0.28,{type:'sawtooth',f:190,to:110,v:0.06});
  else if(kind==='tick') s.tone(96,t,0.05,{type:'square',v:0.03});
  else if(kind==='skip') s.tone(0,t,0.22,{type:'triangle',f:420,to:260,v:0.07});
  else if(kind==='whoosh'){ s.whoosh(t,0.9,0.16); s.bell(84,t+0.1,0.06,0.8); s.bell(91,t+0.25,0.05,0.8); }
  setTimeout(()=>s.stop(),1500);
}
function funBurst(){
  const s=SFX.session(0.15); if(s){ playTierMusic(s,2); setTimeout(()=>s.stop(),2500); }
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c=document.createElement('canvas'); c.className='bz-fx'; c.setAttribute('aria-hidden','true'); document.body.appendChild(c);
  const fx=Fireworks(c);
  fx.confetti(fx.W/2,fx.H*0.45,120,{speed:[5,13]});
  fx.confetti(0,fx.H,60,{angle:-Math.PI*0.32,spread:0.5,speed:[12,20]});
  fx.confetti(fx.W,fx.H,60,{angle:-Math.PI*0.68,spread:0.5,speed:[12,20]});
  setTimeout(()=>{ fx.stop(); c.remove(); },4500);
}
function bonusBtnHTML(){
  return `<button class="bonus-btn" id="bonusBtn" aria-label="Bonus Zone: fun word games"><span class="bb-ic" aria-hidden="true">⚡</span><span class="bb-tx"><b>BONUS</b><small>ZONE</small></span><span class="bb-ic" aria-hidden="true">⚡</span></button>`;
}
function bzHead(title){ return `<div class="act-head"><div><div class="crumb">⚡ Bonus Zone</div><h2>${title}</h2></div><div class="tools" style="margin:0"><button class="btn small" id="toBz"><span aria-hidden="true">⚡</span> Bonus games</button><button class="btn small" id="toMenu">Back to activities</button></div></div>`; }
function bzWire(){ $('#toBz').onclick=()=>go('bonus'); $('#toMenu').onclick=()=>go('menu'); }
/* the answer card shown when a round ends: the word in its PLD colours, its meaning and a Hear it button */
function bzReveal(p){
  const d=defFor(p.w,p.st);
  return `<div class="bz-reveal"><div class="bz-rword">${chunkAt(p.x,p.st)}</div>${d?`<p class="bz-rdef">${esc(d)}</p>`:''}<button class="btn small" id="bzHear"><span aria-hidden="true">🔊</span> Hear it</button></div>`;
}

SCREENS.bonus=function(){
  if(!bonusOK()) return go(S.role==='student'?'menu':'role');
  const pool=bonusPool(), wg=wordGuessPool().length, hg=pool.some(p=>/[A-Za-z]/.test(p.w));
  const sn=SURVIVE.snow.pool().length, tr=SURVIVE.troll.pool().length;
  const bestLine=(g)=>{ const b=gameBest(g); return b?`<br><b>Your best: ${HS_GAMES[g].fmt(b)}</b>`:''; };
  const stLine=(g)=>streakGet(g).best?`<br><b>Best streak: ${streakGet(g).best}</b>`:'';
  app.innerHTML=`<div class="bz-hero"><div class="bz-bolt" aria-hidden="true">⚡</div><h1 class="bz-title">Bonus Zone</h1>
    <p class="bz-sub">${S.demo?'Just for fun.':`Gold for Week ${S.week}! These games are just for fun.`} They use all <b>${pool.length}</b> words from ${S.demo?`Stage ${S.stage}, from Term 1 up to Term ${S.term} Week ${S.week}`:'your spelling lists this year'}.</p></div>
    <div class="bz-games">
      <div class="bz-col"><button class="bz-game g-hang" data-g="bHang" ${hg?'':'disabled'}><span class="ic" aria-hidden="true">👗</span><span class="nm">Spellsa</span><span class="ds">Guess the letters before Spellsa is finished. You have ${HANG_LIVES} lives.${stLine('hang')}</span></button>${hsBox('hang')}</div>
      <div class="bz-col"><button class="bz-game g-word" data-g="bWord" ${wg?'':'disabled'}><span class="ic" aria-hidden="true">🧊</span><span class="nm">Ice Blocks</span><span class="ds">Find the secret word in ${WG_TRIES} tries, guessing real words. Cyan means the right letter in the right spot!${stLine('word')}</span></button>${hsBox('word')}</div>
      <div class="bz-col"><button class="bz-game g-speed" data-g="bSpeed"><span class="ic" aria-hidden="true">🎈</span><span class="nm">Let it Go</span><span class="ds">Spell the words you hear to keep air in your balloon as it climbs into space!${bestLine('lig')}</span></button>${hsBox('lig')}</div>
      <div class="bz-col"><button class="bz-game g-snow" data-g="bSnow" ${sn?'':'disabled'}><span class="ic" aria-hidden="true">⛄</span><span class="nm">Do You Wanna Build a Snowman?</span><span class="ds">Type the word for each meaning to stop your snowman melting in the sun!${bestLine('snow')}</span></button>${hsBox('snow')}</div>
      <div class="bz-col"><button class="bz-game g-troll" data-g="bTroll" ${tr?'':'disabled'}><span class="ic" aria-hidden="true">🧌</span><span class="nm">Troll Rolling</span><span class="ds">Fill the gaps in the sentences to keep your moss troll rolling down the hill!${bestLine('troll')}</span></button>${hsBox('troll')}</div>
    </div>
    <div class="tools"><button class="btn" id="back">Back to activities</button></div>`;
  $('#back').onclick=()=>go('menu');
  app.querySelectorAll('.bz-game').forEach(b=>b.onclick=()=>go(b.dataset.g));
  hsShow();
};

/* tap-and-drag scrolling on the Bonus Zone pages for a mouse, pen or smartboard (a finger on an iPad already scrolls).
   A drag that moves the page doesn't count as a tap on whatever it started on. */
const DRAG_SCREENS=['bonus','bHang','bWord','bSpeed','bSnow','bTroll'];
(function(){
  let d=null;
  document.addEventListener('pointerdown',e=>{
    d=null;
    if(e.pointerType==='touch'||e.button!==0||!DRAG_SCREENS.includes(S.screen)) return;
    if(e.target.closest('#kb,.wg-kb,.tf,input,select,textarea,.modal,.cel')) return;
    d={id:e.pointerId,y:e.clientY,sy:window.scrollY,moved:false};
  },true);
  document.addEventListener('pointermove',e=>{
    if(!d||e.pointerId!==d.id) return;
    const dy=e.clientY-d.y;
    if(!d.moved&&Math.abs(dy)<10) return;
    d.moved=true; window.scrollTo(0,d.sy-dy); e.preventDefault();
    const sel=window.getSelection&&window.getSelection(); if(sel&&sel.removeAllRanges) sel.removeAllRanges();
  },{capture:true,passive:false});
  const end=e=>{
    if(!d||e.pointerId!==d.id) return;
    if(d.moved){ const stop=ev=>{ ev.stopPropagation(); ev.preventDefault(); }; document.addEventListener('click',stop,true); setTimeout(()=>document.removeEventListener('click',stop,true),60); }
    d=null;
  };
  document.addEventListener('pointerup',end,true); document.addEventListener('pointercancel',end,true);
})();

/* ---------- Bonus: Spellsa (guess the letters) ----------
   Each wrong letter draws one more part of the picture: head, hair, dress, left arm, right arm, shoes. */
SCREENS.bHang=function(){
  if(!bonusOK()) return go('menu');
  const pool=bonusPool().filter(p=>/[A-Za-z]/.test(p.w));
  let cur, guessed, wrong, over, hinted, last=null;
  const letters=()=>new Set(cur.w.toLowerCase().replace(/[^a-z]/g,'').split(''));
  const won=()=>[...letters()].every(l=>guessed.has(l));
  function newWord(){ cur=bzPick('hang',pool); guessed=new Set(); wrong=0; over=false; hinted=false; last=streakStartWord('hang'); draw(); hsShow(); }
  function wordHTML(){
    return [...cur.w].map(ch=>{
      if(ch===' ') return '<span class="hg-gap"></span>';
      if(!/[A-Za-z]/.test(ch)) return `<span class="hg-ch fixed">${esc(ch)}</span>`;
      const got=guessed.has(ch.toLowerCase()), show=got||over;
      return `<span class="hg-ch${show?' on':''}${over&&!got?' missed':''}">${show?esc(ch):''}</span>`;
    }).join('');
  }
  function pic(){
    const lost=over&&!won();
    const g=(i,inner)=>`<g class="sp-part${i<wrong?' on':''}${i===wrong-1?' new':''}">${inner}</g>`;
    const face=lost
      ? '<g class="sp-face"><circle cx="93" cy="54" r="2.2"/><circle cx="107" cy="54" r="2.2"/><path class="sp-line" d="M93 67q7-6 14 0"/><path class="sp-tear" d="M107 59q-2 4 0 6q2-2 0-6z"/></g>'
      : '<g class="sp-face"><circle cx="93" cy="54" r="2.2"/><circle cx="107" cy="54" r="2.2"/><path class="sp-line" d="M93 63q7 6 14 0"/><circle class="sp-blush" cx="88" cy="61" r="3.5"/><circle class="sp-blush" cx="112" cy="61" r="3.5"/></g>';
    // drawn back to front: hair sits behind the head and dress, so it comes first in the picture
    return `<svg viewBox="0 0 200 220" class="hg-svg sp-svg" role="img" aria-label="${wrong} of ${HANG_LIVES} wrong guesses">
      <ellipse class="sp-snow" cx="100" cy="206" rx="86" ry="11"/>
      ${g(1,'<path class="sp-hair" d="M78 56c-4-22 9-36 22-36s26 14 22 36c2 14 4 26 9 36c-10 5-22 4-31-2c-9 6-21 7-31 2c5-10 7-22 9-36z"/>')}
      ${g(3,'<path class="sp-arm" d="M88 84q-14 18-18 42"/><circle class="sp-skin" cx="70" cy="128" r="5"/>')}
      ${g(4,'<path class="sp-arm" d="M112 84q14 18 18 42"/><circle class="sp-skin" cx="130" cy="128" r="5"/>')}
      ${g(5,'<ellipse class="sp-shoe" cx="91" cy="196" rx="9" ry="5"/><ellipse class="sp-shoe" cx="109" cy="196" rx="9" ry="5"/>')}
      ${g(2,'<path class="sp-dress" d="M88 78h24l-4 34l26 80h-68l26-80z"/><path class="sp-trim" d="M92 112h16M70 186h60"/><rect class="sp-skin" x="96" y="70" width="8" height="10" rx="3"/>')}
      ${g(0,'<circle class="sp-skin sp-head" cx="100" cy="56" r="19"/>'+face+'<path class="sp-fringe" d="M81 52c2-14 10-21 19-21s17 7 19 21c-6-6-12-9-19-9s-13 3-19 9z" style="opacity:'+(wrong>1?1:0)+'"/>')}
    </svg>`;
  }
  function draw(){
    const win=over&&won(), left=HANG_LIVES-wrong;
    app.innerHTML=bzHead('Spellsa')+streakHTML('hang',last)+`<div class="hg">
      <div class="hg-pic sp-pic">${pic()}<div class="hg-lives"><span aria-hidden="true">${'💙'.repeat(left)}${'🤍'.repeat(wrong)}</span><span class="sr">${left} lives left</span></div></div>
      <div class="hg-main">
        <div class="hg-word" aria-label="Secret word, ${cur.w.length} characters">${wordHTML()}</div>
        <p class="hg-msg ${win?'good':over?'bad':''}" role="status">${win?'🎉 You got it!':over?'Out of lives! The word was:':`Tap a letter. ${[...letters()].filter(l=>!guessed.has(l)).length} more different letter${[...letters()].filter(l=>!guessed.has(l)).length===1?'':'s'} to find.`}</p>
        ${over?bzReveal(cur):`<div class="hg-keys">${'abcdefghijklmnopqrstuvwxyz'.split('').map(l=>{ const g=guessed.has(l); return `<button class="hk${g?(letters().has(l)?' hit':' miss'):''}" data-l="${l}" ${g?'disabled':''} aria-label="${l}">${l}</button>`; }).join('')}</div>`}
        ${hinted&&!over?`<p class="bz-hint"><b>Hint:</b> ${esc(defFor(cur.w,cur.st)||'There is no hint for this word.')}</p>`:''}
        <div class="tools">${over?'<button class="btn primary" id="again">Next word</button>':`<button class="btn small" id="hint" ${hinted?'disabled':''}><span aria-hidden="true">💡</span> Hint</button>`}</div>
      </div></div>${hsBox('hang')}`;
    bzWire();
    if(over){ $('#again').onclick=newWord; $('#bzHear').onclick=()=>speak(cur.w); }
    else{
      $('#hint').onclick=()=>{ hinted=true; draw(); };
      app.querySelector('.hg-keys').onclick=e=>{
        const b=e.target.closest('[data-l]'); if(!b||b.disabled) return;
        const l=b.dataset.l; guessed.add(l);
        if(letters().has(l)) bzSnd('ok'); else { wrong++; bzSnd('bad'); }
        if(won()){ over=true; last=streakEnd('hang',true); funBurst(); } else if(wrong>=HANG_LIVES){ over=true; last=streakEnd('hang',false); }
        draw();
      };
    }
  }
  streakOnLeave('hang');
  newWord();
};

/* ---------- Bonus: Ice Blocks (like Wordle) ----------
   Every guess must be a real word (data/dictionary.js or any spelling list word), not a mash of letters.
   Snow white = letter not in the word, powder blue = in the word but in the wrong spot, cyan = right spot. */
SCREENS.bWord=function(){
  if(!bonusOK()) return go('menu');
  const pool=wordGuessPool();
  if(!pool.length) return go('bonus');
  let cur, ans, len, rows, typed, over, keys, hinted, msg, justRow, last=null;
  const RANK={correct:3,present:2,absent:1};
  function newWord(){ cur=bzPick('word',pool); ans=cur.w.toLowerCase(); len=ans.length; rows=[]; typed=''; over=false; keys={}; hinted=false; msg=''; justRow=-1; last=streakStartWord('word'); draw(); hsShow(); }
  function mark(g){
    const res=Array(len).fill('absent'), left={};
    for(let i=0;i<len;i++){ if(g[i]===ans[i]) res[i]='correct'; else left[ans[i]]=(left[ans[i]]||0)+1; }
    for(let i=0;i<len;i++) if(res[i]!=='correct'&&left[g[i]]>0){ res[i]='present'; left[g[i]]--; }
    return res;
  }
  function grid(){
    let h='';
    for(let r=0;r<WG_TRIES;r++){
      const done=rows[r], live=!over&&r===rows.length;
      h+=`<div class="wg-row${live?' live':''}">`;
      for(let i=0;i<len;i++){
        const ch=done?done.g[i]:live?(typed[i]||''):'';
        const cls=done?' '+done.r[i]+(r===justRow?' flip':''):(ch?' typed':'');
        h+=`<div class="wg-t${cls}" style="${r===justRow?`animation-delay:${i*0.12}s`:''}">${esc(ch)}</div>`;
      }
      h+='</div>';
    }
    return h;
  }
  function kb(){
    const rowsK=['qwertyuiop','asdfghjkl','+zxcvbnm-'];
    return `<div class="wg-kb">${rowsK.map(r=>`<div class="wg-kr">${r.split('').map(k=>k==='+'?'<button class="wgk wide" data-k="enter">Enter</button>':k==='-'?'<button class="wgk wide" data-k="back" aria-label="Delete">⌫</button>':`<button class="wgk ${keys[k]||''}" data-k="${k}">${k}</button>`).join('')}</div>`).join('')}</div>`;
  }
  function draw(){
    const win=over&&rows.length&&rows[rows.length-1].g===ans;
    app.innerHTML=bzHead('Ice Blocks')+streakHTML('word',last)+`<p class="centre muted" style="margin-top:-6px">The secret word has <b>${len}</b> letters. Every guess must be a real word.<br><span class="sw correct"></span> right letter, right spot · <span class="sw present"></span> in the word, wrong spot · <span class="sw absent"></span> not in the word</p>
      <div class="wg-grid ice" style="--n:${len}">${grid()}</div>
      <p class="hg-msg ${win?'good':over?'bad':''}" id="wgMsg" role="status">${win?`🎉 Got it in ${rows.length}!`:over?'Out of tries! The word was:':esc(msg)}</p>
      ${over?bzReveal(cur):kb()}
      ${hinted&&!over?`<p class="bz-hint"><b>Hint:</b> ${esc(defFor(cur.w,cur.st)||'There is no hint for this word.')}</p>`:''}
      <div class="tools">${over?'<button class="btn primary" id="again">Next word</button>':`<button class="btn small" id="hint" ${hinted?'disabled':''}><span aria-hidden="true">💡</span> Hint</button>`}</div>${hsBox('word')}`;
    bzWire(); justRow=-1;
    if(over){ $('#again').onclick=newWord; $('#bzHear').onclick=()=>speak(cur.w); return; }
    $('#hint').onclick=()=>{ hinted=true; draw(); };
    app.querySelector('.wg-kb').addEventListener('pointerdown',e=>{
      const b=e.target.closest('[data-k]'); if(!b) return; e.preventDefault(); press(b.dataset.k);
    });
  }
  function shake(){ const r=app.querySelector('.wg-row.live'); if(!r) return; r.classList.remove('shake'); void r.offsetWidth; r.classList.add('shake'); }
  function nope(m){ msg=m; $('#wgMsg').textContent=msg; $('#wgMsg').className='hg-msg bad'; shake(); bzSnd('bad'); }
  function press(k){
    if(over) return;
    if(k==='back'){ typed=typed.slice(0,-1); msg=''; }
    else if(k==='enter'){
      if(typed.length<len) return nope(`Type all ${len} letters first.`);
      if(!isRealWord(typed)) return nope(`"${typed.toUpperCase()}" isn't a word we know. Try a real word.`);
      const r=mark(typed); rows.push({g:typed,r}); justRow=rows.length-1;
      [...typed].forEach((c,i)=>{ if((RANK[r[i]]||0)>(RANK[keys[c]]||0)) keys[c]=r[i]; });
      typed=''; msg='';
      if(r.every(x=>x==='correct')){ over=true; last=streakEnd('word',true); timers.push(setTimeout(funBurst,len*120+250)); }
      else if(rows.length>=WG_TRIES){ over=true; last=streakEnd('word',false); bzSnd('bad'); }
    }
    else if(typed.length<len){ typed+=k; msg=''; }
    draw();
  }
  newWord();
};

/* ---------- Bonus: survival games ----------
   Let it Go, Do You Wanna Build a Snowman? and Troll Rolling all run on the same engine.
   Each has a meter (balloon air, snowman hp, troll speed) that drains every second, and drains a
   little faster every 10 seconds. Correct answers fill the meter up; wrong answers and skips take
   some away. When the meter reaches 0 the game is over. The numbers for each game are in
   LIG, SNOW and TROLL near the top of the Bonus Zone section. */
const mixHex=(a,b,f)=>{ const p=x=>[1,3,5].map(i=>parseInt(x.slice(i,i+2),16)); const A=p(a),B=p(b); return 'rgb('+A.map((v,i)=>Math.round(v+(B[i]-v)*f)).join(',')+')'; };
const clamp01=v=>Math.max(0,Math.min(1,v));
const hash2=(a,b)=>{ let h=(a*374761393+b*668265263)|0; h=(h^(h>>>13))*1274126177|0; return ((h^(h>>>16))>>>0)/4294967296; };
/* a canvas that redraws itself every frame and keeps its size in step with the page */
function CanvasLoop(canvas,draw){
  const ctx=canvas.getContext('2d');
  const st={ctx,W:0,H:0,t:0,reduce:!!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)};
  let raf=0,alive=true,last=performance.now();
  function size(){ const dpr=Math.min(window.devicePixelRatio||1,2); st.W=canvas.clientWidth; st.H=canvas.clientHeight; canvas.width=Math.round(st.W*dpr); canvas.height=Math.round(st.H*dpr); ctx.setTransform(dpr,0,0,dpr,0,0); }
  size();
  const ro=window.ResizeObserver?new ResizeObserver(size):null; if(ro) ro.observe(canvas); else window.addEventListener('resize',size);
  function frame(now){ if(!alive) return; const dt=Math.min(0.05,(now-last)/1000); last=now; st.t+=dt; if(st.W>0&&st.H>0) draw(dt,st); raf=requestAnimationFrame(frame); }
  raf=requestAnimationFrame(frame);
  st.stop=()=>{ alive=false; cancelAnimationFrame(raf); if(ro) ro.disconnect(); else window.removeEventListener('resize',size); };
  return st;
}

/* ---------- Let it Go: the balloon, the sky and the funny things flying past ---------- */
function LetItGoScene(canvas){
  let alt=0, shown=0, phase='held', rise=0, boostFx=0, air=LIG.START, airShown=LIG.START, leak=LIG.DRAIN, bad=0;
  let pz={x:0,y:0,vx:0,vy:0,t:0,s:1};             // the balloon whizzing about when it runs out of air
  const puffs=[], flyers=[]; let nextFly=1.5;
  const SKY=[[0,'#8fd3ff','#d6f0ff'],[350,'#6cbcf2','#b8e2fb'],[700,'#3d7fd0','#7cb8ec'],[1000,'#1b3477','#3d6fbe'],[1300,'#0a1236','#1b2d6a'],[1600,'#04061a','#0b1236']];
  function skyAt(m){ let i=0; while(i<SKY.length-1&&m>=SKY[i+1][0]) i++; if(i===SKY.length-1) return [SKY[i][1],SKY[i][2]]; const a=SKY[i],b=SKY[i+1],f=(m-a[0])/(b[0]-a[0]); return [mixHex(a[1],b[1],f),mixHex(a[2],b[2],f)]; }
  const L=CanvasLoop(canvas,draw), ctx=L.ctx;
  function cloud(x,y,s,a){ ctx.globalAlpha=a; ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.arc(x,y,18*s,0,7); ctx.arc(x+20*s,y-10*s,22*s,0,7); ctx.arc(x+44*s,y,17*s,0,7); ctx.arc(x+22*s,y+6*s,20*s,0,7); ctx.fill(); ctx.globalAlpha=1; }
  function bird(x,y,s){ ctx.strokeStyle='#2b3a55'; ctx.lineWidth=2; ctx.beginPath(); const f=Math.sin(L.t*8+x)*3; ctx.moveTo(x-8*s,y-f); ctx.quadraticCurveTo(x-3*s,y-6*s,x,y); ctx.quadraticCurveTo(x+3*s,y-6*s,x+8*s,y-f); ctx.stroke(); }
  function planet(kind,x,y){
    ctx.save();
    if(kind===0){ ctx.fillStyle='#e9edf3'; ctx.beginPath(); ctx.arc(x,y,26,0,7); ctx.fill(); ctx.fillStyle='#c9d0db'; [[-8,-6,6],[9,5,5],[-2,11,4]].forEach(([a,b,r])=>{ ctx.beginPath(); ctx.arc(x+a,y+b,r,0,7); ctx.fill(); }); }
    else if(kind===1){ ctx.fillStyle='#f2c46d'; ctx.beginPath(); ctx.arc(x,y,22,0,7); ctx.fill(); ctx.strokeStyle='#e8d9a8'; ctx.lineWidth=4; ctx.beginPath(); ctx.ellipse(x,y,40,9,-0.35,0,7); ctx.stroke(); }
    else if(kind===2){ ctx.fillStyle='#d9653b'; ctx.beginPath(); ctx.arc(x,y,16,0,7); ctx.fill(); ctx.fillStyle='rgba(120,40,20,.35)'; ctx.beginPath(); ctx.arc(x+5,y-3,5,0,7); ctx.fill(); }
    else if(kind===3){ ctx.fillStyle='#9aa4b2'; ctx.fillRect(x-6,y-6,12,12); ctx.fillStyle='#3d6fbe'; ctx.fillRect(x-30,y-5,20,10); ctx.fillRect(x+10,y-5,20,10); ctx.strokeStyle='#cfd6df'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x,y-6); ctx.lineTo(x,y-14); ctx.stroke(); }
    else { ctx.fillStyle='#7b5cd6'; ctx.beginPath(); ctx.arc(x,y,14,0,7); ctx.fill(); ctx.strokeStyle='rgba(255,255,255,.5)'; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(x,y,24,6,0.4,0,7); ctx.stroke(); }
    ctx.restore();
  }
  function ground(baseY){
    const W=L.W,H=L.H; if(baseY<-60) return;
    ctx.fillStyle='#7bc96f'; ctx.beginPath(); ctx.moveTo(0,baseY); for(let x=0;x<=W;x+=20) ctx.lineTo(x,baseY-8-10*Math.sin(x/70)); ctx.lineTo(W,H+400); ctx.lineTo(0,H+400); ctx.fill();
    ctx.fillStyle='#5aa84f'; ctx.fillRect(0,baseY+6,W,H+400);
    const hx=W*0.16, hy=baseY-6;
    ctx.fillStyle='#fff4e0'; ctx.fillRect(hx,hy-30,44,30); ctx.fillStyle='#d9534f'; ctx.beginPath(); ctx.moveTo(hx-6,hy-30); ctx.lineTo(hx+22,hy-52); ctx.lineTo(hx+50,hy-30); ctx.fill();
    ctx.fillStyle='#7aa7d9'; ctx.fillRect(hx+8,hy-22,10,10); ctx.fillStyle='#8a5a36'; ctx.fillRect(hx+26,hy-18,10,18);
    const tx=W*0.82; ctx.fillStyle='#8a5a36'; ctx.fillRect(tx-4,baseY-30,8,30); ctx.fillStyle='#3f9a4a'; ctx.beginPath(); ctx.arc(tx,baseY-40,20,0,7); ctx.arc(tx-12,baseY-30,14,0,7); ctx.arc(tx+12,baseY-30,14,0,7); ctx.fill();
  }
  /* the balloon gets smaller as it loses air (s = 1 when full) */
  function balloon(x,y,heldBy,s,limp){
    const t=L.t, r0=Math.max(22,Math.min(34,L.W/14)), r=r0*s, ry=r*(limp?0.8:1.18);
    const knotY=y+ry+4;
    ctx.strokeStyle='#5b6384'; ctx.lineWidth=1.6; ctx.beginPath(); ctx.moveTo(x,knotY);
    const len=heldBy!=null?heldBy-knotY:r0*2.4;
    for(let i=1;i<=12;i++){ const yy=knotY+len*i/12; ctx.lineTo(x+Math.sin(t*3+i*0.7)*(L.reduce?0:3+bad*8)*(i/12),yy); }
    ctx.stroke();
    const g=ctx.createRadialGradient(x-r*0.35,y-ry*0.4,r*0.15,x,y,r*1.3);
    g.addColorStop(0,'#eefbfd'); g.addColorStop(0.35,'#b0e0e6'); g.addColorStop(1,'#7fb9c4');
    ctx.fillStyle=g; ctx.strokeStyle='#5f9aa6'; ctx.lineWidth=2;
    ctx.beginPath();
    if(s<0.75&&!L.reduce){                       // wrinkly when it's low on air
      const n=28, wr=(0.75-s)*0.12;
      for(let i=0;i<=n;i++){ const a=i/n*Math.PI*2, k=1+Math.sin(a*7+t*2)*wr; const px=x+Math.cos(a)*r*k, py=y+Math.sin(a)*ry*k; i?ctx.lineTo(px,py):ctx.moveTo(px,py); }
    } else ctx.ellipse(x,y,r,ry,0,0,7);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle='#8cc4ce'; ctx.beginPath(); ctx.moveTo(x-5,knotY+2); ctx.lineTo(x+5,knotY+2); ctx.lineTo(x,knotY-5); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,.75)'; ctx.beginPath(); ctx.ellipse(x-r*0.38,y-ry*0.36,r*0.16,ry*0.24,-0.5,0,7); ctx.fill();
    if(boostFx>0){ ctx.strokeStyle='rgba(255,255,255,'+(boostFx*0.8).toFixed(2)+')'; ctx.lineWidth=3; for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.moveTo(x+i*14,knotY+r0*0.5+10); ctx.lineTo(x+i*14,knotY+r0*0.5+10+26*boostFx); ctx.stroke(); } }
    return knotY;
  }
  function hand(x,y,open){
    ctx.fillStyle='#f6d7c3'; ctx.strokeStyle='#c99a7d'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.ellipse(x,y+14,14,18,0,0,7); ctx.fill(); ctx.stroke();
    ctx.fillRect(x-10,y+20,20,L.H); ctx.strokeRect(x-10,y+20,20,L.H);
    if(!open){ ctx.beginPath(); ctx.ellipse(x,y+2,12,8,0,0,7); ctx.fill(); ctx.stroke(); }
    else for(let i=-1;i<=1;i++){ ctx.beginPath(); ctx.ellipse(x+i*8,y-6,4,9,i*0.3,0,7); ctx.fill(); ctx.stroke(); }
  }
  /* ---- things that fly past (drawn facing right, around 0,0) ---- */
  const E=(x,y,rx,ry,rot,fill,stroke,lw)=>{ ctx.beginPath(); ctx.ellipse(x,y,rx,ry,rot||0,0,7); if(fill){ ctx.fillStyle=fill; ctx.fill(); } if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=lw||1.5; ctx.stroke(); } };
  const C=(x,y,r,fill,stroke,lw)=>E(x,y,r,r,0,fill,stroke,lw);
  const RR=(x,y,w,h,r,fill,stroke,lw)=>{ ctx.beginPath(); if(ctx.roundRect) ctx.roundRect(x,y,w,h,r); else ctx.rect(x,y,w,h); if(fill){ ctx.fillStyle=fill; ctx.fill(); } if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=lw||1.5; ctx.stroke(); } };
  const LN=(pts,stroke,lw)=>{ ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1])); ctx.strokeStyle=stroke; ctx.lineWidth=lw||1.5; ctx.stroke(); };
  const FLY={
    heli(t){ LN([[-40,-2],[-14,0]],'#c23b3b',5); C(-42,-3,6,null,'#555',1.5); LN([[-42,-9+6*Math.sin(t*50)],[-42,3-6*Math.sin(t*50)]],'#555',2);
      E(0,0,22,13,0,'#e94f4f','#9e2b2b',2); E(9,-3,9,7,0,'#bfe8ff','#5b6384',1.5); LN([[0,-13],[0,-18]],'#555',2);
      const w=30*Math.abs(Math.cos(t*30)); LN([[-w,-18],[w,-18]],'#333',3); LN([[-14,16],[16,16]],'#555',2); LN([[-8,12],[-8,16]],'#555',2); LN([[8,12],[8,16]],'#555',2); },
    hotair(t){ ctx.save(); ctx.beginPath(); ctx.ellipse(0,-12,26,30,0,0,7); ctx.clip();
      ['#ff4d6d','#ffd23f','#3ec1d3','#7bd389','#a06cd5'].forEach((c,i)=>{ ctx.fillStyle=c; ctx.fillRect(-26+i*10.4,-44,10.4,64); }); ctx.restore();
      E(0,-12,26,30,0,null,'#6b4a2a',2); LN([[-14,14],[-8,30]],'#6b4a2a',1.5); LN([[14,14],[8,30]],'#6b4a2a',1.5);
      RR(-9,28,18,12,3,'#b07a46','#6b4a2a',2); C(-3,26,3,'#f6d7c3'); C(4,26,3,'#f6d7c3'); },
    pig(t){ const f=Math.sin(t*14);
      ctx.save(); ctx.translate(-2,-10); ctx.rotate(-0.4-f*0.6); E(0,-10,7,14,0,'#fff','#bbb',1.5); ctx.restore();
      E(0,0,22,14,0,'#f7a6c1','#c86b8c',2); C(20,-5,11,'#f7a6c1','#c86b8c',2); E(29,-3,5,4,0,'#f48fb1','#c86b8c',1.5);
      C(27.5,-3.5,1,'#7a3350'); C(30.5,-3.5,1,'#7a3350'); C(20,-8,1.8,'#1f2a55');
      ctx.beginPath(); ctx.moveTo(14,-14); ctx.lineTo(16,-22); ctx.lineTo(20,-15); ctx.fillStyle='#f48fb1'; ctx.fill();
      [-12,-4,6,12].forEach(x=>LN([[x,12],[x,19]],'#c86b8c',4));
      ctx.beginPath(); ctx.arc(-25,-2,4,0,Math.PI*1.6); ctx.strokeStyle='#c86b8c'; ctx.lineWidth=2; ctx.stroke();
      ctx.save(); ctx.translate(2,-10); ctx.rotate(-0.2+f*0.6); E(0,-10,7,14,0,'#ffffff','#bbb',1.5); ctx.restore(); },
    flycar(t){ RR(-28,-6,56,16,6,'#3ec1d3','#1f6f7c',2); RR(-14,-18,26,14,6,'#bfe8ff','#1f6f7c',2);
      C(-16,11,6,'#333'); C(16,11,6,'#333'); C(-16,11,2,'#ccc'); C(16,11,2,'#ccc');
      LN([[0,-18],[0,-24]],'#555',2); const w=22*Math.abs(Math.cos(t*28)); LN([[-w,-24],[w,-24]],'#333',3);
      C(27,0,3,'#ffd23f'); C(4,-11,4,'#f6d7c3'); },
    jet(t){ E(0,0,26,5,0,'#f4f6fb','#5b6384',1.5);
      ctx.beginPath(); ctx.moveTo(4,0); ctx.lineTo(-6,14); ctx.lineTo(2,14); ctx.lineTo(12,0); ctx.closePath(); ctx.fillStyle='#f4f6fb'; ctx.fill(); ctx.strokeStyle='#5b6384'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-20,-2); ctx.lineTo(-26,-12); ctx.lineTo(-20,-12); ctx.lineTo(-14,-2); ctx.fill(); ctx.stroke(); },
    bus(t){ const f=Math.sin(t*10);
      ctx.save(); ctx.translate(-6,-12); ctx.rotate(-0.3-f*0.5); E(0,-12,9,18,0,'#fff','#aaa',1.5); ctx.restore();
      RR(-34,-12,68,24,5,'#ffcc29','#a67c00',2); for(let i=0;i<5;i++) RR(-28+i*11,-8,8,8,2,'#bfe8ff','#a67c00',1);
      LN([[-34,4],[34,4]],'#1f2a55',2); C(-20,13,6,'#333'); C(20,13,6,'#333'); C(33,6,2.5,'#fff3b0');
      ctx.save(); ctx.translate(6,-12); ctx.rotate(-0.1+f*0.5); E(0,-12,9,18,0,'#fff','#aaa',1.5); ctx.restore(); },
    ufo(t){ const bl=Math.floor(t*6)%3;
      E(0,-6,14,14,0,'rgba(191,232,255,.85)','#5b6384',1.5);
      C(0,-6,7,'#7bd389','#3f7a2a',1.5); E(-3,-7,2.2,3,0,'#111'); E(3,-7,2.2,3,0,'#111');
      LN([[-3,-12],[-6,-19+Math.sin(t*6)*2]],'#3f7a2a',1.5); LN([[3,-12],[6,-19-Math.sin(t*6)*2]],'#3f7a2a',1.5); C(-6,-19+Math.sin(t*6)*2,1.8,'#ffd23f'); C(6,-19-Math.sin(t*6)*2,1.8,'#ffd23f');
      E(0,2,34,10,0,'#aab3c5','#5b6384',2); [-22,-8,8,22].forEach((x,i)=>C(x,3,2.5,i%3===bl?'#ffd23f':['#ff4d6d','#3ec1d3','#7bd389'][i%3]));
      ctx.save(); ctx.translate(14,-14); ctx.rotate(Math.sin(t*8)*0.5); LN([[0,0],[6,-6]],'#3f7a2a',2); ctx.restore(); },
    comet(t){ const g=ctx.createLinearGradient(-90,-30,0,0); g.addColorStop(0,'rgba(255,255,255,0)'); g.addColorStop(1,'rgba(255,214,120,.9)');
      ctx.beginPath(); ctx.moveTo(-90,-34); ctx.lineTo(0,-7); ctx.lineTo(0,7); ctx.closePath(); ctx.fillStyle=g; ctx.fill();
      C(0,0,9,'#fff7d6'); C(0,0,13,'rgba(255,214,120,.35)'); },
    rocket(t){ const fl=10+Math.sin(t*30)*4;
      ctx.beginPath(); ctx.moveTo(-22,-5); ctx.lineTo(-22-fl,0); ctx.lineTo(-22,5); ctx.fillStyle='#ff8c42'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(-22,-3); ctx.lineTo(-22-fl*0.6,0); ctx.lineTo(-22,3); ctx.fillStyle='#ffd23f'; ctx.fill();
      RR(-22,-9,36,18,8,'#f4f6fb','#5b6384',2); ctx.beginPath(); ctx.moveTo(14,-9); ctx.quadraticCurveTo(30,0,14,9); ctx.fillStyle='#e94f4f'; ctx.fill(); ctx.strokeStyle='#5b6384'; ctx.stroke();
      C(2,0,4.5,'#bfe8ff','#5b6384',1.5);
      ctx.fillStyle='#e94f4f'; ctx.beginPath(); ctx.moveTo(-16,-9); ctx.lineTo(-24,-17); ctx.lineTo(-8,-9); ctx.fill(); ctx.beginPath(); ctx.moveTo(-16,9); ctx.lineTo(-24,17); ctx.lineTo(-8,9); ctx.fill(); },
    astro(t){ ctx.rotate(Math.sin(t*0.8)*0.6);
      RR(-12,-2,24,26,8,'#f4f6fb','#5b6384',2); RR(-17,0,6,18,3,'#d5dbe6','#5b6384',1.5);
      const w=Math.sin(t*3)*0.6; ctx.save(); ctx.translate(12,4); ctx.rotate(-0.8+w); RR(0,-3,16,7,3,'#f4f6fb','#5b6384',1.5); ctx.restore();
      LN([[-12,6],[-20,14]],'#5b6384',6); LN([[-12,6],[-20,14]],'#f4f6fb',4);
      LN([[-5,24],[-7,34]],'#5b6384',7); LN([[5,24],[7,34]],'#5b6384',7); LN([[-5,24],[-7,34]],'#f4f6fb',5); LN([[5,24],[7,34]],'#f4f6fb',5);
      C(0,-12,13,'#f4f6fb','#5b6384',2); E(2,-12,9,7,0,'#1b2d6a'); E(-1,-14,3,2,-0.4,'rgba(255,255,255,.7)'); },
    cow(t){ ctx.rotate(t*0.6);
      E(0,0,22,13,0,'#ffffff','#555',2); E(-8,-3,6,5,0,'#222'); E(8,4,5,4,0,'#222'); E(2,-8,4,3,0,'#222');
      [-12,-5,5,12].forEach(x=>LN([[x,11],[x,20]],'#555',4)); LN([[-22,-2],[-28,6]],'#555',1.5);
      E(24,-4,9,8,0,'#ffffff','#555',2); E(29,-1,5,4,0,'#f7a6c1','#c86b8c',1); C(22,-7,1.6,'#111'); LN([[19,-11],[17,-16]],'#c9a53a',2); LN([[26,-11],[28,-16]],'#c9a53a',2);
      C(24,-5,15,'rgba(191,232,255,.25)','rgba(255,255,255,.85)',2); }
  };
  const SIZE={heli:1,hotair:1,pig:1.1,flycar:1,jet:1.1,bus:1,ufo:1.1,comet:1,rocket:1.1,astro:0.95,cow:1};
  function kinds(m){ return m<450?['heli','hotair','pig','flycar']:m<1150?['jet','bus','ufo','flycar','pig']:['ufo','comet','rocket','astro','cow']; }
  function spawnFlyer(){
    const ks=kinds(shown), kind=ks[Math.floor(Math.random()*ks.length)], dir=Math.random()<0.5?1:-1;
    const sp=kind==='comet'?190+Math.random()*80:kind==='jet'||kind==='rocket'?110+Math.random()*60:55+Math.random()*55;
    flyers.push({kind,dir,sp,x:dir>0?-110:L.W+110,y:L.H*(0.12+Math.random()*0.5),vy:kind==='comet'?sp*0.3:(Math.random()-0.5)*8,s:SIZE[kind]*(0.8+Math.random()*0.35),bob:Math.random()*6});
  }
  function draw(dt,{W,H,t}){
    if(phase==='release'){ rise=Math.min(1,rise+dt/1.2); if(rise>=1) phase='flying'; }
    shown+=(alt-shown)*Math.min(1,dt*(L.reduce?20:3));
    airShown+=(air-airShown)*Math.min(1,dt*4);
    boostFx=Math.max(0,boostFx-dt*1.6); bad=Math.max(0,bad-dt*2);
    const cruise=H*0.42, heldY=H*0.62;
    const by=phase==='held'?heldY:heldY+(cruise-heldY)*(1-Math.pow(1-rise,3));
    const camY=shown*LIG.PX, groundY=H*0.88+camY;
    const [top,bot]=skyAt(shown);
    const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,top); g.addColorStop(1,bot); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    const starA=clamp01((shown-850)/400);
    if(starA>0){ const cell=50, off=camY*0.3; for(let gy=Math.floor(-off/cell)-1;gy<=Math.ceil((H-off)/cell)+1;gy++) for(let gx=0;gx<=Math.ceil(W/cell);gx++){
      const r=hash2(gx,gy), x=gx*cell+r*cell, y=gy*cell+hash2(gy,gx)*cell+off; if(r<0.55) continue;
      ctx.globalAlpha=starA*(0.5+0.5*Math.sin(t*2+r*20)); ctx.fillStyle='#fff'; ctx.fillRect(x,y,r>0.92?2.4:1.4,r>0.92?2.4:1.4); } ctx.globalAlpha=1; }
    if(shown>1150){ const step=180*LIG.PX; for(let k=Math.floor((camY-H)/step);k<=Math.floor((camY+H)/step)+1;k++){ if(k*step<1250*LIG.PX) continue;
      const y=H*0.5-(k*step-camY)*0.6+H*0.5, x=W*(0.15+0.7*hash2(k,7)); if(y>-60&&y<H+60) planet(((k%5)+5)%5,x,y); } }
    const cloudA=1-clamp01((shown-700)/400);
    if(cloudA>0){ const row=110; for(let k=Math.floor(-H/row)-1;k<=Math.ceil(camY/row)+2;k++){
      const y=groundY-140-k*row; if(y<-80||y>H+80||k<0) continue;
      const r=hash2(k,3); if(r<0.25) continue; const x=((hash2(k,9)*W*1.4+t*(8+r*10))%(W+160))-80; cloud(x,y,0.7+r*0.7,cloudA*0.9); } }
    if(shown<450){ for(let k=1;k<=6;k++){ const y=groundY-260-k*230; if(y<-20||y>H+20) continue; bird(((hash2(k,5)*W+t*30)%(W+40))-20,y,1); bird(((hash2(k,5)*W+t*30+18)%(W+40))-20,y+8,0.8); } }
    // funny flyers zoom past once the balloon is up
    if(phase!=='held'&&!L.reduce){ nextFly-=dt; if(nextFly<=0){ if(flyers.length<2) spawnFlyer(); nextFly=2.8+Math.random()*3.2; } }
    for(let i=flyers.length-1;i>=0;i--){ const f=flyers[i]; f.x+=f.dir*f.sp*dt; f.y+=f.vy*dt;
      if(f.x<-140||f.x>W+140||f.y>H+80){ flyers.splice(i,1); continue; }
      ctx.save(); ctx.translate(f.x,f.y+Math.sin(t*2+f.bob)*3); ctx.scale(f.dir*f.s,f.s); if(f.kind==='comet') ctx.rotate(0.3); FLY[f.kind](t); ctx.restore(); }
    ground(groundY);
    const sway=L.reduce?0:Math.sin(t*1.3)*8+Math.sin(t*23)*bad*6;
    const s=0.45+0.55*clamp01(airShown/LIG.CAP);
    if(phase==='held'){ hand(W/2,H*0.62+70,false); balloon(W/2+sway*0.3,by,H*0.62+70,s); }
    else if(phase==='pop'||phase==='fall'){
      pz.t+=dt;
      if(phase==='pop'){
        const k=L.reduce?0:1; pz.vx+=Math.sin(pz.t*17)*900*dt*k; pz.vy+=Math.cos(pz.t*13)*900*dt*k-60*dt;
        pz.vx*=0.96; pz.vy*=0.96; pz.x=Math.max(30,Math.min(W-30,pz.x+pz.vx*dt)); pz.y=Math.max(40,Math.min(H*0.8,pz.y+pz.vy*dt));
        pz.s=Math.max(0.28,pz.s-dt*0.45);
        if(!L.reduce&&Math.random()<0.7) puffs.push({x:pz.x,y:pz.y+30*pz.s,vx:-pz.vx*0.2+(Math.random()-0.5)*30,vy:-pz.vy*0.2+20,r:4+Math.random()*4,a:0.7});
        if(pz.t>1.7){ phase='fall'; pz.vy=0; }
      } else { pz.vy+=260*dt; pz.y+=pz.vy*dt; pz.x+=Math.sin(pz.t*3)*20*dt; }
      if(pz.y<H+120) balloon(pz.x,pz.y,null,pz.s,phase==='fall');
    }
    else{
      if(phase==='release') hand(W/2,H*0.62+70+rise*60,true);
      const x=W/2+sway, knot=balloon(x,by,null,s);
      // air leaking out of the knot: more puffs the faster it leaks
      if(phase==='flying'&&!L.reduce&&Math.random()<dt*(1.5+leak*2.2)) puffs.push({x,y:knot+4,vx:(Math.random()-0.5)*24,vy:30+Math.random()*30,r:2.5+Math.random()*3,a:0.55});
    }
    for(let i=puffs.length-1;i>=0;i--){ const p=puffs[i]; p.x+=p.vx*dt; p.y+=p.vy*dt; p.r+=dt*7; p.a-=dt*0.9; if(p.a<=0){ puffs.splice(i,1); continue; }
      ctx.globalAlpha=p.a; C(p.x,p.y,p.r,'#ffffff'); ctx.globalAlpha=1; }
  }
  return {
    start(){ if(phase==='held'){ phase='release'; rise=L.reduce?1:0; } },
    set(v,info){ air=Math.max(0,v); leak=info.rate; alt=info.score; },
    good(){ boostFx=1; },
    bad(){ bad=1; },
    end(){ if(phase==='pop'||phase==='fall') return; const W=L.W,H=L.H; pz={x:W/2,y:H*0.42,vx:(Math.random()<0.5?-1:1)*260,vy:-200,t:0,s:0.6}; phase='pop'; },
    stop(){ L.stop(); }
  };
}

/* ---------- Do You Wanna Build a Snowman?: the snowman, the sun and the puddle ---------- */
function SnowmanScene(canvas){
  let hp=SNOW.START, shown=SNOW.START, heat=0, heatShown=0, phase='ready', pop=0, shake=0, gone=0;
  const drips=[], flakes=[], wisps=[];
  const L=CanvasLoop(canvas,draw), ctx=L.ctx;
  const E=(x,y,rx,ry,rot,fill,stroke,lw)=>{ ctx.beginPath(); ctx.ellipse(x,y,Math.max(0.1,rx),Math.max(0.1,ry),rot||0,0,7); if(fill){ ctx.fillStyle=fill; ctx.fill(); } if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=lw||1.5; ctx.stroke(); } };
  function ball(x,y,rx,ry,m){
    const g=ctx.createRadialGradient(x-rx*0.35,y-ry*0.45,rx*0.1,x,y,rx*1.15);
    g.addColorStop(0,'#ffffff'); g.addColorStop(0.65,'#eef6ff'); g.addColorStop(1,'#bcd5ee');
    E(x,y,rx,ry,0,g,'#9cbad8',2);
    if(m>0.12){ ctx.fillStyle='#e6f1fc'; for(let i=0;i<3;i++){ const a=Math.PI*(0.25+i*0.25), dx=Math.cos(a)*rx*0.85, dy=Math.sin(a)*ry*0.85, l=ry*0.38*m;   // drippy bottom edge
      ctx.beginPath(); ctx.moveTo(x+dx-5,y+dy); ctx.quadraticCurveTo(x+dx,y+dy+l*1.6,x+dx+5,y+dy); ctx.fill(); } }
  }
  function tree(x,y,s){ ctx.fillStyle='#6b4a2a'; ctx.fillRect(x-3*s,y-10*s,6*s,10*s);
    for(let i=0;i<3;i++){ const w=(26-i*6)*s, ty=y-10*s-i*14*s; ctx.fillStyle='#2f7a4a'; ctx.beginPath(); ctx.moveTo(x-w,ty); ctx.lineTo(x,ty-22*s); ctx.lineTo(x+w,ty); ctx.fill();
      ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.moveTo(x-w*0.45,ty-12*s); ctx.lineTo(x,ty-22*s); ctx.lineTo(x+w*0.45,ty-12*s); ctx.quadraticCurveTo(x,ty-15*s,x-w*0.45,ty-12*s); ctx.fill(); } }
  function hat(x,y,r,rot){ ctx.save(); ctx.translate(x,y); ctx.rotate(rot);
    ctx.fillStyle='#1f2a55'; ctx.fillRect(-r*1.05,-r*0.14,r*2.1,r*0.22); ctx.fillRect(-r*0.62,-r*1.15,r*1.24,r*1.05);
    ctx.fillStyle='#e94f4f'; ctx.fillRect(-r*0.62,-r*0.36,r*1.24,r*0.18); ctx.restore(); }
  function carrot(x,y,len,rot,w){ ctx.save(); ctx.translate(x,y); ctx.rotate(rot); ctx.fillStyle='#ff8c42'; ctx.strokeStyle='#c75e17'; ctx.lineWidth=1.2;
    ctx.beginPath(); ctx.moveTo(0,-w); ctx.lineTo(len,0); ctx.lineTo(0,w); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
  function stick(x,y,len,rot){ ctx.save(); ctx.translate(x,y); ctx.rotate(rot); ctx.strokeStyle='#6b4a2a'; ctx.lineWidth=3; ctx.lineCap='round';
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(len,0); ctx.moveTo(len*0.7,0); ctx.lineTo(len*0.88,-len*0.18); ctx.moveTo(len*0.75,0); ctx.lineTo(len*0.95,len*0.12); ctx.stroke(); ctx.restore(); }
  function sun(x,y,r,t,h){
    const glow=ctx.createRadialGradient(x,y,r*0.6,x,y,r*2.4); glow.addColorStop(0,'rgba(255,200,80,'+(0.35+h*0.3)+')'); glow.addColorStop(1,'rgba(255,200,80,0)');
    ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(x,y,r*2.4,0,7); ctx.fill();
    const col=mixHex('#ffd23f','#ff7a1a',h);
    ctx.save(); ctx.translate(x,y); ctx.rotate(L.reduce?0:t*(0.3+h*0.9)); ctx.fillStyle=col;
    for(let i=0;i<12;i++){ ctx.rotate(Math.PI/6); ctx.beginPath(); ctx.moveTo(r*1.12,-r*0.16); ctx.lineTo(r*(1.55+h*0.25+0.08*Math.sin(t*4+i)),0); ctx.lineTo(r*1.12,r*0.16); ctx.fill(); }
    ctx.restore();
    E(x,y,r,r,0,col,'#e09f00',2);
    // cool sunglasses and a cheeky grin
    ctx.fillStyle='#1f2a55'; const gy=y-r*0.18;
    ctx.beginPath(); if(ctx.roundRect){ ctx.roundRect(x-r*0.72,gy-r*0.2,r*0.62,r*0.38,r*0.12); ctx.roundRect(x+r*0.1,gy-r*0.2,r*0.62,r*0.38,r*0.12); } else { ctx.rect(x-r*0.72,gy-r*0.2,r*0.62,r*0.38); ctx.rect(x+r*0.1,gy-r*0.2,r*0.62,r*0.38); } ctx.fill();
    ctx.fillRect(x-r*0.12,gy-r*0.12,r*0.24,r*0.08);
    ctx.fillStyle='rgba(255,255,255,.6)'; ctx.fillRect(x-r*0.6,gy-r*0.12,r*0.14,r*0.06); ctx.fillRect(x+r*0.22,gy-r*0.12,r*0.14,r*0.06);
    ctx.strokeStyle='#8a4b00'; ctx.lineWidth=2.5; ctx.beginPath();
    if(phase==='melted'){ ctx.arc(x,y+r*0.25,r*0.42,0.1,Math.PI-0.1); ctx.closePath(); ctx.fillStyle='#8a4b00'; ctx.fill(); }
    else { ctx.arc(x+r*0.1,y+r*0.18,r*0.38,0.2+h*0.1,Math.PI-0.6); ctx.stroke(); }
  }
  function draw(dt,{W,H,t}){
    shown+=(hp-shown)*Math.min(1,dt*4); heatShown+=(heat-heatShown)*Math.min(1,dt*1.5);
    pop=Math.max(0,pop-dt*1.4); shake=Math.max(0,shake-dt*2.2); if(phase==='melted') gone=Math.min(1,gone+dt*1.2);
    const h=heatShown, k=Math.min(W,H)/340, gy=H*0.9, cx=W*0.42;
    // sky gets warmer as the sun heats up
    const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,mixHex('#8fd3ff','#ffb27a',h*0.7)); g.addColorStop(1,mixHex('#e3f5ff','#ffe9c7',h*0.8)); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    sun(W*0.8,H*0.4,(20+10*h)*k,t,h);
    // far snowy hills and trees
    ctx.fillStyle='#dcecf8'; ctx.beginPath(); ctx.moveTo(0,gy-40*k); ctx.quadraticCurveTo(W*0.25,gy-95*k,W*0.55,gy-45*k); ctx.quadraticCurveTo(W*0.8,gy-10*k,W,gy-60*k); ctx.lineTo(W,gy); ctx.lineTo(0,gy); ctx.fill();
    tree(W*0.1,gy-14*k,0.9*k); tree(W*0.2,gy-6*k,0.7*k); tree(W*0.9,gy-8*k,0.8*k);
    // the snowy ground; grass peeps through as it melts
    ctx.fillStyle='#f6fbff'; ctx.beginPath(); ctx.moveTo(0,gy); for(let x=0;x<=W;x+=24) ctx.lineTo(x,gy-3*Math.sin(x/40)); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.fill();
    const m=phase==='melted'?1:clamp01(1-shown/SNOW.START);
    if(m>0.05){ ctx.globalAlpha=Math.min(0.85,m); [[0.12,0.95,30],[0.75,0.93,40],[0.92,0.98,24],[0.3,0.99,22]].forEach(([fx,fy,r])=>E(W*fx,H*fy,r*k,7*k,0,'#8fd27a')); ctx.globalAlpha=1; }
    // puddle
    E(cx,gy+3*k,(36+120*m)*k,(6+9*m)*k,0,'rgba(110,185,235,.55)','rgba(70,140,200,.5)',1.5);
    const wob=shake?Math.sin(t*45)*shake*5*k:0, R1=40*k;
    if(m<0.96){
      const bounce=1+0.14*Math.sin(pop*12)*pop, s1=(1-0.42*m)*bounce, sy=1-0.42*m, lean=m*m*R1*0.7;
      const r1=R1*s1, ry1=r1*sy, y1=gy-ry1+3*k;
      const r2=R1*0.7*(1-0.5*m)*bounce, ry2=r2*sy, x2=cx+lean*0.4+wob, y2=y1-ry1-ry2*0.78;
      const r3=R1*0.5*(1-0.55*m)*bounce, ry3=r3*(1-0.25*m), x3=cx+lean+wob, y3=y2-ry2-ry3*0.8;
      const wave=L.reduce?0:Math.sin(t*3)*0.18*(1-m);
      stick(x2-r2*0.85,y2-ry2*0.15,R1*0.95*(1-0.2*m),Math.PI+(0.55-1.35*m)-wave);
      stick(x2+r2*0.85,y2-ry2*0.15,R1*0.95*(1-0.2*m),(0.55-1.35*m)*-1+wave);
      ball(cx+wob*0.5,y1,r1,ry1,m); ball(x2,y2,r2,ry2,m);
      ctx.fillStyle='#1f2a55'; [[-0.15],[0.25]].forEach(([f])=>{ ctx.beginPath(); ctx.arc(x2+lean*0.05,y2+ry2*f,3.2*k,0,7); ctx.fill(); });
      // scarf
      ctx.fillStyle='#e94f4f'; ctx.beginPath(); ctx.ellipse(x2+(x3-x2)*0.5,y2-ry2*0.88,r2*0.78,6*k,0,0,7); ctx.fill();
      ctx.save(); ctx.translate(x2+r2*0.35,y2-ry2*0.85); ctx.rotate(0.25+m*0.6+(L.reduce?0:Math.sin(t*2)*0.06)); ctx.fillRect(0,0,9*k,26*k*(1-0.2*m)); ctx.fillStyle='#ffd23f'; ctx.fillRect(0,20*k*(1-0.2*m),9*k,3*k); ctx.restore();
      ball(x3,y3,r3,ry3,m*0.6);
      // face
      const ey=y3-ry3*0.18, worried=m>0.45;
      ctx.fillStyle='#1f2a55'; ctx.beginPath(); ctx.arc(x3-r3*0.33,ey,3.4*k,0,7); ctx.arc(x3+r3*0.28,ey,3.4*k,0,7); ctx.fill();
      if(worried){ ctx.strokeStyle='#1f2a55'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x3-r3*0.5,ey-r3*0.35); ctx.lineTo(x3-r3*0.18,ey-r3*0.24); ctx.moveTo(x3+r3*0.45,ey-r3*0.35); ctx.lineTo(x3+r3*0.13,ey-r3*0.24); ctx.stroke(); }
      carrot(x3,y3+ry3*0.05,r3*0.95,m*1.05,4*k);
      for(let i=0;i<5;i++){ const f=(i-2)/2, my=y3+ry3*0.45+(worried?-1:1)*(1-f*f)*ry3*0.16-(worried?ry3*0.1:0); ctx.fillStyle='#1f2a55'; ctx.beginPath(); ctx.arc(x3+f*r3*0.42,my,2*k,0,7); ctx.fill(); }
      hat(x3+m*r3*0.5,y3-ry3*0.86,r3*0.95,-0.12+m*0.9+wob*0.01);
      // steam when the sun is hot, drips while it melts
      if(phase==='play'&&!L.reduce){
        if(Math.random()<dt*(1.2+heat*5)) drips.push({x:cx+(Math.random()-0.5)*r1*1.5,y:y1+ry1*0.4,vy:20,a:1});
        if(heat>0.25&&Math.random()<dt*heat*3) wisps.push({x:x3+(Math.random()-0.5)*r3,y:y3-ry3*1.6,a:0.6,ph:Math.random()*6});
      }
      if(pop>0&&!L.reduce){ ctx.fillStyle='rgba(255,255,255,'+pop.toFixed(2)+')'; for(let i=0;i<8;i++){ const a=i/8*Math.PI*2+t*2, rr=R1*(1.4+0.4*Math.sin(t*5+i)); ctx.font=(14*k|0)+'px sans-serif'; ctx.fillText('✦',cx+Math.cos(a)*rr,y2+Math.sin(a)*rr*0.9); } }
    } else {
      // all melted: the hat, carrot, coal and sticks bob in the puddle
      const bob=L.reduce?0:Math.sin(t*2)*1.5*k, a=gone;
      ctx.globalAlpha=a;
      stick(cx-R1*1.4,gy+bob,R1*0.8,0.08); stick(cx+R1*1.5,gy-bob,R1*0.8,Math.PI-0.1);
      carrot(cx-R1*0.6,gy+1*k-bob,R1*0.45,-0.15,4*k);
      ctx.fillStyle='#1f2a55'; [[-0.1,0],[0.15,1],[0.45,-1],[0.9,0]].forEach(([f,d])=>{ ctx.beginPath(); ctx.arc(cx+f*R1,gy+2*k+d*bob,3*k,0,7); ctx.fill(); });
      ctx.fillStyle='#e94f4f'; ctx.fillRect(cx-R1*0.2,gy+5*k,R1*0.6,4*k);
      hat(cx+R1*0.35,gy-2*k+bob,R1*0.42,0.35);
      ctx.globalAlpha=1;
    }
    for(let i=drips.length-1;i>=0;i--){ const d=drips[i]; d.vy+=300*dt; d.y+=d.vy*dt; if(d.y>gy+2*k){ drips.splice(i,1); continue; }
      ctx.fillStyle='#7cc4ea'; ctx.beginPath(); ctx.moveTo(d.x,d.y-5*k); ctx.quadraticCurveTo(d.x+3*k,d.y,d.x,d.y+2*k); ctx.quadraticCurveTo(d.x-3*k,d.y,d.x,d.y-5*k); ctx.fill(); }
    for(let i=wisps.length-1;i>=0;i--){ const w=wisps[i]; w.y-=dt*28; w.a-=dt*0.5; if(w.a<=0){ wisps.splice(i,1); continue; }
      ctx.strokeStyle='rgba(255,255,255,'+w.a.toFixed(2)+')'; ctx.lineWidth=2; ctx.beginPath(); for(let j=0;j<6;j++){ const yy=w.y-j*4*k, xx=w.x+Math.sin(w.ph+j*0.9+t*3)*3*k; j?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy); } ctx.stroke(); }
    for(let i=flakes.length-1;i>=0;i--){ const f=flakes[i]; f.t+=dt; if(f.t>=1){ flakes.splice(i,1); continue; }
      const e=1-Math.pow(1-f.t,3), x=f.x0+(f.x1-f.x0)*e, y=f.y0+(f.y1-f.y0)*e;
      ctx.globalAlpha=1-f.t*0.6; ctx.fillStyle='#ffffff'; ctx.font=(f.s*k|0)+'px sans-serif'; ctx.fillText('❄',x,y); ctx.globalAlpha=1; }
  }
  return {
    start(){ phase='play'; },
    set(v,info){ hp=Math.max(0,v); heat=clamp01((info.rate-SNOW.DRAIN)/1.5); },
    good(){ pop=1; if(L.reduce) return; const W=L.W,H=L.H; for(let i=0;i<16;i++){ const a=Math.random()*Math.PI*2; flakes.push({x0:W*0.46+Math.cos(a)*W*0.5,y0:H*0.55+Math.sin(a)*H*0.5,x1:W*0.46+(Math.random()-0.5)*60,y1:H*0.62+(Math.random()-0.5)*80,t:Math.random()*0.3,s:12+Math.random()*10}); } },
    bad(){ shake=1; },
    end(){ phase='melted'; hp=0; },
    stop(){ L.stop(); }
  };
}

/* ---------- Troll Rolling: a moss troll curled into a ball, rolling down an endless hill ---------- */
function TrollScene(canvas){
  let sp=0, spShown=0, off=0, ang=0, phase='ready', hop=0, hopV=0, shake=0, sit=0;
  const dust=[], leaves=[];
  const L=CanvasLoop(canvas,draw), ctx=L.ctx;
  const E=(x,y,rx,ry,rot,fill,stroke,lw)=>{ ctx.beginPath(); ctx.ellipse(x,y,Math.max(0.1,rx),Math.max(0.1,ry),rot||0,0,7); if(fill){ ctx.fillStyle=fill; ctx.fill(); } if(stroke){ ctx.strokeStyle=stroke; ctx.lineWidth=lw||1.5; ctx.stroke(); } };
  const MOSS=[[0.55,0.2,0.32,'#4f8f34'],[0.5,2.3,0.28,'#5fa03c'],[0.6,3.9,0.3,'#3f7a2a'],[0.35,1.2,0.22,'#6db547'],[0.62,5.1,0.24,'#4f8f34'],[0.2,4.4,0.2,'#3f7a2a'],[0.7,1.5,0.18,'#7cc24f'],[0.72,3.0,0.16,'#5fa03c']];
  function mushroom(x,y,s){ ctx.fillStyle='#fff4e0'; ctx.fillRect(x-2*s,y-8*s,4*s,8*s); E(x,y-8*s,7*s,5*s,0,'#e94f4f'); ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x-3*s,y-10*s,1.3*s,0,7); ctx.arc(x+2.5*s,y-9*s,1.2*s,0,7); ctx.fill(); }
  function ball(x,y,R,a,t){
    ctx.save(); ctx.translate(x,y); ctx.rotate(a);
    // pointy ears and a little tail stick out of the ball
    ctx.fillStyle='#5a8a3a'; [[-2.3,1],[-1.2,1],[2.6,0.7]].forEach(([q,s])=>{ ctx.beginPath(); ctx.moveTo(Math.cos(q-0.18)*R*0.95,Math.sin(q-0.18)*R*0.95); ctx.lineTo(Math.cos(q)*R*(1+0.38*s),Math.sin(q)*R*(1+0.38*s)); ctx.lineTo(Math.cos(q+0.18)*R*0.95,Math.sin(q+0.18)*R*0.95); ctx.fill(); });
    const g=ctx.createRadialGradient(-R*0.35,-R*0.35,R*0.1,0,0,R*1.1); g.addColorStop(0,'#8fcf5a'); g.addColorStop(1,'#3f7a2a');
    E(0,0,R,R,0,g,'#2f5e20',2.5);
    MOSS.forEach(([d,q,r,c])=>E(Math.cos(q)*R*d,Math.sin(q)*R*d,R*r,R*r*0.8,q,c));
    ctx.strokeStyle='#2f5e20'; ctx.lineWidth=1.5; for(let i=0;i<14;i++){ const q=i/14*Math.PI*2; ctx.beginPath(); ctx.moveTo(Math.cos(q)*R,Math.sin(q)*R); ctx.lineTo(Math.cos(q+0.08)*R*1.08,Math.sin(q+0.08)*R*1.08); ctx.stroke(); }
    // the face peeking out of the ball, a big nose and a cheeky grin
    const fx=R*0.42, fy=R*0.05;
    E(fx,fy,R*0.42,R*0.36,0,'#9ccf6a');
    E(fx-R*0.14,fy-R*0.12,R*0.1,R*0.12,0,'#fff','#2f5e20',1); E(fx+R*0.16,fy-R*0.12,R*0.1,R*0.12,0,'#fff','#2f5e20',1);
    E(fx-R*0.12,fy-R*0.1,R*0.045,R*0.06,0,'#1f2a55'); E(fx+R*0.18,fy-R*0.1,R*0.045,R*0.06,0,'#1f2a55');
    E(fx+R*0.04,fy+R*0.06,R*0.14,R*0.1,0,'#7a5a36');
    ctx.strokeStyle='#2f5e20'; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(fx+R*0.02,fy+R*0.12,R*0.16,0.3,Math.PI-0.3); ctx.stroke();
    ctx.restore();
    // the mushroom rides on top of the ball (it doesn't spin, it's stuck on with moss)
    ctx.save(); ctx.translate(x,y); ctx.rotate(a); mushroom(Math.cos(-1.7)*R*0.92,Math.sin(-1.7)*R*0.92,R/26); ctx.restore();
  }
  function sitting(x,gy,R,t,s){
    // uncurled: a mossy troll sitting on its bottom, dizzy from all that rolling
    const by=gy-R*0.8*s;
    E(x-R*0.45,gy-R*0.08,R*0.32,R*0.16,0,'#5a8a3a','#2f5e20',2); E(x+R*0.45,gy-R*0.08,R*0.32,R*0.16,0,'#5a8a3a','#2f5e20',2);
    const g=ctx.createRadialGradient(x-R*0.3,by-R*0.3,R*0.1,x,by,R*1.1); g.addColorStop(0,'#8fcf5a'); g.addColorStop(1,'#3f7a2a');
    E(x,by,R*0.95,R*0.8*s,0,g,'#2f5e20',2.5);
    MOSS.slice(0,5).forEach(([d,q,r,c])=>E(x+Math.cos(q)*R*d*0.8,by+Math.sin(q)*R*d*0.6,R*r*0.8,R*r*0.6,q,c));
    ctx.strokeStyle='#3f7a2a'; ctx.lineWidth=7; ctx.lineCap='round'; ctx.beginPath(); ctx.moveTo(x-R*0.8,by-R*0.1); ctx.lineTo(x-R*1.05,by+R*0.35); ctx.moveTo(x+R*0.8,by-R*0.1); ctx.lineTo(x+R*1.05,by+R*0.35); ctx.stroke();
    const hy=by-R*0.95*s, hr=R*0.6;
    ctx.fillStyle='#5a8a3a'; ctx.beginPath(); ctx.moveTo(x-hr*0.7,hy-hr*0.4); ctx.lineTo(x-hr*1.5,hy-hr*0.9); ctx.lineTo(x-hr*0.5,hy-hr*0.8); ctx.fill(); ctx.beginPath(); ctx.moveTo(x+hr*0.7,hy-hr*0.4); ctx.lineTo(x+hr*1.5,hy-hr*0.9); ctx.lineTo(x+hr*0.5,hy-hr*0.8); ctx.fill();
    E(x,hy,hr,hr*0.9,0,'#7cb84a','#2f5e20',2.5);
    ctx.strokeStyle='#1f2a55'; ctx.lineWidth=1.8;
    [-1,1].forEach(sd=>{ const ex=x+sd*hr*0.38, ey=hy-hr*0.18; E(ex,ey,hr*0.24,hr*0.24,0,'#fff','#2f5e20',1); ctx.beginPath();
      for(let i=0;i<=24;i++){ const q=i/24*Math.PI*4+(L.reduce?0:t*6*sd), rr=hr*0.2*i/24; i?ctx.lineTo(ex+Math.cos(q)*rr,ey+Math.sin(q)*rr):ctx.moveTo(ex,ey); } ctx.stroke(); });
    E(x,hy+hr*0.18,hr*0.3,hr*0.22,0,'#7a5a36');
    ctx.strokeStyle='#2f5e20'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x-hr*0.3,hy+hr*0.55); ctx.quadraticCurveTo(x,hy+hr*0.45,x+hr*0.3,hy+hr*0.58); ctx.stroke();
    mushroom(x+hr*0.2,hy-hr*0.82,R/24);
    ctx.font=Math.round(R*0.35)+'px sans-serif'; ctx.fillStyle='#ffd23f';
    for(let i=0;i<3;i++){ const q=(L.reduce?0:t*3)+i*Math.PI*2/3; ctx.fillText('★',x+Math.cos(q)*hr*1.25-R*0.12,hy-hr*0.9+Math.sin(q)*hr*0.35); }
  }
  function draw(dt,{W,H,t}){
    spShown+=(sp-spShown)*Math.min(1,dt*3);
    const pxs=spShown*TROLL.PX; off+=pxs*dt;
    const R=Math.max(24,Math.min(W,H)*0.1);
    if(phase!=='stopped') ang+=pxs*dt/R; else sit=Math.min(1,sit+dt*2.5);
    hopV-=900*dt; hop=Math.max(0,hop+hopV*dt); if(hop===0) hopV=0;
    shake=Math.max(0,shake-dt*2.5);
    const g=ctx.createLinearGradient(0,0,0,H); g.addColorStop(0,'#86ccf7'); g.addColorStop(1,'#e8f7ff'); ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    // clouds, far mountains and nearer hills scroll past at different speeds
    ctx.fillStyle='rgba(255,255,255,.9)';
    for(let i=-1;i<4;i++){ const cw=W*0.6, base=Math.floor((off*0.05+t*6)/cw), idx=i+base, x=idx*cw-(off*0.05+t*6), y=H*(0.1+0.12*hash2(idx,1));
      ctx.beginPath(); ctx.arc(x+20,y,14,0,7); ctx.arc(x+38,y-8,18,0,7); ctx.arc(x+58,y,13,0,7); ctx.fill(); }
    const mw=170, mo=off*0.08, mb=Math.floor(mo/mw);
    for(let i=-1;i<=Math.ceil(W/mw)+1;i++){ const idx=i+mb, x=idx*mw-mo, ph=H*(0.22+0.18*hash2(idx,4)), base=H*0.62;
      ctx.fillStyle='#9bb7d9'; ctx.beginPath(); ctx.moveTo(x-30,base); ctx.lineTo(x+mw/2,base-ph); ctx.lineTo(x+mw+30,base); ctx.fill();
      ctx.fillStyle='#f4f8fc'; ctx.beginPath(); ctx.moveTo(x+mw/2-ph*0.22,base-ph*0.72); ctx.lineTo(x+mw/2,base-ph); ctx.lineTo(x+mw/2+ph*0.22,base-ph*0.72); ctx.lineTo(x+mw/2,base-ph*0.78); ctx.fill(); }
    const ho=off*0.3, hw=120, hb=Math.floor(ho/hw);
    ctx.fillStyle='#78bf62'; ctx.beginPath(); ctx.moveTo(0,H); for(let x=0;x<=W+10;x+=10) ctx.lineTo(x,H*0.6-14*Math.sin((x+ho)/70)-8*Math.sin((x+ho)/31)); ctx.lineTo(W,H); ctx.fill();
    for(let i=-1;i<=Math.ceil(W/hw)+1;i++){ const idx=i+hb; if(hash2(idx,8)<0.4) continue; const x=idx*hw-ho+hash2(idx,2)*60, y=H*0.6-14*Math.sin((x+ho)/70)-8*Math.sin((x+ho)/31)+6;
      ctx.fillStyle='#6b4a2a'; ctx.fillRect(x-2,y-8,4,8); ctx.fillStyle='#2f7a4a'; ctx.beginPath(); ctx.moveTo(x-11,y-6); ctx.lineTo(x,y-34); ctx.lineTo(x+11,y-6); ctx.fill(); }
    // the slope: everything from here is tipped so the hill runs downhill to the right
    const slope=0.16;
    ctx.save(); ctx.translate(W/2,H/2); ctx.rotate(slope); ctx.translate(-W/2,-H/2);
    const gy=H*0.72, surf=x=>gy+3*Math.sin((x+off)*0.035)+2*Math.sin((x+off)*0.11);
    ctx.fillStyle='#5aa84f'; ctx.beginPath(); ctx.moveTo(-W*0.4,H*1.6); for(let x=-W*0.4;x<=W*1.4;x+=12) ctx.lineTo(x,surf(x)); ctx.lineTo(W*1.4,H*1.6); ctx.fill();
    ctx.strokeStyle='#7ccf62'; ctx.lineWidth=5; ctx.beginPath(); for(let x=-W*0.4;x<=W*1.4;x+=12) x===-W*0.4?ctx.moveTo(x,surf(x)):ctx.lineTo(x,surf(x)); ctx.stroke();
    const dw=90, db=Math.floor(off/dw);
    for(let i=-6;i<=Math.ceil(W*1.4/dw)+1;i++){ const idx=i+db, r=hash2(idx,11); if(r<0.35) continue; const x=idx*dw-off+hash2(idx,12)*40, y=surf(x)+2;
      if(r<0.55){ E(x,y-4,10,7,0,'#9aa4b2','#6b7380',1.5); }
      else if(r<0.72) mushroom(x,y,1.1);
      else if(r<0.88){ ctx.strokeStyle='#3f7a2a'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x,y-12); ctx.stroke(); E(x,y-14,4,4,0,['#ff4d6d','#ffd23f','#a06cd5'][idx%3>=0?idx%3:0]); E(x,y-14,1.6,1.6,0,'#fff3b0'); }
      else { ctx.strokeStyle='#2f7a4a'; ctx.lineWidth=2; for(let j=-2;j<=2;j++){ ctx.beginPath(); ctx.moveTo(x,y); ctx.quadraticCurveTo(x+j*4,y-12,x+j*8,y-16); ctx.stroke(); } } }
    const bx=W*0.4+(shake?Math.sin(t*40)*shake*5:0), by=surf(bx)-R-hop;
    if(phase!=='stopped'){
      // speed lines and kicked-up dirt, more of them the faster the troll rolls
      const sl=clamp01((spShown-2)/12);
      if(sl>0&&!L.reduce){ ctx.strokeStyle='rgba(255,255,255,'+(0.35+sl*0.5).toFixed(2)+')'; ctx.lineWidth=3; ctx.lineCap='round';
        for(let i=0;i<4;i++){ const yy=by-R*0.6+i*R*0.4, l=(20+50*sl)*(0.6+0.4*Math.sin(t*20+i*2)); ctx.beginPath(); ctx.moveTo(bx-R-8,yy); ctx.lineTo(bx-R-8-l,yy); ctx.stroke(); } }
      if(!L.reduce&&phase==='play'&&Math.random()<dt*spShown*1.6) dust.push({x:bx-R*0.6,y:surf(bx)-2,vx:-40-spShown*8,vy:-30-Math.random()*50,r:3+Math.random()*3,a:0.7});
      ball(bx,by,R,ang,t);
    } else sitting(bx,surf(bx),R,t,0.6+0.4*sit);
    for(let i=dust.length-1;i>=0;i--){ const d=dust[i]; d.vy+=160*dt; d.x+=d.vx*dt; d.y+=d.vy*dt; d.a-=dt*1.2; d.r+=dt*4; if(d.a<=0){ dust.splice(i,1); continue; }
      ctx.globalAlpha=d.a; E(d.x,d.y,d.r,d.r,0,'#b08a5a'); ctx.globalAlpha=1; }
    for(let i=leaves.length-1;i>=0;i--){ const f=leaves[i]; f.vy+=200*dt; f.x+=f.vx*dt; f.y+=f.vy*dt; f.a-=dt*0.8; f.r+=dt*f.spin; if(f.a<=0){ leaves.splice(i,1); continue; }
      ctx.save(); ctx.globalAlpha=f.a; ctx.translate(f.x,f.y); ctx.rotate(f.r); E(0,0,6,3,0,f.c); ctx.restore(); }
    ctx.restore();
  }
  return {
    start(){ phase='play'; },
    set(v){ sp=Math.max(0,v); },
    good(){ hopV=280; if(L.reduce) return; const W=L.W,H=L.H; for(let i=0;i<12;i++) leaves.push({x:W*0.4,y:H*0.6,vx:(Math.random()-0.6)*260,vy:-120-Math.random()*180,a:1,r:Math.random()*6,spin:(Math.random()-0.5)*12,c:['#7cc24f','#4f8f34','#ffd23f'][i%3]}); },
    bad(){ shake=1; },
    end(){ phase='stopped'; sp=0; spShown=0; sit=0; },
    stop(){ L.stop(); }
  };
}

/* ---------- the survival engine ---------- */
const fmtS=n=>{ n=Math.floor(n); return n<60?n+' s':Math.floor(n/60)+' min '+(n%60)+' s'; };
const sdef=p=>((CONTENT[p.st]||{})[p.w]||{}).d||'';
const SURVIVE={
  lig:{ title:'Let it Go', icon:'🎈', R:LIG, cls:'g-speed', speaks:true, minLen:LIG.MIN_LEN,
    pool:()=>bonusPool(),
    meterIc:'💨', meterName:'Air', fmtV:v=>Math.ceil(Math.max(0,v))+'%', fmtRate:r=>`Leaking ${r.toFixed(1)}% a second`, fmtDelta:d=>d+'%',
    scoreName:'Height', score:s=>LIG.CLIMB*s.elapsed+LIG.BOOST*s.correct, fmtScore:fmtM, milestone:{at:1250,msg:'🚀 Space!'}, faster:'💨 The leak is getting bigger!',
    intro:'Let the balloon go, then keep it full of air by spelling words correctly!',
    rules:()=>`<li>🎈 The balloon starts <b>${LIG.START}% full</b> and can't hold more than ${LIG.CAP}%.</li><li>💨 It leaks <b>${LIG.DRAIN}% every second</b>, and the leak gets <b>${LIG.STEP}%</b> faster every ${LIG.EVERY} seconds.</li><li>✅ Every correct word puffs in <b>${LIG.GAIN}%</b> more air.</li><li>❌ A wrong answer lets out <b>${LIG.WRONG}%</b>.</li><li>⏭️ Skipping a word lets out <b>${LIG.SKIP}%</b>.</li><li>🏁 When the balloon is empty, the game is over.</li>`,
    go:'🎈 Let it go!',
    card:`<button class="btn big-audio" id="hear"><span aria-hidden="true">🔊</span> Hear it again</button><p class="sp-sent" id="clue"></p>`,
    show(p){ const s=sentFor(p.w,p.st); $('#clue').innerHTML=s?`<span class="muted">Clue:</span> ${esc(s).replace('___','<span class="blank">&nbsp;</span>')}`:''; speak(p.w); },
    wire(getCur){ $('#hear').onclick=()=>{ const c=getCur(); if(c) speak(c.w); }; },
    endTitle:s=>s>=1250?'Your balloon reached space!':'Your balloon ran out of air!', endLine:s=>`Your balloon climbed <b>${fmtM(s)}</b>`, endIc:'🎈' },
  snow:{ title:'Do You Wanna Build a Snowman?', icon:'⛄', R:SNOW, cls:'g-snow',
    pool:()=>bonusPool().filter(p=>sdef(p)),
    meterIc:'❄️', meterName:'Snowman', fmtV:v=>Math.max(0,v).toFixed(1)+' hp', fmtRate:r=>`Melting ${r.toFixed(1)} hp a second`, fmtDelta:d=>d+' hp',
    scoreName:'Time', score:s=>s.elapsed, fmtScore:fmtS, faster:'☀️ The sun is getting hotter!',
    intro:'The sun is out and your snowman is melting! Type the word that matches each meaning to keep rebuilding it.',
    rules:()=>`<li>⛄ Your snowman starts with <b>${SNOW.START} hp</b>.</li><li>☀️ It melts <b>${SNOW.DRAIN} hp every second</b>, and melts <b>${SNOW.STEP} hp</b> faster every ${SNOW.EVERY} seconds.</li><li>✅ Every correct word rebuilds <b>${SNOW.GAIN} hp</b>.</li><li>❌ A wrong answer or a skip melts <b>${SNOW.WRONG} hp</b>.</li><li>🏁 When your snowman has melted, the game is over.</li>`,
    go:'⛄ Build my snowman!',
    card:`<p class="muted" style="margin-bottom:4px">Which word means…</p><div class="clue" id="clue"></div>`,
    show(p){ $('#clue').innerHTML=`“${esc(sdef(p))}”`; },
    endTitle:()=>'Your snowman melted!', endLine:s=>`Your snowman lasted <b>${fmtS(s)}</b>`, endIc:'⛄' },
  troll:{ title:'Troll Rolling', icon:'🧌', R:TROLL, cls:'g-troll',
    pool:()=>bonusPool().filter(p=>/___/.test(sentFor(p.w,p.st))),
    meterIc:'💨', meterName:'Speed', fmtV:v=>Math.max(0,v).toFixed(1)+' m/s', fmtRate:r=>`Slowing ${r.toFixed(2)} m/s every second`, fmtDelta:d=>(+d.toFixed(2))+' m/s',
    scoreName:'Distance', score:s=>s.dist, fmtScore:fmtM, faster:'🐌 The hill is getting flatter!',
    intro:'Your moss troll has curled into a ball and is rolling down the hill. Fill the gaps in the sentences to keep it rolling!',
    rules:()=>`<li>🧌 Your troll starts rolling at <b>${TROLL.START} m/s</b>.</li><li>🐌 It slows down <b>${TROLL.DRAIN} m/s every second</b>, and slows <b>${TROLL.STEP} m/s</b> faster every ${TROLL.EVERY} seconds.</li><li>✅ Every correct word speeds it up <b>${TROLL.GAIN} m/s</b>.</li><li>❌ A wrong answer or a skip slows it down <b>${TROLL.WRONG} m/s</b>.</li><li>🏁 When your troll stops, the game is over.</li>`,
    go:'🧌 Start rolling!',
    card:`<p class="muted" style="margin-bottom:4px">Which word fits in the gap?</p><div class="clue" id="clue"></div>`,
    show(p){ $('#clue').innerHTML=esc(sentFor(p.w,p.st)).replace('___','<span class="blank">&nbsp;</span>'); },
    endTitle:()=>'Your troll stopped rolling!', endLine:s=>`Your troll rolled <b>${fmtM(s)}</b>`, endIc:'🧌' }
};
const SCENES={lig:c=>LetItGoScene(c),snow:c=>SnowmanScene(c),troll:c=>TrollScene(c)};
function survivalScreen(key){
  return function(){
    if(!bonusOK()) return go('menu');
    const G=SURVIVE[key], R=G.R, pool=G.pool();
    if(!pool.length) return go('bonus');
    let order=[], oi=0, cur=null, v=R.START, elapsed=0, dist=0, correct=0, wrong=0, skips=0, log=[], f=null, iv=null, scene=null, lastT=0, running=false, steps=0, hit=false;
    const sig={signal:screenAC.signal};
    const stopScene=()=>{ if(scene){ scene.stop(); scene=null; } };
    screenAC.signal.addEventListener('abort',()=>{ running=false; stopScene(); });
    const rate=()=>R.DRAIN+R.STEP*Math.floor(elapsed/R.EVERY);
    const score=()=>G.score({elapsed,dist,correct});
    const cap=x=>R.CAP?Math.min(R.CAP,x):x;
    const delta=d=>G.fmtDelta(d);
    function hud(){
      return `<div class="sv-hud"><div class="sv-meter" id="mt"><div class="sv-mt"><span class="sv-mn">${G.meterName}</span> <b id="mv">${G.fmtV(R.START)}</b></div><div class="sv-bar ${key}"><i id="mb" style="width:100%"></i></div><div class="sv-rate" id="mr">${G.fmtRate(R.DRAIN)}</div></div>
        <div class="lig-alt"><div class="lig-best">Best <b id="best">${G.fmtScore(gameBest(key))}</b></div><div class="lig-now">${G.scoreName} <b id="sc">${G.fmtScore(0)}</b></div></div></div>`;
    }
    function intro(){
      stopScene(); running=false;
      const best=gameBest(key);
      app.innerHTML=bzHead(G.title)+`<div class="lig-wrap intro sv-${key}"><div class="lig-scene"><canvas class="lig-cv" aria-hidden="true"></canvas>${hud()}</div>
        <div class="sp-intro"><p>${G.intro}</p><ul class="lig-rules">${G.rules()}</ul>
        ${best?`<p class="sp-best">Your best: <b>${G.fmtScore(best)}</b></p>`:''}
        <button class="btn primary big-audio" id="go">${G.go}</button></div></div>${hsBox(key)}`;
      bzWire(); hsShow();
      scene=SCENES[key](app.querySelector('.lig-cv'));
      $('#go').onclick=()=>{ speak('Get ready!'); countdown(); };   // speaking inside the tap lets the iPad talk later
    }
    function countdown(){
      let n=3;
      const box=app.querySelector('.sp-intro'); box.innerHTML=`<div class="sp-count" id="cd" aria-live="assertive">${n}</div>`;
      const hs=app.querySelector('.hs-box'); if(hs) hs.remove();
      const t=setInterval(()=>{
        n--; const cd=$('#cd'); if(!cd){ clearInterval(t); return; }
        if(n>0){ cd.textContent=n; bzSnd('tick'); }
        else if(n===0){ cd.textContent='Go!'; cd.classList.add('go'); if(scene) scene.start(); bzSnd('whoosh'); }
        else { clearInterval(t); play(); }
      },800);
      timers.push(t); bzSnd('tick');
    }
    function play(){
      order=shuffle(pool); oi=0; v=R.START; elapsed=0; dist=0; correct=0; wrong=0; skips=0; log=[]; steps=0; hit=false; running=true;
      const sc=app.querySelector('.lig-scene');                 // keep the same canvas so the picture carries on
      app.innerHTML=`<div class="lig-bar"><span class="crumb">⚡ Bonus Zone</span><b class="lig-title"><span aria-hidden="true">${G.icon}</span> ${G.title}</b><button class="btn small" id="quit">Stop</button></div>
        <div class="lig-wrap play sv-${key}"><div id="scHost"></div>
        <div class="lig-side"><p class="sp-fb" id="fb" role="status"></p>
        <div class="qcard sp-card">${G.card}
          <div class="answer"><div id="ansf"></div></div>
          <div class="tools"><button class="btn" id="skip">Skip ⏭ <small>(−${delta(R.SKIP)})</small></button><button class="btn primary" id="sub">Check ✓</button></div>
        </div></div></div>`;
      $('#scHost').replaceWith(sc);
      $('#quit').onclick=finish;
      f=answerField($('#ansf'),{label:'Type the word',placeholder:'Type the word',onEnter:submit});
      if(G.wire) G.wire(()=>cur);
      $('#sub').onclick=submit; $('#skip').onclick=skip;
      lastT=performance.now();
      iv=setInterval(tick,100); timers.push(iv);
      next(); tick();
    }
    function float(text,cls){
      const sc=app.querySelector('.lig-scene'); if(!sc) return;
      const el=document.createElement('div'); el.className='lig-float '+cls; el.textContent=text; sc.appendChild(el);
      setTimeout(()=>el.remove(),1200);
    }
    function show(){
      const r=rate(), frac=clamp01(v/R.START), s=score();
      if(scene) scene.set(v,{rate:r,frac,score:s});
      const mv=$('#mv'); if(!mv) return;
      mv.textContent=G.fmtV(v); $('#mr').textContent=G.fmtRate(r);
      const mb=$('#mb'); mb.style.width=(frac*100).toFixed(1)+'%'; mb.parentNode.classList.toggle('over',v>R.START&&!R.CAP);
      $('#mt').classList.toggle('low',running&&frac<=0.2);
      $('#sc').textContent=G.fmtScore(s);
      const best=gameBest(key); $('#best').textContent=G.fmtScore(Math.max(best,s));
      app.querySelector('.lig-best').classList.toggle('beaten',s>best&&best>0);
    }
    function tick(){
      if(!running) return;
      const now=performance.now(), dt=Math.min(0.5,(now-lastT)/1000); lastT=now;
      const r=rate(); elapsed+=dt; v-=r*dt; if(v>0) dist+=v*dt;
      const st=Math.floor(elapsed/R.EVERY); if(st>steps){ steps=st; float(G.faster,'down small'); bzSnd('tick'); }
      if(G.milestone&&!hit&&score()>=G.milestone.at){ hit=true; float(G.milestone.msg,'up'); }
      if(v<=0){ v=0; show(); return finish(); }
      show();
    }
    function next(){
      if(oi>=order.length){ order=shuffle(pool); oi=0; }
      cur=order[oi++]; f.set('');
      G.show(cur);
    }
    function submit(){
      if(!running||!cur||!f) return;
      const val=f.value.trim(); if(!val) return;
      const fb=$('#fb');
      if(G.minLen&&val.replace(/\s/g,'').length<Math.min(G.minLen,cur.w.length)){ fb.className='sp-fb bad'; fb.textContent='Have a genuine go at spelling the word before you check.'; return; }
      const ok=same(val,cur.w); log.push({p:cur,given:val,ok});
      if(ok){ correct++; v=cap(v+R.GAIN); bzSnd('ok'); fb.className='sp-fb good'; fb.innerHTML=`✓ Correct! <b>+${delta(R.GAIN)}</b>`; float('+'+delta(R.GAIN),'up'); if(scene) scene.good(); }
      else { wrong++; v-=R.WRONG; bzSnd('bad'); fb.className='sp-fb bad'; fb.innerHTML=`✗ It's spelt ${chunkAt(cur.x,cur.st)}${R.WRONG?` <b>(−${delta(R.WRONG)})</b>`:''}`; if(R.WRONG) float('−'+delta(R.WRONG),'down'); if(scene) scene.bad(); }
      tick(); if(running) next();
    }
    function skip(){
      if(!running||!cur) return;
      skips++; v-=R.SKIP; log.push({p:cur,given:'',ok:false}); bzSnd('skip');
      const fb=$('#fb'); fb.className='sp-fb'; fb.innerHTML=`Skipped (−${delta(R.SKIP)}): ${chunkAt(cur.x,cur.st)}`; float('−'+delta(R.SKIP),'down');
      if(scene) scene.bad();
      tick(); if(running) next();
    }
    function finish(){
      if(!running) return;
      running=false; clearInterval(iv); KB.hide(); stopSpeech(); cur=null;
      show(); if(scene) scene.end();
      const s=Math.floor(score()), best=gameBest(key), isBest=s>best&&s>=1;
      if(isBest) setGameBest(key,s);
      const sc=app.querySelector('.lig-scene');
      app.innerHTML=bzHead(G.title)+`<div class="lig-wrap done sv-${key}"><div id="scHost"></div><div class="sp-done"><div class="sp-big" aria-hidden="true">${isBest?'🏆':G.endIc}</div>
        <h3>${G.endTitle(s)}</h3><div class="sp-final">${G.endLine(s)}</div>
        <p class="sp-best">${correct} word${correct===1?'':'s'} correct${wrong?`, ${wrong} wrong`:''}${skips?`, ${skips} skipped`:''}.<br>${isBest?(best?`New personal best! Your old best was ${G.fmtScore(best)}.`:'Your first game!'):best?`Your best: <b>${G.fmtScore(best)}</b>`:'Have another go!'}</p></div></div>
        ${hsBox(key)}
        ${log.length?`<div class="tbl-wrap"><table class="fbt"><thead><tr><th scope="col"><span class="sr">Result</span></th><th scope="col">Your answer</th><th scope="col">Correct answer</th></tr></thead><tbody>
        ${log.map(r=>`<tr class="${r.ok?'ok':'bad'}"><td class="mk">${r.ok?'✓':'✗'}</td><td class="given">${r.given?esc(r.given):'<span class="muted">(skipped)</span>'}</td><td>${chunkAt(r.p.x,r.p.st)}</td></tr>`).join('')}</tbody></table></div>`:''}
        <div class="tools"><button class="btn primary" id="again">Play again</button></div>`;
      if(sc) $('#scHost').replaceWith(sc); else $('#scHost').remove();
      const mt=$('#mt'); if(mt) mt.classList.remove('low');
      bzWire(); $('#again').onclick=intro;
      hsSubmit(key,s).then(()=>hsShow());
      if(isBest&&s>0) funBurst();
    }
    window.addEventListener('pagehide',()=>{ running=false; },sig);
    intro();
  };
}
SCREENS.bSpeed=survivalScreen('lig');
SCREENS.bSnow=survivalScreen('snow');
SCREENS.bTroll=survivalScreen('troll');

/* ---------- activity registry ---------- */
const ACTS={
  wordlist:actWordList, passage:actPassage, editing:actEditing, dictation:actDictation,
  testEasy, testHard,
  defEasy:()=>quiz('defEasy','def',false), defHard:()=>quiz('defHard','def',true),
  clozeEasy:()=>quiz('clozeEasy','cloze',false), clozeHard:()=>quiz('clozeHard','cloze',true)
};

/* ---------- boot ---------- */
// results left on this iPad from last time are sent a few seconds after the app opens (each iPad at a different moment)
if(pendingCount()) scheduleFlush(3000+Math.random()*12000);
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
