/**
 * db.js — IndexedDB 資料庫層
 * 提供 async/await CRUD 操作
 */

const DB_NAME    = 'MyWalletDB';
const DB_VERSION = 1;

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      // assets
      if (!db.objectStoreNames.contains('assets')) {
        const s = db.createObjectStore('assets', { keyPath: 'id' });
        s.createIndex('groupId', 'groupId');
        s.createIndex('isArchived', 'isArchived');
      }
      // transactions
      if (!db.objectStoreNames.contains('transactions')) {
        const s = db.createObjectStore('transactions', { keyPath: 'id' });
        s.createIndex('assetId', 'assetId');
        s.createIndex('date', 'date');
      }
      // groups
      if (!db.objectStoreNames.contains('groups')) {
        const s = db.createObjectStore('groups', { keyPath: 'id' });
        s.createIndex('sortOrder', 'sortOrder');
      }
      // snapshots
      if (!db.objectStoreNames.contains('snapshots')) {
        const s = db.createObjectStore('snapshots', { keyPath: 'id' });
        s.createIndex('assetId', 'assetId');
        s.createIndex('recordedAt', 'recordedAt');
      }
      // settings
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

// ── 通用 CRUD ──

function txStore(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function promReq(req) {
  return new Promise((res, rej) => {
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

function getAll(storeName) {
  return promReq(txStore(storeName).getAll());
}
function getByKey(storeName, key) {
  return promReq(txStore(storeName).get(key));
}
function getByIndex(storeName, indexName, value) {
  return promReq(txStore(storeName, 'readonly').index(indexName).getAll(value));
}
function put(storeName, obj) {
  return promReq(txStore(storeName, 'readwrite').put(obj));
}
function del(storeName, key) {
  return promReq(txStore(storeName, 'readwrite').delete(key));
}
function clearStore(storeName) {
  return promReq(txStore(storeName, 'readwrite').clear());
}

// ── Assets ──
export const Assets = {
  getAll:       () => getAll('assets'),
  get:          id => getByKey('assets', id),
  getByGroup:   gid => getByIndex('assets', 'groupId', gid),
  save:         a => put('assets', a),
  delete:       id => del('assets', id),
  clear:        () => clearStore('assets'),
};

// ── Transactions ──
export const Transactions = {
  getAll:       () => getAll('transactions'),
  get:          id => getByKey('transactions', id),
  getByAsset:   assetId => getByIndex('transactions', 'assetId', assetId),
  save:         t => put('transactions', t),
  delete:       id => del('transactions', id),
  deleteByAsset: async assetId => {
    const list = await getByIndex('transactions', 'assetId', assetId);
    for (const t of list) await del('transactions', t.id);
  },
  clear:        () => clearStore('transactions'),
};

// ── Groups ──
export const Groups = {
  getAll:  () => getAll('groups'),
  get:     id => getByKey('groups', id),
  save:    g => put('groups', g),
  delete:  id => del('groups', id),
  clear:   () => clearStore('groups'),
};

// ── Snapshots ──
export const Snapshots = {
  getAll:       () => getAll('snapshots'),
  getByAsset:   assetId => getByIndex('snapshots', 'assetId', assetId),
  save:         s => put('snapshots', s),
  deleteByAsset: async assetId => {
    const list = await getByIndex('snapshots', 'assetId', assetId);
    for (const s of list) await del('snapshots', s.id);
  },
  clear:        () => clearStore('snapshots'),
};

// ── Settings ──
export const Settings = {
  get:    async key => { const r = await getByKey('settings', key); return r?.value; },
  set:    (key, value) => put('settings', { key, value }),
  getAll: async () => {
    const rows = await getAll('settings');
    const obj = {};
    for (const r of rows) obj[r.key] = r.value;
    return obj;
  },
};

// ── 備份 / 還原 ──

export async function exportAllData() {
  const [assets, transactions, groups, snapshots, settings] = await Promise.all([
    Assets.getAll(), Transactions.getAll(),
    Groups.getAll(), Snapshots.getAll(),
    Settings.getAll(),
  ]);
  return { version: '1.0', exportedAt: new Date().toISOString(), assets, transactions, groups, snapshots, settings };
}

export async function importAllData(data) {
  await Promise.all([
    Assets.clear(), Transactions.clear(),
    Groups.clear(), Snapshots.clear(),
  ]);
  for (const g of (data.groups || [])) await Groups.save(g);
  for (const a of (data.assets || [])) await Assets.save(a);
  for (const t of (data.transactions || [])) await Transactions.save(t);
  for (const s of (data.snapshots || [])) await Snapshots.save(s);
  if (data.settings) {
    for (const [k, v] of Object.entries(data.settings)) await Settings.set(k, v);
  }
}
