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
const K = { tx: 'wl.tx', set: 'wl.set', ses: 'wl.ses', ep: 'wl.ep', del: 'wl.del', note: 'wl.note', sched: 'wl.sched', nav: 'wl.nav', todo: 'wl.todo', chat: 'wl.chat', mem: 'wl.mem' };

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
/* 把已存在的 dataURL 重新压缩成小体积 JPEG（用于 Agnes 生图等：原图 1024×1024 太大，
   直接存 localStorage 会撑爆 5MB 配额）。压缩失败则原样返回，不阻断主流程。 */
async function compressDataUrl(url, maxSide, quality){
  try{
    const img = await new Promise(function(res, rej){ const im = new Image(); im.onload = function(){ res(im) }; im.onerror = rej; im.src = url });
    if(!img.width || !img.height) return url;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality || 0.6);
  }catch(e){ return url }
}

/* ================= 本地 TTS（优先原生桥——安卓 WebView 不支持 Web Speech API，开了也没声；浏览器环境回退 Web Speech） ================= */
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
  if(!TTS.enabled) return;
  const t = String(text || '').replace(/[#,*_\-]+/g, ' ').slice(0, 400);
  if(!t) return;
  try{ if(window.Android && window.Android.stopSpeak) window.Android.stopSpeak() }catch(e){}
  if(window.Android && typeof window.Android.speak === 'function'){
    try{ window.Android.speak(t); return }catch(e){}
  }
  if(!TTS.synth) return;
  try{
    TTS.synth.cancel();
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'zh-CN'; u.rate = 1.0; u.pitch = 1.0;
    if(TTS.voice) u.voice = TTS.voice;
    TTS.synth.speak(u);
  }catch(e){}
}
function ttsStop(){
  try{ if(window.Android && window.Android.stopSpeak) window.Android.stopSpeak() }catch(e){}
  if(TTS.synth){ try{ TTS.synth.cancel() }catch(e){} }
}

/* ================= 小账对话（复用 ai-accounting 的 analyze 模式，前端维护多轮历史） ================= */
const CHAT = { open: false, busy: false, pendingImg: null, hits: [], hi: -1, q: '', limit: 200 };
const CHAT_MAX = 900;      // 本地最多留多少条
const COMPACT_GAP = 30;    // 攒够多少条旧对话就压一次摘要
const KEEP_LIVE = 16;      // 最近多少条永远保留原文进上下文

/** 写聊天记录，配额爆了就先丢老图片、再丢最老的消息 */
const CHAT_BUDGET = 2.4 * 1024 * 1024;   // 聊天记录在 localStorage 里的预算（字符数）

/** 从最新往回算体积，超出预算的老图就丢掉（只留占位），保证最近的一定能存下 */
function trimBySize(arr){
  let used = 0;
  for(let i = arr.length - 1; i >= 0; i--){
    const m = arr[i];
    const tlen = (m.text ? m.text.length : 0) + 80;
    const ilen = m.img ? m.img.length : 0;
    used += tlen + ilen;
    if(used > CHAT_BUDGET && ilen){ m.img = ''; m.imgGone = true; used -= ilen }
  }
}
function persistChat(arr){
  for(let round = 0; round < 6; round++){
    trimBySize(arr);
    try{ localStorage.setItem(K.chat, JSON.stringify(arr)); return true }catch(e){
      // 连文本都塞不下：砍掉最老的一批，还没地方就放弃，保住已有的数据
      if(arr.length > 8){ arr.splice(0, Math.ceil(arr.length / 3)) }
      else return false;
    }
  }
  return false;
}
function chatPush(role, text, img){
  const a = S.chat();
  a.push({ id: uid(), role: role, text: String(text || ''), img: img || '', ts: Date.now() });
  if(a.length > CHAT_MAX) a.splice(0, a.length - CHAT_MAX);
  persistChat(a);
  return a;
}

/* ================= 小账记忆：永久要素 + 自动压缩沉淀 =================
   mem = { facts:[{id,k,v,ts}], sums:[{id,text,from,to,ts}], compacted:已压缩到第几条, compacting:bool }
   facts  = 重要要素，永久记住，每次都进上下文
   sums   = 更早对话被压缩后的摘要，滚动沉淀，省 token 又不断片
   上下文组装 = 永久要素 + 压缩摘要 + 最近原文                          */
function getMem(){
  const m = S.mem();
  if(!m.facts) m.facts = [];
  if(!m.sums) m.sums = [];
  if(typeof m.compacted !== 'number') m.compacted = 0;
  return m;
}

/* 从用户说的话里抠出值得长期记住的东西 */
const FACT_RULES = [
  [/我叫(.{1,12}?)(?:[，,。!！?？、\s]|$)/, '称呼'],
  [/我是(.{1,14}?)(?:[，,。!！?？、\s]|$)/, '身份'],
  [/我的(.{1,8}?)(?:是|叫)(.{1,20}?)(?:[，,。!！?？、\s]|$)/, null],
  [/(房租|水电|工资|奖金|生活费|预算|花呗|房贷|车贷|保险)(?:是|每月|一个月)?\s*(\d[\d,.]*)\s*元?/, null],
  [/(?:每月|每个月|一个月)(.{0,6}?)(\d[\d,.]*)\s*元/, null],
  [/记住[:：]?\s*(.{2,40})/, '要求记住'],
  [/我(?:喜欢|不喜欢|讨厌|想买|想要|准备|打算|计划)(.{1,22}?)(?:[，,。!！?？、\s]|$)/, '偏好'],
  [/我(?:过敏|忌口|不能吃|不吃)(.{1,16}?)(?:[，,。!！?？、\s]|$)/, '忌口'],
  [/我(?:在|住)(.{1,14}?(?:市|区|县|小区|宿舍|公司))/, '位置'],
  [/我养(?:了)?(.{1,12}?)(?:[，,。!！?？、\s]|$)/, '宠物'],
  [/(?:目标|计划|打算)(?:是)?(.{1,28}?)(?:[，,。!！?？、\s]|$)/, '目标']
];

function extractFacts(text){
  const out = [];
  const s = String(text || '').trim();
  if(s.length < 2 || s.length > 220) return out;
  for(let i = 0; i < FACT_RULES.length; i++){
    const rule = FACT_RULES[i], label = rule[1], m = s.match(rule[0]);
    if(!m) continue;
    let k = label, v = '';
    if(!k){
      if(m.length >= 3) k = m[1].trim() || '备注';
      v = (m[2] || '').trim();
    } else {
      v = (m[1] || '').trim();
    }
    k = k.replace(/^[的地得，,。!！?？怎么是多少是]+/, '').trim();
    v = v.replace(/^[的地得，,。!！?？]+/, '').trim();
    if(!k || !v || k.length > 14 || v.length > 40) continue;
    if(/^(什么|怎么|多少|啊|吧|呢|这|那|我|你|他)$/.test(v)) continue;
    out.push({ k: k, v: v });
  }
  return out;
}

function memAbsorb(text){
  const got = extractFacts(text);
  if(!got.length) return 0;
  const m = getMem();
  let n = 0;
  got.forEach(function(f){
    const ex = m.facts.findIndex(x => x.k === f.k && x.v === f.v);
    if(ex >= 0){ m.facts[ex].ts = Date.now(); m.facts[ex].hits = (m.facts[ex].hits || 1) + 1 }
    else { m.facts.push({ id: uid(), k: f.k, v: f.v, ts: Date.now(), hits: 1 }); n++ }
  });
  if(m.facts.length > 80) m.facts = m.facts.sort((a, b) => a.ts - b.ts).slice(-80);
  S.saveMem(m);
  return n;
}

/** 攒够一批旧对话就调后端压成摘要，并把那批的图片数据清掉省空间 */
async function maybeCompact(){
  const m = getMem();
  if(m.compacting) return;
  const all = S.chat();
  const pending = all.length - m.compacted - KEEP_LIVE;
  if(pending < COMPACT_GAP) return;
  const slice = all.slice(m.compacted, m.compacted + pending);
  if(!slice.length) return;
  m.compacting = true; S.saveMem(m);
  try{
    await login();
    const convo = slice.map(function(x){
      return (x.role === 'user' ? '用户' : '小账') + '：' + String(x.text || '').slice(0, 180);
    }).join('\n');
    const p = '把下面这段对话压成一段 180 字以内的中文摘要，务必保留：用户的个人信息与称呼、长期偏好与忌口、钱数和日期、承诺要做的待办、还没解决的问题。照片类内容一句话带过即可。只输出摘要本身，不要开头和结尾的客套话。\n\n' + convo;
    const r = await req('/functions/v1/ai-accounting', { method: 'POST', timeout: 60000, body: { mode: 'analyze', text: p } });
    const txt = ((r && r.text) || '').trim();
    if(txt.length > 6){
      m.sums.push({ id: uid(), text: txt.slice(0, 400), from: slice[0].ts, to: slice[slice.length - 1].ts, ts: Date.now() });
      if(m.sums.length > 12) m.sums = m.sums.slice(-12);
      m.compacted = m.compacted + pending;
      slice.forEach(function(x){ if(x.img){ x.img = ''; x.imgGone = true } });
      persistChat(all);
      S.saveMem(m);
      const el = document.getElementById('memStat');
      if(el) el.textContent = '已沉淀 ' + m.sums.length + ' 段';
    }
  }catch(e){ /* 压缩失败不影响聊天 */ }
  m.compacting = false;
  try{ S.saveMem(m) }catch(e){}
}

/** 组装上下文：永久要素 + 压缩摘要 + 最近原文 */
function buildContext(){
  const m = getMem();
  const all = S.chat();
  const recent = all.slice(-KEEP_LIVE).filter(x => x.role === 'user' || x.role === 'assistant');
  const facts = m.facts.slice(-20);
  const sums = m.sums.slice(-4);
  let head = '';
  if(facts.length) head += '【关于用户，必须长期记住，回答时直接用】\n' + facts.map(f => '- ' + f.k + '：' + f.v).join('\n') + '\n\n';
  if(sums.length) head += '【更早对话的压缩摘要】\n' + sums.map(s => '- ' + s.text).join('\n') + '\n\n';
  return { head: head, recent: recent.map(x => ({ role: x.role, text: x.text })) };
}

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
  saveSched(v){ localStorage.setItem(K.sched, JSON.stringify(v)) },
  nav(){ try{ return JSON.parse(localStorage.getItem(K.nav) || '[]') }catch(e){ return [] } },
  saveNav(v){ localStorage.setItem(K.nav, JSON.stringify(v)) },
  todo(){ try{ return JSON.parse(localStorage.getItem(K.todo) || '[]') }catch(e){ return [] } },
  saveTodo(v){ localStorage.setItem(K.todo, JSON.stringify(v)) },
  chat(){ try{ return JSON.parse(localStorage.getItem(K.chat) || '[]') }catch(e){ return [] } },
  saveChat(v){ localStorage.setItem(K.chat, JSON.stringify(v)) },
  mem(){ try{ return JSON.parse(localStorage.getItem(K.mem) || '{}') }catch(e){ return {} } },
  saveMem(v){ localStorage.setItem(K.mem, JSON.stringify(v)) }
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
    last.code = out ? out.code : 0;
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

/* 页面切换统一走这里：压入 history 栈，安卓返回键（web.goBack）就能逐页回退而不是退出 App */
function goPage(p){
  if(p === page) return;
  try{ history.pushState({ p: p }, '', location.href) }catch(e){}
  page = p; render();
}
window.addEventListener('popstate', function(e){
  page = (e.state && e.state.p) || 'home';
  render();
});

function render(){
  const v = document.getElementById('view');
  const titles = { home: '首页', records: '账单', calc: '计算器', ai: 'AI 助手', settings: '设置', calendar: '日历', nav: '导航', note: '便签' };
  document.getElementById('pageTitle').textContent = titles[page] || '暖记';
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.page === page || (page === 'calendar' && b.dataset.page === 'home')));
  applyBg();
  if(page === 'home') v.innerHTML = viewHome();
  else if(page === 'records') v.innerHTML = viewRecords();
  else if(page === 'calc') v.innerHTML = viewCalc();
  else if(page === 'ai') v.innerHTML = viewAI();
  else if(page === 'settings') v.innerHTML = viewSettings();
  else if(page === 'calendar') v.innerHTML = viewCalendar();
  else if(page === 'nav') v.innerHTML = viewNav();
  else if(page === 'note') v.innerHTML = viewNote();
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

/* ================= 网站导航（App 内浏览器收藏） =================
   每条：{id, name, url, icon}。icon 取值：
     ''        → 自动（取站点 favicon，失败回退首字母）
     'emoji:🚀' → emoji 图标
     'data:...' → 用户上传并压缩的小图 */
function normUrl(u){
  u = (u || '').trim();
  if(!u) return '';
  if(/^https?:\/\//i.test(u)) return u;
  if(/^[\w.-]+\.\w{2,}/.test(u)) return 'https://' + u;   // 裸域名补 https
  return 'https://' + u;
}
function hostOf(u){
  try{ return new URL(normUrl(u)).host }catch(e){ return (u || '').replace(/^https?:\/\//i, '').split('/')[0] }
}
function navIconHtml(item){
  const ico = (item.icon || '');
  if(ico.indexOf('emoji:') === 0){
    return '<div class="nav-ico nav-emoji">' + esc(ico.slice(6)) + '</div>';
  }
  if(ico.indexOf('data:') === 0){
    return '<div class="nav-ico"><img src="' + ico + '"></div>';
  }
  const host = hostOf(item.url);
  const letter = (item.name || host || '?').slice(0, 1).toUpperCase();
  return '<div class="nav-ico nav-auto">' +
    '<span class="nav-letter">' + esc(letter) + '</span>' +
    '<img class="nav-fav" src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64" onerror="this.style.display=\'none\'">' +
    '</div>';
}
function viewNav(){
  const items = S.nav();
  let html = '<div class="nav-head">' +
    '<div class="muted">把常用网站收藏在这里，点一下就在 App 内打开——App 本身就是个浏览器，加载的网站拥有完整浏览器功能与权限。</div>' +
    '<button class="btn" data-act="navAdd" style="margin-top:12px">+ 添加网站</button>' +
    '</div>';
  if(!items.length){
    html += '<div class="card"><div class="empty">还没有收藏<br><br>点上方「添加网站」把常用网址放进来</div></div>';
  } else {
    html += '<div class="nav-list">';
    items.forEach(function(it){
      html += '<div class="nav-card" data-act="navOpen" data-id="' + it.id + '">' +
        navIconHtml(it) +
        '<div class="nav-info"><div class="nav-name">' + esc(it.name) + '</div><div class="nav-host">' + esc(hostOf(it.url)) + '</div></div>' +
        '<button class="nav-edit" data-act="navEdit" data-id="' + it.id + '">编辑</button>' +
        '</div>';
    });
    html += '</div>';
  }
  return html;
}

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
  return '<div class="tx" data-act="txView" data-id="' + t.id + '">' +
    '<div class="tx-dot">' + esc((CATN[t.category] || '?').slice(0, 1)) + '</div>' +
    (t.imgId ? '<img class="tx-img" data-act="viewImg" data-id="' + t.imgId + '">' : '') +
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

/* 记账详情（只读查看，可再编辑/删除） */
function txView(el, id){
  const t = S.tx().find(x => x.id === id);
  if(!t) return;
  const synced = t.synced ? '已同步云端' : (t.remote_id ? '已同步' : '仅本地');
  let html = '<div class="card">';
  if(t.imgId){
    html += '<img class="tx-detail-img" data-img="' + t.imgId + '" data-act="viewImg" data-id="' + t.imgId + '" ' +
      'style="width:100%;max-height:240px;object-fit:cover;border-radius:10px;margin-bottom:12px;cursor:pointer">';
  }
  html += '<div class="row between" style="padding:7px 0"><span class="muted">类型</span><b>' + (t.type === 'income' ? '收入' : '支出') + '</b></div>' +
    '<div class="row between" style="padding:7px 0"><span class="muted">金额</span><b class="' + t.type + '">' + (t.type === 'income' ? '+' : '-') + money(t.amount) + '</b></div>' +
    '<div class="row between" style="padding:7px 0"><span class="muted">分类</span><b>' + esc(CATN[t.category] || t.category) + '</b></div>' +
    '<div class="row between" style="padding:7px 0"><span class="muted">日期</span><b>' + esc(ymd(t.date)) + '</b></div>' +
    (t.note ? '<div class="row between" style="padding:7px 0;align-items:flex-start"><span class="muted" style="flex:0 0 auto">备注</span><b style="font-weight:400;max-width:62%;text-align:right">' + esc(t.note) + '</b></div>' : '') +
    '<div class="row between" style="padding:7px 0"><span class="muted">同步状态</span><b>' + synced + '</b></div>' +
    '</div>' +
    '<div class="btn-row">' +
      '<button class="btn ghost" data-act="edit" data-id="' + t.id + '">编辑</button>' +
      '<button class="btn danger" data-act="delTx" data-id="' + t.id + '">删除</button>' +
    '</div>';
  openSheet('账单详情', html);
  if(t.imgId){
    imgComp(t.imgId).then(function(u){ const im = document.querySelector('#sheetBody .tx-detail-img'); if(im && u) im.src = u; });
  }
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
/* ================= 农历 + 节气（LM: [1970纪元日, 农历月, 闰标志] 每月初一；TERMS: 节气表 2026-2040） ================= */
const LM=[[19733,12,0],[19763,1,0],[19792,2,0],[19822,3,0],[19851,4,0],[19880,5,0],[19910,6,0],[19939,7,0],[19969,8,0],[19999,9,0],[20028,10,0],[20058,11,0],[20088,12,0],[20117,1,0],[20147,2,0],[20176,3,0],[20206,4,0],[20235,5,0],[20264,6,0],[20294,6,1],[20323,7,0],[20353,8,0],[20382,9,0],[20412,10,0],[20442,11,0],[20472,12,0],[20501,1,0],[20531,2,0],[20560,3,0],[20590,4,0],[20619,5,0],[20648,6,0],[20678,7,0],[20707,8,0],[20736,9,0],[20766,10,0],[20796,11,0],[20826,12,0],[20855,1,0],[20885,2,0],[20915,3,0],[20944,4,0],[20974,5,0],[21003,6,0],[21032,7,0],[21062,8,0],[21091,9,0],[21120,10,0],[21150,11,0],[21180,12,0],[21209,1,0],[21239,2,0],[21269,3,0],[21299,4,0],[21328,5,0],[21358,5,1],[21387,6,0],[21416,7,0],[21446,8,0],[21475,9,0],[21504,10,0],[21534,11,0],[21564,12,0],[21593,1,0],[21623,2,0],[21653,3,0],[21682,4,0],[21712,5,0],[21741,6,0],[21771,7,0],[21800,8,0],[21830,9,0],[21859,10,0],[21888,11,0],[21918,12,0],[21948,1,0],[21977,2,0],[22007,3,0],[22036,4,0],[22066,5,0],[22096,6,0],[22125,7,0],[22155,8,0],[22184,9,0],[22214,10,0],[22243,11,0],[22273,12,0],[22302,1,0],[22331,2,0],[22361,3,0],[22391,3,1],[22420,4,0],[22450,5,0],[22479,6,0],[22509,7,0],[22539,8,0],[22568,9,0],[22598,10,0],[22627,11,0],[22657,12,0],[22686,1,0],[22716,2,0],[22745,3,0],[22774,4,0],[22804,5,0],[22833,6,0],[22863,7,0],[22893,8,0],[22922,9,0],[22952,10,0],[22982,11,0],[23011,12,0],[23041,1,0],[23070,2,0],[23100,3,0],[23129,4,0],[23158,5,0],[23188,6,0],[23217,7,0],[23247,8,0],[23276,9,0],[23306,10,0],[23336,11,0],[23366,11,1],[23395,12,0],[23425,1,0],[23454,2,0],[23484,3,0],[23513,4,0],[23542,5,0],[23572,6,0],[23601,7,0],[23631,8,0],[23660,9,0],[23690,10,0],[23720,11,0],[23749,12,0],[23779,1,0],[23809,2,0],[23838,3,0],[23868,4,0],[23897,5,0],[23926,6,0],[23956,7,0],[23985,8,0],[24014,9,0],[24044,10,0],[24074,11,0],[24103,12,0],[24133,1,0],[24163,2,0],[24193,3,0],[24222,4,0],[24252,5,0],[24281,6,0],[24310,6,1],[24340,7,0],[24369,8,0],[24398,9,0],[24428,10,0],[24457,11,0],[24487,12,0],[24517,1,0],[24547,2,0],[24577,3,0],[24606,4,0],[24636,5,0],[24665,6,0],[24694,7,0],[24724,8,0],[24753,9,0],[24782,10,0],[24812,11,0],[24841,12,0],[24871,1,0],[24901,2,0],[24931,3,0],[24960,4,0],[24990,5,0],[25019,6,0],[25049,7,0],[25078,8,0],[25108,9,0],[25137,10,0],[25166,11,0],[25196,12,0],[25225,1,0],[25255,2,0],[25285,3,0],[25314,4,0],[25344,5,0],[25374,5,1],[25403,6,0],[25433,7,0],[25462,8,0],[25492,9,0],[25521,10,0],[25551,11,0],[25580,12,0],[25609,1,0],[25639,2,0],[25668,3,0],[25698,4,0],[25728,5,0],[25757,6,0],[25787,7,0],[25816,8,0],[25846,9,0],[25876,10,0],[25905,11,0],[25935,12,0],[25964,1,0],[25993,2,0],[26023,3,0],[26052,4,0],[26082,5,0],[26111,6,0],[26141,7,0],[26171,8,0],[26200,9,0],[26230,10,0],[26260,11,0],[26289,12,0],[26319,1,0],[26348,2,0],[26378,2,1],[26407,3,0],[26436,4,0],[26466,5,0],[26495,6,0],[26525,7,0],[26554,8,0],[26584,9,0],[26614,10,0],[26643,11,0],[26673,12,0],[26703,1,0],[26732,2,0],[26762,3,0],[26791,4,0],[26820,5,0],[26850,6,0],[26879,7,0],[26908,8,0],[26938,9,0],[26968,10,0],[26997,11,0],[27027,12,0],[27057,1,0],[27087,2,0],[27116,3,0],[27146,4,0],[27175,5,0],[27204,6,0],[27234,7,0],[27263,7,1],[27292,8,0],[27322,9,0],[27351,10,0],[27381,11,0],[27411,12,0],[27441,1,0],[27471,2,0],[27500,3,0],[27530,4,0],[27559,5,0],[27588,6,0],[27618,7,0],[27647,8,0],[27676,9,0],[27706,10,0],[27735,11,0],[27765,12,0],[27795,1,0],[27825,2,0],[27854,3,0],[27884,4,0],[27913,5,0],[27943,6,0],[27972,7,0],[28002,8,0],[28031,9,0],[28060,10,0],[28090,11,0],[28119,12,0],[28149,1,0],[28179,2,0],[28208,3,0],[28238,4,0],[28268,5,0],[28297,5,1],[28327,6,0],[28356,7,0],[28386,8,0],[28415,9,0],[28444,10,0],[28474,11,0],[28503,12,0],[28533,1,0],[28562,2,0],[28592,3,0],[28622,4,0],[28651,5,0],[28681,6,0],[28711,7,0],[28740,8,0],[28770,9,0],[28799,10,0],[28828,11,0],[28858,12,0],[28887,1,0],[28917,2,0],[28946,3,0],[28976,4,0],[29005,5,0],[29035,6,0],[29065,7,0],[29094,8,0],[29124,9,0],[29154,10,0],[29183,11,0],[29213,12,0],[29242,1,0],[29271,2,0],[29301,3,0],[29330,3,1],[29360,4,0],[29389,5,0],[29419,6,0],[29448,7,0],[29478,8,0],[29508,9,0],[29537,10,0],[29567,11,0],[29597,12,0],[29626,1,0],[29656,2,0],[29685,3,0],[29714,4,0],[29744,5,0],[29773,6,0],[29802,7,0],[29832,8,0],[29862,9,0],[29891,10,0],[29921,11,0],[29951,12,0],[29981,1,0],[30010,2,0],[30040,3,0],[30069,4,0],[30098,5,0],[30128,6,0],[30157,7,0],[30186,8,0],[30216,8,1],[30245,9,0],[30275,10,0],[30305,11,0],[30335,12,0],[30365,1,0],[30394,2,0],[30424,3,0],[30453,4,0],[30482,5,0],[30512,6,0],[30541,7,0],[30570,8,0],[30600,9,0],[30629,10,0],[30659,11,0],[30689,12,0],[30719,1,0],[30748,2,0],[30778,3,0],[30808,4,0],[30837,5,0],[30866,6,0],[30896,7,0],[30925,8,0],[30954,9,0],[30984,10,0],[31013,11,0],[31043,12,0],[31073,1,0],[31102,2,0],[31132,3,0],[31162,4,0],[31191,5,0],[31221,6,0],[31250,6,1],[31280,7,0],[31309,8,0],[31338,9,0],[31368,10,0],[31397,11,0],[31427,12,0],[31456,1,0],[31486,2,0],[31516,3,0],[31546,4,0],[31575,5,0],[31605,6,0],[31634,7,0],[31664,8,0],[31693,9,0],[31722,10,0],[31752,11,0],[31781,12,0],[31811,1,0],[31840,2,0],[31870,3,0],[31900,4,0],[31929,5,0],[31959,6,0],[31988,7,0],[32018,8,0],[32047,9,0],[32077,10,0],[32106,11,0],[32136,12,0],[32165,1,0],[32195,2,0],[32224,3,0],[32254,4,0],[32283,4,1],[32313,5,0],[32342,6,0],[32372,7,0],[32402,8,0],[32431,9,0],[32461,10,0],[32491,11,0],[32520,12,0],[32549,1,0],[32579,2,0],[32608,3,0],[32638,4,0],[32667,5,0],[32697,6,0],[32726,7,0],[32756,8,0],[32785,9,0],[32815,10,0],[32845,11,0],[32875,12,0],[32904,1,0],[32934,2,0],[32963,3,0],[32992,4,0],[33022,5,0],[33051,6,0],[33080,7,0],[33110,8,0],[33139,9,0],[33169,10,0],[33199,11,0],[33229,12,0],[33258,1,0],[33288,2,0],[33318,3,0],[33347,3,1],[33376,4,0],[33406,5,0],[33435,6,0],[33464,7,0],[33494,8,0],[33523,9,0],[33553,10,0],[33583,11,0],[33613,12,0],[33642,1,0],[33672,2,0],[33702,3,0],[33731,4,0],[33760,5,0],[33790,6,0],[33819,7,0],[33848,8,0],[33878,9,0],[33907,10,0],[33937,11,0],[33967,12,0],[33996,1,0],[34026,2,0],[34056,3,0],[34085,4,0],[34115,5,0],[34144,6,0],[34174,7,0],[34203,7,1],[34232,8,0],[34262,9,0],[34291,10,0],[34321,11,0],[34350,12,0],[34380,1,0],[34410,2,0],[34440,3,0],[34469,4,0],[34499,5,0],[34528,6,0],[34558,7,0],[34587,8,0],[34616,9,0],[34646,10,0],[34675,11,0],[34705,12,0],[34734,1,0],[34764,2,0],[34794,3,0],[34823,4,0],[34853,5,0],[34883,6,0],[34912,7,0],[34942,8,0],[34971,9,0],[35000,10,0],[35030,11,0],[35059,12,0],[35089,1,0],[35118,2,0],[35148,3,0],[35177,4,0],[35207,5,0],[35237,5,1],[35266,6,0],[35296,7,0],[35325,8,0],[35355,9,0],[35384,10,0],[35414,11,0],[35443,12,0],[35473,1,0],[35502,2,0],[35532,3,0],[35561,4,0],[35591,5,0],[35620,6,0],[35650,7,0],[35680,8,0],[35709,9,0],[35739,10,0],[35768,11,0],[35798,12,0],[35827,1,0],[35857,2,0],[35886,3,0],[35916,4,0],[35945,5,0],[35974,6,0],[36004,7,0],[36034,8,0],[36063,9,0],[36093,10,0],[36123,11,0],[36152,12,0],[36182,1,0],[36211,2,0],[36241,3,0],[36270,4,0],[36300,4,1],[36329,5,0],[36358,6,0],[36388,7,0],[36417,8,0],[36447,9,0],[36477,10,0],[36507,11,0],[36536,12,0],[36566,1,0],[36595,2,0],[36625,3,0],[36654,4,0],[36684,5,0],[36713,6,0],[36742,7,0],[36772,8,0],[36801,9,0],[36831,10,0],[36861,11,0],[36890,12,0],[36920,1,0],[36950,2,0],[36979,3,0],[37009,4,0],[37038,5,0],[37068,6,0],[37097,7,0],[37126,8,0],[37156,8,1],[37185,9,0],[37215,10,0],[37244,11,0],[37274,12,0],[37304,1,0],[37334,2,0],[37363,3,0],[37393,4,0],[37422,5,0],[37452,6,0],[37481,7,0],[37510,8,0],[37540,9,0],[37569,10,0],[37599,11,0],[37628,12,0],[37658,1,0],[37688,2,0],[37717,3,0],[37747,4,0],[37777,5,0],[37806,6,0],[37836,7,0],[37865,8,0],[37894,9,0],[37924,10,0],[37953,11,0],[37983,12,0],[38012,1,0],[38042,2,0],[38071,3,0],[38101,4,0],[38131,5,0],[38160,6,0],[38190,6,1],[38219,7,0],[38249,8,0],[38278,9,0],[38308,10,0],[38337,11,0],[38367,12,0],[38396,1,0],[38426,2,0],[38455,3,0],[38485,4,0],[38514,5,0],[38544,6,0],[38574,7,0],[38603,8,0],[38633,9,0],[38662,10,0],[38692,11,0],[38721,12,0],[38751,1,0],[38780,2,0],[38810,3,0],[38839,4,0],[38869,5,0],[38898,6,0],[38928,7,0],[38957,8,0],[38987,9,0],[39017,10,0],[39046,11,0],[39076,12,0],[39105,1,0],[39135,2,0],[39164,3,0],[39194,4,0],[39223,4,1],[39252,5,0]];
const TERMS={"2026-01-05":"小寒","2026-01-20":"大寒","2026-02-04":"立春","2026-02-19":"雨水","2026-03-05":"惊蛰","2026-03-20":"春分","2026-04-05":"清明","2026-04-20":"谷雨","2026-05-05":"立夏","2026-05-21":"小满","2026-06-05":"芒种","2026-06-21":"夏至","2026-07-07":"小暑","2026-07-23":"大暑","2026-08-07":"立秋","2026-08-23":"处暑","2026-09-07":"白露","2026-09-23":"秋分","2026-10-08":"寒露","2026-10-23":"霜降","2026-11-07":"立冬","2026-11-22":"小雪","2026-12-07":"大雪","2026-12-22":"冬至","2027-01-05":"小寒","2027-01-20":"大寒","2027-02-04":"立春","2027-02-19":"雨水","2027-03-06":"惊蛰","2027-03-21":"春分","2027-04-05":"清明","2027-04-20":"谷雨","2027-05-06":"立夏","2027-05-21":"小满","2027-06-06":"芒种","2027-06-21":"夏至","2027-07-07":"小暑","2027-07-23":"大暑","2027-08-08":"立秋","2027-08-23":"处暑","2027-09-08":"白露","2027-09-23":"秋分","2027-10-08":"寒露","2027-10-23":"霜降","2027-11-07":"立冬","2027-11-22":"小雪","2027-12-07":"大雪","2027-12-22":"冬至","2028-01-06":"小寒","2028-01-20":"大寒","2028-02-04":"立春","2028-02-19":"雨水","2028-03-06":"惊蛰","2028-03-21":"春分","2028-04-05":"清明","2028-04-20":"谷雨","2028-05-06":"立夏","2028-05-21":"小满","2028-06-06":"芒种","2028-06-22":"夏至","2028-07-07":"小暑","2028-07-23":"大暑","2028-08-08":"立秋","2028-08-23":"处暑","2028-09-08":"白露","2028-09-23":"秋分","2028-10-09":"寒露","2028-10-24":"霜降","2028-11-08":"立冬","2028-11-23":"小雪","2028-12-07":"大雪","2028-12-22":"冬至","2029-01-05":"小寒","2029-01-20":"大寒","2029-02-03":"立春","2029-02-18":"雨水","2029-03-05":"惊蛰","2029-03-20":"春分","2029-04-04":"清明","2029-04-20":"谷雨","2029-05-05":"立夏","2029-05-21":"小满","2029-06-05":"芒种","2029-06-21":"夏至","2029-07-07":"小暑","2029-07-22":"大暑","2029-08-07":"立秋","2029-08-23":"处暑","2029-09-07":"白露","2029-09-23":"秋分","2029-10-08":"寒露","2029-10-23":"霜降","2029-11-07":"立冬","2029-11-22":"小雪","2029-12-07":"大雪","2029-12-21":"冬至","2030-01-05":"小寒","2030-01-20":"大寒","2030-02-04":"立春","2030-02-18":"雨水","2030-03-05":"惊蛰","2030-03-20":"春分","2030-04-05":"清明","2030-04-20":"谷雨","2030-05-05":"立夏","2030-05-21":"小满","2030-06-05":"芒种","2030-06-21":"夏至","2030-07-07":"小暑","2030-07-23":"大暑","2030-08-07":"立秋","2030-08-23":"处暑","2030-09-07":"白露","2030-09-23":"秋分","2030-10-08":"寒露","2030-10-23":"霜降","2030-11-07":"立冬","2030-11-22":"小雪","2030-12-07":"大雪","2030-12-22":"冬至","2031-01-05":"小寒","2031-01-20":"大寒","2031-02-04":"立春","2031-02-19":"雨水","2031-03-06":"惊蛰","2031-03-21":"春分","2031-04-05":"清明","2031-04-20":"谷雨","2031-05-06":"立夏","2031-05-21":"小满","2031-06-06":"芒种","2031-06-21":"夏至","2031-07-07":"小暑","2031-07-23":"大暑","2031-08-08":"立秋","2031-08-23":"处暑","2031-09-08":"白露","2031-09-23":"秋分","2031-10-08":"寒露","2031-10-23":"霜降","2031-11-07":"立冬","2031-11-22":"小雪","2031-12-07":"大雪","2031-12-22":"冬至","2032-01-06":"小寒","2032-01-20":"大寒","2032-02-04":"立春","2032-02-19":"雨水","2032-03-06":"惊蛰","2032-03-21":"春分","2032-04-05":"清明","2032-04-20":"谷雨","2032-05-06":"立夏","2032-05-21":"小满","2032-06-06":"芒种","2032-06-22":"夏至","2032-07-07":"小暑","2032-07-23":"大暑","2032-08-08":"立秋","2032-08-23":"处暑","2032-09-08":"白露","2032-09-23":"秋分","2032-10-09":"寒露","2032-10-24":"霜降","2032-11-08":"立冬","2032-11-23":"小雪","2032-12-07":"大雪","2032-12-22":"冬至","2033-01-05":"小寒","2033-01-20":"大寒","2033-02-03":"立春","2033-02-18":"雨水","2033-03-05":"惊蛰","2033-03-20":"春分","2033-04-04":"清明","2033-04-20":"谷雨","2033-05-05":"立夏","2033-05-21":"小满","2033-06-05":"芒种","2033-06-21":"夏至","2033-07-07":"小暑","2033-07-22":"大暑","2033-08-07":"立秋","2033-08-23":"处暑","2033-09-07":"白露","2033-09-23":"秋分","2033-10-08":"寒露","2033-10-23":"霜降","2033-11-07":"立冬","2033-11-22":"小雪","2033-12-07":"大雪","2033-12-21":"冬至","2034-01-05":"小寒","2034-01-20":"大寒","2034-02-04":"立春","2034-02-18":"雨水","2034-03-05":"惊蛰","2034-03-20":"春分","2034-04-05":"清明","2034-04-20":"谷雨","2034-05-05":"立夏","2034-05-21":"小满","2034-06-05":"芒种","2034-06-21":"夏至","2034-07-07":"小暑","2034-07-23":"大暑","2034-08-07":"立秋","2034-08-23":"处暑","2034-09-07":"白露","2034-09-23":"秋分","2034-10-08":"寒露","2034-10-23":"霜降","2034-11-07":"立冬","2034-11-22":"小雪","2034-12-07":"大雪","2034-12-22":"冬至","2035-01-05":"小寒","2035-01-20":"大寒","2035-02-04":"立春","2035-02-19":"雨水","2035-03-06":"惊蛰","2035-03-21":"春分","2035-04-05":"清明","2035-04-20":"谷雨","2035-05-05":"立夏","2035-05-21":"小满","2035-06-06":"芒种","2035-06-21":"夏至","2035-07-07":"小暑","2035-07-23":"大暑","2035-08-07":"立秋","2035-08-23":"处暑","2035-09-08":"白露","2035-09-23":"秋分","2035-10-08":"寒露","2035-10-23":"霜降","2035-11-07":"立冬","2035-11-22":"小雪","2035-12-07":"大雪","2035-12-22":"冬至","2036-01-06":"小寒","2036-01-20":"大寒","2036-02-04":"立春","2036-02-19":"雨水","2036-03-06":"惊蛰","2036-03-21":"春分","2036-04-05":"清明","2036-04-20":"谷雨","2036-05-06":"立夏","2036-05-21":"小满","2036-06-06":"芒种","2036-06-22":"夏至","2036-07-07":"小暑","2036-07-23":"大暑","2036-08-08":"立秋","2036-08-23":"处暑","2036-09-08":"白露","2036-09-23":"秋分","2036-10-09":"寒露","2036-10-24":"霜降","2036-11-08":"立冬","2036-11-23":"小雪","2036-12-07":"大雪","2036-12-22":"冬至","2037-01-05":"小寒","2037-01-20":"大寒","2037-02-03":"立春","2037-02-18":"雨水","2037-03-05":"惊蛰","2037-03-20":"春分","2037-04-04":"清明","2037-04-20":"谷雨","2037-05-05":"立夏","2037-05-21":"小满","2037-06-05":"芒种","2037-06-21":"夏至","2037-07-07":"小暑","2037-07-22":"大暑","2037-08-07":"立秋","2037-08-23":"处暑","2037-09-07":"白露","2037-09-23":"秋分","2037-10-08":"寒露","2037-10-23":"霜降","2037-11-07":"立冬","2037-11-22":"小雪","2037-12-07":"大雪","2037-12-21":"冬至","2038-01-05":"小寒","2038-01-20":"大寒","2038-02-04":"立春","2038-02-18":"雨水","2038-03-05":"惊蛰","2038-03-20":"春分","2038-04-05":"清明","2038-04-20":"谷雨","2038-05-05":"立夏","2038-05-21":"小满","2038-06-05":"芒种","2038-06-21":"夏至","2038-07-07":"小暑","2038-07-23":"大暑","2038-08-07":"立秋","2038-08-23":"处暑","2038-09-07":"白露","2038-09-23":"秋分","2038-10-08":"寒露","2038-10-23":"霜降","2038-11-07":"立冬","2038-11-22":"小雪","2038-12-07":"大雪","2038-12-22":"冬至","2039-01-05":"小寒","2039-01-20":"大寒","2039-02-04":"立春","2039-02-19":"雨水","2039-03-06":"惊蛰","2039-03-21":"春分","2039-04-05":"清明","2039-04-20":"谷雨","2039-05-05":"立夏","2039-05-21":"小满","2039-06-06":"芒种","2039-06-21":"夏至","2039-07-07":"小暑","2039-07-23":"大暑","2039-08-07":"立秋","2039-08-23":"处暑","2039-09-08":"白露","2039-09-23":"秋分","2039-10-08":"寒露","2039-10-23":"霜降","2039-11-07":"立冬","2039-11-22":"小雪","2039-12-07":"大雪","2039-12-22":"冬至","2040-01-06":"小寒","2040-01-20":"大寒","2040-02-04":"立春","2040-02-19":"雨水","2040-03-06":"惊蛰","2040-03-21":"春分","2040-04-05":"清明","2040-04-20":"谷雨","2040-05-06":"立夏","2040-05-21":"小满","2040-06-06":"芒种","2040-06-22":"夏至","2040-07-07":"小暑","2040-07-23":"大暑","2040-08-08":"立秋","2040-08-23":"处暑","2040-09-08":"白露","2040-09-23":"秋分","2040-10-09":"寒露","2040-10-24":"霜降","2040-11-08":"立冬","2040-11-23":"小雪","2040-12-07":"大雪","2040-12-22":"冬至"};
const CN_MN = ['正','二','三','四','五','六','七','八','九','十','冬','腊'];
function cnLunarDay(n){
  if(n <= 10) return '初' + '一二三四五六七八九十'[n - 1];
  if(n < 20) return '十' + '一二三四五六七八九十'[n - 11];
  if(n === 20) return '二十';
  if(n < 30) return '廿' + '一二三四五六七八九十'[n - 21];
  return '三十';
}
function lunarInfo(k){
  try{
    const p = k.split('-');
    const n = Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
    let lo = 0, hi = LM.length - 1, i = -1;
    while(lo <= hi){ const mid = (lo + hi) >> 1; if(LM[mid][0] <= n){ i = mid; lo = mid + 1 } else hi = mid - 1 }
    if(i < 0) return null;
    const m = LM[i][1], leap = LM[i][2], day = n - LM[i][0] + 1;
    if(day < 1 || day > 31) return null;
    return { mn: (leap ? '闰' : '') + CN_MN[m - 1] + '月', dl: cnLunarDay(day) };
  }catch(e){ return null }
}
function lunarCellText(k){
  if(TERMS[k]) return TERMS[k];
  const li = lunarInfo(k);
  return li ? li.dl : '';
}
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
    '<button class="tb-action" data-act="calBack">← 返回</button>' +
    '<div style="font-weight:600">' + y + ' 年 ' + (m + 1) + ' 月</div>' +
    '<div style="display:flex;gap:8px"><button class="tb-action" data-act="calPrev">上月</button><button class="tb-action" data-act="calNext">下月</button></div></div><div class="cal-grid">';
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
      (hl ? '<span class="cd-hol">' + hl + '</span>' : (lunarCellText(k) ? '<span class="cd-lun' + (TERMS[k] ? ' cd-term' : '') + '">' + lunarCellText(k) + '</span>' : '')) +
      (amt ? '<span class="cd-amt">' + Math.round(amt) + '</span>' : '') +
      (mark ? '<span class="cd-dot"></span>' : '') +
      '</button>';
  }
  html += '</div><div class="cal-legend"><span class="lg hol">红=节假日</span><span class="lg work">灰=补班</span><span class="lg mark">●=有日程</span><span class="lg lun">灰字=农历 · 绿字=节气</span></div></div>';
  const sel = window._calDay;
  if(sel){
    const list = S.tx().filter(t => ymd(t.date) === sel).sort((a, b) => b.createdAt - a.createdAt);
    const notes = S.note();
    const noteVal = notes[sel] || '';
    const sch = daySchedules(sel);
    const hn = holidayName(sel);
    const li = lunarInfo(sel);
    const term = TERMS[sel];
    html += '<div class="card"><h3 class="card-title">' + sel + (hn ? ' · ' + hn : '') + '</h3>' +
      (li ? '<div class="cal-lunar-line">农历 ' + li.mn + ' ' + li.dl + (term ? ' · 今日 ' + term : '') + '</div>' : '');
    html += '<div class="field"><div class="row between" style="margin-bottom:6px"><label style="margin:0">日汇记 / 便签</label><button class="tb-action" data-act="noteRemind" data-id="' + sel + '">定时提醒</button></div><textarea class="input" id="dayNote" data-id="' + sel + '" placeholder="记点今天的碎碎念、待办、感想…">' + esc(noteVal) + '</textarea></div>';
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
        const c = await compressImage(f, 1280, 0.6);
        files.push(c);
      }
    }
  }catch(e){}
  await processImages(files);
}

/* 识别单张：失败自动重试；命中 429 限流时按接近冷却时长长退避（免费档冷却约 1 分钟） */
async function recognizeOne(j, attempt){
  attempt = attempt || 0;
  try{
    const r = await req('/functions/v1/ai-accounting', { method: 'POST', timeout: 90000, body: { mode: 'recognize', image: j.compUrl } });
    return r;
  }catch(e){
    const code = e.code || 0;
    if(code === 429 && attempt < 5){ await sleep(8000 * Math.pow(1.8, attempt)); return recognizeOne(j, attempt + 1) } // 8s,15s,28s,50s,90s
    if(attempt < 2){ await sleep(1200); return recognizeOne(j, attempt + 1) }
    return null;
  }
}
/* 识别队列：串行处理（避开免费档并发限流 429），每张间隔，部分失败不影响其它 */
async function runRecognizeQueue(files){
  const out = new Array(files.length).fill(null);
  const failed = [];
  let done = 0;
  const stat = function(){
    const el = document.getElementById('recStat');
    if(el) el.textContent = '正在识别 ' + done + ' / ' + files.length + ' 张…' + (done < files.length ? '（已识别请稍候）' : '');
  };
  stat();
  for(let my = 0; my < files.length; my++){
    const r = await recognizeOne(files[my]);
    if(r && Array.isArray(r.items)){ out[my] = r.items; }
    else { out[my] = []; if(r === null) failed.push(my); }
    done++; stat();
    if(my < files.length - 1) await sleep(1500); // 间隔，进一步避开连发限流
  }
  return { out: out, failed: failed };
}

async function processImages(files){
  if(!files || !files.length){ toast('未选择图片'); return }
  openSheet('AI 识别中', '<div style="padding:16px 0;text-align:center"><span class="spinner"></span><br><span id="recStat">准备识别 ' + files.length + ' 张…</span></div>');
  try{
    await login();
    const res = await runRecognizeQueue(files);
    const results = res.out, failed = res.failed;
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
    if(!items.length){
      const msg = (failed.length === files.length)
        ? '识别失败：云端限流或暂时不可用（免费档并发受限）。建议一次少选几张，或稍等 1 分钟再试。'
        : '没识别出条目，可手动记一笔（或换张清晰点的图）';
      throw new Error(msg);
    }
    window._aiItems = items;
    const warn = failed.length
      ? '<p class="small warn" style="margin:6px 0 10px">有 ' + failed.length + ' 张识别失败（可能限流），可稍后单独重选这几张重试，其余已正常识别。</p>'
      : '';
    openSheet('识别结果（可修改）',
      '<p class="small muted" style="margin-bottom:8px">已识别 ' + items.length + ' 笔，可逐条修改后保存。点击图片可查看原图。</p>' +
      warn +
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
    if(r && r.image){ applyBgImg(await compressDataUrl(r.image, 800, 0.65)); toast('已用 Agnes 生成背景'); if(doClose) closeSheet(); return }
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
  const all = S.chat();
  if(!all.length){
    box.innerHTML = '<div class="chat-welcome">我是小账，你的记账搭子 💬<br>可以问我：这个月花了多少？怎么省钱？帮我算笔账～' +
      '<div class="chat-welcome-sub">我说过的话都会沉淀成长期记忆；聊多了旧的会自动压缩成摘要，重要的则永久记住。上面的「查找」可以翻历史，「记忆」能看到我记住了什么。</div></div>';
    return;
  }
  const start = Math.max(0, all.length - CHAT.limit);
  const show = all.slice(start);
  let html = '';
  if(start > 0){
    html += '<div class="chat-more"><button class="chat-more-btn" data-act="chatMore">往下滑之前先加载更早的 ' + start + ' 条</button></div>';
  }
  html += show.map(function(m, idx){
    const img = m.img ? '<div class="chat-img-wrap"><img class="chat-img-thumb" src="' + m.img + '" alt="图片"></div>'
      : (m.imgGone ? '<div class="chat-img-gone">🖼️ 图片（已随旧对话压缩归档）</div>' : '');
    return '<div class="chat-msg ' + m.role + '" data-mi="' + (start + idx) + '">' +
      '<div class="bubble">' + img + mdLite(m.text) + '</div></div>';
  }).join('');
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}

/* ================= 历史记忆查找 ================= */
function memToggleSearch(){
  const bar = document.getElementById('chatSearch');
  if(!bar) return;
  if(bar.classList.contains('hidden')){
    bar.classList.remove('hidden');
    const i = document.getElementById('chatSearchInput');
    if(i){ i.focus(); if(CHAT.q) memRunSearch(CHAT.q); }
  } else { memCloseSearch() }
}
function memCloseSearch(){
  const bar = document.getElementById('chatSearch');
  if(bar) bar.classList.add('hidden');
  CHAT.q = ''; CHAT.hits = []; CHAT.hi = -1;
  const inp = document.getElementById('chatSearchInput'); if(inp) inp.value = '';
  const cnt = document.getElementById('chatSearchCnt'); if(cnt) cnt.textContent = '';
  const box = document.getElementById('chatBox');
  if(box) box.querySelectorAll('.chat-msg.is-hit').forEach(el => el.classList.remove('is-hit'));
}
function memSearchInput(){
  const inp = document.getElementById('chatSearchInput');
  const q = (inp && inp.value || '').trim();
  CHAT.q = q;
  memRunSearch(q);
}
function memRunSearch(q){
  const cnt = document.getElementById('chatSearchCnt');
  const box = document.getElementById('chatBox');
  if(!box) return;
  box.querySelectorAll('.chat-msg.is-hit').forEach(el => el.classList.remove('is-hit'));
  CHAT.hits = []; CHAT.hi = -1;
  if(!q || q.length < 1){
    if(cnt) cnt.textContent = '';
    return;
  }
  const all = S.chat();
  const low = q.toLowerCase();
  all.forEach(function(m, i){ if(String(m.text || '').toLowerCase().indexOf(low) >= 0) CHAT.hits.push(i) });
  if(!CHAT.hits.length){
    if(cnt) cnt.textContent = '没找到';
    toast('历史里没有「' + q + '」');
    return;
  }
  // 命中的可能比当前渲染的还早，自动放开条数
  const need = all.length - CHAT.hits[0];
  if(need > CHAT.limit) CHAT.limit = Math.min(need + 50, CHAT_MAX);
  renderChat();
  if(cnt) cnt.textContent = '共 ' + CHAT.hits.length + ' 条';
  CHAT.hi = -1;
  memGo(1);
}
function memGo(d){
  if(!CHAT.hits.length) return;
  CHAT.hi = (CHAT.hi + d + CHAT.hits.length) % CHAT.hits.length;
  const mi = CHAT.hits[CHAT.hi];
  const box = document.getElementById('chatBox');
  if(!box) return;
  box.querySelectorAll('.chat-msg.is-hit').forEach(el => el.classList.remove('is-hit'));
  let el = box.querySelector('[data-mi="' + mi + '"]');
  if(!el){ CHAT.limit = CHAT_MAX; renderChat(); el = box.querySelector('[data-mi="' + mi + '"]') }
  if(el){
    el.classList.add('is-hit');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const cnt = document.getElementById('chatSearchCnt');
  if(cnt) cnt.textContent = (CHAT.hi + 1) + ' / ' + CHAT.hits.length;
}
function chatMoreBtn(){
  const box = document.getElementById('chatBox');
  const before = box ? box.scrollHeight : 0;
  CHAT.limit = Math.min(CHAT.limit + 300, CHAT_MAX);
  renderChat();
  if(box){ box.scrollTop = box.scrollHeight - before; }
}

/* ================= 记忆仓库查看 ================= */
function memView(){
  const m = getMem();
  const facts = m.facts.slice().sort((a, b) => b.ts - a.ts);
  const sums = m.sums.slice().sort((a, b) => b.ts - a.ts);
  let html = '<div class="mem-card"><div class="mem-h">永久记住的事实（' + facts.length + '）</div>';
  html += facts.length ? facts.map(function(f){
    return '<div class="mem-row"><div class="mem-kv"><b>' + esc(f.k) + '</b><span>' + esc(f.v) + '</span></div>' +
      '<button class="mem-del" data-act="memDelFact" data-id="' + f.id + '">删</button></div>';
  }).join('') : '<div class="mem-empty">还没有。你可以说「我叫小王」「房租每月 3200」「我对芒果过敏」，这些会自动记住。</div>';
  html += '</div>';
  html += '<div class="mem-card"><div class="mem-h">压缩沉淀的历史摘要（' + sums.length + '）</div>';
  html += sums.length ? sums.map(function(s){
    const day = s.to ? ymd(s.to) : '';
    return '<div class="mem-row col"><div class="mem-sum">' + esc(s.text) + '</div>' +
      '<div class="mem-foot"><span>' + day + '</span><button class="mem-del" data-act="memDelSum" data-id="' + s.id + '">删</button></div></div>';
  }).join('') : '<div class="mem-empty">聊够 ' + COMPACT_GAP + ' 条以上，旧对话会自动压成摘要留在这里。</div>';
  html += '</div>';
  html += '<div class="mem-tip">这些会在你每次问小账时自动带上，所以它不像"第一次聊天"。不需要的点右边删掉。</div>';
  openSheet('小账记住了什么', html);
}
function memDelFact(id){
  const m = getMem();
  m.facts = m.facts.filter(x => x.id !== id);
  S.saveMem(m); memView(); toast('已经忘掉');
}
function memDelSum(id){
  const m = getMem();
  m.sums = m.sums.filter(x => x.id !== id);
  S.saveMem(m); memView(); toast('已删除');
}
async function sendChat(){
  if(CHAT.busy) return;
  const inp = document.getElementById('chatInput');
  const text = (inp && inp.value || '').trim();
  const img = CHAT.pendingImg || null;
  if(!text && !img) return;
  inp.value = '';
  CHAT.pendingImg = null;
  const nnew = memAbsorb(text);            // 抠出值得永久记住的要素
  chatPush('user', text || '（发了一张图片）', img);
  if(nnew) toast('记住了 ' + nnew + ' 条要点');
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
    const ctx = buildContext();
    const MEMHEAD = ctx.head;
    const hist = ctx.recent.slice(0, -1);   // 组装好的上下文（最近原文），去掉刚发的这一条
    const lastText = text || '（发了一张图片）';
    let reply = null;
    let imgText = '';
    if(img){
      // 先用识图把图中文字/账单读出来（兼容旧后端也能“读图”）
      try{
        const rr = await req('/functions/v1/ai-accounting', { method:'POST', timeout:60000, body:{ mode:'recognize', image: img } });
        if(rr && rr.items && rr.items.length){
          imgText = rr.items.map(function(it){ return (it.amount ? ('¥' + it.amount + ' ') : '') + (it.category || '') + (it.note ? (' ' + it.note) : '') }).join('\n');
        }
      }catch(e){ /* 忽略识别失败 */ }
      const augText = MEMHEAD + (imgText ? '【图片中识别到的内容】\n' + imgText + '\n\n' : '') + lastText;
      // 优先让后端多模态“看”图（agent/image 模式，需要部署后端）
      try{
        const r = await req('/functions/v1/ai-accounting', { method:'POST', timeout:60000, body:{ mode:'agent', text: augText, history: hist, image: img } });
        if(r && r.text) reply = r.text;
      }catch(e){ /* 未部署多模态，下面兜底 */ }
      if(!reply){
        try{
          const r = await req('/functions/v1/ai-accounting', { method:'POST', timeout:60000, body:{ mode:'analyze', text: augText, history: hist } });
          if(r && r.text) reply = r.text;
        }catch(e){}
      }
      // 图片既没被“看”到、也没识别出文字：诚实说明，不假装看见
      if(!reply && !imgText){
        reply = '我收到图片啦～不过目前我只能识别图片里的文字、小票、账单这类内容，还看不到画面本身（比如景物、人物）。' +
          '想让我真正“看图”，需要开启云端图像能力（后端已写好，部署即可）。' +
          (lastText && lastText !== '（发了一张图片）' ? '你写的「' + lastText + '」我收到了，可以再描述一下图片内容，我帮你分析～' : '你可以告诉我图片里是什么，我帮你分析～');
      }
    } else {
      // 纯文本：优先 agent，未部署则 analyze 兜底
      try{
        const r = await req('/functions/v1/ai-accounting', { method:'POST', timeout:60000, body:{ mode:'agent', text: MEMHEAD + lastText, history: hist } });
        if(r && r.text) reply = r.text;
      }catch(e){}
      if(!reply){
        const prompt = MEMHEAD + '你是记账 App「暖记」的 AI 助手“小账”，也是百事通贴心小助理：可以聊记账省钱，也可以聊生活、健康、情感、出行、百科等任何话题，像朋友一样自然。' +
          '若用户要你执行操作（记账/计算/查账/生成背景），只输出一个 ```json 工具块 ```（{"tool":"add_tx|calc|query|gen_bg","args":{...}}），不要其它文字；其它情况用自然语言简洁友好回答（200 字内）。' +
          '分类id：餐饮food/外卖takeout/交通transport/加油fuel/购物shopping/居家home/房租rent/水电燃气utility/数码digital/通讯comm/娱乐fun/旅行travel/美容beauty/医疗medical/宠物pet/教育edu/运动sport/咖啡coffee/菜场超市market/人情social/保险insurance/订阅会员subscription/税费tax_fee/其他other_exp / 工资salary/奖金bonus/理财收益invest/兼职parttime/红包redpacket_in/分红dividend/退款refund/租金收入rental_in/零花钱allowance/其他收入other_inc。' +
          'calc 参数：discount{orig:原价,discount:折扣如8.5表85折} rise{old:原价,now:现价} installment{total:总额,periods:期数,rate:每期手续费率%}。query 参数：month_exp|month_inc|balance|today_exp|top_cat。金额自动转阿拉伯数字，直接执行不要反问。' +
          '对话历史：\n' + hist.map(function(m){ return (m.role === 'user' ? '用户' : '小账') + '：' + m.text }).join('\n') + '\n用户：' + lastText;
        const r = await req('/functions/v1/ai-accounting', { method:'POST', timeout:60000, body:{ mode:'analyze', text: prompt, history: hist } });
        reply = (r && r.text) || '（没收到回复）';
      }
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
  maybeCompact();          // 后台把攒够的旧对话压成摘要，不阻塞界面
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

/* ================= 便签 / 待办（每日任务 · 打钩完成度） =================
   每条：{id, title, note, date:'YYYY-MM-DD', remind:'HH:mm' 或 '', daily:bool,
          done:bool, doneAt:ms, doneDates:['YYYY-MM-DD'...], createdAt:ms}
   普通任务完成与否看 done；每日任务（daily）按 doneDates 记录“哪天打过钩”，每天独立。 */
function isDoneOn(t, d){
  return t.daily ? ((t.doneDates || []).indexOf(d) >= 0) : !!t.done;
}
function pct(a, b){ return b > 0 ? Math.round(a / b * 100) : 0 }

function viewNote(){
  const list = S.todo();
  const today = ymd(Date.now());
  const daily = list.filter(t => t.daily);
  const todayItems = list.filter(t => !t.daily && t.date === today && !t.done);
  const backlog = list.filter(t => !t.daily && !t.done && t.date < today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const total = daily.length + todayItems.length;
  const doneN = daily.filter(t => isDoneOn(t, today)).length + todayItems.filter(t => t.done).length;
  const p = pct(doneN, total);
  let doneAgo = list.filter(t => !t.daily && t.done && ymd(t.doneAt || t.createdAt) === today);

  let html = '<div class="card td-sum">' +
    '<div class="td-sum-top"><div><div class="td-sum-num">' + doneN + ' / ' + total + '</div>' +
    '<div class="td-sum-lab">今日任务完成度' + (daily.length ? '（含每日 ' + daily.length + ' 项）' : '') + '</div></div>' +
    '<div class="td-sum-pct">' + p + '%</div></div>' +
    '<div class="td-bar"><i style="width:' + p + '%"></i></div>' +
    '<div class="td-sum-foot"><span>还清 ' + (total - doneN) + ' 项</span>' +
    '<span>' + (p === 100 && total > 0 ? '今天全做完了，漂亮 🎉' : (total === 0 ? '还没派任务，点下面加一条' : '继续加油～')) + '</span></div>' +
    '</div>';

  html += '<div class="card td-group"><div class="td-ghead"><span class="dot daily"></span>每日任务' +
    '<button class="td-add" data-act="todoNew" data-id="daily">+ 加每日</button></div>';
  html += daily.length ? daily.map(t => todoRow(t, today)).join('')
    : '<div class="td-empty">每天都要做的事放这儿，比如记账、吃药、喝水打卡</div>';
  html += '</div>';

  html += '<div class="card td-group"><div class="td-ghead"><span class="dot today"></span>今天 · ' + today +
    '<button class="td-add" data-act="todoNew" data-id="' + today + '">+ 加任务</button></div>';
  html += todayItems.length ? todayItems.map(t => todoRow(t, today)).join('')
    : '<div class="td-empty">今天还没有安排</div>';
  if(doneAgo.length){
    html += '<div class="td-done-head">今天已完成 ' + doneAgo.length + ' 项' +
      '<button class="td-add" data-act="todoClear">清空</button></div>' +
      doneAgo.map(t => todoRow(t, today)).join('');
  }
  html += '</div>';

  if(backlog.length){
    html += '<div class="card td-group"><div class="td-ghead"><span class="dot late"></span>往期没做完 · ' + backlog.length +
      '<button class="td-add" data-act="todoLift">全部挪到今天</button></div>' +
      backlog.map(t => todoRow(t, today)).join('') + '</div>';
  }

  if(!list.length){
    html += '<div class="card"><div class="empty-note">便签还是空的。<br>可以记「每天记账」「周三交房租」「给妈打电话」这类，打钩就有成就感。</div></div>';
  }
  return html;
}

function todoRow(t, today){
  const done = isDoneOn(t, today);
  const meta = [];
  if(t.daily) meta.push('每天');
  else if(t.date < today && !t.done) meta.push('原定 ' + t.date);
  if(t.remind) meta.push('⏰ ' + t.remind);
  if(t.note) meta.push(t.note);
  return '<div class="td-item' + (done ? ' done' : '') + '">' +
    '<button class="td-check' + (done ? ' on' : '') + '" data-act="todoToggle" data-id="' + t.id + '">' +
      (done ? '<svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>' : '') + '</button>' +
    '<div class="td-body" data-act="todoEdit" data-id="' + t.id + '">' +
      '<div class="td-title">' + esc(t.title) + '</div>' +
      (meta.length ? '<div class="td-meta">' + esc(meta.join(' · ')) + '</div>' : '') +
    '</div>' +
    '<button class="td-del" data-act="todoDel" data-id="' + t.id + '">删除</button>' +
    '</div>';
}

function openNoteForm(id, presetDate, daily){
  const t = id ? S.todo().find(x => x.id === id) : null;
  const date = t ? t.date : (presetDate && presetDate !== 'daily' ? presetDate : ymd(Date.now()));
  const isDaily = t ? !!t.daily : (daily === true || presetDate === 'daily');
  openSheet(t ? '编辑任务' : '新建任务', '' +
    '<div class="field"><label>要做什么</label><input class="input" id="tdTitle" value="' + esc(t ? t.title : '') + '" placeholder="如：给妈打电话"></div>' +
    '<div class="field"><label>备注（选填）</label><input class="input" id="tdNote" value="' + esc(t ? (t.note || '') : '') + '" placeholder="选填"></div>' +
    (isDaily ? '' : '<div class="field"><label>日期</label><input class="input" id="tdDate" type="date" value="' + date + '"></div>') +
    '<div class="field"><label>提醒时间（选填，到点通知栏提醒）</label><input class="input" id="tdRemind" type="time" value="' + esc(t ? (t.remind || '') : '') + '"></div>' +
    '<div class="row between" style="padding:6px 0"><span>设为每日任务</span>' +
      '<div class="switch' + (isDaily ? ' on' : '') + '" id="tdDailySw" data-act="tdDaily"><i></i></div></div>' +
    '<input type="hidden" id="tdId" value="' + (t ? t.id : '') + '">' +
    '<input type="hidden" id="tdDaily" value="' + (isDaily ? '1' : '') + '">' +
    '<div style="display:flex;gap:10px;margin-top:12px">' +
      '<button class="btn ghost" style="flex:1" data-act="closeSheet">取消</button>' +
      '<button class="btn" style="flex:2" data-act="todoSave">保存</button>' +
    '</div>');
}
function todoDailySwitch(){
  const sw = document.getElementById('tdDailySw');
  const hd = document.getElementById('tdDaily');
  if(!sw || !hd) return;
  hd.value = hd.value === '1' ? '' : '1';
  sw.classList.toggle('on', hd.value === '1');
}

function saveTodoItem(){
  const idEl = document.getElementById('tdId');
  const title = ((document.getElementById('tdTitle') || {}).value || '').trim();
  if(!title){ toast('先写点要做什么'); return }
  const note = ((document.getElementById('tdNote') || {}).value || '').trim();
  const daily = ((document.getElementById('tdDaily') || {}).value || '') === '1';
  const dateEl = document.getElementById('tdDate');
  const date = daily ? '' : ((dateEl && dateEl.value) || ymd(Date.now()));
  const remind = ((document.getElementById('tdRemind') || {}).value || '').trim();
  const arr = S.todo();
  const id = idEl && idEl.value;
  let item = null;
  if(id){
    const i = arr.findIndex(x => x.id === id);
    if(i >= 0) item = arr[i] = Object.assign(arr[i], { title: title, note: note, daily: daily, date: date, remind: remind });
  }
  if(!item){
    item = { id: uid(), title: title, note: note, daily: daily, date: date, remind: remind, done: false, doneAt: 0, doneDates: [], createdAt: Date.now() };
    arr.push(item);
  }
  S.saveTodo(arr);
  closeSheet(); render();
  todoSetRemind(item);
  toast(id ? '已更新' : '已添加');
}

function todoSetRemind(item){
  if(!item.remind || !window.Android || !window.Android.scheduleReminder) return;
  const d = item.daily ? ymd(Date.now()) : item.date;
  if(!d) return;
  const when = new Date(d + 'T' + item.remind + ':00').getTime();
  if(isNaN(when)) return;
  const fire = (item.daily && when <= Date.now()) ? when + 86400000 : when;
  try{ window.Android.scheduleReminder('待办：' + item.title, (item.note ? item.note + ' · ' : '') + d, fire, 'todo-' + item.id) }catch(e){}
}

function toggleTodo(id){
  const arr = S.todo(); const i = arr.findIndex(x => x.id === id);
  if(i < 0) return;
  const t = arr[i]; const today = ymd(Date.now());
  if(t.daily){
    t.doneDates = t.doneDates || [];
    const k = t.doneDates.indexOf(today);
    if(k >= 0) t.doneDates.splice(k, 1); else t.doneDates.push(today);
  } else {
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : 0;
  }
  S.saveTodo(arr); render();
}

function delTodo(id){ S.saveTodo(S.todo().filter(x => x.id !== id)); render(); toast('已删除') }

function clearDoneTodo(){
  const today = ymd(Date.now());
  S.saveTodo(S.todo().filter(t => !(t.done && ymd(t.doneAt || t.createdAt) === today)));
  render(); toast('已清空今日完成记录');
}

function liftBacklog(){
  const today = ymd(Date.now());
  S.saveTodo(S.todo().map(t => (!t.daily && !t.done && t.date < today) ? Object.assign({}, t, { date: today }) : t));
  render(); toast('已全部挪到今天');
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

/* ================= 便签定时提醒（走原生通知栏） ================= */
function openNoteRemind(date){
  const cur = (S.note()[date] || '').slice(0, 80);
  openSheet('便签定时提醒', '' +
    '<div class="field"><label>提醒日期</label><input class="input" id="nrD" type="date" value="' + date + '"></div>' +
    '<div class="field"><label>提醒时间</label><input class="input" id="nrT" type="time" value="09:00"></div>' +
    '<div class="field"><label>提醒内容（留空则用这天便签内容）</label><textarea class="input" id="nrText" placeholder="留空则用这天便签的内容">' + esc(cur) + '</textarea></div>' +
    '<div class="btn-row">' +
      '<button class="btn ghost" data-act="close">取消</button>' +
      '<button class="btn" data-act="noteRemindSave">设定提醒</button>' +
    '</div>');
}
function saveNoteRemind(){
  const d = (document.getElementById('nrD') || {}).value;
  const t = (document.getElementById('nrT') || {}).value || '09:00';
  let txt = ((document.getElementById('nrText') || {}).value || '').trim();
  if(!d){ toast('请选提醒日期'); return }
  if(!txt){ txt = (S.note()[d] || '').trim() }
  if(!txt){ toast('便签是空的，先写点内容或填提醒内容'); return }
  const pp = d.split('-'), pt = t.split(':');
  const when = new Date(+pp[0], +pp[1] - 1, +pp[2], +pt[0], +pt[1], 0).getTime();
  if(when <= Date.now()){ toast('时间已过，请选将来的时间'); return }
  if(window.Android && typeof window.Android.scheduleReminder === 'function'){
    window.Android.scheduleReminder('便签提醒', txt, when, 'note-' + d);
    closeSheet(); toast('已设定 ' + d + ' ' + t + ' 提醒，到点通知栏见');
  } else { toast('当前环境不支持通知提醒') }
}

/* ================= 导出账单 ================= */
function buildCsv(){
  const rows = S.tx().slice().sort((a, b) => a.date - b.date);
  return ['日期,类型,分类,金额,备注'].concat(rows.map(t =>
    [ymd(t.date), t.type === 'income' ? '收入' : '支出', CATN[t.category] || t.category, t.amount, (t.note || '').replace(/,/g, '，')].join(','))).join('\n');
}
function expSheetHtml(){
  return '' +
    '<div class="exp-sec">' +
      '<div class="exp-t">通道一 · 保存到手机</div>' +
      '<button class="btn ghost" data-act="expSave">保存到下载目录并打开</button>' +
      '<p class="small muted" style="margin:8px 0 0">存在手机「文件管理 → Download」里，保存后自动打开预览，不用自己翻文件夹找。</p>' +
    '</div>' +
    '<div class="exp-sec">' +
      '<div class="exp-t">通道二 · 下载链接</div>' +
      '<div class="exp-link" id="expLink">生成中…</div>' +
      '<div class="btn-row" style="margin-top:8px">' +
        '<button class="btn ghost" data-act="expCopy">复制链接</button>' +
        '<button class="btn ghost" data-act="expBrowser">浏览器打开下载</button>' +
      '</div>' +
      '<p class="small muted" style="margin:8px 0 0">手机浏览器打开这个链接会直接下载 CSV 文件。</p>' +
    '</div>';
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
/* ================= 导航：添加 / 编辑 / 打开 ================= */
let navEditItem = null;
let navEditIcon = '';
const NAV_EMOJIS = ['🔗','🌐','📌','⭐','💡','🛒','📚','🎵','📺','💬','🏦','📈','🍔','✈️','🎮','📷','🔧','🏠','📝','☁️'];

function openNavEditor(item){
  navEditItem = item || null;
  navEditIcon = item ? (item.icon || '') : '';
  const e = item || {};
  const emojiBtns = NAV_EMOJIS.map(function(em){
    const on = ('emoji:' + em === navEditIcon) ? ' on' : '';
    return '<button class="nav-emoji-btn' + on + '" data-act="navEmoji" data-id="' + em + '">' + em + '</button>';
  }).join('');
  const html =
    '<div class="field"><label>名称</label><input class="input" id="navName" placeholder="如：百度 / 我的博客" value="' + esc(e.name || '') + '"></div>' +
    '<div class="field"><label>网址</label><input class="input" id="navUrl" placeholder="如 bing.com 或 https://..." value="' + esc(e.url || '') + '"></div>' +
    '<div class="field"><label>图标</label>' +
      '<div class="nav-icon-row">' +
        '<button class="nav-icon-opt' + (navEditIcon.indexOf('emoji:') !== 0 && navEditIcon.indexOf('data:') !== 0 ? ' on' : '') + '" data-act="navAuto">自动</button>' +
        '<button class="nav-icon-opt' + (navEditIcon.indexOf('data:') === 0 ? ' on' : '') + '" data-act="navUpload">上传图片</button>' +
      '</div>' +
      '<div class="nav-preview" id="navPreview">' + navIconHtml({ name: e.name || '网站', url: e.url || '', icon: navEditIcon }) + '</div>' +
      '<div class="nav-emoji-grid">' + emojiBtns + '</div>' +
    '</div>' +
    '<div class="btn-row" style="margin-top:6px">' +
      '<button class="btn" data-act="navSave">保存</button>' +
      (item ? '<button class="btn danger" data-act="navDel" data-id="' + item.id + '">删除</button>' : '') +
    '</div>';
  openSheet(item ? '编辑导航' : '添加网站', html);
}

function navRePreview(){
  const pv = document.getElementById('navPreview');
  if(pv) pv.innerHTML = navIconHtml({ name: (document.getElementById('navName').value || '网站'), url: (document.getElementById('navUrl').value || ''), icon: navEditIcon });
}
function refreshNavIconOpts(){
  const box = document.getElementById('sheetBody'); if(!box) return;
  box.querySelectorAll('.nav-icon-opt').forEach(function(b){
    const a = b.dataset.act;
    if(a === 'navAuto') b.classList.toggle('on', navEditIcon.indexOf('emoji:') !== 0 && navEditIcon.indexOf('data:') !== 0);
    if(a === 'navUpload') b.classList.toggle('on', navEditIcon.indexOf('data:') === 0);
  });
  box.querySelectorAll('.nav-emoji-btn').forEach(function(b){ b.classList.toggle('on', 'emoji:' + b.dataset.id === navEditIcon) });
}
function navAuto(){ navEditIcon = ''; navRePreview(); refreshNavIconOpts(); }
function navEmoji(el, id){ navEditIcon = 'emoji:' + id; navRePreview(); refreshNavIconOpts(); }
async function navUpload(){
  const d = await pickIconImage();
  if(!d) return;
  const small = await compressDataUrl(d, 120, 0.82);   // 图标压到 120px，省 localStorage
  navEditIcon = small || d;
  navRePreview(); refreshNavIconOpts();
}
function pickIconImage(){
  return new Promise(function(res){
    window.__imgResolve = function(d){ res(d) };
    if(window.Android && window.Android.pickImage){ window.Android.pickImage() }
    else { window.__imgResolve = null; res(null) }
  });
}
function navSave(){
  const name = (document.getElementById('navName').value || '').trim();
  const url = normUrl(document.getElementById('navUrl').value);
  if(!url){ toast('请填写网址'); return }
  if(!name) name = hostOf(url);
  const items = S.nav();
  if(navEditItem){
    const it = items.find(x => x.id === navEditItem.id);
    if(it){ it.name = name; it.url = url; it.icon = navEditIcon }
    else { items.push({ id: navEditItem.id, name: name, url: url, icon: navEditIcon }) }
  } else {
    items.push({ id: uid(), name: name, url: url, icon: navEditIcon });
  }
  S.saveNav(items);
  closeSheet(); render(); toast('已保存');
}
function navDel(el, id){
  if(!confirm('确定删除该导航？')) return;
  S.saveNav(S.nav().filter(x => x.id !== id));
  closeSheet(); render(); toast('已删除');
}
function navOpen(el, id){
  const it = S.nav().find(x => x.id === id);
  if(!it) return;
  openInApp(it.url);
}
function openInApp(url){
  url = normUrl(url);
  if(window.Android && window.Android.openInApp){ window.Android.openInApp(url) }
  else { try{ window.open(url, '_blank') }catch(e){ location.href = url } }
}

const ACTIONS = {
  go(el, id){ goPage(id) },
  calendar(){ window._calDay = null; goPage('calendar') },
  /* 便签 / 待办 */
  todoNew(el, id){ openNoteForm(null, id) },
  todoEdit(el, id){ openNoteForm(id) },
  tdDaily(){ todoDailySwitch() },
  todoSave(){ saveTodoItem() },
  todoToggle(el, id){ toggleTodo(id) },
  todoDel(el, id){ delTodo(id) },
  todoClear(){ clearDoneTodo() },
  todoLift(){ liftBacklog() },
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
  txView(el, id){ txView(el, id) },
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
    window.__lastCsv = buildCsv();
    if(window.Android && window.Android.startExportLink){
      openSheet('导出账单', expSheetHtml());
      window.__exportReady = function(url){
        const el = document.getElementById('expLink');
        if(el){ el.textContent = url }
      };
      try{ window.Android.startExportLink('暖记账单.csv', '\ufeff' + window.__lastCsv) }catch(e){}
      return;
    }
    const url = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\ufeff' + window.__lastCsv);
    const a = document.createElement('a'); a.href = url; a.download = '暖记账单.csv'; a.click();
    toast('已导出');
  },
  expSave(){
    if(window.Android && window.Android.saveTextOpen){
      window.Android.saveTextOpen('暖记账单.csv', '\ufeff' + (window.__lastCsv || buildCsv()));
    } else { ACTIONS.export() }
  },
  expCopy(){
    const url = (document.getElementById('expLink') || {}).textContent || '';
    if(!url || url === '生成中…'){ toast('链接还没生成好'); return }
    if(window.Android && window.Android.copyText){ window.Android.copyText(url); toast('链接已复制') }
    else {
      const ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta);
      ta.select(); try{ document.execCommand('copy'); toast('链接已复制') }catch(e){} document.body.removeChild(ta);
    }
  },
  expBrowser(){
    const url = (document.getElementById('expLink') || {}).textContent || '';
    if(!url || url === '生成中…'){ toast('链接还没生成好'); return }
    if(window.Android && window.Android.openExternal){ window.Android.openExternal(url) }
    else{ window.open(url, '_blank') }
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
  calBack(){ goPage('home') },
  noteRemind(el, id){ openNoteRemind(id) },
  noteRemindSave(){ saveNoteRemind() },
  clearCloud(){ clearCloud() },
  navAdd(){ openNavEditor(null) },
  navEdit(el, id){ openNavEditor(S.nav().find(x => x.id === id)) },
  navSave(){ navSave() },
  navDel(el, id){ navDel(el, id) },
  navOpen(el, id){ navOpen(el, id) },
  navAuto(){ navAuto() },
  navUpload(){ navUpload() },
  navEmoji(el, id){ navEmoji(el, id) },

  /* 小账历史记忆 */
  memSearch(){ memToggleSearch() },
  memPrev(){ memGo(-1) },
  memNext(){ memGo(1) },
  memCloseSearch(){ memCloseSearch() },
  memView(){ memView() },
  memDelFact(el, id){ memDelFact(id) },
  memDelSum(el, id){ memDelSum(id) },
  chatMore(){ chatMoreBtn() }
};

document.addEventListener('click', function(e){
  const el = e.target.closest('[data-act]');
  if(!el) return;
  const fn = ACTIONS[el.dataset.act];
  if(fn){ e.preventDefault(); fn(el, el.dataset.id) }
});

document.addEventListener('input', function(e){
  if(e.target.id === 'chatSearchInput'){ memSearchInput(); return; }
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
  goPage(b.dataset.page);
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
  // 兼容旧版：曾用 Agnes 1024×1024 原图存 bgImg，体积过大会撑爆 localStorage 5MB 配额，启动时压缩一次
  if(s.bgImg && s.bgImg.indexOf('data:') === 0 && s.bgImg.length > 1600000){
    compressDataUrl(s.bgImg, 800, 0.65).then(function(u){ if(u && u !== s.bgImg){ const ns = S.set(); ns.bgImg = u; S.saveSet(ns); } });
  }
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
