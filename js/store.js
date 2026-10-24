// Browser storage: projects (JSON) and their media (Blobs) in IndexedDB.
const DB_NAME = 'clipkraft-studio';
const DB_VERSION = 1;
let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

export async function listProjects() {
  const db = await openDB();
  const all = await reqP(db.transaction('projects').objectStore('projects').getAll());
  return all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
export async function getProject(id) {
  const db = await openDB();
  return reqP(db.transaction('projects').objectStore('projects').get(id));
}
export async function saveProject(p) {
  p.updatedAt = Date.now();
  const db = await openDB();
  const t = db.transaction('projects', 'readwrite');
  t.objectStore('projects').put(JSON.parse(JSON.stringify(p)));
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export async function deleteProject(id) {
  const db = await openDB();
  const keys = await reqP(db.transaction('blobs').objectStore('blobs').getAllKeys());
  const t = db.transaction(['projects', 'blobs'], 'readwrite');
  t.objectStore('projects').delete(id);
  for (const k of keys) if (String(k).startsWith(id + '/')) t.objectStore('blobs').delete(k);
  return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
export async function putBlob(key, blob) {
  const db = await openDB();
  const t = db.transaction('blobs', 'readwrite');
  t.objectStore('blobs').put(blob, key);
  return new Promise((res, rej) => { t.oncomplete = () => res(key); t.onerror = () => rej(t.error); });
}
export async function getBlob(key) {
  if (!key) return null;
  const db = await openDB();
  return reqP(db.transaction('blobs').objectStore('blobs').get(key));
}
export async function deleteBlob(key) {
  if (!key) return;
  const db = await openDB();
  const t = db.transaction('blobs', 'readwrite');
  t.objectStore('blobs').delete(key);
  return new Promise((res) => { t.oncomplete = () => res(); t.onerror = () => res(); });
}
export async function kvGet(key) {
  const db = await openDB();
  return reqP(db.transaction('kv').objectStore('kv').get(key));
}
export async function kvSet(key, value) {
  const db = await openDB();
  const t = db.transaction('kv', 'readwrite');
  t.objectStore('kv').put(value, key);
  return new Promise((res) => { t.oncomplete = () => res(); t.onerror = () => res(); });
}
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* optional */ }
}
