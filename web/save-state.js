// Persistence for active game sessions: saves the emulator's state
// so refreshing the page resumes where the player left off.

const DB_NAME = 'dailyred-state';
const STORE_NAME = 'saves';
const DB_VERSION = 1;
const SESSION_KEY = 'dailyred-active-game';
const FALLBACK_KEY = 'dailyred-state-fallback';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      return resolve(null);
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      console.warn('IndexedDB unavailable:', request.error);
      resolve(null);
    };
  });
  return dbPromise;
}

export function hasActiveSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

export function setActiveSession(active) {
  try {
    if (active) sessionStorage.setItem(SESSION_KEY, '1');
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage blocked
  }
}

async function blobToBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBlob(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'application/octet-stream' });
}

export async function saveActiveState(data) {
  setActiveSession(true);
  const record = { id: 'active', ...data, savedAt: Date.now() };

  try {
    const db = await openDB();
    if (db) {
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    }
  } catch (err) {
    console.warn('Failed to save to IndexedDB:', err);
  }

  // Fallback to sessionStorage if IndexedDB failed
  try {
    const b64 = await blobToBase64(data.stateBlob);
    const serialized = JSON.stringify({ ...record, stateBlob: null, b64 });
    sessionStorage.setItem(FALLBACK_KEY, serialized);
    return true;
  } catch (err) {
    console.warn('Failed fallback storage:', err);
    return false;
  }
}

export async function loadActiveState(currentDate) {
  let record = null;

  try {
    const db = await openDB();
    if (db) {
      record = await new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get('active');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    }
  } catch (err) {
    console.warn('Failed to read IndexedDB:', err);
  }

  if (!record) {
    try {
      const raw = sessionStorage.getItem(FALLBACK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.b64) {
          parsed.stateBlob = base64ToBlob(parsed.b64);
          delete parsed.b64;
          record = parsed;
        }
      }
    } catch {
      // Storage blocked or invalid
    }
  }

  if (!record) {
    setActiveSession(false);
    return null;
  }

  // Expired daily battle from a past date
  if (currentDate && !record.isPractice && record.date !== currentDate) {
    await clearActiveState();
    return null;
  }

  return record;
}

export async function clearActiveState() {
  setActiveSession(false);

  try {
    sessionStorage.removeItem(FALLBACK_KEY);
  } catch {
    // Storage blocked
  }

  try {
    const db = await openDB();
    if (db) {
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete('active');
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    }
  } catch (err) {
    console.warn('Failed to clear IndexedDB:', err);
  }
  return true;
}
