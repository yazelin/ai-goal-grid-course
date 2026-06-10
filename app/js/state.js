// 狀態模型與儲存(契約 C4)
// localStorage 'goal-grid-state-v1':{version, cells[9], actions[8], wallpaper, updatedAt}
// IndexedDB db='goal-grid' v1,stores:'refs'(參考圖)、'wallpapers'(成品)

export const STATE_KEY = 'goal-grid-state-v1';
export const DB_NAME = 'goal-grid';
export const DB_VERSION = 1;
export const STORES = ['refs', 'wallpapers'];

export function defaultState() {
  return {
    version: 1,
    cells: Array(9).fill(null), // null = 留給 AI;{text, source:'user'|'ai'} = 已填
    actions: Array(8).fill(null), // null = 尚未展開;Array(8) = 子目標 i 的行動列
    wallpaper: { orientation: 'portrait', styleId: 'aurora' },
    updatedAt: new Date().toISOString(),
  };
}

function normCell(c) {
  if (!c || typeof c !== 'object') return null;
  const text = typeof c.text === 'string' ? c.text.trim() : '';
  if (!text) return null;
  return { text, source: c.source === 'ai' ? 'ai' : 'user' };
}

// 把任何來路不明的資料修復成合法 state(壞資料回預設值)
export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return base;
  if (Array.isArray(raw.cells)) {
    for (let i = 0; i < 9; i++) base.cells[i] = normCell(raw.cells[i]);
  }
  if (Array.isArray(raw.actions)) {
    for (let i = 0; i < 8; i++) {
      const row = raw.actions[i];
      base.actions[i] = Array.isArray(row)
        ? Array.from({ length: 8 }, (_, j) => normCell(row[j]))
        : null;
    }
  }
  const wp = raw.wallpaper;
  if (wp && typeof wp === 'object') {
    if (wp.orientation === 'landscape') base.wallpaper.orientation = 'landscape';
    if (typeof wp.styleId === 'string' && wp.styleId) base.wallpaper.styleId = wp.styleId;
  }
  if (typeof raw.updatedAt === 'string') base.updatedAt = raw.updatedAt;
  return base;
}

export function setCell(state, idx, text, source = 'user') {
  if (!Number.isInteger(idx) || idx < 0 || idx > 8) {
    throw new RangeError(`格子索引超界:${idx}`);
  }
  const t = String(text ?? '').trim();
  state.cells[idx] = t ? { text: t, source } : null;
  state.updatedAt = new Date().toISOString();
  return state;
}

export function setAction(state, subIdx, actionIdx, text, source = 'user') {
  if (!Number.isInteger(subIdx) || subIdx < 0 || subIdx > 7) {
    throw new RangeError(`子目標索引超界:${subIdx}`);
  }
  if (!Number.isInteger(actionIdx) || actionIdx < 0 || actionIdx > 7) {
    throw new RangeError(`行動索引超界:${actionIdx}`);
  }
  if (!Array.isArray(state.actions[subIdx])) {
    state.actions[subIdx] = Array(8).fill(null);
  }
  const t = String(text ?? '').trim();
  state.actions[subIdx][actionIdx] = t ? { text: t, source } : null;
  state.updatedAt = new Date().toISOString();
  return state;
}

export function loadState(storage = globalThis.localStorage) {
  try {
    return normalizeState(JSON.parse(storage.getItem(STATE_KEY)));
  } catch {
    return defaultState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('狀態保存失敗', err);
  }
  return state;
}

// ---- IndexedDB helpers(瀏覽器環境)----

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function withStore(store, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// record:{id:auto, blob:Blob, meta:object, createdAt:ISO}
export function idbPut(store, record) {
  return withStore(store, 'readwrite', (os) => os.put(record));
}

export function idbAll(store) {
  return withStore(store, 'readonly', (os) => os.getAll());
}

export function idbDelete(store, id) {
  return withStore(store, 'readwrite', (os) => os.delete(id));
}
