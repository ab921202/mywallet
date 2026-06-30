/**
 * app.js — 主應用程式控制器
 * 管理路由、狀態、UI 渲染、事件處理
 */

import { openDB, Assets, Transactions, Groups, Snapshots, Settings, exportAllData, importAllData } from './db.js';
import {
  ASSET_TYPES, TX_TYPES, CURRENCIES, NON_STANDARD, isNonStandard,
  uuid, fmt, fmtTWD, fmtCurrency, fmtPct, fmtShares, fmtDate, fmtRelDate,
  assetValueTWD, unrealizedPnL, unrealizedRate, todayPnL, todayRate,
  applyBuy, applySell, applySplit, prepareUpdatePrice,
  newAsset, newTransaction, defaultGroups, buildCSV, downloadFile, today
} from './models.js';
import {
  renderAllocationChart, renderGroupChart, renderPnLChart,
  renderTrendChart, renderRankChart, renderAssetPriceChart
} from './charts.js';

// ════════════════════════════════════════
// 應用狀態
// ════════════════════════════════════════
const state = {
  assets: [], transactions: [], groups: [], snapshots: [],
  settings: { baseCurrency: 'TWD', theme: 'auto' },
  currentPage: 'dashboard',
  selectedGroupId: null,
  valueHidden: false,
  searchText: '',
  detailAssetId: null,
  chartTab: 'allocation',
  txFilter: null,
  sortOption: 'value',
};

// ════════════════════════════════════════
// 啟動
// ════════════════════════════════════════
async function init() {
  await openDB();
  await loadData();
  await applySettings();
  if (state.groups.length === 0) await createDefaultGroups();
  setupNav();
  setupModals();
  render();
  registerSW();
}

async function loadData() {
  [state.assets, state.transactions, state.groups, state.snapshots] =
    await Promise.all([Assets.getAll(), Transactions.getAll(), Groups.getAll(), Snapshots.getAll()]);
  const s = await Settings.getAll();
  Object.assign(state.settings, s);
  state.groups.sort((a,b) => a.sortOrder - b.sortOrder);
}

async function applySettings() {
  const { theme } = state.settings;
  if (theme && theme !== 'auto') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
}

async function createDefaultGroups() {
  const groups = defaultGroups();
  for (const g of groups) await Groups.save(g);
  state.groups = groups;
}

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// ════════════════════════════════════════
// 導航
// ════════════════════════════════════════
function setupNav() {
  document.querySelectorAll('.tab-item').forEach(el => {
    el.addEventListener('click', () => {
      const page = el.dataset.page;
      navigateTo(page);
    });
  });
  document.querySelector('.tab-add').addEventListener('click', () => openAddTxSheet());
}

function navigateTo(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`)?.classList.add('active');
  document.querySelectorAll('.tab-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  if (page === 'charts') renderChartsPage();
  if (page === 'settings') renderSettingsPage();
}

// 資產詳情（子頁面）
function showDetail(assetId) {
  state.detailAssetId = assetId;
  state.txFilter = null;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-detail').classList.add('active');
  renderDetailPage();
}

function backFromDetail() {
  state.detailAssetId = null;
  document.getElementById('page-detail').classList.remove('active');
  document.getElementById(`page-${state.currentPage}`)?.classList.add('active');
  renderPortfolioPage();
}

// ════════════════════════════════════════
// Toast
// ════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ════════════════════════════════════════
// 主渲染
// ════════════════════════════════════════
function render() {
  renderDashboard();
  renderPortfolioPage();
}

// ════════════════════════════════════════
// Dashboard
// ════════════════════════════════════════
function renderDashboard() {
  const activeAssets = state.assets.filter(a => !a.isArchived);
  const totalValue   = activeAssets.reduce((s,a) => s + assetValueTWD(a), 0);
  const totalCost    = activeAssets.reduce((s,a) => s + a.totalCost, 0);
  const totalPnL     = totalValue - totalCost;
  const totalRate    = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;
  const tPnL         = activeAssets.reduce((s,a) => s + todayPnL(a), 0);
  const prevTotal    = activeAssets.reduce((s,a) => s + a.previousClosePrice * a.totalShares * a.exchangeRate, 0);
  const tRate        = prevTotal > 0 ? (tPnL / prevTotal) * 100 : 0;

  // 總資產卡
  const heroEl = document.getElementById('hero-value');
  const heroPnLEl = document.getElementById('hero-pnl');
  heroEl.textContent = state.valueHidden ? 'NT$ ●●●●●' : fmtTWD(totalValue);
  heroEl.classList.toggle('blurred', false);

  heroPnLEl.innerHTML = `
    <span class="pnl-amount ${totalPnL >= 0 ? 'text-green' : 'text-red'}">
      ${totalPnL >= 0 ? '+' : ''}${fmtTWD(totalPnL)}
    </span>
    <span class="pnl-badge ${totalPnL >= 0 ? 'green' : 'red'}">${fmtPct(totalRate)}</span>
    <button class="eye-btn" id="toggle-hide" onclick="window.toggleValueHidden()">
      ${state.valueHidden ? '👁️' : '🙈'}
    </button>
  `;

  // 今日損益
  const todayEl = document.getElementById('today-card');
  const tColor  = tPnL >= 0 ? '#34C759' : '#FF3B30';
  todayEl.innerHTML = `
    <div class="today-bar" style="background:${tColor}"></div>
    <div class="today-info">
      <div class="today-label">☀️ 今日損益</div>
      <div class="today-value" style="color:${tColor}">${tPnL >= 0 ? '+' : ''}${fmtTWD(tPnL)}</div>
      <div class="today-rate" style="color:${tColor}">${fmtPct(tRate)}</div>
    </div>
  `;

  // 配置圖
  const result = renderAllocationChart('alloc-chart', activeAssets);
  if (result) {
    const legendEl = document.getElementById('alloc-legend');
    const total = result.total;
    legendEl.innerHTML = result.entries.slice(0,6).map(([k,v], i) => `
      <div class="legend-item">
        <div class="legend-dot" style="background:${result.colors[i]}"></div>
        <span class="legend-label">${ASSET_TYPES[k]?.name ?? k}</span>
        <span class="legend-pct">${fmt(v/total*100,1)}%</span>
      </div>
    `).join('');
  }

  // 表現排行
  const ranked = [...activeAssets].filter(a => a.totalCost > 0)
    .sort((a,b) => unrealizedRate(b) - unrealizedRate(a));
  const gainers = ranked.slice(0,3);
  const losers  = ranked.length > 3 ? ranked.slice(-3).reverse() : [];

  const topEl = document.getElementById('top-performers');
  topEl.innerHTML = '';
  if (gainers.length === 0) {
    topEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>新增資產後顯示排行</p></div>';
  } else {
    if (gainers.length) {
      topEl.insertAdjacentHTML('beforeend','<div class="section-title" style="padding:8px 0 4px">🏆 最佳表現</div>');
      topEl.insertAdjacentHTML('beforeend', gainers.map(a => performerRow(a)).join(''));
    }
    if (losers.length) {
      topEl.insertAdjacentHTML('beforeend','<div class="divider"></div><div class="section-title" style="padding:4px 0">📉 最差表現</div>');
      topEl.insertAdjacentHTML('beforeend', losers.map(a => performerRow(a)).join(''));
    }
  }

  // 最近交易
  const recentEl = document.getElementById('recent-txs');
  const recent = [...state.transactions]
    .sort((a,b) => new Date(b.date) - new Date(a.date))
    .slice(0,5);
  const assetMap = Object.fromEntries(state.assets.map(a => [a.id, a]));

  if (!recent.length) {
    recentEl.innerHTML = '<div class="empty-state" style="padding:20px"><p>尚無交易記錄</p></div>';
  } else {
    recentEl.innerHTML = recent.map(t => {
      const a = assetMap[t.assetId] || {};
      const total = ((t.shares * t.pricePerShare) + t.fee) * t.exchangeRate;
      const txInfo = TX_TYPES[t.type] || {};
      return `
        <div class="tx-row">
          <div class="tx-icon" style="background:${txInfo.color}22">${txInfo.icon || '📋'}</div>
          <div class="tx-info">
            <div class="tx-asset">${a.name || '未知資產'}</div>
            <div class="tx-meta">${txInfo.name} · ${fmtRelDate(t.date)}</div>
          </div>
          <div class="tx-right">
            <div class="tx-amount ${t.type === 'sell' || t.type === 'dividend' ? 'text-green' : ''}">
              ${t.type === 'sell' || t.type === 'dividend' ? '+' : '-'}${fmtTWD(total)}
            </div>
            <div class="tx-shares">${fmtShares(t.shares)} 股</div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function performerRow(a) {
  const rate   = unrealizedRate(a);
  const color  = rate >= 0 ? '#34C759' : '#FF3B30';
  const typeInfo = ASSET_TYPES[a.assetType] || {};
  return `
    <div class="performer-row" onclick="window.showDetail('${a.id}')">
      <div class="performer-icon" style="background:${typeInfo.color}22">${typeInfo.icon || '📦'}</div>
      <div style="flex:1;min-width:0">
        <div class="performer-name">${a.name}</div>
        <div class="performer-ticker" style="font-size:11px;color:var(--text3)">${a.ticker || typeInfo.name || ''}</div>
      </div>
      <div class="performer-rate" style="color:${color}">${fmtPct(rate)}</div>
    </div>
  `;
}

// ════════════════════════════════════════
// Portfolio
// ════════════════════════════════════════
function renderPortfolioPage() {
  renderGroupTabs();
  renderAssetList();
}

function renderGroupTabs() {
  const el = document.getElementById('group-tabs');
  const selected = state.selectedGroupId;
  el.innerHTML = `
    <div class="group-tab ${!selected ? 'active' : ''}" onclick="window.selectGroup(null)">全部</div>
    ${state.groups.map(g => `
      <div class="group-tab ${selected === g.id ? 'active' : ''}"
           onclick="window.selectGroup('${g.id}')">
        ${g.icon} ${g.name}
      </div>
    `).join('')}
  `;
}

function renderAssetList() {
  let assets = state.assets.filter(a => !a.isArchived);
  if (state.selectedGroupId) assets = assets.filter(a => a.groupId === state.selectedGroupId);

  const q = state.searchText.trim().toLowerCase();
  if (q) assets = assets.filter(a =>
    a.name.toLowerCase().includes(q) || (a.ticker || '').toLowerCase().includes(q)
  );

  // 排序
  assets = [...assets].sort((a,b) => {
    switch(state.sortOption) {
      case 'pnl':    return unrealizedRate(b) - unrealizedRate(a);
      case 'name':   return a.name.localeCompare(b.name, 'zh-TW');
      case 'recent': return new Date(b.lastUpdated) - new Date(a.lastUpdated);
      default:       return assetValueTWD(b) - assetValueTWD(a);
    }
  });

  const totalVal = assets.reduce((s,a) => s + assetValueTWD(a), 0);
  const totalPnL = assets.reduce((s,a) => s + unrealizedPnL(a), 0);

  // 彙整列
  document.getElementById('portfolio-summary').innerHTML = assets.length ? `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;font-size:13px">
      <div>
        <div style="color:var(--text3)">合計 ${assets.length} 個資產</div>
        <div style="font-weight:700;font-size:15px">${fmtTWD(totalVal)}</div>
      </div>
      <div style="text-align:right">
        <div style="color:var(--text3)">未實現損益</div>
        <div style="font-weight:700;font-size:15px;color:${totalPnL>=0?'var(--green)':'var(--red)'}">
          ${totalPnL>=0?'+':''}${fmtTWD(totalPnL)}
        </div>
      </div>
    </div>
  ` : '';

  const listEl = document.getElementById('asset-list');
  if (!assets.length) {
    listEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">💼</div>
        <h3>尚無資產</h3>
        <p>點擊下方 + 新增第一筆資產</p>
      </div>`;
    return;
  }

  listEl.innerHTML = `<div class="asset-list">${assets.map(a => assetRowHTML(a)).join('')}</div>`;
}

function assetRowHTML(a) {
  const val    = assetValueTWD(a);
  const pnl    = unrealizedPnL(a);
  const rate   = unrealizedRate(a);
  const color  = pnl >= 0 ? 'var(--green)' : 'var(--red)';
  const typeInfo = ASSET_TYPES[a.assetType] || {};
  return `
    <div class="asset-row" onclick="window.showDetail('${a.id}')">
      <div class="asset-icon" style="background:${typeInfo.color}22">${typeInfo.icon || '📦'}</div>
      <div class="asset-info">
        <div class="asset-name">${a.isFavorite ? '⭐ ' : ''}${a.name}</div>
        <div class="asset-meta">${a.ticker ? a.ticker + ' · ' : ''}${isNonStandard(a.assetType) ? '1 份' : fmtShares(a.totalShares) + ' 股'}</div>
      </div>
      <div class="asset-right">
        <div class="asset-value">${fmtTWD(val)}</div>
        <div class="asset-pnl" style="color:${color}">${fmtPct(rate)}</div>
      </div>
    </div>
  `;
}

// ════════════════════════════════════════
// 資產詳情
// ════════════════════════════════════════
function renderDetailPage() {
  const a = state.assets.find(x => x.id === state.detailAssetId);
  if (!a) return;

  const typeInfo = ASSET_TYPES[a.assetType] || {};
  const val    = assetValueTWD(a);
  const uPnL   = unrealizedPnL(a);
  const uRate  = unrealizedRate(a);
  const tPnL   = todayPnL(a);
  const tRate  = todayRate(a);

  const el = document.getElementById('page-detail');
  el.innerHTML = `
    <!-- 返回 Header -->
    <div class="page-header">
      <div class="header-row">
        <button class="back-btn" onclick="window.backFromDetail()">←</button>
        <div style="flex:1;text-align:center;font-size:17px;font-weight:700">${a.name}</div>
        <div style="display:flex;gap:8px">
          <button class="back-btn" onclick="window.openUpdatePrice('${a.id}')" title="更新現價">💹</button>
          <button class="back-btn" onclick="window.openEditAsset('${a.id}')" title="編輯">✏️</button>
        </div>
      </div>
    </div>

    <div class="page-content" style="gap:14px">
      <!-- 資產標題卡 -->
      <div class="detail-header">
        <div class="detail-icon" style="background:${typeInfo.color}22">${typeInfo.icon || '📦'}</div>
        <div>
          <div class="detail-name">${a.name}</div>
          <div class="detail-meta">
            ${a.ticker ? '<span class="chip">'+a.ticker+'</span> ' : ''}
            ${typeInfo.name} · ${a.currency}
          </div>
        </div>
      </div>

      <!-- 三格指標 -->
      <div class="metrics-grid">
        <div class="metric-cell">
          <div class="metric-label">市值</div>
          <div class="metric-value">${fmtTWD(val)}</div>
        </div>
        <div class="metric-cell">
          <div class="metric-label">未實現損益</div>
          <div class="metric-value" style="color:${uPnL>=0?'var(--green)':'var(--red)'}">
            ${uPnL>=0?'+':''}${fmtTWD(uPnL)}
          </div>
          <div class="metric-sub" style="color:${uPnL>=0?'var(--green)':'var(--red)'}">${fmtPct(uRate)}</div>
        </div>
        <div class="metric-cell">
          <div class="metric-label">今日損益</div>
          <div class="metric-value" style="color:${tPnL>=0?'var(--green)':'var(--red)'}">
            ${tPnL>=0?'+':''}${fmtTWD(tPnL)}
          </div>
          <div class="metric-sub" style="color:${tPnL>=0?'var(--green)':'var(--red)'}">${fmtPct(tRate)}</div>
        </div>
      </div>

      <!-- 走勢圖 -->
      <div class="card">
        <div class="card-title">📈 價格走勢</div>
        <div class="chart-container">
          <canvas id="asset-price-chart" height="160"></canvas>
        </div>
      </div>

      <!-- 成本卡 -->
      <div class="card">
        <div class="card-title">💼 成本明細</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          ${costCell('持有數量', isNonStandard(a.assetType) ? '1 份' : fmtShares(a.totalShares) + ' 股')}
          ${costCell('平均成本', fmtCurrency(a.avgCostPerShare, a.currency))}
          ${costCell('總投入', fmtTWD(a.totalCost))}
          ${costCell('現價', fmtCurrency(a.currentPrice, a.currency))}
          ${a.currency !== 'TWD' ? costCell('匯率', '1 '+a.currency+' = '+fmt(a.exchangeRate)+'TWD') : ''}
          ${costCell('更新時間', fmtRelDate(a.lastUpdated))}
        </div>
      </div>

      <!-- 交易記錄 -->
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="card-title" style="margin:0">📋 交易記錄</div>
          <select id="tx-filter" style="font-size:12px;color:var(--accent);background:rgba(0,122,255,0.08);border:none;border-radius:12px;padding:4px 10px;font-family:var(--font)"
            onchange="window.setTxFilter(this.value)">
            <option value="">全部</option>
            ${Object.entries(TX_TYPES).map(([k,v]) => `<option value="${k}" ${state.txFilter===k?'selected':''}>${v.name}</option>`).join('')}
          </select>
        </div>
        <div id="tx-list"></div>
      </div>

      <button class="btn btn-danger" onclick="window.confirmDeleteAsset('${a.id}')">🗑️ 刪除此資產</button>
      <div style="height:10px"></div>
    </div>
  `;

  // 走勢圖
  const snaps = state.snapshots.filter(s => s.assetId === a.id);
  renderAssetPriceChart('asset-price-chart', snaps);
  renderTxList(a.id);
}

function costCell(label, value) {
  return `
    <div>
      <div style="font-size:10px;color:var(--text3);font-weight:500;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px">${label}</div>
      <div style="font-size:14px;font-weight:600">${value}</div>
    </div>
  `;
}

function renderTxList(assetId) {
  let txs = state.transactions.filter(t => t.assetId === assetId);
  if (state.txFilter) txs = txs.filter(t => t.type === state.txFilter);
  txs.sort((a,b) => new Date(b.date) - new Date(a.date));

  const el = document.getElementById('tx-list');
  if (!el) return;
  if (!txs.length) { el.innerHTML = '<div class="empty-state" style="padding:20px"><p>尚無交易記錄</p></div>'; return; }

  el.innerHTML = txs.map(t => {
    const txInfo = TX_TYPES[t.type] || {};
    const total  = ((t.shares * t.pricePerShare) + t.fee) * t.exchangeRate;
    return `
      <div class="tx-row">
        <div class="tx-icon" style="background:${txInfo.color}22">${txInfo.icon || '📋'}</div>
        <div class="tx-info">
          <div class="tx-asset">${txInfo.name}</div>
          <div class="tx-meta">${fmtDate(t.date)}${t.note ? ' · ' + t.note : ''}</div>
        </div>
        <div class="tx-right">
          <div class="tx-amount">${fmtTWD(total)}</div>
          <div class="tx-shares">${t.type === 'split' && t.splitNewShares ? '→ '+fmtShares(t.splitNewShares)+' 股' : fmtShares(t.shares)+' 股'}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ════════════════════════════════════════
// Charts
// ════════════════════════════════════════
function renderChartsPage() {
  const tabs = ['allocation','group','pnl','trend','ranking'];
  const labels = ['資產配置','群組配置','損益','走勢','排行'];
  document.getElementById('charts-tabs').innerHTML = tabs.map((t,i) => `
    <div class="seg-btn ${state.chartTab === t ? 'active' : ''}" onclick="window.switchChartTab('${t}')">${labels[i]}</div>
  `).join('');
  renderChartContent();
}

function renderChartContent() {
  const el = document.getElementById('charts-content');
  const active = state.assets.filter(a => !a.isArchived);

  switch(state.chartTab) {
    case 'allocation':
      el.innerHTML = `<div class="card"><div class="card-title">📊 按資產類別</div><div class="chart-container"><canvas id="chart-alloc" height="240"></canvas></div><div id="chart-legend" class="legend" style="margin-top:12px"></div></div>`;
      setTimeout(() => {
        const r = renderAllocationChart('chart-alloc', active);
        if (r) document.getElementById('chart-legend').innerHTML = r.entries.map(([k,v],i) => `
          <div class="legend-item">
            <div class="legend-dot" style="background:${r.colors[i]}"></div>
            <span class="legend-label">${ASSET_TYPES[k]?.name ?? k}</span>
            <span class="legend-pct">${fmt(v/r.total*100,1)}%</span>
          </div>`).join('');
      }, 50);
      break;

    case 'group':
      el.innerHTML = `<div class="card"><div class="card-title">📁 按群組</div><div class="chart-container"><canvas id="chart-group" height="240"></canvas></div><div id="chart-group-legend" class="legend" style="margin-top:12px"></div></div>`;
      setTimeout(() => {
        const r = renderGroupChart('chart-group', active, state.groups);
        if (r) document.getElementById('chart-group-legend').innerHTML = r.entries.map(([k,v],i) => `
          <div class="legend-item">
            <div class="legend-dot" style="background:${r.colors[i]}"></div>
            <span class="legend-label">${k}</span>
            <span class="legend-pct">${fmt(v/r.total*100,1)}%</span>
          </div>`).join('');
      }, 50);
      break;

    case 'pnl':
      el.innerHTML = `<div class="card"><div class="card-title">💹 各資產未實現損益</div><div class="chart-container" style="overflow:auto"><canvas id="chart-pnl"></canvas></div></div>`;
      setTimeout(() => renderPnLChart('chart-pnl', active), 50);
      break;

    case 'trend':
      el.innerHTML = `<div class="card"><div class="card-title">📈 總資產走勢</div><div class="chart-container" id="chart-trend-wrap"><canvas id="chart-trend" height="220"></canvas></div></div>`;
      setTimeout(() => renderTrendChart('chart-trend', state.snapshots, active), 50);
      break;

    case 'ranking':
      el.innerHTML = `<div class="card"><div class="card-title">🏆 報酬率排行</div><div class="chart-container" style="overflow:auto"><canvas id="chart-rank"></canvas></div></div>`;
      setTimeout(() => renderRankChart('chart-rank', active), 50);
      break;
  }
}

// ════════════════════════════════════════
// Settings
// ════════════════════════════════════════
function renderSettingsPage() {
  const { theme, baseCurrency, lastBackupDate } = state.settings;

  document.getElementById('settings-content').innerHTML = `
    <!-- 外觀 -->
    <div class="settings-group-title">外觀</div>
    <div class="settings-group">
      <div class="settings-row">
        <span class="settings-icon">🌙</span>
        <span class="settings-label">顯示模式</span>
        <select id="theme-select" style="font-size:14px;color:var(--text3);background:none;border:none;font-family:var(--font)"
          onchange="window.changeTheme(this.value)">
          <option value="auto"  ${theme==='auto'||!theme?'selected':''}>跟隨系統</option>
          <option value="dark"  ${theme==='dark'?'selected':''}>深色</option>
          <option value="light" ${theme==='light'?'selected':''}>淺色</option>
        </select>
      </div>
    </div>

    <!-- 幣別 -->
    <div class="settings-group-title" style="margin-top:20px">幣別</div>
    <div class="settings-group">
      <div class="settings-row">
        <span class="settings-icon">💱</span>
        <span class="settings-label">基準幣別</span>
        <select id="currency-select" style="font-size:14px;color:var(--text3);background:none;border:none;font-family:var(--font)"
          onchange="window.changeCurrency(this.value)">
          ${Object.entries(CURRENCIES).map(([k,v]) => `<option value="${k}" ${baseCurrency===k?'selected':''}>${v.symbol} ${k}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- 群組管理 -->
    <div class="settings-group-title" style="margin-top:20px">群組管理</div>
    <div class="settings-group">
      ${state.groups.map(g => `
        <div class="settings-row">
          <span class="settings-icon">${g.icon}</span>
          <span class="settings-label">${g.name}</span>
          <span class="settings-value">${state.assets.filter(a => a.groupId === g.id && !a.isArchived).length} 個</span>
          <button style="background:none;border:none;color:var(--red);font-size:16px;cursor:pointer;padding:4px"
            onclick="window.deleteGroup('${g.id}')">🗑️</button>
        </div>
      `).join('')}
      <div class="settings-row" style="cursor:pointer" onclick="window.openAddGroup()">
        <span class="settings-icon">➕</span>
        <span class="settings-label" style="color:var(--accent)">新增群組</span>
      </div>
    </div>

    <!-- 資料 -->
    <div class="settings-group-title" style="margin-top:20px">資料</div>
    <div class="settings-group">
      <div class="settings-row" style="cursor:pointer" onclick="window.exportCSV()">
        <span class="settings-icon">📄</span>
        <span class="settings-label">匯出交易記錄 (CSV)</span>
      </div>
      <div class="settings-row" style="cursor:pointer" onclick="window.exportJSON()">
        <span class="settings-icon">💾</span>
        <span class="settings-label">完整備份 (JSON)</span>
        ${lastBackupDate ? `<span class="settings-value">${fmtRelDate(lastBackupDate)}</span>` : ''}
      </div>
      <div class="settings-row" style="cursor:pointer" onclick="document.getElementById('import-input').click()">
        <span class="settings-icon">📂</span>
        <span class="settings-label">還原備份</span>
      </div>
      <input type="file" id="import-input" accept=".json" style="display:none" onchange="window.importJSON(event)">
    </div>

    <!-- 封存資產 -->
    <div class="settings-group-title" style="margin-top:20px">封存資產</div>
    <div class="settings-group">
      ${state.assets.filter(a => a.isArchived).length === 0
        ? '<div class="settings-row"><span class="settings-value" style="flex:1;text-align:center">無封存資產</span></div>'
        : state.assets.filter(a => a.isArchived).map(a => `
            <div class="settings-row">
              <span class="settings-label">${a.name}</span>
              <button style="background:none;border:none;color:var(--accent);font-size:13px;cursor:pointer"
                onclick="window.unarchiveAsset('${a.id}')">還原</button>
            </div>`).join('')
      }
    </div>

    <!-- 關於 -->
    <div class="settings-group-title" style="margin-top:20px">關於</div>
    <div class="settings-group">
      <div class="settings-row">
        <span class="settings-icon">📱</span>
        <span class="settings-label">版本</span>
        <span class="settings-value">v1.0 PWA</span>
      </div>
      <div class="settings-row">
        <span class="settings-icon">💼</span>
        <span class="settings-label">資產數量</span>
        <span class="settings-value">${state.assets.filter(a=>!a.isArchived).length} 個</span>
      </div>
      <div class="settings-row">
        <span class="settings-icon">🔒</span>
        <span class="settings-label">資料儲存</span>
        <span class="settings-value">本機 IndexedDB</span>
      </div>
    </div>
    <div style="height:20px"></div>
  `;
}

// ════════════════════════════════════════
// Modal：新增/編輯交易
// ════════════════════════════════════════
let txForm = { assetId: null, isNewAsset: false };

function openAddTxSheet(preselectedAssetId = null) {
  txForm = { assetId: preselectedAssetId, isNewAsset: false, type: 'buy' };
  const modal = document.getElementById('modal-tx');
  modal.querySelector('.sheet-title').textContent = '新增交易';
  renderTxForm();
  modal.classList.add('open');
}

function renderTxForm() {
  const body = document.getElementById('tx-form-body');
  const selectedAsset = state.assets.find(a => a.id === txForm.assetId);
  const txType = txForm.type || 'buy';
  const isSplit = txType === 'split';
  const currency = selectedAsset?.currency || txForm.currency || 'TWD';
  const rate = selectedAsset?.exchangeRate || txForm.exchangeRate || 1;

  body.innerHTML = `
    <!-- 資產選擇 -->
    <div class="form-section">
      <label class="form-label">資產</label>
      ${selectedAsset ? `
        <div class="form-group">
          <div class="form-row">
            <span style="font-size:20px">${ASSET_TYPES[selectedAsset.assetType]?.icon || '📦'}</span>
            <span class="form-row-label">${selectedAsset.name}</span>
            <button style="background:none;border:none;color:var(--accent);font-size:13px;cursor:pointer"
              onclick="window.clearSelectedAsset()">更換</button>
          </div>
        </div>
      ` : txForm.isNewAsset ? `
        <div class="form-group">
          <div class="form-row">
            <span class="form-row-label">名稱</span>
            <input type="text" id="new-asset-name" placeholder="e.g. 台積電" value="${txForm.newAssetName||''}">
          </div>
          <div class="form-row">
            <span class="form-row-label">代碼</span>
            <input type="text" id="new-asset-ticker" placeholder="選填" value="${txForm.newAssetTicker||''}">
          </div>
          <div class="form-row">
            <span class="form-row-label">類別</span>
            <select id="new-asset-type">
              ${Object.entries(ASSET_TYPES).map(([k,v]) => `<option value="${k}" ${(txForm.newAssetType||'stock')===k?'selected':''}>${v.icon} ${v.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <span class="form-row-label">幣別</span>
            <select id="new-asset-currency" onchange="window.onCurrencyChange(this.value)">
              ${Object.entries(CURRENCIES).map(([k,v]) => `<option value="${k}" ${(txForm.currency||'TWD')===k?'selected':''}>${k}</option>`).join('')}
            </select>
          </div>
          <div class="form-row">
            <span class="form-row-label">群組</span>
            <select id="new-asset-group">
              <option value="">無群組</option>
              ${state.groups.map(g => `<option value="${g.id}" ${txForm.newAssetGroupId===g.id?'selected':''}>${g.name}</option>`).join('')}
            </select>
          </div>
          <div class="form-row" style="cursor:pointer" onclick="window.cancelNewAsset()">
            <span class="form-row-label secondary">取消，選擇現有資產</span>
          </div>
        </div>
      ` : `
        <div class="form-group">
          <div class="form-row" style="flex-direction:column;align-items:stretch;gap:8px;padding:12px">
            <input type="text" id="asset-search" placeholder="🔍 搜尋資產名稱或代碼" style="text-align:left;background:var(--surface2);border-radius:8px;padding:8px 10px;border:1px solid var(--border)" oninput="window.renderAssetSearch(this.value)">
            <div id="asset-search-results" style="max-height:180px;overflow-y:auto"></div>
          </div>
          <div class="form-row" style="cursor:pointer" onclick="window.startNewAsset()">
            <span style="color:var(--accent)">➕ 建立新資產</span>
          </div>
        </div>
        <script>window.renderAssetSearch('')<\/script>
      `}
    </div>

    <!-- 交易類型 -->
    <div class="form-section">
      <label class="form-label">類型</label>
      <div class="seg-ctrl">
        ${Object.entries(TX_TYPES).map(([k,v]) => `
          <button class="seg-btn ${txType===k?'active':''}" onclick="window.setTxType('${k}')">${v.name}</button>
        `).join('')}
      </div>
    </div>

    <!-- 日期 -->
    <div class="form-section">
      <label class="form-label">日期</label>
      <div class="form-group">
        <div class="form-row">
          <input type="date" id="tx-date" value="${txForm.date||today()}" style="text-align:left;flex:1">
        </div>
      </div>
    </div>

    ${isSplit ? `
      <!-- 分割：新股數 -->
      <div class="form-section">
        <label class="form-label">分割後新股數</label>
        <div class="form-group">
          <div class="form-row">
            <span class="form-row-label">新股數</span>
            <input type="number" id="split-shares" placeholder="0" value="${txForm.splitNewShares||''}">
          </div>
        </div>
      </div>
    ` : `
      <!-- 交易明細 -->
      <div class="form-section">
        <label class="form-label">交易明細</label>
        <div class="form-group">
          <div class="form-row">
            <span class="form-row-label">數量${isNonStandard(selectedAsset?.assetType||txForm.newAssetType||'stock')?' (份)':' (股)'}</span>
            <input type="number" id="tx-shares" placeholder="0" value="${txForm.shares||''}" oninput="window.updateTxSummary()">
          </div>
          <div class="form-row">
            <span class="form-row-label">每${isNonStandard(selectedAsset?.assetType||txForm.newAssetType||'stock')?'份':'股'}價格 (${currency})</span>
            <input type="number" id="tx-price" placeholder="0.00" value="${txForm.price||''}" oninput="window.updateTxSummary()">
          </div>
          <div class="form-row">
            <span class="form-row-label">手續費 (${currency})</span>
            <input type="number" id="tx-fee" placeholder="0" value="${txForm.fee??'0'}" oninput="window.updateTxSummary()">
          </div>
          ${currency !== 'TWD' ? `
            <div class="form-row">
              <span class="form-row-label">匯率 (1 ${currency} = ? TWD)</span>
              <input type="number" id="tx-rate" placeholder="1" value="${rate}" oninput="window.updateTxSummary()">
            </div>
          ` : ''}
        </div>
      </div>

      <!-- 合計 -->
      <div id="tx-summary" style="margin-bottom:16px"></div>
    `}

    <!-- 備註 -->
    <div class="form-section">
      <label class="form-label">備註（選填）</label>
      <div class="form-group">
        <div class="form-row">
          <textarea id="tx-note" placeholder="輸入備註...">${txForm.note||''}</textarea>
        </div>
      </div>
    </div>

    <button class="btn btn-primary" id="save-tx-btn" onclick="window.saveTx()" style="margin-bottom:20px">儲存交易</button>
  `;

  updateTxSummary();
}

function renderAssetSearch(q) {
  const el = document.getElementById('asset-search-results');
  if (!el) return;
  const lower = q.toLowerCase();
  const filtered = state.assets.filter(a => !a.isArchived && (
    !q || a.name.toLowerCase().includes(lower) || (a.ticker||'').toLowerCase().includes(lower)
  )).slice(0, 8);

  el.innerHTML = filtered.length ? filtered.map(a => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px;cursor:pointer;border-radius:8px"
      onclick="window.selectAssetForTx('${a.id}')" class="asset-search-item">
      <span>${ASSET_TYPES[a.assetType]?.icon||'📦'}</span>
      <span style="font-size:14px;font-weight:500">${a.name}</span>
      <span style="font-size:11px;color:var(--text3)">${a.ticker||''}</span>
    </div>
  `).join('') : '<div style="padding:8px;color:var(--text3);font-size:13px">找不到資產</div>';
}

function updateTxSummary() {
  const el = document.getElementById('tx-summary');
  if (!el) return;
  const shares = parseFloat(document.getElementById('tx-shares')?.value) || 0;
  const price  = parseFloat(document.getElementById('tx-price')?.value)  || 0;
  const fee    = parseFloat(document.getElementById('tx-fee')?.value)    || 0;
  const rate   = parseFloat(document.getElementById('tx-rate')?.value)   || 1;
  if (!shares && !price) { el.innerHTML = ''; return; }
  const total = (shares * price + fee) * rate;
  el.innerHTML = `
    <div class="summary-row">
      <span class="summary-label">合計 (${fmtShares(shares)} × ${fmt(price)} + ${fmt(fee)} 費) × ${fmt(rate,4)}</span>
      <span class="summary-value">${fmtTWD(total)}</span>
    </div>
  `;
}

// ════════════════════════════════════════
// Modal：更新現價
// ════════════════════════════════════════
let updatePriceAssetId = null;

function openUpdatePrice(assetId) {
  updatePriceAssetId = assetId;
  const a = state.assets.find(x => x.id === assetId);
  if (!a) return;
  const modal = document.getElementById('modal-update-price');
  document.getElementById('update-price-title').textContent = `更新現價 — ${a.name}`;
  document.getElementById('update-price-input').value = a.currentPrice;
  document.getElementById('update-rate-row').style.display = a.currency !== 'TWD' ? 'flex' : 'none';
  document.getElementById('update-rate-input').value = a.exchangeRate;
  document.getElementById('update-currency-label').textContent = `(1 ${a.currency} = ? TWD)`;
  modal.classList.add('open');
}

async function saveUpdatePrice() {
  const a = state.assets.find(x => x.id === updatePriceAssetId);
  if (!a) return;
  const newPrice = parseFloat(document.getElementById('update-price-input').value);
  const newRate  = parseFloat(document.getElementById('update-rate-input').value) || a.exchangeRate;
  if (!newPrice || newPrice <= 0) { showToast('請輸入有效價格'); return; }

  const snapshot = prepareUpdatePrice(a, newPrice, a.currency !== 'TWD' ? newRate : undefined);
  await Assets.save(a);
  await Snapshots.save(snapshot);
  state.snapshots.push(snapshot);
  document.getElementById('modal-update-price').classList.remove('open');
  showToast('現價已更新 ✓');
  render();
  if (state.detailAssetId === a.id) renderDetailPage();
}

// ════════════════════════════════════════
// Modal：編輯資產
// ════════════════════════════════════════
let editAssetId = null;

function openEditAsset(assetId) {
  editAssetId = assetId;
  const a = state.assets.find(x => x.id === assetId);
  if (!a) return;
  const modal = document.getElementById('modal-edit-asset');
  document.getElementById('edit-asset-name').value = a.name;
  document.getElementById('edit-asset-ticker').value = a.ticker || '';
  document.getElementById('edit-asset-note').value = a.note || '';
  document.getElementById('edit-asset-fav').checked = a.isFavorite;

  const typeSelect = document.getElementById('edit-asset-type');
  typeSelect.innerHTML = Object.entries(ASSET_TYPES).map(([k,v]) => `<option value="${k}" ${a.assetType===k?'selected':''}>${v.icon} ${v.name}</option>`).join('');

  const groupSelect = document.getElementById('edit-asset-group');
  groupSelect.innerHTML = `<option value="">無群組</option>` +
    state.groups.map(g => `<option value="${g.id}" ${a.groupId===g.id?'selected':''}>${g.name}</option>`).join('');

  modal.classList.add('open');
}

async function saveEditAsset() {
  const a = state.assets.find(x => x.id === editAssetId);
  if (!a) return;
  a.name      = document.getElementById('edit-asset-name').value.trim();
  a.ticker    = document.getElementById('edit-asset-ticker').value.trim() || null;
  a.note      = document.getElementById('edit-asset-note').value.trim() || null;
  a.isFavorite = document.getElementById('edit-asset-fav').checked;
  a.assetType = document.getElementById('edit-asset-type').value;
  a.groupId   = document.getElementById('edit-asset-group').value || null;
  if (!a.name) { showToast('請輸入資產名稱'); return; }
  await Assets.save(a);
  document.getElementById('modal-edit-asset').classList.remove('open');
  showToast('已更新 ✓');
  render();
  if (state.detailAssetId === a.id) renderDetailPage();
}

// ════════════════════════════════════════
// Modal：新增群組
// ════════════════════════════════════════
function openAddGroup() {
  document.getElementById('modal-add-group').classList.add('open');
  document.getElementById('new-group-name').value = '';
  document.getElementById('new-group-icon').value = '📁';
  document.getElementById('new-group-color').value = '#007AFF';
}

async function saveAddGroup() {
  const name  = document.getElementById('new-group-name').value.trim();
  const icon  = document.getElementById('new-group-icon').value.trim() || '📁';
  const color = document.getElementById('new-group-color').value;
  if (!name) { showToast('請輸入群組名稱'); return; }
  const group = { id: uuid(), name, icon, colorHex: color, sortOrder: state.groups.length, createdAt: new Date().toISOString() };
  await Groups.save(group);
  state.groups.push(group);
  document.getElementById('modal-add-group').classList.remove('open');
  showToast('群組已新增 ✓');
  renderSettingsPage();
  renderPortfolioPage();
}

// ════════════════════════════════════════
// 儲存交易（核心邏輯）
// ════════════════════════════════════════
async function saveTx() {
  const txType = txForm.type || 'buy';
  const dateEl  = document.getElementById('tx-date');
  const noteEl  = document.getElementById('tx-note');

  let asset;

  // 1. 取得資產
  if (txForm.assetId) {
    asset = state.assets.find(a => a.id === txForm.assetId);
  } else if (txForm.isNewAsset) {
    const name = document.getElementById('new-asset-name')?.value?.trim();
    if (!name) { showToast('請輸入資產名稱'); return; }
    asset = newAsset({
      name,
      ticker:    document.getElementById('new-asset-ticker')?.value?.trim() || null,
      assetType: document.getElementById('new-asset-type')?.value || 'stock',
      currency:  document.getElementById('new-asset-currency')?.value || 'TWD',
      exchangeRate: parseFloat(document.getElementById('tx-rate')?.value) || 1,
      groupId:   document.getElementById('new-asset-group')?.value || null,
    });
    if (isNonStandard(asset.assetType)) asset.totalShares = 1;
    await Assets.save(asset);
    state.assets.push(asset);
  } else {
    showToast('請選擇或建立資產'); return;
  }

  if (!asset) { showToast('找不到資產'); return; }

  const currency = asset.currency;
  const date  = dateEl?.value || today();
  const note  = noteEl?.value?.trim() || null;

  if (txType === 'split') {
    const newShares = parseFloat(document.getElementById('split-shares')?.value);
    if (!newShares || newShares <= 0) { showToast('請輸入分割後股數'); return; }
    const tx = newTransaction({ assetId: asset.id, type: 'split', date, shares: asset.totalShares, pricePerShare: 0, fee: 0, exchangeRate: asset.exchangeRate, splitNewShares: newShares, note });
    applySplit(asset, newShares);
    await Transactions.save(tx);
    await Assets.save(asset);
    state.transactions.push(tx);
  } else {
    const shares = parseFloat(document.getElementById('tx-shares')?.value);
    const price  = parseFloat(document.getElementById('tx-price')?.value);
    const fee    = parseFloat(document.getElementById('tx-fee')?.value) || 0;
    const rate   = currency === 'TWD' ? 1 : (parseFloat(document.getElementById('tx-rate')?.value) || 1);
    if (!shares || shares <= 0) { showToast('請輸入數量'); return; }
    if (price < 0) { showToast('請輸入價格'); return; }

    const tx = newTransaction({ assetId: asset.id, type: txType, date, shares, pricePerShare: price, fee, exchangeRate: rate, note });
    await Transactions.save(tx);
    state.transactions.push(tx);

    switch(txType) {
      case 'buy': case 'bonus': applyBuy(asset, shares, price, fee, rate); break;
      case 'sell': applySell(asset, shares); break;
      case 'dividend': break;
    }
    await Assets.save(asset);
  }

  document.getElementById('modal-tx').classList.remove('open');
  showToast('交易已新增 ✓');
  render();
}

// ════════════════════════════════════════
// 刪除 / 封存
// ════════════════════════════════════════
async function confirmDeleteAsset(assetId) {
  if (!confirm('確定刪除此資產？所有交易記錄將一併刪除。')) return;
  await Transactions.deleteByAsset(assetId);
  await Snapshots.deleteByAsset(assetId);
  await Assets.delete(assetId);
  state.assets        = state.assets.filter(a => a.id !== assetId);
  state.transactions  = state.transactions.filter(t => t.assetId !== assetId);
  state.snapshots     = state.snapshots.filter(s => s.assetId !== assetId);
  backFromDetail();
  showToast('已刪除');
}

async function unarchiveAsset(assetId) {
  const a = state.assets.find(x => x.id === assetId);
  if (!a) return;
  a.isArchived = false;
  await Assets.save(a);
  showToast('已還原');
  renderSettingsPage();
  render();
}

async function deleteGroup(groupId) {
  if (!confirm('確定刪除此群組？（資產不會被刪除）')) return;
  await Groups.delete(groupId);
  state.groups = state.groups.filter(g => g.id !== groupId);
  state.assets.filter(a => a.groupId === groupId).forEach(a => { a.groupId = null; Assets.save(a); });
  if (state.selectedGroupId === groupId) state.selectedGroupId = null;
  showToast('已刪除');
  renderSettingsPage();
  renderPortfolioPage();
}

// ════════════════════════════════════════
// 匯出 / 匯入
// ════════════════════════════════════════
async function exportCSV() {
  const csv = buildCSV(state.assets, state.transactions);
  downloadFile(csv, `MyWallet_交易記錄_${today()}.csv`, 'text/csv;charset=utf-8-sig;');
  showToast('CSV 已匯出');
}

async function exportJSON() {
  const data = await exportAllData();
  downloadFile(JSON.stringify(data, null, 2), `MyWallet_備份_${today()}.json`, 'application/json');
  await Settings.set('lastBackupDate', new Date().toISOString());
  state.settings.lastBackupDate = new Date().toISOString();
  showToast('備份已匯出');
  renderSettingsPage();
}

async function importJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!confirm('確定還原備份？所有現有資料將被覆蓋。')) { event.target.value = ''; return; }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await importAllData(data);
    await loadData();
    event.target.value = '';
    showToast('還原成功 ✓');
    render();
    renderSettingsPage();
  } catch(e) {
    showToast('還原失敗：' + e.message);
  }
}

// ════════════════════════════════════════
// 設定操作
// ════════════════════════════════════════
async function changeTheme(val) {
  state.settings.theme = val;
  await Settings.set('theme', val);
  applySettings();
}

async function changeCurrency(val) {
  state.settings.baseCurrency = val;
  await Settings.set('baseCurrency', val);
  showToast('幣別已更新');
}

// ════════════════════════════════════════
// Modal 管理
// ════════════════════════════════════════
function setupModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m) m.classList.remove('open');
    });
  });
}

// ════════════════════════════════════════
// 全域函式（HTML onclick 使用）
// ════════════════════════════════════════
Object.assign(window, {
  toggleValueHidden: () => { state.valueHidden = !state.valueHidden; renderDashboard(); },
  showDetail,
  backFromDetail,
  selectGroup: id => { state.selectedGroupId = id; renderPortfolioPage(); },
  openAddTxSheet,
  openUpdatePrice,
  saveUpdatePrice,
  openEditAsset,
  saveEditAsset,
  openAddGroup,
  saveAddGroup,
  confirmDeleteAsset,
  unarchiveAsset,
  deleteGroup,
  exportCSV,
  exportJSON,
  importJSON,
  changeTheme,
  changeCurrency,
  switchChartTab: tab => { state.chartTab = tab; renderChartsPage(); },
  setTxType: type => { txForm.type = type; renderTxForm(); },
  setTxFilter: val => { state.txFilter = val || null; renderTxList(state.detailAssetId); },
  updateTxSummary,
  renderAssetSearch,
  selectAssetForTx: id => { txForm.assetId = id; renderTxForm(); },
  clearSelectedAsset: () => { txForm.assetId = null; renderTxForm(); },
  startNewAsset: () => { txForm.isNewAsset = true; renderTxForm(); },
  cancelNewAsset: () => { txForm.isNewAsset = false; renderTxForm(); },
  onCurrencyChange: val => { txForm.currency = val; renderTxForm(); },
  saveTx,
  setSortOption: v => { state.sortOption = v; renderPortfolioPage(); },
  searchAssets: q => { state.searchText = q; renderAssetList(); },
});

// ════════════════════════════════════════
// 啟動
// ════════════════════════════════════════
init();
