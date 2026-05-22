// LibreFlow — IndexedDB layer
//
// Database schema (version 5):
//   tracks    { id, name, artist, album, path, ext, duration, dateAdded, artB64, artColor, genre, rgGain }
//   cfg       { state: <app config object> }
//   playlists { id, name, trackIds[] }
//   playlog   { ts, id, dur }
//   imports   { id, date, source, paths[], count }

import { CFG } from './cfg.js';

/** @type {IDBDatabase|null} Singleton IDB connection. Initialised by openDB(). */
export let DB = null;

// ══ IndexedDB ══════════════════════════════════

/**
 * Open (or reuse) the 'lp4' IndexedDB database.
 * Must be called once at boot before any IDB helpers are used.
 * Safe to call multiple times — returns immediately if already open.
 *
 * @returns {Promise<void>}
 */
async function openDB() {
  if (DB) return;
  DB = await new Promise((ok, fail) => {
    const r = indexedDB.open('lp4', 5); // v5 : ajout du store imports
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tracks'))    d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('cfg'))       d.createObjectStore('cfg');
      if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('playlog'))   d.createObjectStore('playlog', { keyPath: 'ts' });
      if (!d.objectStoreNames.contains('imports'))   d.createObjectStore('imports', { keyPath: 'id' });
    };
    r.onsuccess = e => ok(e.target.result);
    r.onerror   = () => fail(r.error);
    r.onblocked = () => fail(new Error('IDB bloqué — fermer les autres instances de LibreFlow'));
  });
}

/**
 * Open a transaction on a single store and return the IObjectStore.
 * Throws synchronously if DB has not been initialised yet.
 *
 * @param {string} s             - Store name ('tracks' | 'cfg' | 'playlists' | 'playlog' | 'imports')
 * @param {'readonly'|'readwrite'} [m='readonly'] - Transaction mode
 * @returns {IDBObjectStore}
 */
const tx = (s, m='readonly') => {
  if (!DB) throw new Error('[tx] IDB non initialisée');
  return DB.transaction(s, m).objectStore(s);
};

// Helpers IDB avec gestion d'erreur — les anciens ignoraient onerror → deadlock si IDB échoue
// Timeout pour les opérations IDB — évite un hang permanent si la DB est corrompue

/**
 * Race an IDB operation against a timeout, clearing the timeout timer once the
 * operation settles. B28 FIX — sans clearTimeout, le setTimeout orphelin
 * (jusqu'à 30 s pour dall) continue de tourner et garde l'event loop éveillé
 * après une opération réussie.
 *
 * @template T
 * @param {Promise<T>} op - IDB operation promise
 * @param {number} ms     - Timeout in milliseconds
 * @returns {Promise<T>}
 */
function _raceWithTimeout(op, ms) {
  let timer;
  const timeout = new Promise((_, fail) => {
    timer = setTimeout(() => fail(new Error('IDB timeout')), ms);
  });
  return Promise.race([op, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Get a single record by key from a store.
 *
 * @template T
 * @param {string} s - Store name
 * @param {IDBValidKey} k - Record key
 * @returns {Promise<T|undefined>}
 */
const dget = (s,k) => _raceWithTimeout(new Promise((ok,fail) => {
  const r = tx(s).get(k);
  r.onsuccess = () => ok(r.result);
  r.onerror   = () => fail(r.error);
}), CFG.IDB_TIMEOUT_DEFAULT);

/**
 * Get all records from a store.
 * Uses a longer timeout (CFG.IDB_TIMEOUT_DALL) to handle large libraries.
 *
 * @template T
 * @param {string} s - Store name
 * @returns {Promise<T[]>}
 */
const dall = (s) => _raceWithTimeout(new Promise((ok,fail) => {
  const r = tx(s).getAll();
  r.onsuccess = () => ok(r.result);
  r.onerror   = () => fail(r.error);
}), CFG.IDB_TIMEOUT_DALL);

/**
 * Put (insert or update) a record in a store.
 *
 * @param {string} s           - Store name
 * @param {any}    v           - Value to store
 * @param {IDBValidKey} [k]    - Explicit key (omit if store has keyPath)
 * @returns {Promise<void>}
 */
const dput = (s,v,k) => {
  // Skip persisting ephemeral CD tracks — they're tied to the inserted disc's lifetime
  if (s === 'tracks' && v && v._isEphemeralCd === true) return;
  return _raceWithTimeout(new Promise((ok,fail) => {
    const r = k !== undefined ? tx(s,'readwrite').put(v,k) : tx(s,'readwrite').put(v);
    r.onsuccess = () => ok();
    r.onerror   = () => fail(r.error);
  }), 8000);
};

/**
 * Delete a record by key from a store.
 *
 * @param {string} s          - Store name
 * @param {IDBValidKey} k     - Key to delete
 * @returns {Promise<void>}
 */
const ddel = (s,k) => _raceWithTimeout(new Promise((ok,fail) => {
  const r = tx(s,'readwrite').delete(k);
  r.onsuccess = () => ok();
  r.onerror   = () => fail(r.error);
}), 8000);

// ── Storage quota ─────────────────────────────────────────────

/**
 * Returns navigator.storage.estimate() or null if the API is unavailable.
 * Usage: { usage: bytes, quota: bytes }
 * @returns {Promise<StorageEstimate|null>}
 */
export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch(e) { console.warn('[getStorageEstimate]', e); return null; }
}

/**
 * Returns true if the error is a storage quota exceeded error.
 * Covers Chrome (QuotaExceededError), Firefox (NS_ERROR_DOM_QUOTA_REACHED),
 * and Safari / WebKit variants.
 * @param {unknown} e
 * @returns {boolean}
 */
export function isQuotaError(e) {
  if (!e) return false;
  const name = /** @type {any} */(e)?.name ?? '';
  const code = /** @type {any} */(e)?.code ?? 0;
  return name === 'QuotaExceededError'
    || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || code === 22   // legacy DOMException QUOTA_EXCEEDED_ERR
    || (typeof name === 'string' && name.toLowerCase().includes('quota'));
}

export { openDB, tx, dget, dall, dput, ddel };
