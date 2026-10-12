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
const K = { tx: 'wl.tx', set: 'wl.set', ses: 'wl.ses', ep: 'wl.ep', del: 'wl.del' };

const CATS = {
  expense: [['food','餐饮'],['transport','交通'],['shopping','购物'],['home','居家'],['fun','娱乐'],['takeout','外卖'],['study','学习'],['medical','医疗'],['social','人情'],['other_exp','其他']],
  income: [['salary','工资'],['bonus','奖金'],['invest','理财'],['parttime','兼职'],['other_inc','其他']]
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

const CALCS = [
  ['budget','预算','看本月还能花多少','M4 6h16M4 12h16M4 18h10'],
  ['loan','房贷/车贷','等额本息月供','M4 18V8l8-5 8 5v10M9 18v-6h6v6'],
  ['split','AA 分账','人均多少','M12 3v18M7 7h10M7 12h10M7 17h10'],
  ['save','储蓄目标','多久能攒够','M12 3l8 4v6c0 4-3.5 7-8 8-4.5-1-8-4-8-8V7z'],
  ['fx','汇率换算','外币转人民币','M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4'],
  ['tax','个税计算','月薪到手多少','M9 7h6M9 12h6M9 17h6M5 5h14v14H5z'],
  ['tip','小费/服务费','按比例算小费','M12 5v14M8 9h8M8 13h8'],
  ['invest','复利收益','本金滚多少年','M4 19V5M4 19h16M8 15l4-5 3 3 4-7']
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
  saveDel(v){ localStorage.setItem(K.del, JSON.stringify(v)) }
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

/* supabase 直连走 WebView 自带 fetch（Chromium 指纹能过 Cloudflare，无需凭证）；
   国内反代走原生桥（原生层注入预览凭证 Cookie，绕开浏览器 SameSite 限制）。 */
function epIsProxy(ep){ return ep.indexOf('edgeone.cool') > -1 }

async function req(path, opt){
  opt = opt || {};
  let last;
  for(const ep of EPS){
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
  const r = await req('/auth/v1/token?grant_type=password', {
    method: 'POST', body: { email: EMAIL, password: PWD }, auth: false
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
}

function applyBg(){
  const c = (S.set().bg) || '';
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
    '<div class="tx-main">' +
      '<div class="tx-cat">' + esc(CATN[t.category] || t.category) + '</div>' +
      '<div class="tx-note">' + esc(t.note || ymd(t.date)) + '</div>' +
    '</div>' +
    '<div class="tx-amt ' + t.type + '">' + (t.type === 'income' ? '+' : '-') + money(t.amount) + '</div>' +
  '</div>';
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
    '<div class="ai-hero">' +
      '<div class="row between"><h3 class="card-title" style="margin:0">AI 拍照记账</h3>' +
      '<button class="tb-action" data-act="capture">选择图片</button></div>' +
      '<p class="small muted" style="margin:8px 0 0">拍小票、截图或账单，AI 自动识别金额与分类，识别后可手动修改再保存。</p>' +
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
  return '' +
    '<div class="card">' +
      '<h3 class="card-title">云端备份</h3>' +
      '<div class="setting-row"><div><div>固定账号自动登录</div>' +
        '<div class="small muted">18882632073 · 管理员林</div></div>' +
        '<span class="small ' + (online ? 'muted' : 'muted') + '">' + (online ? '已连接' : '离线') + '</span></div>' +
      '<div class="setting-row"><div>本地共 ' + tx.length + ' 条' + (unsynced ? '（' + unsynced + ' 条待上传）' : '') + '</div>' +
        '<button class="tb-action" data-act="sync">立即同步</button></div>' +
      (LAST_ERR ? '<div class="setting-row"><div class="small" style="color:var(--expense)">上次失败 ' + LAST_ERR.time + '<br>' + esc(LAST_ERR.msg) + '</div></div>' : '') +
      '<div class="setting-row"><div>连不上时先测网络</div>' +
        '<button class="tb-action" data-act="diag">网络诊断</button></div>' +
      '<div class="setting-row"><div>联网自动备份</div>' +
        '<div class="switch ' + (s.auto !== false ? 'on' : '') + '" data-act="toggle" data-id="auto"><i></i></div></div>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">界面</h3>' +
      '<div class="setting-row"><div>背景色</div><div class="bg-swatches">' +
        BGS.map(b => '<button class="swatch ' + ((s.bg || '') === b[0] ? 'on' : '') + '" data-act="bg" data-id="' + b[0] + '" style="background:' + (b[0] || '#fff') + '" title="' + b[1] + '"></button>').join('') +
      '</div></div>' +
      '<div class="setting-row"><div>首页励志语</div>' +
        '<div class="switch ' + (s.quote !== false ? 'on' : '') + '" data-act="toggle" data-id="quote"><i></i></div></div>' +
    '</div>' +
    '<div class="card">' +
      '<h3 class="card-title">数据</h3>' +
      '<button class="btn ghost" data-act="export" style="margin-bottom:10px">导出账单（CSV）</button>' +
      '<button class="btn danger" data-act="clear">清空本地数据</button>' +
      '<p class="small muted" style="margin:10px 0 0">数据优先存在手机本地，断网也能记账；联网后自动备份到云端，换手机不丢。</p>' +
    '</div>';
}

/* ---------- 日历 ---------- */
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
    html += '<button class="cal-d ' + (amt ? 'has' : '') + (k === todayKey ? ' today' : '') + '" data-act="calDay" data-id="' + k + '">' +
      '<span>' + day + '</span>' + (amt ? '<span class="cd-amt">' + Math.round(amt) + '</span>' : '') + '</button>';
  }
  html += '</div></div>';
  const sel = window._calDay;
  if(sel){
    const list = S.tx().filter(t => ymd(t.date) === sel).sort((a, b) => b.createdAt - a.createdAt);
    html += '<div class="card"><h3 class="card-title">' + sel + '（' + list.length + ' 笔）</h3>' +
      (list.length ? list.map(txRow).join('') : '<div class="empty">这天没有记录</div>') + '</div>';
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
          '<div class="field"><label>年数</label><input class="input" id="c_invY" type="number" value="10"></div>'
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
async function doCapture(){
  let dataUrl = null;
  try{
    if(window.Android && window.Android.pickImage){
      dataUrl = await new Promise((resolve, reject) => {
        window.__imgResolve = resolve;
        window.__imgReject = reject;
        window.Android.pickImage();
        setTimeout(() => { if(window.__imgResolve){ window.__imgResolve = null; reject(new Error('取消')) } }, 120000);
      });
    }else{
      dataUrl = await new Promise(resolve => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = 'image/*';
        inp.onchange = e => {
          const f = e.target.files[0]; if(!f) return resolve(null);
          const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(f);
        };
        inp.click();
      });
    }
  }catch(e){ dataUrl = null }
  if(!dataUrl){ toast('未选择图片'); return }

  const sizeKb = Math.round(dataUrl.length * 0.75 / 1024);
  if(sizeKb > 3500){ toast('图片太大（' + sizeKb + 'KB），请换一张'); return }

  openSheet('AI 识别中', '<div class="preview"><img src="' + dataUrl + '" class="preview"></div><div><span class="spinner"></span>正在识别…</div>');
  try{
    await login();
    const r = await req('/functions/v1/ai-accounting', {
      method: 'POST', timeout: 90000,
      body: { mode: 'recognize', image: dataUrl }
    });
    const items = (r && r.items) || [];
    if(!items.length) throw new Error('没识别出条目，可手动记一笔');
    window._aiItems = items;
    openSheet('识别结果（可修改）', '<div class="preview"><img src="' + dataUrl + '" class="preview"></div>' +
      items.map((it, i) => aiItemRow(it, i)).join('') +
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
  return '<div class="card tight" data-ai="' + i + '">' +
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
      date: parseDate(dateEl ? dateEl.value : '')
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
  rows.push(await diagOne('云端数据接口', EPS[0], '/rest/v1/transactions?select=count', {}));
  rows.push(await diagOne('云端账号登录', EPS[0], '/auth/v1/token?grant_type=password', { method: 'POST', body: { email: EMAIL, password: PWD }, auth: false }));
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
  }
};

document.addEventListener('click', function(e){
  const el = e.target.closest('[data-act]');
  if(!el) return;
  const fn = ACTIONS[el.dataset.act];
  if(fn){ e.preventDefault(); fn(el, el.dataset.id) }
});

document.addEventListener('input', function(e){
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
  if(window.__imgResolve){ const r = window.__imgResolve; window.__imgResolve = null; r(dataUrl) }
};
window.onImageCancel = function(){
  if(window.__imgResolve){ const r = window.__imgResolve; window.__imgResolve = null; r(null) }
};

/* ================= 启动 ================= */
function init(){
  const s = S.ses();
  if(s){ TOKEN = s.access_token || ''; UID = s.user_id || '' }
  render();
  setNet('off');
  if((S.set().auto !== false)) syncAll(true);
  window.addEventListener('online', () => syncAll(true));
  setInterval(function(){ if(S.set().auto !== false) syncAll(true) }, 120000);
}
init();
