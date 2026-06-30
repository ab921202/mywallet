/**
 * charts.js — Chart.js 圖表渲染
 */
import { ASSET_TYPES, fmt, fmtTWD, fmtPct, assetValueTWD, unrealizedPnL, unrealizedRate } from './models.js';

let chartInstances = {};

function destroyChart(id) {
  if (chartInstances[id]) {
    chartInstances[id].destroy();
    delete chartInstances[id];
  }
}

// ── 圓餅圖：按資產類別 ──
export function renderAllocationChart(canvasId, assets) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const grouped = {};
  for (const a of assets.filter(a => !a.isArchived)) {
    const val = assetValueTWD(a);
    const type = a.assetType;
    grouped[type] = (grouped[type] || 0) + val;
  }

  const entries = Object.entries(grouped).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
  if (!entries.length) { canvas.parentElement.innerHTML = '<div class="empty-state"><div class="icon">📊</div><p>尚無資料</p></div>'; return; }

  const labels = entries.map(([k]) => ASSET_TYPES[k]?.name ?? k);
  const data   = entries.map(([,v]) => v);
  const colors = entries.map(([k]) => ASSET_TYPES[k]?.color ?? '#8E8E93');
  const total  = data.reduce((s,v) => s+v, 0);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: 'transparent', hoverBorderColor: 'transparent' }] },
    options: {
      cutout: '60%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.label}: NT$${Math.round(ctx.raw).toLocaleString('zh-TW')} (${fmt(ctx.raw/total*100,1)}%)`,
          }
        }
      }
    }
  });
  return { entries, total, labels, colors };
}

// ── 圓餅圖：按群組 ──
export function renderGroupChart(canvasId, assets, groups) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const groupMap = Object.fromEntries(groups.map(g => [g.id, g]));
  const grouped  = {};
  const colorMap = {};

  for (const a of assets.filter(a => !a.isArchived)) {
    const val  = assetValueTWD(a);
    const name = a.groupId && groupMap[a.groupId] ? groupMap[a.groupId].name : '未分組';
    const hex  = a.groupId && groupMap[a.groupId] ? groupMap[a.groupId].colorHex : '#8E8E93';
    grouped[name]  = (grouped[name]  || 0) + val;
    colorMap[name] = hex;
  }

  const entries = Object.entries(grouped).filter(([,v]) => v > 0).sort((a,b) => b[1]-a[1]);
  if (!entries.length) return;

  const labels = entries.map(([k]) => k);
  const data   = entries.map(([,v]) => v);
  const colors = entries.map(([k]) => colorMap[k]);
  const total  = data.reduce((s,v) => s+v, 0);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: 'transparent' }] },
    options: {
      cutout: '60%',
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: NT$${Math.round(ctx.raw).toLocaleString('zh-TW')} (${fmt(ctx.raw/total*100,1)}%)` } }
      }
    }
  });
  return { entries, total, labels, colors };
}

// ── 損益橫條圖 ──
export function renderPnLChart(canvasId, assets) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const sorted = assets.filter(a => !a.isArchived && a.totalCost > 0)
    .map(a => ({ name: a.name, pnl: unrealizedPnL(a) }))
    .sort((a,b) => b.pnl - a.pnl)
    .slice(0, 12);

  if (!sorted.length) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

  canvas.height = Math.max(sorted.length * 44, 200);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map(d => d.name),
      datasets: [{
        data: sorted.map(d => d.pnl),
        backgroundColor: sorted.map(d => d.pnl >= 0 ? 'rgba(52,199,89,0.7)' : 'rgba(255,59,48,0.7)'),
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `NT$${Math.round(ctx.raw).toLocaleString('zh-TW')}` } }
      },
      scales: {
        x: { ticks: { color: isDark ? '#8E8E93' : '#6C6C70', callback: v => 'NT$'+(v>=0?'':'-')+Math.abs(Math.round(v)).toLocaleString() }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
        y: { ticks: { color: isDark ? '#EBEBF5' : '#3C3C43', font: { size: 12 } }, grid: { display: false } }
      }
    }
  });
}

// ── 總資產走勢折線圖 ──
export function renderTrendChart(canvasId, snapshots, assets) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const assetMap = Object.fromEntries(assets.map(a => [a.id, a]));
  const dateMap  = {};

  for (const s of snapshots) {
    const day  = s.recordedAt.split('T')[0];
    const a    = assetMap[s.assetId];
    if (!a) continue;
    dateMap[day] = (dateMap[day] || 0) + s.price * a.totalShares * a.exchangeRate;
  }

  const entries = Object.entries(dateMap).sort(([a],[b]) => a.localeCompare(b));
  if (entries.length < 2) { canvas.parentElement.innerHTML = '<div class="empty-state"><div class="icon">📈</div><p>更新各資產現價後將顯示走勢</p></div>'; return; }

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: entries.map(([d]) => d),
      datasets: [{
        data: entries.map(([,v]) => v),
        borderColor: '#007AFF',
        backgroundColor: 'rgba(0,122,255,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#007AFF',
        borderWidth: 2.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmtTWD(ctx.raw) } }
      },
      scales: {
        x: { ticks: { color: isDark ? '#8E8E93' : '#6C6C70', maxTicksLimit: 6 }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
        y: { ticks: { color: isDark ? '#8E8E93' : '#6C6C70', callback: v => 'NT$'+Math.round(v).toLocaleString() }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } }
      }
    }
  });
}

// ── 報酬率排行橫條圖 ──
export function renderRankChart(canvasId, assets) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const sorted = assets.filter(a => !a.isArchived && a.totalCost > 0)
    .map(a => ({ name: a.name, rate: unrealizedRate(a) }))
    .sort((a,b) => b.rate - a.rate)
    .slice(0, 12);

  if (!sorted.length) return;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

  canvas.height = Math.max(sorted.length * 44, 200);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: sorted.map(d => d.name),
      datasets: [{
        data: sorted.map(d => d.rate),
        backgroundColor: sorted.map(d => d.rate >= 0 ? 'rgba(52,199,89,0.7)' : 'rgba(255,59,48,0.7)'),
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => fmtPct(ctx.raw) } }
      },
      scales: {
        x: { ticks: { color: isDark ? '#8E8E93' : '#6C6C70', callback: v => v.toFixed(1)+'%' }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
        y: { ticks: { color: isDark ? '#EBEBF5' : '#3C3C43', font: { size: 12 } }, grid: { display: false } }
      }
    }
  });
}

// ── 單資產走勢圖 ──
export function renderAssetPriceChart(canvasId, snapshots) {
  destroyChart(canvasId);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const sorted = [...snapshots].sort((a,b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  if (sorted.length < 2) { canvas.parentElement.innerHTML = '<div class="empty-state" style="padding:30px"><div class="icon">📈</div><p>更新現價後將顯示走勢</p></div>'; return; }

  const first = sorted[0].price;
  const last  = sorted[sorted.length-1].price;
  const isUp  = last >= first;

  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || (!document.documentElement.hasAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);

  chartInstances[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: sorted.map(s => s.recordedAt.split('T')[0]),
      datasets: [{
        data: sorted.map(s => s.price),
        borderColor: isUp ? '#34C759' : '#FF3B30',
        backgroundColor: isUp ? 'rgba(52,199,89,0.1)' : 'rgba(255,59,48,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: isUp ? '#34C759' : '#FF3B30',
        borderWidth: 2.5,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => ctx.raw.toLocaleString('zh-TW', {minimumFractionDigits: 2}) } }
      },
      scales: {
        x: { ticks: { color: isDark ? '#8E8E93' : '#6C6C70', maxTicksLimit: 5 }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
        y: { ticks: { color: isDark ? '#8E8E93' : '#6C6C70' }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } }
      }
    }
  });
}
