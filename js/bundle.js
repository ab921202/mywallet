/**
 * MyWallet PWA — 完整 JavaScript（無 ES modules，單一檔案）
 */

// ════════════════════════════════════════
// IndexedDB 資料庫層
// ════════════════════════════════════════
const DB_NAME = 'MyWalletDB';
const DB_VERSION = 1;
let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('assets')) {
        const s = db.createObjectStore('assets', { keyPath: 'id' });
        s.createIndex('groupId', 'groupId');
      }
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('assetId', 'assetId');
      }
      if (!db.objectStoreNames.contains('groups')) {
        db.createObjectStore('groups', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        const s = db.createObjectStore('snapshots', { keyPath: 'id' });
        s.createIndex('assetId', 'assetId');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror = e => reject(e.target.error);
  });
}

function dbStore(name, mode = 'readonly') {
  return _db.transaction(name, mode).objectStore(name);
}
function pr(req) {
  return new Promise((res, rej) => { req.onsuccess = e => res(e.target.result); req.onerror = e => rej(e.target.error); });
}
const DB = {
  getAll: s => pr(dbStore(s).getAll()),
  get: (s, k) => pr(dbStore(s).get(k)),
  byIndex: (s, idx, val) => pr(dbStore(s).index(idx).getAll(val)),
  put: (s, o) => pr(dbStore(s, 'readwrite').put(o)),
  del: (s, k) => pr(dbStore(s, 'readwrite').delete(k)),
  clear: s => pr(dbStore(s, 'readwrite').clear()),
};

const Assets = {
  getAll: () => DB.getAll('assets'),
  save: a => DB.put('assets', a),
  delete: id => DB.del('assets', id),
  clear: () => DB.clear('assets'),
};
const Transactions = {
  getAll: () => DB.getAll('transactions'),
  getByAsset: id => DB.byIndex('transactions', 'assetId', id),
  save: t => DB.put('transactions', t),
  delete: id => DB.del('transactions', id),
  deleteByAsset: async id => { const list = await DB.byIndex('transactions','assetId',id); for (const t of list) await DB.del('transactions', t.id); },
  clear: () => DB.clear('transactions'),
};
const Groups = {
  getAll: () => DB.getAll('groups'),
  save: g => DB.put('groups', g),
  delete: id => DB.del('groups', id),
  clear: () => DB.clear('groups'),
};
const Snapshots = {
  getAll: () => DB.getAll('snapshots'),
  getByAsset: id => DB.byIndex('snapshots', 'assetId', id),
  save: s => DB.put('snapshots', s),
  deleteByAsset: async id => { const list = await DB.byIndex('snapshots','assetId',id); for (const s of list) await DB.del('snapshots', s.id); },
  clear: () => DB.clear('snapshots'),
};
const Settings = {
  get: async k => { const r = await DB.get('settings', k); return r?.value; },
  set: (k, v) => DB.put('settings', { key: k, value: v }),
  getAll: async () => { const rows = await DB.getAll('settings'); const o = {}; rows.forEach(r => o[r.key] = r.value); return o; },
};

async function exportAllData() {
  const [assets, transactions, groups, snapshots] = await Promise.all([Assets.getAll(), Transactions.getAll(), Groups.getAll(), Snapshots.getAll()]);
  const settings = await Settings.getAll();
  return { version: '1.0', exportedAt: new Date().toISOString(), assets, transactions, groups, snapshots, settings };
}
async function importAllData(data) {
  await Promise.all([Assets.clear(), Transactions.clear(), Groups.clear(), Snapshots.clear()]);
  for (const g of (data.groups || [])) await Groups.save(g);
  for (const a of (data.assets || [])) await Assets.save(a);
  for (const t of (data.transactions || [])) await Transactions.save(t);
  for (const s of (data.snapshots || [])) await Snapshots.save(s);
  if (data.settings) for (const [k, v] of Object.entries(data.settings)) await Settings.set(k, v);
}

// ════════════════════════════════════════
// 資料模型 & 計算
// ════════════════════════════════════════
const genId = () => crypto.randomUUID();

const ASSET_TYPES = {
  stock:      { name: '股票',     icon: '📈', color: '#007AFF' },
  etf:        { name: 'ETF',      icon: '📊', color: '#34C759' },
  crypto:     { name: '加密貨幣', icon: '₿',  color: '#FF9500' },
  forex:      { name: '外匯',     icon: '💱', color: '#5AC8FA' },
  fund:       { name: '基金',     icon: '💰', color: '#AF52DE' },
  bond:       { name: '債券',     icon: '📄', color: '#FF2D55' },
  realestate: { name: '不動產',   icon: '🏠', color: '#FF6B35' },
  cash:       { name: '現金',     icon: '💵', color: '#4CD964' },
  insurance:  { name: '保險',     icon: '🛡️', color: '#00C7BE' },
  commodity:  { name: '大宗商品', icon: '🪙', color: '#FFD700' },
  other:      { name: '其他',     icon: '📦', color: '#8E8E93' },
};
const NON_STANDARD = ['realestate', 'insurance'];
const isNonStd = t => NON_STANDARD.includes(t);

const TX_TYPES = {
  buy:      { name: '買入',       icon: '⬇️', color: '#34C759' },
  sell:     { name: '賣出',       icon: '⬆️', color: '#FF3B30' },
  dividend: { name: '股息',       icon: '💸', color: '#007AFF' },
  split:    { name: '股票分割',   icon: '✂️', color: '#FF9500' },
  bonus:    { name: '股息再投入', icon: '🔁', color: '#AF52DE' },
};

const CURRENCIES = {
  TWD: { symbol: 'NT$', name: '新台幣' },
  USD: { symbol: '$',   name: '美元' },
  JPY: { symbol: '¥',  name: '日圓' },
  EUR: { symbol: '€',  name: '歐元' },
  HKD: { symbol: 'HK$', name: '港幣' },
  CNY: { symbol: '¥',  name: '人民幣' },
  GBP: { symbol: '£',  name: '英鎊' },
  AUD: { symbol: 'A$', name: '澳幣' },
  SGD: { symbol: 'S$', name: '新加坡幣' },
};

function fmt(n, d = 2) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return new Intl.NumberFormat('zh-TW', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
}
function fmtTWD(n) { return 'NT$' + fmt(n, 0); }
function fmtCur(n, cur = 'TWD', d = 2) { return (CURRENCIES[cur]?.symbol ?? '') + fmt(n, d); }
function fmtPct(n) { if (isNaN(n)) return '—'; return (n > 0 ? '+' : '') + fmt(n, 2) + '%'; }
function fmtShares(n) { if (!n && n !== 0) return '—'; return n % 1 === 0 ? fmt(n, 0) : fmt(n, 4); }
function fmtDate(d) { if (!d) return ''; return new Date(d).toLocaleDateString('zh-TW', { year:'numeric', month:'2-digit', day:'2-digit' }); }
function fmtRel(d) {
  if (!d) return '';
  const diff = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (diff === 0) return '今天'; if (diff === 1) return '昨天'; if (diff < 7) return diff + ' 天前';
  return fmtDate(d);
}
function today() { return new Date().toISOString().split('T')[0]; }

// 計算
function valTWD(a) { return a.currentPrice * a.totalShares * a.exchangeRate; }
function uPnL(a) { return valTWD(a) - a.totalCost; }
function uRate(a) { return a.totalCost ? (uPnL(a) / a.totalCost) * 100 : 0; }
function tPnL(a) { return (a.currentPrice - a.previousClosePrice) * a.totalShares * a.exchangeRate; }
function tRate(a) { return a.previousClosePrice ? ((a.currentPrice - a.previousClosePrice) / a.previousClosePrice) * 100 : 0; }

function applyBuy(a, shares, price, fee, rate) {
  const cost = (price * shares + fee) * rate;
  const newTotal = a.totalShares + shares;
  a.avgCostPerShare = newTotal > 0 ? (a.totalCost + cost) / newTotal : 0;
  a.totalCost += cost;
  a.totalShares = newTotal;
}
function applySell(a, shares) {
  a.totalCost -= a.avgCostPerShare * shares;
  a.totalShares -= shares;
  if (a.totalShares <= 0) { a.totalShares = 0; a.totalCost = 0; }
}
function applySplit(a, newShares) {
  if (newShares <= 0) return;
  a.avgCostPerShare = newShares > 0 ? a.totalCost / newShares : 0;
  a.totalShares = newShares;
}
function prepareUpdatePrice(a, newPrice, newRate) {
  const snap = { id: genId(), assetId: a.id, price: newPrice, recordedAt: new Date().toISOString() };
  a.previousClosePrice = a.currentPrice;
  a.currentPrice = newPrice;
  if (newRate) a.exchangeRate = newRate;
  a.lastUpdated = new Date().toISOString();
  return snap;
}

function mkAsset(o = {}) {
  return { id: genId(), name: '', ticker: '', assetType: 'stock', currency: 'TWD', exchangeRate: 1,
    totalShares: 0, avgCostPerShare: 0, totalCost: 0, currentPrice: 0, previousClosePrice: 0,
    groupId: null, note: '', isFavorite: false, isArchived: false,
    lastUpdated: new Date().toISOString(), createdAt: new Date().toISOString(), ...o };
}
function mkTx(o = {}) {
  return { id: genId(), assetId: '', type: 'buy', date: today(), shares: 0, pricePerShare: 0,
    fee: 0, exchangeRate: 1, splitNewShares: null, note: '', createdAt: new Date().toISOString(), ...o };
}
function mkDefaultGroups() {
  return [
    { id: genId(), name: '台股',     icon: '🇹🇼', colorHex: '#FF3B30', sortOrder: 0, createdAt: new Date().toISOString() },
    { id: genId(), name: '美股',     icon: '🇺🇸', colorHex: '#007AFF', sortOrder: 1, createdAt: new Date().toISOString() },
    { id: genId(), name: '加密貨幣', icon: '₿',   colorHex: '#FF9500', sortOrder: 2, createdAt: new Date().toISOString() },
    { id: genId(), name: '其他',     icon: '📦',  colorHex: '#8E8E93', sortOrder: 3, createdAt: new Date().toISOString() },
  ];
}

function buildCSV(assets, transactions) {
  const am = Object.fromEntries(assets.map(a => [a.id, a]));
  const rows = [['日期','資產名稱','代碼','交易類型','數量','每股價格','手續費','匯率','總成本TWD']];
  [...transactions].sort((a,b) => new Date(b.date)-new Date(a.date)).forEach(t => {
    const a = am[t.assetId] || {};
    rows.push([t.date, a.name||'', a.ticker||'', TX_TYPES[t.type]?.name||t.type, t.shares,
      t.pricePerShare, t.fee, t.exchangeRate, Math.round((t.shares*t.pricePerShare+t.fee)*t.exchangeRate)]);
  });
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
}

function dlFile(content, filename, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ════════════════════════════════════════
// 圖表（Chart.js）
// ════════════════════════════════════════
const chartInst = {};
function destroyChart(id) { if (chartInst[id]) { chartInst[id].destroy(); delete chartInst[id]; } }
function isDark() {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
const axisColor = () => isDark() ? '#8E8E93' : '#6C6C70';
const gridColor = () => isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';

function renderPieChart(canvasId, labels, data, colors) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;
  const total = data.reduce((s,v) => s+v, 0);
  chartInst[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: 'transparent' }] },
    options: {
      cutout: '60%', responsive: true, maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: NT$${Math.round(ctx.raw).toLocaleString('zh-TW')} (${fmt(ctx.raw/total*100,1)}%)` } }
      }
    }
  });
}

function renderHBar(canvasId, labels, data, colors, fmtFn) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || !data.length) return;
  canvas.style.height = Math.max(data.length * 44, 200) + 'px';
  chartInst[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderRadius: 6, borderSkipped: false }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtFn(ctx.raw) } } },
      scales: {
        x: { ticks: { color: axisColor(), callback: v => fmtFn(v) }, grid: { color: gridColor() } },
        y: { ticks: { color: isDark() ? '#EBEBF5' : '#3C3C43', font: { size: 12 } }, grid: { display: false } }
      }
    }
  });
}

function renderLine(canvasId, labels, data, color, fmtFn) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas || data.length < 2) { if (canvas) canvas.parentElement.innerHTML = '<div class="empty-state" style="padding:30px"><div class="icon">📈</div><p>更新各資產現價後將顯示走勢</p></div>'; return; }
  chartInst[canvasId] = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color + '1A', fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: color, borderWidth: 2.5 }] },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmtFn(ctx.raw) } } },
      scales: {
        x: { ticks: { color: axisColor(), maxTicksLimit: 6 }, grid: { color: gridColor() } },
        y: { ticks: { color: axisColor(), callback: v => fmtFn(v) }, grid: { color: gridColor() } }
      }
    }
  });
}

// ════════════════════════════════════════
// 應用程式狀態
// ════════════════════════════════════════
const S = {
  assets: [], transactions: [], groups: [], snapshots: [],
  settings: { baseCurrency: 'TWD', theme: 'auto' },
  page: 'dashboard',
  groupFilter: null,
  search: '',
  hidden: false,
  detailId: null,
  chartTab: 'allocation',
  txFilter: null,
  sortOpt: 'value',
  txForm: { assetId: null, isNew: false, type: 'buy' },
  updateId: null,
  editId: null,
};

// ════════════════════════════════════════
// 啟動
// ════════════════════════════════════════
async function initApp() {
  await openDB();
  await loadAll();
  applyTheme();
  if (!S.groups.length) { const gs = mkDefaultGroups(); for (const g of gs) await Groups.save(g); S.groups = gs; }
  setupNav();
  setupModals();
  render();
}

async function loadAll() {
  [S.assets, S.transactions, S.groups, S.snapshots] = await Promise.all([
    Assets.getAll(), Transactions.getAll(), Groups.getAll(), Snapshots.getAll()
  ]);
  Object.assign(S.settings, await Settings.getAll());
  S.groups.sort((a,b) => (a.sortOrder||0)-(b.sortOrder||0));
}

function applyTheme() {
  const t = S.settings.theme;
  if (t && t !== 'auto') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}

// ════════════════════════════════════════
// 導航
// ════════════════════════════════════════
function setupNav() {
  document.querySelectorAll('.tab-item').forEach(el => {
    el.addEventListener('click', () => goTo(el.dataset.page));
  });
}

function goTo(page) {
  S.page = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page)?.classList.add('active');
  document.querySelectorAll('.tab-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'charts') renderCharts();
  if (page === 'settings') renderSettings();
}

function showDetail(id) {
  S.detailId = id; S.txFilter = null;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-detail').classList.add('active');
  renderDetail();
}

function backDetail() {
  S.detailId = null;
  document.getElementById('page-detail').classList.remove('active');
  document.getElementById('page-' + S.page)?.classList.add('active');
  render();
}

// ════════════════════════════════════════
// Toast
// ════════════════════════════════════════
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// ════════════════════════════════════════
// 全域渲染
// ════════════════════════════════════════
function render() { renderDash(); renderPortfolio(); }

// ════════════════════════════════════════
// Dashboard
// ════════════════════════════════════════
function renderDash() {
  const active = S.assets.filter(a => !a.isArchived);
  const totalVal  = active.reduce((s,a) => s + valTWD(a), 0);
  const totalCost = active.reduce((s,a) => s + a.totalCost, 0);
  const pnl       = totalVal - totalCost;
  const rate      = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
  const dayPnl    = active.reduce((s,a) => s + tPnL(a), 0);
  const prevTotal = active.reduce((s,a) => s + a.previousClosePrice * a.totalShares * a.exchangeRate, 0);
  const dayRate   = prevTotal > 0 ? (dayPnl / prevTotal) * 100 : 0;

  // 總資產卡
  document.getElementById('hero-value').textContent = S.hidden ? 'NT$ ●●●●●' : fmtTWD(totalVal);
  document.getElementById('hero-pnl').innerHTML = `
    <span class="pnl-amount ${pnl>=0?'text-green':'text-red'}">${pnl>=0?'+':''}${fmtTWD(pnl)}</span>
    <span class="pnl-badge ${pnl>=0?'green':'red'}">${fmtPct(rate)}</span>
    <button class="eye-btn" onclick="toggleHide()">${S.hidden?'👁️':'🙈'}</button>
  `;

  // 今日損益
  const dc = dayPnl >= 0 ? '#34C759' : '#FF3B30';
  document.getElementById('today-card').innerHTML = `
    <div class="today-bar" style="background:${dc}"></div>
    <div class="today-info">
      <div class="today-label">☀️ 今日損益</div>
      <div class="today-value" style="color:${dc}">${dayPnl>=0?'+':''}${fmtTWD(dayPnl)}</div>
      <div class="today-rate" style="color:${dc}">${fmtPct(dayRate)}</div>
    </div>
  `;

  // 圓餅圖
  const grouped = {};
  active.forEach(a => { const v = valTWD(a); grouped[a.assetType] = (grouped[a.assetType]||0) + v; });
  const entries = Object.entries(grouped).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const total = entries.reduce((s,[,v])=>s+v,0);
  if (entries.length) {
    renderPieChart('alloc-chart', entries.map(([k])=>ASSET_TYPES[k]?.name||k), entries.map(([,v])=>v), entries.map(([k])=>ASSET_TYPES[k]?.color||'#8E8E93'));
    document.getElementById('alloc-legend').innerHTML = entries.slice(0,6).map(([k,v])=>`
      <div class="legend-item">
        <div class="legend-dot" style="background:${ASSET_TYPES[k]?.color||'#8E8E93'}"></div>
        <span class="legend-label">${ASSET_TYPES[k]?.name||k}</span>
        <span class="legend-pct">${fmt(v/total*100,1)}%</span>
      </div>`).join('');
  } else {
    document.getElementById('alloc-legend').innerHTML = '<p style="color:var(--text3);font-size:13px">新增資產後顯示</p>';
  }

  // 表現排行
  const ranked = [...active].filter(a=>a.totalCost>0).sort((a,b)=>uRate(b)-uRate(a));
  const top3 = ranked.slice(0,3), bot3 = ranked.length>3?ranked.slice(-3).reverse():[];
  const perfEl = document.getElementById('top-performers');
  if (!ranked.length) { perfEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>新增資產後顯示排行</p></div>'; }
  else {
    perfEl.innerHTML = '<div class="section-title" style="padding:6px 0 4px">🏆 最佳表現</div>' +
      top3.map(perfRow).join('') +
      (bot3.length ? '<div class="divider"></div><div class="section-title" style="padding:4px 0">📉 最差表現</div>' + bot3.map(perfRow).join('') : '');
  }

  // 最近交易
  const am = Object.fromEntries(S.assets.map(a=>[a.id,a]));
  const recent = [...S.transactions].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,5);
  const txEl = document.getElementById('recent-txs');
  if (!recent.length) { txEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>尚無交易記錄</p></div>'; }
  else {
    txEl.innerHTML = recent.map(t => {
      const a = am[t.assetId]||{};
      const total = ((t.shares*t.pricePerShare)+t.fee)*t.exchangeRate;
      const ti = TX_TYPES[t.type]||{};
      return `<div class="tx-row">
        <div class="tx-icon" style="background:${ti.color||'#8E8E93'}22">${ti.icon||'📋'}</div>
        <div class="tx-info">
          <div class="tx-asset">${a.name||'未知'}</div>
          <div class="tx-meta">${ti.name||''} · ${fmtRel(t.date)}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount ${t.type==='sell'||t.type==='dividend'?'text-green':''}">${t.type==='sell'||t.type==='dividend'?'+':'-'}${fmtTWD(total)}</div>
          <div class="tx-shares">${fmtShares(t.shares)} 股</div>
        </div>
      </div>`;
    }).join('');
  }
}

function perfRow(a) {
  const r = uRate(a); const c = r>=0?'#34C759':'#FF3B30';
  const ti = ASSET_TYPES[a.assetType]||{};
  return `<div class="performer-row" onclick="showDetail('${a.id}')">
    <div class="performer-icon" style="background:${ti.color||'#8E8E93'}22">${ti.icon||'📦'}</div>
    <div style="flex:1;min-width:0">
      <div class="performer-name">${a.name}</div>
      <div class="performer-ticker">${a.ticker||ti.name||''}</div>
    </div>
    <div class="performer-rate" style="color:${c}">${fmtPct(r)}</div>
  </div>`;
}

// ════════════════════════════════════════
// Portfolio
// ════════════════════════════════════════
function renderPortfolio() {
  // 群組 Tabs
  document.getElementById('group-tabs').innerHTML =
    `<div class="group-tab ${!S.groupFilter?'active':''}" onclick="setGroup(null)">全部</div>` +
    S.groups.map(g => `<div class="group-tab ${S.groupFilter===g.id?'active':''}" onclick="setGroup('${g.id}')">${g.icon} ${g.name}</div>`).join('');

  // 資產過濾 + 排序
  let assets = S.assets.filter(a => !a.isArchived);
  if (S.groupFilter) assets = assets.filter(a => a.groupId === S.groupFilter);
  if (S.search) { const q = S.search.toLowerCase(); assets = assets.filter(a => a.name.toLowerCase().includes(q) || (a.ticker||'').toLowerCase().includes(q)); }
  assets = [...assets].sort((a,b) => {
    if (S.sortOpt==='pnl')    return uRate(b)-uRate(a);
    if (S.sortOpt==='name')   return a.name.localeCompare(b.name,'zh-TW');
    if (S.sortOpt==='recent') return new Date(b.lastUpdated)-new Date(a.lastUpdated);
    return valTWD(b)-valTWD(a);
  });

  const tv = assets.reduce((s,a)=>s+valTWD(a),0);
  const tp = assets.reduce((s,a)=>s+uPnL(a),0);
  document.getElementById('portfolio-summary').innerHTML = assets.length ? `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;font-size:13px">
      <div><div style="color:var(--text3)">合計 ${assets.length} 個資產</div><div style="font-weight:700;font-size:15px">${fmtTWD(tv)}</div></div>
      <div style="text-align:right"><div style="color:var(--text3)">未實現損益</div><div style="font-weight:700;font-size:15px;color:${tp>=0?'var(--green)':'var(--red)'}">${tp>=0?'+':''}${fmtTWD(tp)}</div></div>
    </div>` : '';

  const listEl = document.getElementById('asset-list');
  if (!assets.length) { listEl.innerHTML = '<div class="empty-state"><div class="icon">💼</div><h3>尚無資產</h3><p>點擊下方 + 新增第一筆資產</p></div>'; return; }
  listEl.innerHTML = `<div class="asset-list">${assets.map(a => {
    const v = valTWD(a), p = uPnL(a), r = uRate(a), c = p>=0?'var(--green)':'var(--red)';
    const ti = ASSET_TYPES[a.assetType]||{};
    return `<div class="asset-row" onclick="showDetail('${a.id}')">
      <div class="asset-icon" style="background:${ti.color||'#8E8E93'}22">${ti.icon||'📦'}</div>
      <div class="asset-info">
        <div class="asset-name">${a.isFavorite?'⭐ ':''}${a.name}</div>
        <div class="asset-meta">${a.ticker?a.ticker+' · ':''}${isNonStd(a.assetType)?'1 份':fmtShares(a.totalShares)+' 股'}</div>
      </div>
      <div class="asset-right">
        <div class="asset-value">${fmtTWD(v)}</div>
        <div class="asset-pnl" style="color:${c}">${fmtPct(r)}</div>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ════════════════════════════════════════
// 資產詳情
// ════════════════════════════════════════
function renderDetail() {
  const a = S.assets.find(x => x.id === S.detailId);
  if (!a) return;
  const ti = ASSET_TYPES[a.assetType]||{};
  const v = valTWD(a), up = uPnL(a), ur = uRate(a), tp = tPnL(a), tr = tRate(a);

  document.getElementById('page-detail').innerHTML = `
    <div class="page-header safe-top">
      <div class="header-row">
        <button class="back-btn" onclick="backDetail()">←</button>
        <div style="flex:1;text-align:center;font-size:17px;font-weight:700">${a.name}</div>
        <div style="display:flex;gap:8px">
          <button class="back-btn" onclick="openUpdatePrice('${a.id}')">💹</button>
          <button class="back-btn" onclick="openEditAsset('${a.id}')">✏️</button>
        </div>
      </div>
    </div>
    <div class="page-content" style="gap:14px">
      <div class="detail-header">
        <div class="detail-icon" style="background:${ti.color||'#8E8E93'}22">${ti.icon||'📦'}</div>
        <div>
          <div class="detail-name">${a.name}</div>
          <div class="detail-meta">${a.ticker?`<span class="chip">${a.ticker}</span> `:''}${ti.name} · ${a.currency}</div>
        </div>
      </div>
      <div class="metrics-grid">
        <div class="metric-cell"><div class="metric-label">市值</div><div class="metric-value">${fmtTWD(v)}</div></div>
        <div class="metric-cell"><div class="metric-label">未實現損益</div><div class="metric-value" style="color:${up>=0?'var(--green)':'var(--red)'}">${up>=0?'+':''}${fmtTWD(up)}</div><div class="metric-sub" style="color:${up>=0?'var(--green)':'var(--red)'}">${fmtPct(ur)}</div></div>
        <div class="metric-cell"><div class="metric-label">今日損益</div><div class="metric-value" style="color:${tp>=0?'var(--green)':'var(--red)'}">${tp>=0?'+':''}${fmtTWD(tp)}</div><div class="metric-sub" style="color:${tp>=0?'var(--green)':'var(--red)'}">${fmtPct(tr)}</div></div>
      </div>
      <div class="card">
        <div class="card-title">📈 價格走勢</div>
        <div id="asset-chart-wrap"><canvas id="asset-chart" height="160"></canvas></div>
      </div>
      <div class="card">
        <div class="card-title">💼 成本明細</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${ccell('持有數量', isNonStd(a.assetType)?'1 份':fmtShares(a.totalShares)+' 股')}
          ${ccell('平均成本', fmtCur(a.avgCostPerShare, a.currency))}
          ${ccell('總投入', fmtTWD(a.totalCost))}
          ${ccell('現價', fmtCur(a.currentPrice, a.currency))}
          ${a.currency!=='TWD'?ccell('匯率','1 '+a.currency+' = '+fmt(a.exchangeRate)+'TWD'):''}
          ${ccell('更新時間', fmtRel(a.lastUpdated))}
        </div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="card-title" style="margin:0">📋 交易記錄</div>
          <select style="font-size:12px;color:var(--accent);background:rgba(0,122,255,0.08);border:none;border-radius:12px;padding:4px 10px;font-family:inherit" onchange="setTxFilter(this.value)">
            <option value="">全部</option>
            ${Object.entries(TX_TYPES).map(([k,v])=>`<option value="${k}">${v.name}</option>`).join('')}
          </select>
        </div>
        <div id="tx-list"></div>
      </div>
      <button class="btn btn-danger" onclick="confirmDelAsset('${a.id}')">🗑️ 刪除此資產</button>
    </div>`;

  // 走勢圖
  const snaps = S.snapshots.filter(s => s.assetId === a.id).sort((a,b) => new Date(a.recordedAt)-new Date(b.recordedAt));
  if (snaps.length < 2) {
    document.getElementById('asset-chart-wrap').innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">📈</div><p>更新現價後將顯示走勢</p></div>';
  } else {
    const isUp = snaps[snaps.length-1].price >= snaps[0].price;
    renderLine('asset-chart', snaps.map(s=>s.recordedAt.split('T')[0]), snaps.map(s=>s.price), isUp?'#34C759':'#FF3B30', v => fmt(v,2));
  }
  renderTxList();
}

function ccell(l, v) { return `<div><div style="font-size:10px;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px">${l}</div><div style="font-size:14px;font-weight:600">${v}</div></div>`; }

function renderTxList() {
  let txs = S.transactions.filter(t => t.assetId === S.detailId);
  if (S.txFilter) txs = txs.filter(t => t.type === S.txFilter);
  txs.sort((a,b) => new Date(b.date)-new Date(a.date));
  const el = document.getElementById('tx-list');
  if (!el) return;
  if (!txs.length) { el.innerHTML = '<div class="empty-state" style="padding:20px"><p>尚無交易記錄</p></div>'; return; }
  el.innerHTML = txs.map(t => {
    const ti = TX_TYPES[t.type]||{};
    const total = ((t.shares*t.pricePerShare)+t.fee)*t.exchangeRate;
    return `<div class="tx-row">
      <div class="tx-icon" style="background:${ti.color||'#8E8E93'}22">${ti.icon||'📋'}</div>
      <div class="tx-info"><div class="tx-asset">${ti.name}</div><div class="tx-meta">${fmtDate(t.date)}${t.note?' · '+t.note:''}</div></div>
      <div class="tx-right">
        <div class="tx-amount">${fmtTWD(total)}</div>
        <div class="tx-shares">${t.type==='split'&&t.splitNewShares?'→ '+fmtShares(t.splitNewShares)+' 股':fmtShares(t.shares)+' 股'}</div>
      </div>
    </div>`;
  }).join('');
}

// ════════════════════════════════════════
// 圖表頁
// ════════════════════════════════════════
function renderCharts() {
  const tabs = [['allocation','資產配置'],['group','群組配置'],['pnl','損益'],['trend','走勢'],['ranking','排行']];
  document.getElementById('charts-tabs').innerHTML = tabs.map(([k,l]) =>
    `<button class="seg-btn ${S.chartTab===k?'active':''}" onclick="switchChart('${k}')">${l}</button>`).join('');
  renderChartContent();
}

function renderChartContent() {
  const el = document.getElementById('charts-content');
  const active = S.assets.filter(a => !a.isArchived);

  if (S.chartTab === 'allocation') {
    const grouped = {};
    active.forEach(a => { const v = valTWD(a); grouped[a.assetType] = (grouped[a.assetType]||0)+v; });
    const entries = Object.entries(grouped).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
    const total = entries.reduce((s,[,v])=>s+v,0);
    el.innerHTML = `<div class="card"><div class="card-title">📊 按資產類別</div><canvas id="chart-main" height="220"></canvas><div class="legend" style="margin-top:12px" id="chart-legend"></div></div>`;
    setTimeout(() => {
      renderPieChart('chart-main', entries.map(([k])=>ASSET_TYPES[k]?.name||k), entries.map(([,v])=>v), entries.map(([k])=>ASSET_TYPES[k]?.color||'#8E8E93'));
      document.getElementById('chart-legend').innerHTML = entries.map(([k,v])=>`<div class="legend-item"><div class="legend-dot" style="background:${ASSET_TYPES[k]?.color||'#8E8E93'}"></div><span class="legend-label">${ASSET_TYPES[k]?.name||k}</span><span class="legend-pct">${fmt(v/total*100,1)}%</span></div>`).join('');
    },50);
  }
  else if (S.chartTab === 'group') {
    const gm = Object.fromEntries(S.groups.map(g=>[g.id,g]));
    const grouped = {}, cmap = {};
    active.forEach(a => { const v = valTWD(a), n = a.groupId&&gm[a.groupId]?gm[a.groupId].name:'未分組'; grouped[n]=(grouped[n]||0)+v; cmap[n]=a.groupId&&gm[a.groupId]?gm[a.groupId].colorHex:'#8E8E93'; });
    const entries = Object.entries(grouped).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
    const total = entries.reduce((s,[,v])=>s+v,0);
    el.innerHTML = `<div class="card"><div class="card-title">📁 按群組</div><canvas id="chart-main" height="220"></canvas><div class="legend" style="margin-top:12px" id="chart-legend"></div></div>`;
    setTimeout(() => {
      renderPieChart('chart-main', entries.map(([k])=>k), entries.map(([,v])=>v), entries.map(([k])=>cmap[k]));
      document.getElementById('chart-legend').innerHTML = entries.map(([k,v])=>`<div class="legend-item"><div class="legend-dot" style="background:${cmap[k]}"></div><span class="legend-label">${k}</span><span class="legend-pct">${fmt(v/total*100,1)}%</span></div>`).join('');
    },50);
  }
  else if (S.chartTab === 'pnl') {
    const sorted = [...active].filter(a=>a.totalCost>0).map(a=>({name:a.name,pnl:uPnL(a)})).sort((a,b)=>b.pnl-a.pnl).slice(0,12);
    el.innerHTML = `<div class="card"><div class="card-title">💹 各資產未實現損益</div><div style="overflow-x:auto"><canvas id="chart-main"></canvas></div></div>`;
    setTimeout(() => renderHBar('chart-main', sorted.map(d=>d.name), sorted.map(d=>d.pnl), sorted.map(d=>d.pnl>=0?'rgba(52,199,89,0.7)':'rgba(255,59,48,0.7)'), v=>'NT$'+Math.round(v).toLocaleString()), 50);
  }
  else if (S.chartTab === 'trend') {
    const dm = {};
    S.snapshots.forEach(s => { const a = S.assets.find(x=>x.id===s.assetId); if(!a)return; const d=s.recordedAt.split('T')[0]; dm[d]=(dm[d]||0)+s.price*a.totalShares*a.exchangeRate; });
    const entries = Object.entries(dm).sort(([a],[b])=>a.localeCompare(b));
    el.innerHTML = `<div class="card"><div class="card-title">📈 總資產走勢</div><div id="trend-wrap"><canvas id="chart-main" height="200"></canvas></div></div>`;
    setTimeout(() => renderLine('chart-main', entries.map(([d])=>d), entries.map(([,v])=>v), '#007AFF', v=>'NT$'+Math.round(v).toLocaleString()), 50);
  }
  else if (S.chartTab === 'ranking') {
    const sorted = [...active].filter(a=>a.totalCost>0).map(a=>({name:a.name,rate:uRate(a)})).sort((a,b)=>b.rate-a.rate).slice(0,12);
    el.innerHTML = `<div class="card"><div class="card-title">🏆 報酬率排行</div><div style="overflow-x:auto"><canvas id="chart-main"></canvas></div></div>`;
    setTimeout(() => renderHBar('chart-main', sorted.map(d=>d.name), sorted.map(d=>d.rate), sorted.map(d=>d.rate>=0?'rgba(52,199,89,0.7)':'rgba(255,59,48,0.7)'), v=>v.toFixed(1)+'%'), 50);
  }
}

// ════════════════════════════════════════
// 設定頁
// ════════════════════════════════════════
function renderSettings() {
  const { theme, baseCurrency, lastBackupDate } = S.settings;
  document.getElementById('settings-content').innerHTML = `
    <div class="settings-group-title">外觀</div>
    <div class="settings-group">
      <div class="settings-row">
        <span class="settings-icon">🌙</span><span class="settings-label">顯示模式</span>
        <select style="font-size:14px;color:var(--text3);background:none;border:none;font-family:inherit" onchange="changeTheme(this.value)">
          <option value="auto" ${!theme||theme==='auto'?'selected':''}>跟隨系統</option>
          <option value="dark" ${theme==='dark'?'selected':''}>深色</option>
          <option value="light" ${theme==='light'?'selected':''}>淺色</option>
        </select>
      </div>
    </div>
    <div class="settings-group-title" style="margin-top:20px">幣別</div>
    <div class="settings-group">
      <div class="settings-row">
        <span class="settings-icon">💱</span><span class="settings-label">基準幣別</span>
        <select style="font-size:14px;color:var(--text3);background:none;border:none;font-family:inherit" onchange="changeCurrency(this.value)">
          ${Object.entries(CURRENCIES).map(([k,v])=>`<option value="${k}" ${baseCurrency===k?'selected':''}>${v.symbol} ${k}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="settings-group-title" style="margin-top:20px">群組管理</div>
    <div class="settings-group">
      ${S.groups.map(g=>`
        <div class="settings-row">
          <span class="settings-icon">${g.icon}</span>
          <span class="settings-label">${g.name}</span>
          <span class="settings-value">${S.assets.filter(a=>a.groupId===g.id&&!a.isArchived).length} 個</span>
          <button style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:4px" onclick="delGroup('${g.id}')">🗑️</button>
        </div>`).join('')}
      <div class="settings-row" style="cursor:pointer" onclick="openAddGroup()">
        <span class="settings-icon">➕</span><span class="settings-label" style="color:var(--accent)">新增群組</span>
      </div>
    </div>
    <div class="settings-group-title" style="margin-top:20px">資料</div>
    <div class="settings-group">
      <div class="settings-row" style="cursor:pointer" onclick="doExportCSV()"><span class="settings-icon">📄</span><span class="settings-label">匯出交易記錄 (CSV)</span></div>
      <div class="settings-row" style="cursor:pointer" onclick="doExportJSON()"><span class="settings-icon">💾</span><span class="settings-label">完整備份 (JSON)</span>${lastBackupDate?`<span class="settings-value">${fmtRel(lastBackupDate)}</span>`:''}</div>
      <div class="settings-row" style="cursor:pointer" onclick="document.getElementById('import-input').click()"><span class="settings-icon">📂</span><span class="settings-label">還原備份</span></div>
      <input type="file" id="import-input" accept=".json" style="display:none" onchange="doImportJSON(event)">
    </div>
    ${S.assets.filter(a=>a.isArchived).length ? `
    <div class="settings-group-title" style="margin-top:20px">封存資產</div>
    <div class="settings-group">
      ${S.assets.filter(a=>a.isArchived).map(a=>`<div class="settings-row"><span class="settings-label">${a.name}</span><button style="background:none;border:none;color:var(--accent);font-size:13px;cursor:pointer" onclick="unarchive('${a.id}')">還原</button></div>`).join('')}
    </div>` : ''}
    <div class="settings-group-title" style="margin-top:20px">關於</div>
    <div class="settings-group">
      <div class="settings-row"><span class="settings-icon">📱</span><span class="settings-label">版本</span><span class="settings-value">v1.0 PWA</span></div>
      <div class="settings-row"><span class="settings-icon">💼</span><span class="settings-label">資產數量</span><span class="settings-value">${S.assets.filter(a=>!a.isArchived).length} 個</span></div>
      <div class="settings-row"><span class="settings-icon">🔒</span><span class="settings-label">資料儲存</span><span class="settings-value">本機 IndexedDB</span></div>
    </div>
    <div style="height:20px"></div>`;
}

// ════════════════════════════════════════
// 新增交易 Modal
// ════════════════════════════════════════
function openAddTxSheet(preId = null) {
  S.txForm = { assetId: preId, isNew: false, type: 'buy', currency: 'TWD', exchangeRate: 1 };
  renderTxForm();
  document.getElementById('modal-tx').classList.add('open');
}

function renderTxForm() {
  const f = S.txForm;
  const selAsset = S.assets.find(a => a.id === f.assetId);
  const txType = f.type || 'buy';
  const isSplit = txType === 'split';
  const currency = selAsset?.currency || f.currency || 'TWD';

  document.getElementById('tx-form-body').innerHTML = `
    <div class="form-section">
      <label class="form-label">資產</label>
      ${selAsset ? `
        <div class="form-group">
          <div class="form-row">
            <span style="font-size:20px">${ASSET_TYPES[selAsset.assetType]?.icon||'📦'}</span>
            <span class="form-row-label">${selAsset.name}</span>
            <button style="background:none;border:none;color:var(--accent);font-size:13px;cursor:pointer" onclick="clearSelAsset()">更換</button>
          </div>
        </div>` :
      f.isNew ? `
        <div class="form-group">
          <div class="form-row"><span class="form-row-label">名稱</span><input type="text" id="na-name" placeholder="e.g. 台積電"></div>
          <div class="form-row"><span class="form-row-label">代碼</span><input type="text" id="na-ticker" placeholder="選填"></div>
          <div class="form-row"><span class="form-row-label">類別</span>
            <select id="na-type">${Object.entries(ASSET_TYPES).map(([k,v])=>`<option value="${k}" ${(f.newType||'stock')===k?'selected':''}>${v.icon} ${v.name}</option>`).join('')}</select>
          </div>
          <div class="form-row"><span class="form-row-label">幣別</span>
            <select id="na-cur" onchange="onCurChange(this.value)">${Object.keys(CURRENCIES).map(k=>`<option value="${k}" ${(f.currency||'TWD')===k?'selected':''}>${k}</option>`).join('')}</select>
          </div>
          <div class="form-row"><span class="form-row-label">群組</span>
            <select id="na-group"><option value="">無群組</option>${S.groups.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}</select>
          </div>
          <div class="form-row" style="cursor:pointer" onclick="cancelNewAsset()"><span class="form-row-label secondary">← 搜尋現有資產</span></div>
        </div>` : `
        <div class="form-group">
          <div class="form-row" style="flex-direction:column;align-items:stretch;gap:8px;padding:12px">
            <input type="text" id="asset-search-inp" placeholder="🔍 搜尋資產" style="text-align:left;background:var(--surface2);border-radius:8px;padding:8px 10px;border:1px solid var(--border)" oninput="renderAssetSearch(this.value)">
            <div id="asset-search-res" style="max-height:180px;overflow-y:auto"></div>
          </div>
          <div class="form-row" style="cursor:pointer" onclick="startNewAsset()"><span style="color:var(--accent)">➕ 建立新資產</span></div>
        </div>`
      }
    </div>
    <div class="form-section">
      <label class="form-label">類型</label>
      <div class="seg-ctrl">${Object.entries(TX_TYPES).map(([k,v])=>`<button class="seg-btn ${txType===k?'active':''}" onclick="setTxType('${k}')">${v.name}</button>`).join('')}</div>
    </div>
    <div class="form-section">
      <label class="form-label">日期</label>
      <div class="form-group"><div class="form-row"><input type="date" id="tx-date" value="${f.date||today()}" style="text-align:left;flex:1"></div></div>
    </div>
    ${isSplit ? `
      <div class="form-section">
        <label class="form-label">分割後新股數</label>
        <div class="form-group"><div class="form-row"><span class="form-row-label">新股數</span><input type="number" id="split-shares" placeholder="0" value="${f.splitNewShares||''}"></div></div>
      </div>` : `
      <div class="form-section">
        <label class="form-label">交易明細</label>
        <div class="form-group">
          <div class="form-row"><span class="form-row-label">數量</span><input type="number" id="tx-shares" placeholder="0" value="${f.shares||''}" oninput="updSummary()"></div>
          <div class="form-row"><span class="form-row-label">每股價格 (${currency})</span><input type="number" id="tx-price" placeholder="0.00" value="${f.price||''}" oninput="updSummary()"></div>
          <div class="form-row"><span class="form-row-label">手續費</span><input type="number" id="tx-fee" placeholder="0" value="${f.fee??'0'}" oninput="updSummary()"></div>
          ${currency!=='TWD'?`<div class="form-row"><span class="form-row-label">匯率 (1 ${currency}=?TWD)</span><input type="number" id="tx-rate" placeholder="1" value="${selAsset?.exchangeRate||1}" oninput="updSummary()"></div>`:''}
        </div>
      </div>
      <div id="tx-summary" style="margin-bottom:16px"></div>`}
    <div class="form-section">
      <label class="form-label">備註（選填）</label>
      <div class="form-group"><div class="form-row"><textarea id="tx-note" placeholder="輸入備註..." style="text-align:left;min-height:60px;width:100%;padding:4px 0">${f.note||''}</textarea></div></div>
    </div>
    <button class="btn btn-primary" onclick="saveTx()" style="margin-bottom:20px">儲存交易</button>
  `;

  if (!selAsset && !f.isNew) renderAssetSearch('');
  updSummary();
}

function renderAssetSearch(q) {
  const el = document.getElementById('asset-search-res');
  if (!el) return;
  const lower = q.toLowerCase();
  const filtered = S.assets.filter(a => !a.isArchived && (!q || a.name.toLowerCase().includes(lower) || (a.ticker||'').toLowerCase().includes(lower))).slice(0,8);
  el.innerHTML = filtered.length
    ? filtered.map(a=>`<div style="display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;border-radius:8px" onclick="selAssetForTx('${a.id}')"><span>${ASSET_TYPES[a.assetType]?.icon||'📦'}</span><span style="font-size:14px;font-weight:500">${a.name}</span><span style="font-size:11px;color:var(--text3)">${a.ticker||''}</span></div>`).join('')
    : '<div style="padding:8px;color:var(--text3);font-size:13px">找不到資產</div>';
}

function updSummary() {
  const el = document.getElementById('tx-summary');
  if (!el) return;
  const shares = parseFloat(document.getElementById('tx-shares')?.value)||0;
  const price  = parseFloat(document.getElementById('tx-price')?.value)||0;
  const fee    = parseFloat(document.getElementById('tx-fee')?.value)||0;
  const rate   = parseFloat(document.getElementById('tx-rate')?.value)||1;
  if (!shares && !price) { el.innerHTML=''; return; }
  const total = (shares * price + fee) * rate;
  el.innerHTML = `<div class="summary-row"><span class="summary-label">合計 (${fmtShares(shares)} × ${fmt(price)} + ${fmt(fee)} 費) × ${fmt(rate,4)}</span><span class="summary-value">${fmtTWD(total)}</span></div>`;
}

async function saveTx() {
  const f = S.txForm;
  const txType = f.type || 'buy';
  let asset;

  if (f.assetId) {
    asset = S.assets.find(a => a.id === f.assetId);
  } else if (f.isNew) {
    const name = document.getElementById('na-name')?.value?.trim();
    if (!name) { toast('請輸入資產名稱'); return; }
    asset = mkAsset({
      name,
      ticker: document.getElementById('na-ticker')?.value?.trim() || null,
      assetType: document.getElementById('na-type')?.value || 'stock',
      currency: document.getElementById('na-cur')?.value || 'TWD',
      groupId: document.getElementById('na-group')?.value || null,
    });
    if (isNonStd(asset.assetType)) asset.totalShares = 1;
    await Assets.save(asset);
    S.assets.push(asset);
  } else { toast('請選擇或建立資產'); return; }

  if (!asset) { toast('找不到資產'); return; }

  const date = document.getElementById('tx-date')?.value || today();
  const note = document.getElementById('tx-note')?.value?.trim() || null;
  const cur = asset.currency;

  if (txType === 'split') {
    const newShares = parseFloat(document.getElementById('split-shares')?.value);
    if (!newShares || newShares <= 0) { toast('請輸入分割後股數'); return; }
    const tx = mkTx({ assetId: asset.id, type:'split', date, shares: asset.totalShares, pricePerShare:0, fee:0, exchangeRate:asset.exchangeRate, splitNewShares:newShares, note });
    applySplit(asset, newShares);
    await Transactions.save(tx); await Assets.save(asset);
    S.transactions.push(tx);
  } else {
    const shares = parseFloat(document.getElementById('tx-shares')?.value);
    const price  = parseFloat(document.getElementById('tx-price')?.value)||0;
    const fee    = parseFloat(document.getElementById('tx-fee')?.value)||0;
    const rate   = cur==='TWD' ? 1 : (parseFloat(document.getElementById('tx-rate')?.value)||1);
    if (!shares || shares <= 0) { toast('請輸入數量'); return; }
    const tx = mkTx({ assetId:asset.id, type:txType, date, shares, pricePerShare:price, fee, exchangeRate:rate, note });
    if (txType==='buy'||txType==='bonus') applyBuy(asset, shares, price, fee, rate);
    else if (txType==='sell') applySell(asset, shares);
    await Transactions.save(tx); await Assets.save(asset);
    S.transactions.push(tx);
  }

  document.getElementById('modal-tx').classList.remove('open');
  toast('交易已新增 ✓');
  render();
}

// ════════════════════════════════════════
// 更新現價 Modal
// ════════════════════════════════════════
function openUpdatePrice(id) {
  S.updateId = id;
  const a = S.assets.find(x => x.id === id);
  if (!a) return;
  document.getElementById('update-price-title').textContent = '更新現價 — ' + a.name;
  document.getElementById('update-price-input').value = a.currentPrice;
  document.getElementById('update-rate-row').style.display = a.currency !== 'TWD' ? 'flex' : 'none';
  document.getElementById('update-rate-input').value = a.exchangeRate;
  document.getElementById('update-currency-label').textContent = `匯率 (1 ${a.currency} = ? TWD)`;
  document.getElementById('modal-update-price').classList.add('open');
}

async function saveUpdatePrice() {
  const a = S.assets.find(x => x.id === S.updateId);
  if (!a) return;
  const newPrice = parseFloat(document.getElementById('update-price-input').value);
  const newRate  = parseFloat(document.getElementById('update-rate-input').value) || a.exchangeRate;
  if (!newPrice || newPrice < 0) { toast('請輸入有效價格'); return; }
  const snap = prepareUpdatePrice(a, newPrice, a.currency!=='TWD' ? newRate : undefined);
  await Assets.save(a); await Snapshots.save(snap);
  S.snapshots.push(snap);
  document.getElementById('modal-update-price').classList.remove('open');
  toast('現價已更新 ✓');
  render();
  if (S.detailId === a.id) renderDetail();
}

// ════════════════════════════════════════
// 編輯資產 Modal
// ════════════════════════════════════════
function openEditAsset(id) {
  S.editId = id;
  const a = S.assets.find(x => x.id === id);
  if (!a) return;
  document.getElementById('edit-asset-name').value = a.name;
  document.getElementById('edit-asset-ticker').value = a.ticker || '';
  document.getElementById('edit-asset-note').value = a.note || '';
  document.getElementById('edit-asset-fav').checked = a.isFavorite;
  document.getElementById('edit-asset-type').innerHTML = Object.entries(ASSET_TYPES).map(([k,v])=>`<option value="${k}" ${a.assetType===k?'selected':''}>${v.icon} ${v.name}</option>`).join('');
  document.getElementById('edit-asset-group').innerHTML = `<option value="">無群組</option>` + S.groups.map(g=>`<option value="${g.id}" ${a.groupId===g.id?'selected':''}>${g.name}</option>`).join('');
  document.getElementById('modal-edit-asset').classList.add('open');
}

async function saveEditAsset() {
  const a = S.assets.find(x => x.id === S.editId);
  if (!a) return;
  const name = document.getElementById('edit-asset-name').value.trim();
  if (!name) { toast('請輸入資產名稱'); return; }
  a.name = name;
  a.ticker = document.getElementById('edit-asset-ticker').value.trim() || null;
  a.note = document.getElementById('edit-asset-note').value.trim() || null;
  a.isFavorite = document.getElementById('edit-asset-fav').checked;
  a.assetType = document.getElementById('edit-asset-type').value;
  a.groupId = document.getElementById('edit-asset-group').value || null;
  await Assets.save(a);
  document.getElementById('modal-edit-asset').classList.remove('open');
  toast('已更新 ✓');
  render();
  if (S.detailId === a.id) renderDetail();
}

// ════════════════════════════════════════
// 新增群組 Modal
// ════════════════════════════════════════
function openAddGroup() {
  document.getElementById('new-group-name').value = '';
  document.getElementById('new-group-icon').value = '📁';
  document.getElementById('new-group-color').value = '#007AFF';
  document.getElementById('modal-add-group').classList.add('open');
}

async function saveAddGroup() {
  const name = document.getElementById('new-group-name').value.trim();
  if (!name) { toast('請輸入群組名稱'); return; }
  const g = { id: genId(), name, icon: document.getElementById('new-group-icon').value || '📁', colorHex: document.getElementById('new-group-color').value, sortOrder: S.groups.length, createdAt: new Date().toISOString() };
  await Groups.save(g);
  S.groups.push(g);
  document.getElementById('modal-add-group').classList.remove('open');
  toast('群組已新增 ✓');
  renderSettings(); renderPortfolio();
}

// ════════════════════════════════════════
// 刪除 / 封存
// ════════════════════════════════════════
async function confirmDelAsset(id) {
  if (!confirm('確定刪除此資產？所有交易記錄將一併刪除。')) return;
  await Transactions.deleteByAsset(id);
  await Snapshots.deleteByAsset(id);
  await Assets.delete(id);
  S.assets = S.assets.filter(a => a.id !== id);
  S.transactions = S.transactions.filter(t => t.assetId !== id);
  S.snapshots = S.snapshots.filter(s => s.assetId !== id);
  backDetail(); toast('已刪除');
}

async function unarchive(id) {
  const a = S.assets.find(x => x.id === id);
  if (!a) return;
  a.isArchived = false;
  await Assets.save(a);
  toast('已還原'); renderSettings(); render();
}

async function delGroup(id) {
  if (!confirm('確定刪除此群組？（資產不會被刪除）')) return;
  await Groups.delete(id);
  S.groups = S.groups.filter(g => g.id !== id);
  for (const a of S.assets.filter(a => a.groupId === id)) { a.groupId = null; await Assets.save(a); }
  if (S.groupFilter === id) S.groupFilter = null;
  toast('已刪除'); renderSettings(); renderPortfolio();
}

// ════════════════════════════════════════
// 匯出 / 匯入
// ════════════════════════════════════════
async function doExportCSV() {
  dlFile(buildCSV(S.assets, S.transactions), `MyWallet_${today()}.csv`, 'text/csv;charset=utf-8-sig;');
  toast('CSV 已匯出');
}

async function doExportJSON() {
  const data = await exportAllData();
  dlFile(JSON.stringify(data, null, 2), `MyWallet_備份_${today()}.json`, 'application/json');
  await Settings.set('lastBackupDate', new Date().toISOString());
  S.settings.lastBackupDate = new Date().toISOString();
  toast('備份已匯出'); renderSettings();
}

async function doImportJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('確定還原備份？所有現有資料將被覆蓋。')) { e.target.value=''; return; }
  try {
    const data = JSON.parse(await file.text());
    await importAllData(data);
    await loadAll();
    e.target.value='';
    toast('還原成功 ✓'); render(); renderSettings();
  } catch(err) { toast('還原失敗：' + err.message); }
}

// ════════════════════════════════════════
// 設定操作
// ════════════════════════════════════════
async function changeTheme(val) { S.settings.theme=val; await Settings.set('theme',val); applyTheme(); }
async function changeCurrency(val) { S.settings.baseCurrency=val; await Settings.set('baseCurrency',val); toast('已更新'); }

// ════════════════════════════════════════
// Modal 管理
// ════════════════════════════════════════
function setupModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); });
  });
}

// ════════════════════════════════════════
// 全域函式（HTML onclick）
// ════════════════════════════════════════
window.toggleHide = () => { S.hidden = !S.hidden; renderDash(); };
window.showDetail = showDetail;
window.backDetail = backDetail;
window.openAddTxSheet = openAddTxSheet;
window.openUpdatePrice = openUpdatePrice;
window.saveUpdatePrice = saveUpdatePrice;
window.openEditAsset = openEditAsset;
window.saveEditAsset = saveEditAsset;
window.openAddGroup = openAddGroup;
window.saveAddGroup = saveAddGroup;
window.confirmDelAsset = confirmDelAsset;
window.unarchive = unarchive;
window.delGroup = delGroup;
window.doExportCSV = doExportCSV;
window.doExportJSON = doExportJSON;
window.doImportJSON = doImportJSON;
window.changeTheme = changeTheme;
window.changeCurrency = changeCurrency;
window.setGroup = id => { S.groupFilter = id; renderPortfolio(); };
window.searchAssets = q => { S.search = q; renderPortfolio(); };
window.setSortOption = v => { S.sortOpt = v; renderPortfolio(); };
window.switchChart = tab => { S.chartTab = tab; renderCharts(); };
window.setTxType = t => { S.txForm.type = t; renderTxForm(); };
window.setTxFilter = v => { S.txFilter = v || null; renderTxList(); };
window.updSummary = updSummary;
window.renderAssetSearch = renderAssetSearch;
window.selAssetForTx = id => { S.txForm.assetId = id; renderTxForm(); };
window.clearSelAsset = () => { S.txForm.assetId = null; renderTxForm(); };
window.startNewAsset = () => { S.txForm.isNew = true; renderTxForm(); };
window.cancelNewAsset = () => { S.txForm.isNew = false; renderTxForm(); };
window.onCurChange = v => { S.txForm.currency = v; renderTxForm(); };
window.saveTx = saveTx;

// ════════════════════════════════════════
// 啟動
// ════════════════════════════════════════
document.addEventListener('DOMContentLoaded', initApp);
