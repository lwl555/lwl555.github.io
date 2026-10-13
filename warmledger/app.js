'use strict';
/* 暖记 WarmLedger —— 离线优先网页应用
   数据存 localStorage（离线可用），联网自动同步 Supabase，AI 走 Edge Function。 */

/* ================= 常量 ================= */
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjbnNzeWlxaXR1Z3FmbWNiZGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0MDEyNzUsImV4cCI6MjA5ODk3NzI3NX0.9EfbEr7BQhZtbOwHJ3IrkOy16kcaxlmzuJuV0A2Z8Eg';
/* 云端只有一个入口：supabase 直连（走 WebView 自带 fetch，Chromium 指纹与浏览器一致）。
   之前的 EdgeOne 反代废弃：其 *.edgeone.cool 预览域名天生带访问密码，且凭证约一天过期，
   国内访问定时 401，不可作为长期通道。连不上就安心离线记账，联网后自动同步。 */
const EPS = [
  'https://wcnssyiqitugqfmcbdhe.supabase.co'
];
function epUrl(ep, path){ return ep + path; }
const EMAIL = '18882632073@warmledger.app';
const PWD = '110110nm';
const K = { tx: 'wl.tx', set: 'wl.set', ses: 'wl.ses', ep: 'wl.ep', del: 'wl.del', note: 'wl.note', sched: 'wl.sched' };

const CATS = {
  expense: [
    ['food','餐饮'],['takeout','外卖'],['transport','交通'],['fuel','加油'],
    ['shopping','购物'],['home','居家'],['rent','房租'],['utility','水电燃气'],
    ['digital','数码'],['comm','通讯'],['fun','娱乐'],['travel','旅行'],
    ['beauty','美容'],['medical','医疗'],['pet','宠物'],['edu','教育'],
    ['sport','运动'],['coffee','咖啡'],['market','菜场超市'],['social','人情'],
    ['insurance','保险'],['subscription','订阅会员'],['tax_fee','税费'],['other_exp','其他']
  ],
  income: [
    ['salary','工资'],['bonus','奖金'],['invest','理财收益'],['parttime','兼职'],
    ['redpacket_in','红包'],['dividend','分红'],['refund','退款'],['rental_in','租金收入'],['allowance','零花钱'],['other_inc','其他收入']
  ]
};
const CATN = {};
CATS.expense.forEach(c => CATN[c[0]] = c[1]);
CATS.income.forEach(c => CATN[c[0]] = c[1]);

const QUOTES = [
  '今天省下的每一笔，都是未来的底气。',
  '记账不是抠门，是让钱花得明白。',
  '小钱看得见，大钱才留得住。',
  '坚持记账的人，运气都不会太差。',
  '钱要花在让自己变好的地方。',
  '一个月后回头看，你会感谢现在的自己。',
  '收入是能力，结余是本事。',
  '不必完美，持续就好。'
];

const BGS = [
  ['', '默认白'], ['#FFF7F0', '暖杏'], ['#F2FBF6', '浅薄荷'],
  ['#FFF3F5', '浅樱'], ['#F4F7FF', '浅雾'], ['#FBFBF4', '米白']
];

/* ================= 自定义后台（可选） =================
   默认用内置固定账号（林 / 18882632073）自动登录免费 Supabase。
   高级用户可在「账号中心」填入自己的 Supabase 项目地址与账号，切换到自己的后台。
   留空则用默认。 */
const DEF_SB = 'https://wcnssyiqitugqfmcbdhe.supabase.co';
function customSB(){ const s = S.set(); return (s.sbUrl && s.sbUrl.trim()) || ''; }
function customCred(){ const s = S.set(); return { email: (s.accEmail && s.accEmail.trim()) || EMAIL, pwd: s.accPwd || PWD }; }
/* 当前生效的后台地址：用户自定义优先，否则默认免费 Supabase */
function baseUrl(){ return customSB() || DEF_SB; }

/* ================= 图片存储（IndexedDB，原图完整保留） =================
   账单表无图片列，所以原图存在浏览器本地 IndexedDB，账单只存图片 id；
   压缩图在同步时尝试写入后台（若表无 img 列则静默失败，不影响）。 */
const IMGDB = 'warmledger_img';
function imgDB(){
  return new Promise(function(res, rej){
    const r = indexedDB.open(IMGDB, 1);
    r.onupgradeneeded = function(){ r.result.createObjectStore('imgs', { keyPath: 'id' }) };
    r.onsuccess = function(){ res(r.result) };
    r.onerror = function(){ rej(r.error) };
  });
}
async function imgPut(id, blob){
  const db = await imgDB();
  return new Promise(function(res, rej){
    const tx = db.transaction('imgs', 'readwrite');
    tx.objectStore('imgs').put({ id: id, blob: blob, ts: Date.now() });
    tx.oncomplete = function(){ res() }; tx.onerror = function(){ rej(tx.error) };
  });
}
async function imgGet(id){
  if(!id) return null;
  const db = await imgDB();
  return new Promise(function(res){
    const tx = db.transaction('imgs', 'readonly');
    const q = tx.objectStore('imgs').get(id);
    q.onsuccess = function(){ res(q.result ? (q.result.blob || q.result) : null) };
    q.onerror = function(){ res(null) };
  });
}
async function imgOrig(id){ const v = await imgGet(id); return v && typeof v === 'object' ? (v.orig || v.blob) : v; }
async function imgComp(id){ const v = await imgGet(id); return v && typeof v === 'object' ? (v.comp || v.blob) : v; }
async function imgToDataUrl(blob){
  if(!blob) return null;
  return new Promise(function(res){ const r = new FileReader(); r.onload = function(){ res(r.result) }; r.readAsDataURL(blob) });
}
/* 把图片文件转 dataURL，并按最大边压缩（控制后台体积最小）。返回 {origUrl(原图存IndexedDB), compUrl(压缩图 base64)} */
async function compressImage(file, maxSide, quality){
  const origUrl = await new Promise(function(res){ const r = new FileReader(); r.onload = function(){ res(r.result) }; r.readAsDataURL(file) });
  const img = await new Promise(function(res, rej){ const im = new Image(); im.onload = function(){ res(im) }; im.onerror = rej; im.src = origUrl });
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(img, 0, 0, w, h);
  const compUrl = cv.toDataURL('image/jpeg', quality || 0.6);
  return { origUrl: origUrl, compUrl: compUrl };
}

/* ================= 本地 TTS（Web Speech API，系统中文语音，离线可用） ================= */
const TTS = { synth: window.speechSynthesis, voice: null, enabled: false };
function ttsInit(){
  try{
    if(!('speechSynthesis' in window)){ TTS.synth = null; return }
    const pick = function(){
      const vs = TTS.synth.getVoices() || [];
      // 优选中文（普通话）女声，名字含 zh / 普通话 / Chinese / Xiaoxiao / Tingting 等
      const zh = vs.filter(function(v){ return /zh|cmn|Chinese|普通话|国语|xiaoxiao|tingting|mei|yaoyao|huihui/i.test(v.lang + ' ' + v.name) });
      TTS.voice = zh[0] || null;
    };
    pick();
    TTS.synth.onvoiceschanged = pick;
  }catch(e){ TTS.synth = null }
}
function ttsSpeak(text){
  if(!TTS.synth || !TTS.enabled) return;
  try{
    TTS.synth.cancel();
    const u = new SpeechSynthesisUtterance(String(text || '').replace(/[#,*_\-]+/g, ' ').slice(0, 400));
    u.lang = 'zh-CN'; u.rate = 1.0; u.pitch = 1.0;
    if(TTS.voice) u.voice = TTS.voice;
    TTS.synth.speak(u);
  }catch(e){}
}

/* ================= 小账对话（复用 ai-accounting 的 analyze 模式，前端维护多轮历史） ================= */
const CHAT = { list: [], open: false, busy: false, pendingImg: null };
function chatPush(role, text){ CHAT.list.push({ role: role, text: text }) }

const CALCS = [
  ['budget','预算','看本月还能花多少','M4 6h16M4 12h16M4 18h10'],
  ['loan','房贷/车贷','等额本息月供','M4 18V8l8-5 8 5v10M9 18v-6h6v6'],
  ['split','AA 分账','人均多少','M12 3v18M7 7h10M7 12h10M7 17h10'],
  ['save','储蓄目标','多久能攒够','M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z'],
  ['fx','汇率换算','外币转人民币','M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4'],
  ['tax','个税计算','月薪到手多少','M9 7h6M9 12h6M9 17h6M5 5h14v14H5z'],
  ['tip','小费/服务费','按比例算小费','M12 5v14M8 9h8M8 13h8'],
  ['invest','复利收益','本金滚多少年','M4 19V5M4 19h16M8 15l4-5 3 3 4-7'],
  ['discount','折扣价','原价打几折到手多少','M5 9h14M5 9l-1 6h16l-1-6M9 9V6a3 3 0 016 0v3'],
  ['rise','涨跌幅度','涨了还是跌了多少','M4 17l5-5 3 3 7-8M16 7h4v4'],
  ['installment','分期还款','分几期每期多少','M4 7h16v10H4zM4 11h16M9 7v10']
];

/* ================= 存储 ================= */
const S = {
  tx(){ try{ return JSON.parse(localStorage.getItem(K.tx) || '[]') }catch(e){ return [] } },
  saveTx(v){ localStorage.setItem(K.tx, JSON.stringify(v)) },
  set(){ try{ return JSON.parse(localStorage.getItem(K.set) || '{}') }catch(e){ return {} } },
  saveSet(v){ localStorage.setItem(K.set, JSON.stringify(v)) },
  ses(){ try{ return JSON.parse(localStorage.getItem(K.ses) || 'null') }catch(e){ return null } },
  saveSes(v){ localStorage.setItem(K.ses, JSON.stringify(v)) },
  ep(){ return localStorage.getItem(K.ep) || EPS[0] },
  saveEp(v){ localStorage.setItem(K.ep, v) },
  del(){ try{ return JSON.parse(localStorage.getItem(K.del) || '[]') }catch(e){ return [] } },
  saveDel(v){ localStorage.setItem(K.del, JSON.stringify(v)) },
  note(){ try{ return JSON.parse(localStorage.getItem(K.note) || '{}') }catch(e){ return {} } },
  saveNote(v){ localStorage.setItem(K.note, JSON.stringify(v)) },
  sched(){ try{ return JSON.parse(localStorage.getItem(K.sched) || '[]') }catch(e){ return [] } },
  saveSched(v){ localStorage.setItem(K.sched, JSON.stringify(v)) }
};

/* ================= 工具 ================= */
const pad = n => String(n).padStart(2, '0');
function ymd(ms){ const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) }
function ymKey(ms){ const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth()+1) }
function money(n){
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function uid(){
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
    const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
function todayNoon(){ const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).getTime() }
function parseDate(s){
  if(!s) return todayNoon();
  const p = String(s).split('-');
  return new Date(+p[0], (+p[1]) - 1, +p[2] || 1, 12, 0, 0).getTime();
}
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
/* 轻量 Markdown 渲染（先转义再替换，防注入）：
   支持 #/##/### 标题、**加粗**、- 列表、1. 列表、换行 */
function mdLite(src){
  const lines = esc(src).split(/\r?\n/);
  let html = '', inList = false;
  const inline = s => s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  for(const raw of lines){
    const line = raw.trim();
    const ul = line.match(/^[-*]\s+(.*)/);
    const ol = line.match(/^\d+[.、]\s+(.*)/);
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if(ul || ol){
      if(!inList){ html += '<ul style="margin:6px 0 6px 18px">'; inList = true }
      html += '<li>' + inline((ul || ol)[1]) + '</li>';
      continue;
    }
    if(inList){ html += '</ul>'; inList = false }
    if(h) html += '<div style="font-weight:700;margin:10px 0 4px">' + inline(h[2]) + '</div>';
    else if(line === '') html += '<div style="height:6px"></div>';
    else html += '<div style="margin:2px 0">' + inline(line) + '</div>';
  }
  if(inList) html += '</ul>';
  return html;
}
function toast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}
function num(id){ const el = document.getElementById(id); if(!el) return 0; const v = parseFloat(el.value); return isNaN(v) ? 0 : v }

/* ================= 网络 ================= */
let TOKEN = '', UID = '', online = false, LAST_ERR = null;

/* ---------- 原生网络桥（App 内）与浏览器 fetch 双通道 ---------- */
let NATIVE_SEQ = 0;
const NATIVE_WAIT = {};

window.__nativeApiResp = function(id, jsonStr){
  const r = NATIVE_WAIT[id];
  if(!r) return;
  NATIVE_WAIT[id] = null;
  try{ r(JSON.parse(jsonStr)) }catch(e){ r(null) }
};

function nativeApi(method, url, headers, body, timeoutMs){
  return new Promise(function(resolve){
    if(!(window.Android && window.Android.apiFetch)) return resolve(null);
    const id = String(++NATIVE_SEQ);
    NATIVE_WAIT[id] = resolve;
    try{
      window.Android.apiFetch(id, method, url, JSON.stringify(headers || {}), body || null);
    }catch(e){ NATIVE_WAIT[id] = null; return resolve(null) }
    setTimeout(function(){
      if(NATIVE_WAIT[id]){ NATIVE_WAIT[id] = null; resolve(null) }
    }, timeoutMs || 100000);
  });
}

async function browserApi(method, url, headers, body, timeoutMs){
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs || 25000);
  try{
    const r = await fetch(url, { method: method, headers: headers, body: body || undefined, signal: ctrl.signal });
    const t = await r.text();
    return { code: r.status, body: t };
  }catch(e){
    return { code: 0, body: '网络错误: ' + String((e && e.message) || e).slice(0, 80) };
  }finally{ clearTimeout(tm) }
}

/* 所有请求走 WebView 自带 fetch（Chromium 指纹能过运营商 DPI，无需任何反代凭证）。 */

async function req(path, opt){
  opt = opt || {};
  let last;
  for(const ep of [baseUrl()]){
    const url = epUrl(ep, path);
    const headers = { 'apikey': ANON, 'Content-Type': 'application/json' };
    if(opt.auth !== false && TOKEN) headers['Authorization'] = 'Bearer ' + TOKEN;
    if(opt.headers) Object.assign(headers, opt.headers);
    const body = opt.body ? JSON.stringify(opt.body) : null;
    const timeout = opt.timeout || 30000;
    const out = await browserApi(opt.method || 'GET', url, headers, body, timeout);
    if(out && out.code >= 200 && out.code < 300 && out.body && !/^\s*</.test(out.body)){
      try{ return JSON.parse(out.body) }catch(e){ return out.body }
    }
    last = new Error(friendlyNetErr(out));
  }
  throw last || new Error('网络不可用');
}

/* 把网络层错误翻译成人话，避免把 HTML 报错页/英文堆给用户 */
function friendlyNetErr(out){
  if(!out) return '网络不可用';
  if(out.code === 0) return '当前网络连不上云端（移动数据下部分运营商会拦截，WiFi 下一般正常）';
  return '云端返回 ' + out.code;
}

async function login(){
  const s = S.ses();
  if(s && s.access_token && s.expires_at > Date.now() + 60000){
    TOKEN = s.access_token; UID = s.user_id; return true;
  }
  const cred = customCred();
  const r = await req('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: cred.email, password: cred.pwd }, auth: false
  });
  if(!r || !r.access_token) throw new Error('登录失败');
  TOKEN = r.access_token; UID = r.user.id;
  S.saveSes({ access_token: r.access_token, user_id: r.user.id, expires_at: Date.now() + ((r.expires_in || 3600) * 1000) });
  return true;
}

async function pull(){
  const rows = await req('/rest/v1/transactions?user_id=eq.' + UID + '&order=date.desc');
  if(!Array.isArray(rows)) return 0;
  const local = S.tx(); const byRid = {};
  local.forEach(t => { if(t.remote_id) byRid[t.remote_id] = t });
  let added = 0;
  rows.forEach(r => {
    if(byRid[r.remote_id]){ byRid[r.remote_id].synced = true; return }
    local.push({
      id: r.remote_id || uid(), remote_id: r.remote_id, type: r.type,
      amount: Number(r.amount), category: r.category, note: r.note || '',
      date: Number(r.date), createdAt: Number(r.created_at || r.date), synced: true
    });
    added++;
  });
  S.saveTx(local);
  return added;
}

async function push(){
  const tx = S.tx();
  const pend = tx.filter(t => !t.synced);
  if(pend.length){
    const payload = pend.map(t => ({
      remote_id: t.remote_id, user_id: UID, type: t.type, amount: t.amount,
      category: t.category, note: t.note || '', account: '',
      date: t.date, created_at: t.createdAt, synced: true
    }));
    await req('/rest/v1/transactions', { method: 'POST', body: payload, headers: { 'Prefer': 'return=minimal' } });
    pend.forEach(t => t.synced = true);
  }
  const del = S.del();
  if(del.length){
    for(const rid of del.slice()){
      try{
        await req('/rest/v1/transactions?remote_id=eq.' + rid, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
        del.splice(del.indexOf(rid), 1);
      }catch(e){ /* 离线时保留，下次再删 */ }
    }
    S.saveDel(del);
  }
  S.saveTx(tx);
  return pend.length;
}

function setNet(state){
  const bar = document.getElementById('netBar');
  if(!bar) return;
  if(state === 'syncing'){ bar.innerHTML = '正在同步…'; return }
  if(state === 'on'){ bar.innerHTML = '<span class="status-dot on"></span>已连接云端 · 自动备份'; return }
  bar.innerHTML = '<span class="status-dot off"></span>离线记账中 · 数据存本地，联网自动同步';
}

async function syncAll(silent){
  try{
    setNet('syncing');
    await login();
    const a = await pull();
    const p = await push();
    online = true; setNet('on');
    LAST_ERR = null;
    const _st = S.set(); _st.lastSync = Date.now(); S.saveSet(_st);
    if(!silent) toast('同步完成 · 新增 ' + a + ' 条 · 上传 ' + p + ' 条');
    render();
    return true;
  }catch(e){
    online = false; setNet('off');
    LAST_ERR = { msg: String((e && e.message) || e).slice(0, 120), time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) };
    if(!silent) toast('暂时连不上云端 · 数据已存本地');
    render();
    return false;
  }
}

/* ================= 数据操作 ================= */
function addTx(t){
  const tx = S.tx();
  t.id = uid(); t.remote_id = t.remote_id || uid();
  t.createdAt = Date.now(); t.synced = false;
  tx.push(t); S.saveTx(tx);
  setTimeout(() => syncAll(true), 60);
}
function updateTx(id, patch){
  const tx = S.tx(); const t = tx.find(x => x.id === id);
  if(t){ Object.assign(t, patch); t.synced = false; S.saveTx(tx); setTimeout(() => syncAll(true), 60) }
}
function delTx(id){
  let tx = S.tx(); const t = tx.find(x => x.id === id);
  if(!t) return;
  if(t.remote_id){ const d = S.del(); if(d.indexOf(t.remote_id) < 0){ d.push(t.remote_id); S.saveDel(d) } }
  tx = tx.filter(x => x.id !== id); S.saveTx(tx);
  setTimeout(() => syncAll(true), 60);
}

function monthStats(ms){
  const key = ymKey(ms); let inc = 0, exp = 0;
  S.tx().forEach(t => { if(ymKey(t.date) === key){ if(t.type === 'income') inc += t.amount; else exp += t.amount } });
  return { inc: inc, exp: exp, bal: inc - exp, key: key };
}
function sortedTx(){ return S.tx().slice().sort((a, b) => b.date - a.date || b.createdAt - a.createdAt) }

/* ================= 渲染 ================= */
let page = 'home';
let calCursor = todayNoon();

function render(){
  const v = document.getElementById('view');
  const titles = { home: '首页', records: '账单', calc: '计算器', ai: 'AI 助手', settings: '设置', calendar: '日历' };
  document.getElementById('pageTitle').textContent = titles[page] || '暖记';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.page === page || (page === 'calendar' && b.dataset.page === 'home')));
  applyBg();
  if(page === 'home') v.innerHTML = viewHome();
  else if(page === 'records') v.innerHTML = viewRecords();
  else if(page === 'calc') v.innerHTML = viewCalc();
  else if(page === 'ai') v.innerHTML = viewAI();
  else if(page === 'settings') v.innerHTML = viewSettings();
  else if(page === 'calendar') v.innerHTML = viewCalendar();
  window.scrollTo(0, 0);
  setTimeout(fillImgs, 0);
}

function applyBg(){
  const s = S.set();
  if(s.bgImg && s.bgImg.indexOf('data:') === 0){
    document.body.style.backgroundImage = 'url(' + s.bgImg + ')';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundRepeat = 'no-repeat';
    return;
  }
  const c = (s.bg) || '';
  document.body.style.background = c || '#FFFFFF';
}

const QICONS = {
  add: 'M12 5v14M5 12h14',
  shot: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16a3.5 3.5 0 100-7 3.5 3.5 0 000 7z',
  ai: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  cal: 'M5 5h14v14H5zM5 9h14M9 3v4M15 3v4'
};

function viewHome(){
  const st = monthStats(Date.now());
  const q = QUOTES[new Date().getDate() % QUOTES.length];
  const recent = sortedTx().slice(0, 5);
  const showQuote = S.set().quote !== false;
  return '' +
    '<div class="summary">' +
      '<div class="small muted">本月结余（' + st.key + '）</div>' +
      '<div class="sum-main">' + (st.bal < 0 ? '-' : '') + money(Math.abs(st.bal)) + '</div>' +
      '<div class="sum-grid">' +
        '<div class="sum-item"><div class="k">收入</div><div class="v income">' + money(st.inc) + '</div></div>' +
        '<div class="sum-item"><div class="k">支出</div><div class="v expense">' + money(st.exp) + '</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="quick">' +
      '<button class="qbtn" data-act="add"><span class="qicon q-add"><svg viewBox="0 0 24 24"><path d="' + QICONS.add + '"/></svg></span><span>记一笔</span></button>' +
      '<button class="qbtn" data-act="capture"><span class="qicon q-shot"><svg viewBox="0 0 24 24"><path d="' + QICONS.shot + '"/></svg></span><span>拍照记账</span></button>' +
      '<button class="qbtn" data-act="analyst"><span class="qicon q-ai"><svg viewBox="0 0 24 24"><path d="' + QICONS.ai + '"/></svg></span><span>AI 分析</span></button>' +
      '<button class="qbtn" data-act="calendar"><span class="qicon q-cal"><svg viewBox="0 0 24 24"><path d="' + QICONS.cal + '"/></svg></span><span>日历</span></button>' +
    '</div>' +
    (showQuote ? '<div class="quote">' + esc(q) + '</div>' : '') +
    '<div class="card">' +
      '<div class="row between" style="margin-bottom:8px">' +
        '<h3 class="card-title" style="margin:0">最近账单</h3>' +
        '<button class="small muted" data-act="go" data-id="records">全部</button>' +
      '</div>' +
      (recent.length ? recent.map(txRow).join('') : '<div class="empty">还没有记录，点上方「记一笔」开始</div>') +
    '</div>';
}

function txRow(t){
  return '<div class="tx" data-act="edit" data-id="' + t.id + '">' +
    '<div class="tx-dot">' + esc((CATN[t.category] || '?').slice(0, 1)) + '</div>' +
    (t.imgId ? '<img class="tx-img" data-img="' + t.imgId + '">' : '') +
    '<div class="tx-main">' +
      '<div class="tx-cat">' + esc(CATN[t.category] || t.category) + '</div>' +
      '<div class="tx-note">' + esc(t.note || ymd(t.date)) + '</div>' +
    '</div>' +
    '<div class="tx-amt ' + t.type + '">' + (t.type === 'income' ? '+' : '-') + money(t.amount) + '</div>' +
  '</div>';
}
function fillImgs(){
  document.querySelectorAll('[data-img]').forEach(function(el){
    const id = el.dataset.img; if(!id || el.src) return;
    imgComp(id).then(function(u){ if(u) el.src = u; });
  });
}

function viewRecords(){
  const list = sortedTx();
  if(!list.length) return '<div class="card"><div class="empty">还没有账单<br><br><button class="btn" data-act="add">记第一笔</button></div></div>';
  const groups = {}; const order = [];
  list.forEach(t => { const k = ymd(t.date); if(!groups[k]){ groups[k] = []; order.push(k) } groups[k].push(t) });
  let html = '<button class="btn" data-act="add" style="margin-bottom:12px">记一笔</button>';
  order.forEach(k => {
    let inc = 0, exp = 0;
    groups[k].forEach(t => { if(t.type === 'income') inc += t.amount; else exp += t.amount });
    html += '<div class="day-group"><div class="day-head"><span>' + k + '</span>' +
      '<span>收 ' + money(inc) + ' · 支 ' + money(exp) + '</span></div>' +
      groups[k].map(txRow).join('') + '</div>';
  });
  return html;
}

function viewCalc(){
  return '<div class="calc-grid">' + CALCS.map(c =>
    '<button class="calc-card" data-act="calc" data-id="' + c[0] + '">' +
      '<div class="cc-ic"><svg viewBox="0 0 24 24"><path d="' + c[3] + '"/></svg></div>' +
      '<div class="cc-t">' + c[1] + '</div><div class="cc-d">' + c[2] + '</div>' +
    '</button>').join('') + '</div>';
}

function viewAI(){
  return '' +
    '<div class="card" style="background:linear-gradient(135deg,#FFF3F5,#F2FBF6);border:1px solid #F0E6E8">' +
      '<div class="row between" style="align-items:center">' +
        '<div><h3 class="card-title" style="margin:0">小账 · AI 聊天助手</h3>' +
        '<div class="small muted" style="margin-top:2px">像朋友一样问记账、预算、省钱</div></div>' +
        '<button class="tb-action" data-act="openChat">进入聊天</button>' +
      '</div>' +
    '</div>' +
    '<div class="ai-hero">' +
      '<div class="row between"><h3 class="card-title" style="margin:0">AI 拍照记账</h3>' +
      '<button class="tb-action" data-act="capture">选择图片</button></div>' +
      '<p class="small muted" style="margin:8px 0 0">拍小票、截图或账单，AI 自动识别金额与分类，识别后可手动修改再保存。可一次选多张。</p>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">AI 财务分析师</h3>' +
      '<div class="field"><label>基于你的账单提问（留空则自动分析本月）</label>' +
      '<textarea class="input" id="aiQ" placeholder="例如：这个月外卖花太多了，怎么控制？"></textarea></div>' +
      '<button class="btn" data-act="analyze">生成分析报告</button>' +
      '<div id="aiOut"></div>' +
    '</div>';
}

function viewSettings(){
  const s = S.set();
  const tx = S.tx();
  const unsynced = tx.filter(t => !t.synced).length;
  const cred = customCred();
  return '' +
    '<div class="card">' +
      '<h3 class="card-title">云端备份</h3>' +
      '<div class="setting-row"><div><div>账号：' + esc(cred.email) + '</div>' +
        '<div class="small muted">昵称：林 · 固定账号自动登录</div></div>' +
        '<span class="small muted">' + (online ? '已连接云端' : '离线') + '</span></div>' +
      '<div class="setting-row"><div>本地共 ' + tx.length + ' 条' + (unsynced ? '（' + unsynced + ' 条待上传）' : '') + '</div>' +
        '<button class="tb-action" data-act="sync">立即同步</button></div>' +
      '<div class="setting-row"><div>账号与后台</div><button class="tb-action" data-act="openAccount">账号中心</button></div>' +
      (LAST_ERR ? '<div class="setting-row"><div class="small" style="color:var(--expense)">上次失败 ' + LAST_ERR.time + '<br>' + esc(LAST_ERR.msg) + '</div></div>' : '') +
      '<div class="setting-row"><div>连不上时先测网络</div><button class="tb-action" data-act="diag">网络诊断</button></div>' +
      '<div class="setting-row"><div>联网自动备份</div><div class="switch ' + (s.auto !== false ? 'on' : '') + '" data-act="toggle" data-id="auto"><i></i></div></div>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">同步管理</h3>' +
      '<div class="setting-row"><div>查看同步状态 / 已同步分类</div><button class="tb-action" data-act="syncManage">查看</button></div>' +
      '<div class="setting-row"><div>清除云端（保留本地）</div><button class="tb-action" data-act="clearCloud" style="color:var(--expense)">清除</button></div>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">界面与背景</h3>' +
      '<div class="setting-row"><div>自定义背景图</div><button class="tb-action" data-act="openBg">更换</button></div>' +
      '<div class="setting-row"><div>首页励志语</div><div class="switch ' + (s.quote !== false ? 'on' : '') + '" data-act="toggle" data-id="quote"><i></i></div></div>' +
      '<div class="setting-row"><div>AI 语音朗读（本地语音）</div><div class="switch ' + (s.tts !== false ? 'on' : '') + '" data-act="toggle" data-id="tts"><i></i></div></div>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">数据</h3>' +
      '<button class="btn ghost" data-act="export" style="margin-bottom:10px">导出账单（CSV）</button>' +
      '<button class="btn danger" data-act="clear">清空本地数据</button>' +
      '<p class="small muted" style="margin:10px 0 0">数据优先存在手机本地，断网也能记账；联网后自动备份到云端，换手机不丢。</p>' +
    '</div>';
}

/* ---------- 日历 ---------- */
/* ================= 节假日（2026 国务院安排，含调休补班） ================= */
const HOLIDAYS = {
  '2026-01-01':'元旦','2026-01-02':'元旦','2026-01-03':'元旦',
  '2026-02-15':'春节','2026-02-16':'春节','2026-02-17':'春节','2026-02-18':'春节','2026-02-19':'春节','2026-02-20':'春节','2026-02-21':'春节','2026-02-22':'春节','2026-02-23':'春节',
  '2026-04-04':'清明','2026-04-05':'清明','2026-04-06':'清明',
  '2026-05-01':'劳动','2026-05-02':'劳动','2026-05-03':'劳动','2026-05-04':'劳动','2026-05-05':'劳动',
  '2026-06-19':'端午','2026-06-20':'端午','2026-06-21':'端午',
  '2026-09-25':'中秋','2026-09-26':'中秋','2026-09-27':'中秋',
  '2026-10-01':'国庆','2026-10-02':'国庆','2026-10-03':'国庆','2026-10-04':'国庆','2026-10-05':'国庆','2026-10-06':'国庆','2026-10-07':'国庆',
  '2026-01-04':'调休班','2026-02-14':'调休班','2026-02-28':'调休班','2026-05-09':'调休班','2026-09-20':'调休班','2026-10-10':'调休班'
};
function holidayName(k){ return HOLIDAYS[k] || '' }
function daySchedules(k){
  return S.sched().filter(function(s){ return s.date === k }).sort(function(a,b){ return (a.time||'').localeCompare(b.time||'') });
}
function dayHasSched(k){ return S.sched().some(function(s){ return s.date === k }) }

function viewCalendar(){
  const d = new Date(calCursor);
  const y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1);
  const startW = first.getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const byDay = {};
  S.tx().forEach(t => { const k = ymd(t.date); byDay[k] = (byDay[k] || 0) + (t.type === 'expense' ? t.amount : 0) });
  let html = '<div class="card"><div class="cal-head">' +
    '<button class="tb-action" data-act="calPrev">上月</button>' +
    '<div style="font-weight:600">' + y + ' 年 ' + (m + 1) + ' 月</div>' +
    '<button class="tb-action" data-act="calNext">下月</button></div><div class="cal-grid">';
  ['日','一','二','三','四','五','六'].forEach(w => html += '<div class="cal-w">' + w + '</div>');
  for(let i = 0; i < startW; i++) html += '<div></div>';
  const todayKey = ymd(Date.now());
  for(let day = 1; day <= days; day++){
    const ms = new Date(y, m, day, 12, 0, 0).getTime();
    const k = ymd(ms);
    const amt = byDay[k] || 0;
    const hl = holidayName(k);
    const isWork = hl === '调休班';
    const mark = dayHasSched(k);
    html += '<button class="cal-d ' + (amt ? 'has' : '') + (k === todayKey ? ' today' : '') + (hl && !isWork ? ' hol' : '') + (isWork ? ' work' : '') + (mark ? ' mark' : '') + (window._calDay === k ? ' sel' : '') + '" data-act="calDay" data-id="' + k + '">' +
      '<span class="cd-d">' + day + '</span>' +
      (hl ? '<span class="cd-hol">' + hl + '</span>' : '') +
      (amt ? '<span class="cd-amt">' + Math.round(amt) + '</span>' : '') +
      (mark ? '<span class="cd-dot"></span>' : '') +
      '</button>';
  }
  html += '</div><div class="cal-legend"><span class="lg hol">红=节假日</span><span class="lg work">灰=补班</span><span class="lg mark">●=有日程</span></div></div>';
  const sel = window._calDay;
  if(sel){
    const list = S.tx().filter(t => ymd(t.date) === sel).sort((a, b) => b.createdAt - a.createdAt);
    const notes = S.note();
    const noteVal = notes[sel] || '';
    const sch = daySchedules(sel);
    const hn = holidayName(sel);
    html += '<div class="card"><h3 class="card-title">' + sel + (hn ? ' · ' + hn : '') + '</h3>';
    html += '<div class="field"><label>日汇记 / 便签</label><textarea class="input" id="dayNote" data-id="' + sel + '" placeholder="记点今天的碎碎念、待办、感想…">' + esc(noteVal) + '</textarea></div>';
    html += '<div class="row between" style="margin:6px 0 10px"><span class="card-title" style="margin:0">日程 / 提醒（' + sch.length + '）</span><button class="tb-action" data-act="openSched" data-id="' + sel + '">+ 添加</button></div>';
    if(sch.length){
      html += '<div class="sched-list">' + sch.map(function(s){
        return '<div class="sched-item ' + (s.notify ? 'nt' : '') + '" data-act="openSched" data-id="' + sel + '|' + s.id + '">' +
          '<div class="sched-l"><div class="sched-t">' + esc(s.title) + (s.notify ? ' 🔔' : '') + '</div>' +
          (s.note ? '<div class="sched-n">' + esc(s.note) + '</div>' : '') + '</div>' +
          '<div class="sched-time">' + (s.time || '') + '</div></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="empty" style="padding:14px 0">这天还没有日程，点“添加”约一下～</div>';
    }
    html += '</div>';
    if(list.length){
      html += '<div class="card"><h3 class="card-title">' + sel + ' 账单（' + list.length + ' 笔）</h3>' + list.map(txRow).join('') + '</div>';
    }
  }
  return html;
}

/* ================= Sheet ================= */
function openSheet(title, html){
  document.getElementById('sheetTitle').textContent = title;
  document.getElementById('sheetBody').innerHTML = html;
  document.getElementById('sheet').classList.remove('hidden');
}
function closeSheet(){ document.getElementById('sheet').classList.add('hidden') }

function formTx(t){
  t = t || { type: 'expense', category: 'food', amount: '', note: '', date: ymd(Date.now()) };
  const cats = CATS[t.type];
  return '' +
    '<div class="field"><div class="seg" id="typeSeg">' +
      '<button data-act="seg" data-id="expense" class="' + (t.type === 'expense' ? 'on' : '') + '">支出</button>' +
      '<button data-act="seg" data-id="income" class="' + (t.type === 'income' ? 'on' : '') + '">收入</button>' +
    '</div></div>' +
    '<div class="field"><label>金额</label><input class="input" id="fAmount" type="number" step="0.01" inputmode="decimal" value="' + (t.amount || '') + '" placeholder="0.00"></div>' +
    '<div class="field"><label>分类</label><div class="chips" id="fCats">' +
      cats.map(c => '<button class="chip-cat ' + (t.category === c[0] ? 'on' : '') + '" data-act="cat" data-id="' + c[0] + '">' + c[1] + '</button>').join('') +
    '</div></div>' +
    '<div class="field"><label>备注</label><input class="input" id="fNote" value="' + esc(t.note) + '" placeholder="选填，如 楼下超市"></div>' +
    '<div class="field"><label>日期</label><input class="input" id="fDate" type="date" value="' + t.date + '"></div>' +
    '<div class="btn-row">' +
      '<button class="btn ghost" data-act="close">取消</button>' +
      '<button class="btn" data-act="saveTx" data-id="' + (t.id || '') + '">保存</button>' +
    '</div>' +
    (t.id ? '<button class="btn danger" style="margin-top:10px" data-act="delTx" data-id="' + t.id + '">删除这笔</button>' : '');
}

let formState = { type: 'expense', category: 'food' };

/* ================= 计算器 ================= */
const CALC_FN = {
  budget(){
    const b = num('c_budget'), used = monthStats(Date.now()).exp;
    const left = b - used;
    const d = new Date(); const total = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const restDays = Math.max(1, total - d.getDate() + 1);
    return '<div class="result"><div class="r-line"><span>本月已花</span><b>' + money(used) + '</b></div>' +
      '<div class="r-line"><span>剩余预算</span><b>' + money(left) + '</b></div>' +
      '<div class="r-line"><span>日均可用（剩 ' + restDays + ' 天）</span><b>' + money(left / restDays) + '</b></div></div>';
  },
  loan(){
    const p = num('c_loanP'), yr = num('c_loanR'), yrs = num('c_loanY');
    const r = yr / 100 / 12, n = yrs * 12;
    if(!p || !n) return '';
    const mp = r ? p * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : p / n;
    return '<div class="result"><div class="big-result"><div class="bv">' + money(mp) + '</div><div class="bk">每月还款</div></div>' +
      '<div class="r-line"><span>还款总额</span><b>' + money(mp * n) + '</b></div>' +
      '<div class="r-line"><span>支付利息</span><b>' + money(mp * n - p) + '</b></div></div>';
  },
  split(){
    const t = num('c_splitT'), n = num('c_splitN') || 1;
    return '<div class="result"><div class="big-result"><div class="bv">' + money(t / n) + '</div><div class="bk">每人应付</div></div>' +
      '<div class="r-line"><span>合计</span><b>' + money(t) + '</b></div>' +
      '<div class="r-line"><span>人数</span><b>' + n + ' 人</b></div></div>';
  },
  save(){
    const goal = num('c_saveG'), has = num('c_saveH'), per = num('c_saveP');
    const need = goal - has;
    if(per <= 0) return '<div class="result">请填写每月存钱金额</div>';
    const months = Math.ceil(need / per);
    const d = new Date(); d.setMonth(d.getMonth() + months);
    return '<div class="result"><div class="big-result"><div class="bv">' + months + ' 个月</div><div class="bk">还需存</div></div>' +
      '<div class="r-line"><span>还差</span><b>' + money(need) + '</b></div>' +
      '<div class="r-line"><span>预计达成</span><b>' + ymd(d.getTime()) + '</b></div></div>';
  },
  fx(){
    const a = num('c_fxA'), r = num('c_fxR');
    return '<div class="result"><div class="big-result"><div class="bv">' + money(a * r) + '</div><div class="bk">换算结果</div></div></div>';
  },
  tax(){
    const salary = num('c_taxS'), ins = num('c_taxI');
    const x = salary - ins - 5000;
    if(x <= 0) return '<div class="result"><div class="big-result"><div class="bv">0.00</div><div class="bk">无需缴税</div></div>' +
      '<div class="r-line"><span>到手</span><b>' + money(salary - ins) + '</b></div></div>';
    let rate = 0.03, ded = 0;
    if(x > 80000){ rate = 0.45; ded = 15160 }
    else if(x > 55000){ rate = 0.35; ded = 7160 }
    else if(x > 35000){ rate = 0.30; ded = 4410 }
    else if(x > 25000){ rate = 0.25; ded = 2660 }
    else if(x > 12000){ rate = 0.20; ded = 1410 }
    else if(x > 3000){ rate = 0.10; ded = 210 }
    const tax = Math.max(0, x * rate - ded);
    return '<div class="result"><div class="big-result"><div class="bv">' + money(tax) + '</div><div class="bk">个人所得税</div></div>' +
      '<div class="r-line"><span>应纳税所得额</span><b>' + money(x) + '</b></div>' +
      '<div class="r-line"><span>到手工资</span><b>' + money(salary - ins - tax) + '</b></div></div>';
  },
  tip(){
    const a = num('c_tipA'), p = num('c_tipP');
    const tip = a * p / 100;
    return '<div class="result"><div class="r-line"><span>小费</span><b>' + money(tip) + '</b></div>' +
      '<div class="r-line"><span>合计</span><b>' + money(a + tip) + '</b></div></div>';
  },
  invest(){
    const p = num('c_invP'), r = num('c_invR'), y = num('c_invY');
    const fv = p * Math.pow(1 + r / 100, y);
    return '<div class="result"><div class="big-result"><div class="bv">' + money(fv) + '</div><div class="bk">' + y + ' 年后本息</div></div>' +
      '<div class="r-line"><span>本金</span><b>' + money(p) + '</b></div>' +
      '<div class="r-line"><span>收益</span><b>' + money(fv - p) + '</b></div></div>';
  },
  discount(){
    const o = num('c_discO'), d = num('c_discD');
    if(!o) return '';
    const rate = d > 0 && d <= 10 ? d / 10 : d / 100;
    const price = o * rate;
    const save = o - price;
    return '<div class="result"><div class="big-result"><div class="bv">' + money(price) + '</div><div class="bk">到手价</div></div>' +
      '<div class="r-line"><span>原价</span><b>' + money(o) + '</b></div>' +
      '<div class="r-line"><span>立省</span><b>' + money(save) + '</b></div></div>';
  },
  rise(){
    const o = num('c_riseO'), n = num('c_riseN');
    if(!o) return '';
    const pct = (n - o) / o * 100;
    const up = pct >= 0;
    return '<div class="result"><div class="big-result"><div class="bv" style="color:' + (up ? 'var(--expense)' : 'var(--income)') + '">' + (up ? '+' : '') + pct.toFixed(1) + '%</div><div class="bk">' + (up ? '上涨' : '下跌') + '</div></div>' +
      '<div class="r-line"><span>差额</span><b>' + money(n - o) + '</b></div>' +
      '<div class="r-line"><span>现在</span><b>' + money(n) + '</b></div></div>';
  },
  installment(){
    const t = num('c_instT'), n = num('c_instN') || 1, r = num('c_instR') / 100;
    const fee = t * r;
    const per = (t + fee * n) / n;
    return '<div class="result"><div class="big-result"><div class="bv">' + money(per) + '</div><div class="bk">每期应还</div></div>' +
      '<div class="r-line"><span>分期总额</span><b>' + money(per * n) + '</b></div>' +
      '<div class="r-line"><span>手续费合计</span><b>' + money(fee * n) + '</b></div></div>';
  }
};

const CALC_FORM = {
  budget: '<div class="field"><label>本月预算（元）</label><input class="input" id="c_budget" type="number" value="3000"></div>',
  loan: '<div class="field"><label>贷款金额（元）</label><input class="input" id="c_loanP" type="number" value="1000000"></div>' +
        '<div class="field"><label>年利率（%）</label><input class="input" id="c_loanR" type="number" step="0.01" value="4.2"></div>' +
        '<div class="field"><label>贷款年限</label><input class="input" id="c_loanY" type="number" value="30"></div>',
  split: '<div class="field"><label>总金额（元）</label><input class="input" id="c_splitT" type="number" value="300"></div>' +
         '<div class="field"><label>人数</label><input class="input" id="c_splitN" type="number" value="4"></div>',
  save: '<div class="field"><label>目标金额（元）</label><input class="input" id="c_saveG" type="number" value="20000"></div>' +
        '<div class="field"><label>已存（元）</label><input class="input" id="c_saveH" type="number" value="3000"></div>' +
        '<div class="field"><label>每月能存（元）</label><input class="input" id="c_saveP" type="number" value="2000"></div>',
  fx: '<div class="field"><label>金额</label><input class="input" id="c_fxA" type="number" step="0.01" value="100"></div>' +
      '<div class="field"><label>汇率（1 外币 = ? 元）</label><input class="input" id="c_fxR" type="number" step="0.0001" value="7.25"></div>',
  tax: '<div class="field"><label>月薪（元）</label><input class="input" id="c_taxS" type="number" value="12000"></div>' +
       '<div class="field"><label>五险一金（元）</label><input class="input" id="c_taxI" type="number" value="1500"></div>',
  tip: '<div class="field"><label>消费金额（元）</label><input class="input" id="c_tipA" type="number" value="200"></div>' +
       '<div class="field"><label>小费比例（%）</label><input class="input" id="c_tipP" type="number" value="10"></div>',
  invest: '<div class="field"><label>本金（元）</label><input class="input" id="c_invP" type="number" value="50000"></div>' +
          '<div class="field"><label>年利率（%）</label><input class="input" id="c_invR" type="number" step="0.1" value="5"></div>' +
          '<div class="field"><label>年数</label><input class="input" id="c_invY" type="number" value="10"></div>',
  discount: '<div class="field"><label>原价（元）</label><input class="input" id="c_discO" type="number" step="0.01" value="199"></div>' +
            '<div class="field"><label>折扣（折，如 8.5 即 85 折）</label><input class="input" id="c_discD" type="number" step="0.1" value="8.5"></div>',
  rise: '<div class="field"><label>原来价格（元）</label><input class="input" id="c_riseO" type="number" step="0.01" value="100"></div>' +
        '<div class="field"><label>现在价格（元）</label><input class="input" id="c_riseN" type="number" step="0.01" value="130"></div>',
  installment: '<div class="field"><label>总金额（元）</label><input class="input" id="c_instT" type="number" step="0.01" value="6000"></div>' +
               '<div class="field"><label>分期数（期）</label><input class="input" id="c_instN" type="number" value="12"></div>' +
               '<div class="field"><label>每期手续费率（%，如 0.6）</label><input class="input" id="c_instR" type="number" step="0.1" value="0.6"></div>'
};

function openCalc(key){
  const c = CALCS.find(x => x[0] === key);
  /* 注意：先插入表单 DOM，再计算初始结果。
     之前写成 CALC_FORM[key] + CALC_FN[key]() 一步拼好，
     导致 CALC_FN 在输入框还不存在时就读值报错，弹层打不开。 */
  openSheet(c[1], CALC_FORM[key] + '<div id="calcOut"></div>');
  document.getElementById('calcOut').innerHTML = CALC_FN[key]();
  const body = document.getElementById('sheetBody');
  body.dataset.calc = key;
}

/* ================= AI ================= */
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms) }) }

/* 旧 APK（无 pickImages 桥）：逐张添加，支持不限量，无需重装 App */
function pickOneAndroid(){
  return new Promise(function(resolve, reject){
    window.__imgResolve = resolve; window.__imgReject = reject;
    try{ window.Android.pickImage() }catch(e){ if(window.__imgReject){ window.__imgReject = null } reject(e) }
    setTimeout(function(){ if(window.__imgResolve){ window.__imgResolve = null; resolve(null) } }, 120000);
  }).catch(function(){ return null });
}
function pickLoopAndroid(){
  return new Promise(function(resolve){
    const acc = [];
    function render(){
      openSheet('已选 ' + acc.length + ' 张图片',
        (acc.length ? '<div class="ai-thumbs">' + acc.map(function(_, i){ return '<div class="ai-thumb"><img src="' + acc[i].compUrl + '"></div>' }).join('') + '</div>' : '<p class="small muted">还没有选图，点下面按钮从相册/相机添加。</p>') +
        '<button class="btn" data-act="imgAddMore">+ 继续添加图片</button>' +
        '<button class="btn ghost" data-act="imgStartRec"' + (acc.length ? '' : ' disabled') + '>开始识别（' + acc.length + ' 张）</button>');
    }
    window.__loopAdd = function(){ pickOneAndroid().then(function(d){ if(d) acc.push({ origUrl: d, compUrl: d }); render(); }) };
    window.__loopDone = function(){ const r = acc.slice(); window.__loopAdd = null; window.__loopDone = null; resolve(r); };
    render();
  });
}

async function doCapture(){
  let files = [];
  try{
    if(window.Android && typeof window.Android.pickImages === 'function'){
      // 新 APK：系统原生多选（一次选很多张）
      window.__imgMulti = [];
      files = await new Promise(function(res){ window.__imgDone = res; window.Android.pickImages(); });
      window.__imgMulti = null;
    } else if(window.Android && window.Android.pickImage){
      // 旧 APK：逐张添加，不限量（不用重装 App）
      files = await pickLoopAndroid();
    } else {
      // 网站/浏览器：多文件选择，不限量
      const picked = await new Promise(function(resolve){
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*'; inp.multiple = true;
        inp.onchange = function(e){ resolve(Array.from(e.target.files || [])) };
        inp.click();
      });
      for(const f of picked){
        const c = await compressImage(f, 1600, 0.7);
        files.push(c);
      }
    }
  }catch(e){}
  await processImages(files);
}

/* 识别队列：有限并发（超出自动排队），单张失败/限流自动退避重试 */
async function recognizeOne(j, attempt){
  attempt = attempt || 0;
  try{
    const r = await req('/functions/v1/ai-accounting', { method: 'POST', timeout: 90000, body: { mode: 'recognize', image: j.compUrl } });
    return r;
  }catch(e){
    if(attempt < 3){ await sleep(700 * Math.pow(2, attempt)); return recognizeOne(j, attempt + 1) }
    return null;
  }
}
async function runRecognizeQueue(files){
  const CONC = 3;                          // 同时处理的图片数，超出排队
  const out = new Array(files.length).fill(null);
  let idx = 0, done = 0;
  const stat = function(){
    const el = document.getElementById('recStat');
    if(el) el.textContent = '正在识别 ' + done + ' / ' + files.length + ' 张（并发 ' + Math.min(CONC, files.length) + '）…';
  };
  stat();
  async function worker(){
    while(idx < files.length){
      const my = idx++;
      try{ const r = await recognizeOne(files[my]); out[my] = (r && r.items) || []; }
      catch(e){ out[my] = [] }
      done++; stat();
    }
  }
  const ws = [];
  const n = Math.min(CONC, files.length);
  for(let i = 0; i < n; i++) ws.push(worker());
  await Promise.all(ws);
  return out;
}

async function processImages(files){
  if(!files || !files.length){ toast('未选择图片'); return }
  openSheet('AI 识别中', '<div style="padding:16px 0;text-align:center"><span class="spinner"></span><br><span id="recStat">准备识别 ' + files.length + ' 张…</span></div>');
  try{
    await login();
    const results = await runRecognizeQueue(files);
    const items = []; window._aiThumb = {};
    results.forEach(function(arr, fi){
      const j = files[fi];
      (arr || []).forEach(function(it){
        const imgId = uid();
        imgPut(imgId, { orig: j.origUrl, comp: j.compUrl }); // 原图完整存 IndexedDB，本地永久保留
        it.imgId = imgId;
        window._aiThumb[imgId] = j.compUrl;
        items.push(it);
      });
    });
    if(!items.length) throw new Error('没识别出条目，可手动记一笔');
    window._aiItems = items;
    openSheet('识别结果（可修改）',
      '<p class="small muted" style="margin-bottom:8px">已识别 ' + items.length + ' 笔，可逐条修改后保存。点击图片可查看原图。</p>' +
      items.map(function(it, i){ return aiItemRow(it, i) }).join('') +
      '<button class="btn" data-act="saveAll">全部保存（' + items.length + ' 笔）</button>');
  }catch(e){
    openSheet('识别失败', '<p class="small muted">' + esc(e.message || String(e)) + '</p>' +
      '<button class="btn" data-act="add" style="margin-top:10px">手动记一笔</button>');
  }
}

function aiItemRow(it, i){
  const type = it.type === 'income' ? 'income' : 'expense';
  const cats = CATS[type];
  const catOk = cats.some(c => c[0] === it.category);
  const cat = catOk ? it.category : (type === 'income' ? 'other_inc' : 'other_exp');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(it.date || '') ? it.date : ymd(Date.now());
  const thumb = (window._aiThumb && window._aiThumb[it.imgId]) ?
    '<div class="ai-thumb" data-act="viewImg" data-id="' + it.imgId + '"><img src="' + window._aiThumb[it.imgId] + '"></div>' : '';
  return '<div class="card tight" data-ai="' + i + '">' +
    thumb +
    '<div class="row between" style="margin-bottom:8px">' +
      '<div class="seg" style="width:140px">' +
        '<button data-act="aiType" data-id="' + i + '|expense" class="' + (type === 'expense' ? 'on' : '') + '">支出</button>' +
        '<button data-act="aiType" data-id="' + i + '|income" class="' + (type === 'income' ? 'on' : '') + '">收入</button>' +
      '</div>' +
      '<button class="small muted" data-act="aiDrop" data-id="' + i + '">移除</button>' +
    '</div>' +
    '<div class="field"><label>金额</label><input class="input" data-ai-amt="' + i + '" type="number" step="0.01" value="' + (Number(it.amount) || 0) + '"></div>' +
    '<div class="field"><label>分类</label><div class="chips" data-ai-cats="' + i + '">' +
      cats.map(c => '<button class="chip-cat ' + (cat === c[0] ? 'on' : '') + '" data-act="aiCat" data-id="' + i + '|' + c[0] + '">' + c[1] + '</button>').join('') +
    '</div></div>' +
    '<div class="field"><label>备注</label><input class="input" data-ai-note="' + i + '" value="' + esc(it.note || '') + '"></div>' +
    '<div class="field"><label>日期</label><input class="input" data-ai-date="' + i + '" type="date" value="' + date + '"></div>' +
  '</div>';
}

function collectAiItems(){
  const out = [];
  (window._aiItems || []).forEach((it, i) => {
    const card = document.querySelector('[data-ai="' + i + '"]');
    if(!card) return;
    const amtEl = document.querySelector('[data-ai-amt="' + i + '"]');
    const noteEl = document.querySelector('[data-ai-note="' + i + '"]');
    const dateEl = document.querySelector('[data-ai-date="' + i + '"]');
    const onCat = card.querySelector('.chip-cat.on');
    const onType = card.querySelector('.seg button.on');
    out.push({
      type: onType && onType.dataset.id.indexOf('income') > -1 ? 'income' : 'expense',
      category: onCat ? onCat.dataset.id.split('|')[1] : 'other_exp',
      amount: parseFloat(amtEl && amtEl.value) || 0,
      note: noteEl ? noteEl.value : '',
      date: parseDate(dateEl ? dateEl.value : ''),
      imgId: it.imgId || null
    });
  });
  return out.filter(x => x.amount > 0);
}

async function doAnalyze(){
  const out = document.getElementById('aiOut');
  const q = (document.getElementById('aiQ') || {}).value || '';
  const st = monthStats(Date.now());
  const byCat = {};
  S.tx().forEach(t => { if(ymKey(t.date) === st.key){ byCat[CATN[t.category] || t.category] = (byCat[CATN[t.category] || t.category] || 0) + t.amount } });
  const detail = Object.keys(byCat).map(k => k + ' ' + money(byCat[k])).join('，') || '暂无明细';
  const text = q ? q + '\n\n【我的本月数据】收入 ' + money(st.inc) + '，支出 ' + money(st.exp) + '，结余 ' + money(st.bal) + '。明细：' + detail
                 : '请分析我本月的收支情况并给出可执行建议。收入 ' + money(st.inc) + '，支出 ' + money(st.exp) + '，结余 ' + money(st.bal) + '。明细：' + detail;
  out.innerHTML = '<div><span class="spinner"></span>AI 正在分析…</div>';
  try{
    await login();
    const r = await req('/functions/v1/ai-accounting', { method: 'POST', timeout: 90000, body: { mode: 'analyze', text: text } });
    out.innerHTML = '<div class="ai-out">' + mdLite((r && r.text) || '（无返回）') + '</div>';
  }catch(e){
    out.innerHTML = '<div class="ai-out">分析失败：' + esc(e.message || String(e)) + '<br>（离线时无法使用 AI，联网后重试）</div>';
  }
}

/* ================= 网络诊断 ================= */
async function diagOne(name, ep, path, opt){
  opt = opt || {};
  const t0 = Date.now();
  const url = epUrl(ep, path);
  const headers = { 'apikey': ANON, 'Content-Type': 'application/json' };
  if(opt.auth !== false) headers['Authorization'] = 'Bearer ' + (TOKEN || ANON);
  const body = opt.body ? JSON.stringify(opt.body) : null;
  const out = await browserApi(opt.method || 'GET', url, headers, body, 20000);
  const ok = !!(out && out.code >= 200 && out.code < 300 && !/^\s*</.test(out.body || ''));
  return {
    name: name, ok: ok,
    code: out ? String(out.code) : '无通道',
    ms: Date.now() - t0,
    body: out ? friendlyNetErr(out) : '无通道'
  };
}

async function runDiag(){
  openSheet('网络诊断中', '<div style="padding:20px 0;text-align:center"><span class="spinner"></span> 正在测试，约 10 秒…</div>');
  const rows = [];
  rows.push(await diagOne('云端数据接口', baseUrl(), '/rest/v1/transactions?select=count', {}));
  rows.push(await diagOne('云端账号登录', baseUrl(), '/auth/v1/token?grant_type=password', { method: 'POST', body: { email: customCred().email, password: customCred().pwd }, auth: false }));
  const html = rows.map(r =>
    '<div class="card tight" style="margin-bottom:8px">' +
      '<div class="row between"><b style="font-size:14px">' + esc(r.name) + '</b>' +
      '<span class="small" style="color:' + (r.ok ? 'var(--income)' : 'var(--expense)') + ';font-weight:600">' + (r.ok ? '通过 ' : '未通 ') + esc(r.code) + ' · ' + r.ms + 'ms</span></div>' +
      '<div class="small muted" style="margin-top:4px">' + esc(r.body || '') + '</div>' +
    '</div>').join('');
  const tip = rows[0].ok
    ? '云端已连通，记账会自动备份。'
    : '当前网络连不上云端，不影响记账 —— 数据都存本机，换 WiFi 或联网后会自动同步。';
  openSheet('诊断结果', html + '<p class="small muted" style="margin-top:6px">' + tip + '</p>');
}

/* ================= 小账工具调用（自动化） ================= */
/* 从助手回复里抽取 {@tool,@args} 工具块（支持 ```json 包裹或裸 JSON） */
function extractTool(text){
  if(!text) return null;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  let raw = m ? m[1] : null;
  if(!raw){ const m2 = text.match(/\{[^{}]*"tool"\s*:[^{}]*\}/); raw = m2 ? m2[0] : null; }
  if(!raw) return null;
  try{ const o = JSON.parse(raw); if(o && o.tool) return o; }catch(e){}
  return null;
}
function runCalcReply(a){
  a = a || {}; const k = a.kind;
  if(k === 'discount'){
    const o = Number(a.orig)||0, d = Number(a.discount)||0;
    if(!o || !d) return '请告诉我原价和折扣（比如 8.5 折）';
    const rate = (d > 0 && d <= 10) ? d/10 : d/100;
    const price = o*rate, save = o-price;
    return '💡 ' + money(o) + ' 元打 ' + d + ' 折 = ' + money(price) + ' 元，立省 ' + money(save) + ' 元';
  }
  if(k === 'rise'){
    const o = Number(a.old)||0, n = Number(a.now)||0;
    if(!o) return '请告诉我原价和现价';
    const pct = (n-o)/o*100, up = pct >= 0;
    return '📈 ' + (up ? '上涨' : '下跌') + ' ' + Math.abs(pct).toFixed(1) + '%：' + money(o) + ' → ' + money(n) + ' 元（差 ' + money(n-o) + '）';
  }
  if(k === 'installment'){
    const t = Number(a.total)||0, p = Number(a.periods)||1, r = Number(a.rate)||0;
    if(!t) return '请告诉我总额、期数和每期手续费率';
    const fee = t*r/100, per = (t + fee*p)/p;
    return '💳 分期 ' + p + ' 期：每期 ' + money(per) + ' 元，总额 ' + money(per*p) + ' 元，手续费合计 ' + money(fee*p) + ' 元';
  }
  return '🧮 这种计算我还没学会，去「计算器」里点一下吧～';
}
function queryReply(a){
  a = a || {}; const k = a.kind;
  const tx = S.tx();
  if(k === 'month_exp' || k === 'month_inc' || k === 'balance'){
    const st = monthStats(Date.now());
    if(k === 'month_exp') return '📊 本月（' + st.key + '）支出共 ' + money(st.exp) + ' 元';
    if(k === 'month_inc') return '📊 本月（' + st.key + '）收入共 ' + money(st.inc) + ' 元';
    return '📊 本月（' + st.key + '）结余 ' + money(st.bal) + ' 元（收 ' + money(st.inc) + ' / 支 ' + money(st.exp) + '）';
  }
  if(k === 'today_exp'){
    let e = 0; tx.forEach(t => { if(ymd(t.date) === ymd(Date.now()) && t.type === 'expense') e += t.amount });
    return '📊 今天支出 ' + money(e) + ' 元';
  }
  if(k === 'top_cat'){
    const key = ymKey(Date.now()); const byCat = {};
    tx.forEach(t => { if(t.type === 'expense' && ymKey(t.date) === key){ const n = CATN[t.category]||t.category; byCat[n] = (byCat[n]||0)+t.amount } });
    const entries = Object.entries(byCat).sort((x,y) => y[1]-x[1]);
    if(!entries.length) return '📊 本月还没有支出记录';
    return '📊 本月支出最多的分类是「' + entries[0][0] + '」' + money(entries[0][1]) + ' 元' + (entries[1] ? '，其次是「' + entries[1][0] + '」' + money(entries[1][1]) + ' 元' : '');
  }
  return '📊 这项我暂时查不了，去「账单」页看看吧～';
}
function execTool(tool, args){
  args = args || {};
  if(tool === 'add_tx'){
    const type = args.type === 'income' ? 'income' : 'expense';
    const amount = Number(args.amount) || 0;
    if(!amount || amount <= 0) return '⚠️ 金额无效，没记下';
    let cat = args.category; const cats = CATS[type];
    if(!cats.some(c => c[0] === cat)) cat = type === 'income' ? 'other_inc' : 'other_exp';
    const data = { type, amount, category: cat, note: (args.note || ''), date: parseDate(args.date) };
    addTx(data);
    return '✅ 已记一笔：' + (type === 'income' ? '收入' : '支出') + ' · ' + CATN[cat] + ' ' + money(amount) + ' 元' + (data.note ? '（' + data.note + '）' : '');
  }
  if(tool === 'calc') return runCalcReply(args);
  if(tool === 'query') return queryReply(args);
  if(tool === 'gen_bg'){ bgGenAgnes(args.prompt || '', args.style || '', false); return '🎨 正在用 Agnes 生成背景，稍等…'; }
  return '🤖 收到指令：' + tool + '（暂不支持）';
}
/* Agnes AI 生图：调后端 image 模式返回 dataURL；后端未部署时回退本地生成 */
async function bgGenAgnes(prompt, style, doClose){
  toast('Agnes 正在生图…');
  try{
    await login();
    const r = await req('/functions/v1/ai-accounting', { method:'POST', timeout:120000, body:{ mode:'image', prompt:(prompt || '温暖清新的记账 App 背景') + (style ? ('，风格：' + style) : ''), size:'1024x1024' } });
    if(r && r.image){ applyBgImg(r.image); toast('已用 Agnes 生成背景'); if(doClose) closeSheet(); return }
    throw new Error('未返回图片');
  }catch(e){
    const st = style || BG_STYLES[Math.floor(Math.random()*BG_STYLES.length)];
    applyBgImg(genBgCanvas(st));
    toast('（本地生成，部署 Agnes 后端后可真·AI 生图）');
    if(doClose) closeSheet();
  }
}

/* ================= 小账聊天（全屏） ================= */
function openChat(){
  CHAT.open = true;
  const ov = document.getElementById('chatOverlay');
  if(ov) ov.classList.remove('hidden');
  renderChat();
  setTimeout(function(){ const i = document.getElementById('chatInput'); if(i) i.focus(); }, 200);
}
function closeChat(){
  CHAT.open = false;
  const ov = document.getElementById('chatOverlay');
  if(ov) ov.classList.add('hidden');
  if(TTS.synth) TTS.synth.cancel();
}
function renderChat(){
  const box = document.getElementById('chatBox');
  if(!box) return;
  if(!CHAT.list.length){
    box.innerHTML = '<div class="chat-welcome">我是小账，你的记账搭子 💬<br>可以问我：这个月花了多少？怎么省钱？帮我算笔账～</div>';
    return;
  }
  box.innerHTML = CHAT.list.map(function(m){
    const img = m.img ? '<div class="chat-img-wrap"><img class="chat-img-thumb" src="' + m.img + '" alt="图片"></div>' : '';
    return '<div class="chat-msg ' + m.role + '"><div class="bubble">' + img + mdLite(m.text) + '</div></div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}
async function sendChat(){
  if(CHAT.busy) return;
  const inp = document.getElementById('chatInput');
  const text = (inp && inp.value || '').trim();
  const img = CHAT.pendingImg || null;
  if(!text && !img) return;
  inp.value = '';
  CHAT.pendingImg = null;
  CHAT.list.push({ role:'user', text: text || '（发了一张图片）', img: img });
  renderChat();
  CHAT.busy = true;
  const box = document.getElementById('chatBox');
  const typing = document.createElement('div');
  typing.className = 'chat-msg assistant';
  typing.innerHTML = '<div class="bubble"><span class="spinner"></span> 小账正在想…</div>';
  box.appendChild(typing);
  box.scrollTop = box.scrollHeight;
  try{
    await login();
    // 带图时先识别图中内容（兼容旧后端也能“读图”）
    let imgText = '';
    if(img){
      try{
        const rr = await req('/functions/v1/ai-accounting', { method:'POST', timeout:60000, body:{ mode:'recognize', image: img } });
        if(rr && rr.items && rr.items.length){
          imgText = rr.items.map(function(it){ return (it.amount ? ('¥' + it.amount + ' ') : '') + (it.category || '') + (it.note ? (' ' + it.note) : '') }).join('\n');
        }
      }catch(e){ /* 忽略识别失败 */ }
    }
    const hist = CHAT.list.slice(0, -1).map(function(m){ return { role:m.role, text:m.text } });
    const lastText = CHAT.list[CHAT.list.length - 1].text;
    const augText = (imgText ? '【图片中识别到的内容】\n' + imgText + '\n\n' : '') + lastText;
    let r, reply;
    try{
      r = await req('/functions/v1/ai-accounting', { method:'POST', timeout:60000, body:{ mode:'agent', text: augText, history: hist, image: img } });
      if(r && r.text) reply = r.text;
    }catch(e){ /* agent 未部署，下面走 analyze 兜底 */ }
    if(!reply){
      const prompt = '你是记账 App「暖记」的 AI 助手“小账”，也是百事通贴心小助理：可以聊记账省钱，也可以聊生活、健康、情感、出行、百科等任何话题，像朋友一样自然。' +
        '若用户要你执行操作（记账/计算/查账/生成背景），只输出一个 ```json 工具块 ```（{"tool":"add_tx|calc|query|gen_bg","args":{...}}），不要其它文字；其它情况用自然语言简洁友好回答（200 字内）。' +
        '分类id：餐饮food/外卖takeout/交通transport/加油fuel/购物shopping/居家home/房租rent/水电燃气utility/数码digital/通讯comm/娱乐fun/旅行travel/美容beauty/医疗medical/宠物pet/教育edu/运动sport/咖啡coffee/菜场超市market/人情social/保险insurance/订阅会员subscription/税费tax_fee/其他other_exp / 工资salary/奖金bonus/理财收益invest/兼职parttime/红包redpacket_in/分红dividend/退款refund/租金收入rental_in/零花钱allowance/其他收入other_inc。' +
        'calc 参数：discount{orig:原价,discount:折扣如8.5表85折} rise{old:原价,now:现价} installment{total:总额,periods:期数,rate:每期手续费率%}。query 参数：month_exp|month_inc|balance|today_exp|top_cat。金额自动转阿拉伯数字，直接执行不要反问。' +
        '对话历史：\n' + hist.map(function(m){ return (m.role === 'user' ? '用户' : '小账') + '：' + m.text }).join('\n') + '\n用户：' + augText;
      r = await req('/functions/v1/ai-accounting', { method:'POST', timeout:60000, body:{ mode:'analyze', text: prompt, image: img } });
      reply = (r && r.text) || '（没收到回复）';
    }
    const tool = extractTool(reply);
    if(typing.parentNode) typing.parentNode.removeChild(typing);
    if(tool){
      const resText = execTool(tool.tool, tool.args);
      chatPush('assistant', resText);
      renderChat();
      ttsSpeak(resText);
    } else {
      chatPush('assistant', reply);
      renderChat();
      if(TTS.enabled) ttsSpeak(reply);
    }
  }catch(e){
    if(typing.parentNode) typing.parentNode.removeChild(typing);
    chatPush('assistant', '网络开小差了，联网后我再来～');
    renderChat();
  }
  CHAT.busy = false;
}

/* ================= 聊天发图 ================= */
function chatPickImg(){
  if(window.Android && (window.Android.pickImage || window.Android.pickImages)){
    window.__imgResolve = function(dataUrl){
      window.__imgResolve = null;
      if(dataUrl){ CHAT.pendingImg = dataUrl; renderChat(); toast('已选图片，点发送发给小账') }
    };
    try{ window.Android.pickImage() }catch(e){}
    return;
  }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async function(e){
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    CHAT.pendingImg = await compressImage(f, 1200, 0.7);
    renderChat();
  };
  inp.click();
}

/* ================= 日程 / 提醒 ================= */
function openSched(id){
  const p = (id || '').split('|');
  const date = p[0] || window._calDay;
  const sid = p[1];
  let s = { title:'', time:'09:00', note:'', notify:true };
  if(sid){ const ex = S.sched().find(x => x.id === sid); if(ex) s = ex; }
  window._schedNotify = (s.notify !== false);
  openSheet('日程 / 提醒', '' +
    (sid ? '<input type="hidden" id="sId" value="' + sid + '">' : '') +
    '<input type="hidden" id="sDate" value="' + date + '">' +
    '<div class="field"><label>标题</label><input class="input" id="sTitle" value="' + esc(s.title) + '" placeholder="如 看牙医 / 给妈打电话"></div>' +
    '<div class="field"><label>时间</label><input class="input" id="sTime" type="time" value="' + (s.time || '09:00') + '"></div>' +
    '<div class="field"><label>备注</label><textarea class="input" id="sNote" placeholder="选填">' + esc(s.note || '') + '</textarea></div>' +
    '<div class="setting-row"><span>到时通知我（手机通知栏 + 声音）</span><div class="switch ' + (s.notify !== false ? 'on' : '') + '" data-act="schedToggle" id="sNotify"><i></i></div></div>' +
    '<div class="btn-row">' +
      '<button class="btn ghost" data-act="close">取消</button>' +
      '<button class="btn" data-act="saveSched">' + (sid ? '保存' : '添加') + '</button>' +
    '</div>' +
    (sid ? '<button class="btn danger" style="margin-top:10px" data-act="delSched" data-id="' + sid + '">删除</button>' : '')
  );
}
function saveSched(){
  const date = (document.getElementById('sDate') || {}).value;
  const title = ((document.getElementById('sTitle') || {}).value || '').trim();
  const time = ((document.getElementById('sTime') || {}).value || '09:00');
  const note = ((document.getElementById('sNote') || {}).value || '').trim();
  const notify = window._schedNotify !== false;
  if(!title){ toast('请填写标题'); return }
  const sid = (document.getElementById('sId') || {}).value;
  const arr = S.sched();
  let item;
  if(sid){ const i = arr.findIndex(x => x.id === sid); if(i >= 0) item = Object.assign(arr[i], { title:title, time:time, note:note, notify:notify }); }
  else { item = { id: uid(), date:date, time:time, title:title, note:note, notify:notify, createdAt: Date.now() }; arr.push(item); }
  S.saveSched(arr);
  if(notify && window.Android && typeof window.Android.scheduleReminder === 'function'){
    const pr = date.split('-'); const pt = time.split(':');
    const when = new Date(+pr[0], +pr[1]-1, +pr[2], +pt[0], +pt[1], 0).getTime();
    if(when > Date.now()){
      window.Android.scheduleReminder(item.title, (note ? note + ' · ' : '') + date, when, item.id);
      toast('已设定提醒，到时手机会响铃');
    } else { toast('时间已过，未设定提醒') }
  }
  closeSheet(); render();
}
function delSched(el, id){
  S.saveSched(S.sched().filter(x => x.id !== id));
  closeSheet(); render(); toast('已删除');
}

/* ================= 图片查看器 ================= */
async function viewImg(el, id){
  const url = await imgOrig(id);
  const ov = document.getElementById('imgOverlay');
  if(ov){ ov.querySelector('img').src = url || ''; ov.classList.remove('hidden') }
}
function closeImg(){ const ov = document.getElementById('imgOverlay'); if(ov) ov.classList.add('hidden') }

/* ================= 背景图（本地生成 / 上传 / 应用） ================= */
const BG_STYLES = ['薄荷','暖杏','日落','海洋','星空','极光','波点','网格','山影'];
function genBgPreview(st){
  const m = { 薄荷:'#EAF8F1',暖杏:'#FFF3E9',日落:'#FFD9C8',海洋:'#CDE7F2',星空:'#E3DEFB',极光:'#E6FBF4',波点:'#F2FBF7',网格:'#F2FBF7',山影:'#EAF8F1' };
  return 'linear-gradient(135deg,' + (m[st] || '#fff') + ',#ffffff)';
}
function genBgCanvas(style){
  const w = 480, h = 800;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const g = function(c1, c2){ const lg = ctx.createLinearGradient(0, 0, 0, h); lg.addColorStop(0, c1); lg.addColorStop(1, c2); return lg };
  const m = { 薄荷:['#EAF8F1','#FFFFFF'],暖杏:['#FFF3E9','#FFFFFF'],日落:['#FFE3D3','#FFC9B8'],海洋:['#E3F2FB','#CDE7F2'],星空:['#EDEAFB','#F6F3FF'],极光:['#E6FBF4','#E8F0FB'] };
  if(m[style]){ ctx.fillStyle = g(m[style][0], m[style][1]); ctx.fillRect(0, 0, w, h) }
  else if(style === '波点'){ ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,w,h); ctx.fillStyle = 'rgba(47,191,143,.12)'; for(let y=20;y<h;y+=46) for(let x=20;x<w;x+=46){ ctx.beginPath(); ctx.arc(x,y,9,0,7); ctx.fill() } }
  else if(style === '网格'){ ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0,0,w,h); ctx.strokeStyle = 'rgba(47,191,143,.10)'; ctx.lineWidth = 1; for(let x=0;x<=w;x+=30){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke() } for(let y=0;y<=h;y+=30){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke() } }
  else if(style === '山影'){ ctx.fillStyle = g('#EAF8F1','#FFFFFF'); ctx.fillRect(0,0,w,h); ctx.fillStyle = 'rgba(47,191,143,.18)'; ctx.beginPath(); ctx.moveTo(0,h); ctx.lineTo(0,h-180); ctx.quadraticCurveTo(w/2,h-320,w,h-160); ctx.lineTo(w,h); ctx.closePath(); ctx.fill() }
  return cv.toDataURL('image/jpeg', 0.7);
}
function applyBgImg(url){ const s = S.set(); s.bgImg = url; S.saveSet(s); applyBg() }
function openBgPicker(){
  const gen = BG_STYLES.map(function(st){
    return '<button class="bg-gen" data-act="bgGen" data-id="' + st + '"><div class="bg-gen-ic" style="background:' + genBgPreview(st) + '"></div><span>' + st + '</span></button>';
  }).join('');
  const s = S.set();
  openSheet('自定义背景', '' +
    '<p class="small muted">AI 生图 / 本地生成 / 上传 / 纯色都能用。背景只存本机，不影响记账。</p>' +
    '<h3 class="card-title" style="margin:12px 0 8px">AI 生图（Agnes 模型）</h3>' +
    '<div class="field"><label>描述你想要的背景（如：清晨阳光下的咖啡桌）</label>' +
      '<input class="input" id="bgPrompt" placeholder="一句话描述"></div>' +
    '<div class="chips" id="bgStyles" style="margin-bottom:8px">' +
      BG_STYLES.map(function(st){ return '<button class="chip-cat bg-style" data-act="bgStyle" data-id="' + st + '">' + st + '</button>'; }).join('') +
    '</div>' +
    '<button class="btn" data-act="bgAgnes">用 Agnes 生成</button>' +
    '<p class="small muted" style="margin-top:6px">需部署后端 image 模式；未部署会自动用本地风格生成。</p>' +
    '<h3 class="card-title" style="margin:14px 0 8px">本地风格（免费·即时）</h3>' +
    '<div class="bg-gen-grid">' + gen + '</div>' +
    (s.bgImg && s.bgImg.indexOf('data:') === 0 ? '<button class="btn ghost" data-act="bgClear" style="margin-top:12px">清除自定义图片背景</button>' : '') +
    '<h3 class="card-title" style="margin:14px 0 8px">上传本地图片</h3>' +
    '<button class="btn ghost" data-act="bgUpload">从相册选择</button>' +
    '<h3 class="card-title" style="margin:14px 0 8px">纯色</h3>' +
    '<div class="bg-swatches">' + BGS.map(function(b){ return '<button class="swatch ' + ((s.bg || '') === b[0] ? 'on' : '') + '" data-act="bg" data-id="' + b[0] + '" style="background:' + (b[0] || '#fff') + '"></button>'; }).join('') + '</div>');
}
function bgGen(el, id){ applyBgImg(genBgCanvas(id)); toast('已应用「' + id + '」背景'); closeSheet() }
async function bgUpload(){
  const f = await new Promise(function(res){ const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = function(e){ res(e.target.files[0]) }; i.click(); });
  if(!f) return;
  const c = await compressImage(f, 1000, 0.6);
  applyBgImg(c.compUrl); toast('已应用上传的背景'); closeSheet();
}
function bgClear(){ const s = S.set(); s.bgImg = ''; S.saveSet(s); applyBg(); closeSheet(); }

/* ================= 账号中心 ================= */
function openAccount(){
  const s = S.set();
  const cred = customCred();
  openSheet('账号中心', '' +
    '<div class="card tight" style="margin-bottom:12px">' +
      '<div class="row between"><div><div style="font-weight:600">' + esc(cred.email) + '</div>' +
      '<div class="small muted">昵称：林 · 固定账号自动登录</div></div>' +
      '<span class="small muted">' + (online ? '已连接云端' : '离线') + '</span></div>' +
    '</div>' +
    '<div class="field"><label>切换 / 自定义账号（可选）</label>' +
      '<input class="input" id="accEmail" value="' + esc(s.accEmail || '') + '" placeholder="邮箱，不填则用默认账号"></div>' +
    '<div class="field"><label>密码</label><input class="input" id="accPwd" type="password" value="' + esc(s.accPwd || '') + '" placeholder="留空表示不修改"></div>' +
    '<div class="field"><label>自定义后台地址（可选）</label><input class="input" id="accSb" value="' + esc(s.sbUrl || '') + '" placeholder="https://xxxx.supabase.co"></div>' +
    '<button class="btn" data-act="saveAccount">保存并重新登录</button>' +
    '<button class="btn ghost" data-act="logoutAccount" style="margin-top:10px">退出当前账号（用默认）</button>' +
    '<p class="small muted" style="margin-top:10px">默认账号已自动登录并云端备份。填入自己的 Supabase 项目可切换到个人后台；留空则回到默认账号。</p>');
}
function saveAccount(){
  const s = S.set();
  s.accEmail = (document.getElementById('accEmail').value || '').trim();
  s.accPwd = document.getElementById('accPwd').value;
  s.sbUrl = (document.getElementById('accSb').value || '').trim();
  S.saveSet(s); S.saveSes(null); TOKEN = ''; UID = '';
  closeSheet(); render();
  toast('已保存，正在重新登录…');
  syncAll(false);
}
function logoutAccount(){
  const s = S.set(); s.accEmail = ''; s.accPwd = ''; s.sbUrl = ''; S.saveSet(s);
  S.saveSes(null); TOKEN = ''; UID = '';
  closeSheet(); render(); toast('已退出，使用默认账号'); syncAll(false);
}

/* ================= 同步管理 ================= */
async function syncManage(){
  const tx = S.tx();
  const synced = tx.filter(function(t){ return t.synced }).length;
  const catCount = {};
  tx.filter(function(t){ return t.synced }).forEach(function(t){ const n = CATN[t.category] || t.category; catCount[n] = (catCount[n] || 0) + 1 });
  const cats = Object.keys(catCount).map(function(k){ return k + ' ' + catCount[k] + '笔' }).join('、') || '暂无';
  const s = S.set();
  const last = s.lastSync ? new Date(s.lastSync).toLocaleString('zh-CN', { hour12: false }) : '从未';
  openSheet('同步管理', '' +
    '<div class="card tight" style="margin-bottom:12px">' +
      '<div class="setting-row"><div>本地账单</div><b>' + tx.length + ' 条</b></div>' +
      '<div class="setting-row"><div>已同步到云端</div><b style="color:var(--income)">' + synced + ' 条</b></div>' +
      '<div class="setting-row"><div>待上传</div><b style="color:var(--expense)">' + (tx.length - synced) + ' 条</b></div>' +
      '<div class="setting-row"><div>上次同步</div><span class="small muted">' + last + '</span></div>' +
    '</div>' +
    '<div class="card tight" style="margin-bottom:12px"><div class="card-title" style="margin-bottom:6px">已同步分类</div><div class="small muted">' + cats + '</div></div>' +
    '<p class="small muted">后台消耗请在 Supabase 项目面板查看（本机不显示）。验证同步：清空本地后点「立即同步」能找回云端数据即生效。</p>' +
    '<button class="btn danger" data-act="clearCloud" style="margin-top:6px">清除云端数据（保留本地）</button>');
}
async function clearCloud(){
  if(!confirm('确定清除云端所有账单？本地数据会保留。此操作不可撤销，且需要云端可写权限。')) return;
  try{
    await login();
    await req('/rest/v1/transactions?user_id=eq.' + UID, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
    const tx = S.tx(); tx.forEach(function(t){ t.synced = false }); S.saveTx(tx);
    closeSheet(); toast('云端数据已清除（本地保留）'); render();
  }catch(e){
    openSheet('清除失败', '<p class="small muted">' + esc(e.message || String(e)) + '</p><p class="small muted">多半是云端权限（RLS）未开放，不影响本地数据。</p>');
  }
}

/* ================= 动作 ================= */
const ACTIONS = {
  go(el, id){ page = id; render() },
  calendar(){ page = 'calendar'; window._calDay = null; render() },
  calPrev(){ const d = new Date(calCursor); d.setMonth(d.getMonth() - 1); calCursor = d.getTime(); window._calDay = null; render() },
  calNext(){ const d = new Date(calCursor); d.setMonth(d.getMonth() + 1); calCursor = d.getTime(); window._calDay = null; render() },
  calDay(el, id){ window._calDay = id; render() },
  add(){ formState = { type: 'expense', category: 'food' }; openSheet('记一笔', formTx()) },
  close(){ closeSheet() },
  seg(el, id){
    formState.type = id;
    const cats = CATS[id];
    if(!cats.some(c => c[0] === formState.category)) formState.category = cats[0][0];
    const seg = document.getElementById('typeSeg');
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    document.getElementById('fCats').innerHTML = cats.map(c =>
      '<button class="chip-cat ' + (formState.category === c[0] ? 'on' : '') + '" data-act="cat" data-id="' + c[0] + '">' + c[1] + '</button>').join('');
  },
  cat(el, id){
    formState.category = id;
    document.getElementById('fCats').querySelectorAll('.chip-cat').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  },
  saveTx(el, id){
    const amount = parseFloat(document.getElementById('fAmount').value);
    if(!amount || amount <= 0){ toast('请填写金额'); return }
    const data = {
      type: formState.type, amount: amount, category: formState.category,
      note: document.getElementById('fNote').value.trim(),
      date: parseDate(document.getElementById('fDate').value)
    };
    if(id) updateTx(id, data); else addTx(data);
    closeSheet(); render(); toast(id ? '已更新' : '已记录');
  },
  delTx(el, id){ delTx(id); closeSheet(); render(); toast('已删除') },
  edit(el, id){
    const t = S.tx().find(x => x.id === id);
    if(!t) return;
    formState = { type: t.type, category: t.category };
    openSheet('编辑', formTx(Object.assign({}, t, { date: ymd(t.date) })));
  },
  calc(el, id){ openCalc(id) },
  capture(){ doCapture() },
  imgAddMore(){ if(window.__loopAdd) window.__loopAdd() },
  imgStartRec(){ if(window.__loopDone) window.__loopDone() },
  analyst(){ page = 'ai'; render(); setTimeout(doAnalyze, 120) },
  analyze(){ doAnalyze() },
  aiType(el, id){
    const p = id.split('|'); const i = +p[0];
    const card = document.querySelector('[data-ai="' + i + '"]');
    card.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', b.dataset.id === id));
    const cats = CATS[p[1]];
    const holder = card.querySelector('[data-ai-cats]');
    holder.innerHTML = cats.map(c => '<button class="chip-cat" data-act="aiCat" data-id="' + i + '|' + c[0] + '">' + c[1] + '</button>').join('');
    holder.querySelector('.chip-cat').classList.add('on');
  },
  aiCat(el, id){
    const i = id.split('|')[0];
    document.querySelector('[data-ai-cats="' + i + '"]').querySelectorAll('.chip-cat').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  },
  aiDrop(el, id){
    const card = document.querySelector('[data-ai="' + id + '"]');
    if(card) card.remove();
  },
  saveAll(){
    const items = collectAiItems();
    if(!items.length){ toast('没有可保存的条目'); return }
    items.forEach(t => addTx(t));
    closeSheet(); page = 'records'; render();
    toast('已保存 ' + items.length + ' 笔');
  },
  sync(){ syncAll(false) },
  diag(){ runDiag() },
  toggle(el, id){
    const s = S.set();
    if(id === 'auto') s.auto = !(s.auto !== false);
    if(id === 'quote') s.quote = !(s.quote !== false);
    if(id === 'tts'){ s.tts = !(s.tts !== false); TTS.enabled = s.tts; S.saveSet(s); render(); if(TTS.enabled) ttsSpeak('朗读已开启'); return; }
    S.saveSet(s); render();
  },
  bg(el, id){
    const s = S.set(); s.bg = id; S.saveSet(s); render();
  },
  export(){
    const rows = S.tx().slice().sort((a, b) => a.date - b.date);
    const csv = ['日期,类型,分类,金额,备注'].concat(rows.map(t =>
      [ymd(t.date), t.type === 'income' ? '收入' : '支出', CATN[t.category] || t.category, t.amount, (t.note || '').replace(/,/g, '，')].join(','))).join('\n');
    if(window.Android && window.Android.saveText){
      window.Android.saveText('暖记账单.csv', '\ufeff' + csv);
      toast('已导出 ' + rows.length + ' 条');
      return;
    }
    const url = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + csv);
    const a = document.createElement('a'); a.href = url; a.download = '暖记账单.csv'; a.click();
    toast('已导出 ' + rows.length + ' 条');
  },
  clear(){
    if(!confirm('确定清空本地所有账单？云端数据不会被删除。')) return;
    const tx = S.tx();
    tx.forEach(t => { if(t.remote_id){ const d = S.del(); if(d.indexOf(t.remote_id) < 0){ d.push(t.remote_id); S.saveDel(d) } } });
    S.saveTx([]); render(); toast('已清空本地');
  },
  openChat(){ openChat() },
  chatImg(){ chatPickImg() },
  closeChat(){ closeChat() },
  sendChat(){ sendChat() },
  viewImg(el, id){ viewImg(el, id) },
  closeImg(){ closeImg() },
  openBg(){ openBgPicker() },
  bgGen(el, id){ bgGen(el, id) },
  bgUpload(){ bgUpload() },
  bgClear(){ bgClear() },
  bgStyle(el, id){
    const box = document.getElementById('bgStyles');
    if(box) box.querySelectorAll('.bg-style').forEach(b => b.classList.toggle('on', b.dataset.id === id));
  },
  bgAgnes(){
    const p = (document.getElementById('bgPrompt') || {}).value || '';
    const sel = document.querySelector('#bgStyles .bg-style.on');
    bgGenAgnes(p, sel ? sel.dataset.id : '', true);
  },
  openAccount(){ openAccount() },
  saveAccount(){ saveAccount() },
  logoutAccount(){ logoutAccount() },
  syncManage(){ syncManage() },
  openSched(el, id){ openSched(id) },
  saveSched(){ saveSched() },
  delSched(el, id){ delSched(el, id) },
  schedToggle(){ window._schedNotify = !(window._schedNotify !== false); const sw = document.getElementById('sNotify'); if(sw) sw.classList.toggle('on', window._schedNotify !== false); },
  clearCloud(){ clearCloud() }
};

document.addEventListener('click', function(e){
  const el = e.target.closest('[data-act]');
  if(!el) return;
  const fn = ACTIONS[el.dataset.act];
  if(fn){ e.preventDefault(); fn(el, el.dataset.id) }
});

document.addEventListener('input', function(e){
  const dn = e.target.closest('#dayNote');
  if(dn){ const notes = S.note(); notes[dn.dataset.id] = dn.value; S.saveNote(notes); return; }
  const body = document.getElementById('sheetBody');
  if(!body || !body.dataset.calc) return;
  const key = body.dataset.calc;
  const out = document.getElementById('calcOut');
  if(out && CALC_FN[key]) out.innerHTML = CALC_FN[key]();
});

document.getElementById('tabbar').addEventListener('click', function(e){
  const b = e.target.closest('.tab');
  if(!b) return;
  page = b.dataset.page; render();
});
document.getElementById('syncBtn').addEventListener('click', function(){ syncAll(false) });
document.getElementById('sheetMask').addEventListener('click', closeSheet);
document.getElementById('sheetClose').addEventListener('click', closeSheet);

/* 供安卓端回调：图片选择结果（data URL） */
window.onImagePicked = function(dataUrl){
  if(window.__imgMulti){                 // 多选收集模式：先入队
    if(dataUrl) window.__imgMulti.push({ origUrl: dataUrl, compUrl: dataUrl });
    return;
  }
  if(window.__imgResolve){ const r = window.__imgResolve; window.__imgResolve = null; r(dataUrl) }
};
window.onImageCancel = function(){
  if(window.__imgMulti) return;          // 多选模式下取消忽略，最终以 onImagesDone 收尾
  if(window.__imgResolve){ const r = window.__imgResolve; window.__imgResolve = null; r(null) }
};
/* 原生多选结束信号：把收集到的图片数组交给调用方 */
window.onImagesDone = function(count){
  const arr = window.__imgMulti || [];
  window.__imgMulti = null;
  if(window.__imgDone){ const r = window.__imgDone; window.__imgDone = null; r(arr) }
};

/* ================= 启动 ================= */
function init(){
  ttsInit();
  const s = S.set();
  TTS.enabled = (s.tts !== false);
  const ses = S.ses();
  if(ses){ TOKEN = ses.access_token || ''; UID = ses.user_id || '' }
  render();
  setNet('off');
  if((s.auto !== false)) syncAll(true);
  window.addEventListener('online', () => syncAll(true));
  setInterval(function(){ if((S.set().auto !== false)) syncAll(true) }, 120000);
}
init();

(function(){
  const ci = document.getElementById('chatInput');
  if(ci) ci.addEventListener('keydown', function(e){ if(e.key === 'Enter'){ e.preventDefault(); sendChat() } });
})();
