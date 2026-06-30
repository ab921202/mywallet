/**
 * models.js — 業務邏輯 / 計算公式
 */

// ── UUID ──
export const uuid = () => crypto.randomUUID();

// ── 資產類別 ──
export const ASSET_TYPES = {
  stock:      { name: '股票',    icon: '📈', color: '#007AFF' },
  etf:        { name: 'ETF',     icon: '📊', color: '#34C759' },
  crypto:     { name: '加密貨幣', icon: '₿',  color: '#FF9500' },
  forex:      { name: '外匯',    icon: '💱', color: '#5AC8FA' },
  fund:       { name: '基金',    icon: '💰', color: '#AF52DE' },
  bond:       { name: '債券',    icon: '📄', color: '#FF2D55' },
  realestate: { name: '不動產',  icon: '🏠', color: '#FF6B35' },
  cash:       { name: '現金',    icon: '💵', color: '#4CD964' },
  insurance:  { name: '保險',    icon: '🛡️', color: '#00C7BE' },
  commodity:  { name: '大宗商品', icon: '🪙', color: '#FFD700' },
  other:      { name: '其他',    icon: '📦', color: '#8E8E93' },
};

// 非標準資產（totalShares 固定為 1）
export const NON_STANDARD = ['realestate', 'insurance'];
export const isNonStandard = t => NON_STANDARD.includes(t);

// ── 交易類型 ──
export const TX_TYPES = {
  buy:      { name: '買入',     icon: '⬇️', color: '#34C759' },
  sell:     { name: '賣出',     icon: '⬆️', color: '#FF3B30' },
  dividend: { name: '股息',     icon: '💸', color: '#007AFF' },
  split:    { name: '股票分割', icon: '✂️', color: '#FF9500' },
  bonus:    { name: '股息再投入', icon: '🔁', color: '#AF52DE' },
};

// ── 幣別 ──
export const CURRENCIES = {
  TWD: { symbol: 'NT$', name: '新台幣' },
  USD: { symbol: '$',   name: '美元' },
  JPY: { symbol: '¥',   name: '日圓' },
  EUR: { symbol: '€',   name: '歐元' },
  HKD: { symbol: 'HK$', name: '港幣' },
  CNY: { symbol: '¥',   name: '人民幣' },
  GBP: { symbol: '£',   name: '英鎊' },
  AUD: { symbol: 'A$',  name: '澳幣' },
  SGD: { symbol: 'S$',  name: '新加坡幣' },
};

// ── 格式化 ──
export function fmt(num, dec = 2) {
  if (num === null || num === undefined || isNaN(num)) return '—';
  return new Intl.NumberFormat('zh-TW', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  }).format(num);
}

export function fmtTWD(num) {
  return 'NT$' + fmt(num, 0);
}

export function fmtCurrency(num, currency = 'TWD', dec = 2) {
  const sym = CURRENCIES[currency]?.symbol ?? '';
  return sym + fmt(num, dec);
}

export function fmtPct(num, showSign = true) {
  if (isNaN(num)) return '—';
  const sign = showSign && num > 0 ? '+' : '';
  return `${sign}${fmt(num, 2)}%`;
}

export function fmtShares(num) {
  if (!num && num !== 0) return '—';
  if (num % 1 === 0) return fmt(num, 0);
  return fmt(num, 4);
}

export function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function fmtRelDate(d) {
  if (!d) return '';
  const now = new Date();
  const dt  = new Date(d);
  const diff = Math.floor((now - dt) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff < 7)  return `${diff} 天前`;
  return fmtDate(dt);
}

// ── 資產計算 ──

/** 市值（台幣）*/
export function assetValueTWD(a) {
  return a.currentPrice * a.totalShares * a.exchangeRate;
}

/** 未實現損益（台幣）*/
export function unrealizedPnL(a) {
  return assetValueTWD(a) - a.totalCost;
}

/** 未實現損益率 */
export function unrealizedRate(a) {
  if (!a.totalCost) return 0;
  return (unrealizedPnL(a) / a.totalCost) * 100;
}

/** 今日損益（台幣）*/
export function todayPnL(a) {
  return (a.currentPrice - a.previousClosePrice) * a.totalShares * a.exchangeRate;
}

/** 今日損益率 */
export function todayRate(a) {
  if (!a.previousClosePrice) return 0;
  return ((a.currentPrice - a.previousClosePrice) / a.previousClosePrice) * 100;
}

// ── 買入後更新成本（加權平均）──
export function applyBuy(asset, shares, pricePerShare, fee, rate) {
  const costTWD      = (pricePerShare * shares + fee) * rate;
  const newTotal     = asset.totalShares + shares;
  asset.avgCostPerShare = newTotal > 0 ? (asset.totalCost + costTWD) / newTotal : 0;
  asset.totalCost   += costTWD;
  asset.totalShares  = newTotal;
}

// ── 賣出後更新持倉 ──
export function applySell(asset, shares) {
  const soldCost    = asset.avgCostPerShare * shares;
  asset.totalShares -= shares;
  asset.totalCost   -= soldCost;
  if (asset.totalShares <= 0) { asset.totalShares = 0; asset.totalCost = 0; }
}

// ── 股票分割（直接輸入新股數）──
export function applySplit(asset, newShares) {
  if (newShares <= 0) return;
  asset.avgCostPerShare = newShares > 0 ? asset.totalCost / newShares : 0;
  asset.totalShares     = newShares;
}

// ── 更新現價（保留 previousClose + 建立 snapshot）──
export function prepareUpdatePrice(asset, newPrice, newRate) {
  const snapshot = {
    id:         uuid(),
    assetId:    asset.id,
    price:      newPrice,
    recordedAt: new Date().toISOString(),
  };
  asset.previousClosePrice = asset.currentPrice;
  asset.currentPrice       = newPrice;
  if (newRate) asset.exchangeRate = newRate;
  asset.lastUpdated        = new Date().toISOString();
  return snapshot;
}

// ── 建立新資產 ──
export function newAsset(overrides = {}) {
  return {
    id:                 uuid(),
    name:               '',
    ticker:             '',
    assetType:          'stock',
    currency:           'TWD',
    exchangeRate:       1,
    totalShares:        0,
    avgCostPerShare:    0,
    totalCost:          0,
    currentPrice:       0,
    previousClosePrice: 0,
    groupId:            null,
    tags:               [],
    note:               '',
    isFavorite:         false,
    isArchived:         false,
    lastUpdated:        new Date().toISOString(),
    createdAt:          new Date().toISOString(),
    ...overrides,
  };
}

// ── 建立新交易 ──
export function newTransaction(overrides = {}) {
  return {
    id:             uuid(),
    assetId:        '',
    type:           'buy',
    date:           new Date().toISOString().split('T')[0],
    shares:         0,
    pricePerShare:  0,
    fee:            0,
    exchangeRate:   1,
    splitNewShares: null,
    note:           '',
    createdAt:      new Date().toISOString(),
    ...overrides,
  };
}

// ── 建立預設群組 ──
export function defaultGroups() {
  return [
    { id: uuid(), name: '台股',    icon: '🇹🇼', colorHex: '#FF3B30', sortOrder: 0, createdAt: new Date().toISOString() },
    { id: uuid(), name: '美股',    icon: '🇺🇸', colorHex: '#007AFF', sortOrder: 1, createdAt: new Date().toISOString() },
    { id: uuid(), name: '加密貨幣', icon: '₿',   colorHex: '#FF9500', sortOrder: 2, createdAt: new Date().toISOString() },
    { id: uuid(), name: '其他',    icon: '📦',  colorHex: '#8E8E93', sortOrder: 3, createdAt: new Date().toISOString() },
  ];
}

// ── CSV 匯出 ──
export function buildCSV(assets, transactions) {
  const assetMap = Object.fromEntries(assets.map(a => [a.id, a]));
  const rows = [['日期','資產名稱','代碼','交易類型','數量','每股價格','手續費','匯率','總成本(TWD)']];
  const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const t of sorted) {
    const a = assetMap[t.assetId] || {};
    const total = ((t.shares * t.pricePerShare) + t.fee) * t.exchangeRate;
    rows.push([
      t.date,
      a.name || '',
      a.ticker || '',
      TX_TYPES[t.type]?.name || t.type,
      t.shares,
      t.pricePerShare,
      t.fee,
      t.exchangeRate,
      Math.round(total),
    ]);
  }
  return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

// ── 下載工具 ──
export function downloadFile(content, filename, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function today() {
  return new Date().toISOString().split('T')[0];
}
