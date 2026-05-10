// LibreFlow — IndexedDB layer
//
// Database schema (version 4):
//   tracks    { id, name, artist, album, path, ext, duration, dateAdded, artB64, artColor, genre, rgGain }
//   cfg       { state: <app config object> }
//   playlists { id, name, trackIds[] }
//   playlog   { ts, id, dur }

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
    const r = indexedDB.open('lp4', 4); // v4 : ajout du store playlog
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tracks'))    d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('cfg'))       d.createObjectStore('cfg');
      if (!d.objectStoreNames.contains('playlists')) d.createObjectStore('playlists', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('playlog'))   d.createObjectStore('playlog', { keyPath: 'ts' });
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
 * @param {string} s             - Store name ('tracks' | 'cfg' | 'playlists' | 'playlog')
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
 * Returns a promise that rejects after `ms` milliseconds.
 * Used with Promise.race() to add timeouts to IDB requests.
 *
 * @param {number} [ms=8000]
 * @returns {Promise<never>}
 */
function _idbTimeout(ms = 8000) {
  return new Promise((_, fail) => setTimeout(() => fail(new Error('IDB timeout')), ms));
}

/**
 * Get a single record by key from a store.
 *
 * @template T
 * @param {string} s - Store name
 * @param {IDBValidKey} k - Record key
 * @returns {Promise<T|undefined>}
 */
const dget = (s,k) => Promise.race([_idbTimeout(CFG.IDB_TIMEOUT_DEFAULT), new Promise((ok,fail) => {
  const r = tx(s).get(k);
  r.onsuccess = () => ok(r.result);
  r.onerror   = () => fail(r.error);
})]);

/**
 * Get all records from a store.
 * Uses a longer timeout (CFG.IDB_TIMEOUT_DALL) to handle large libraries.
 *
 * @template T
 * @param {string} s - Store name
 * @returns {Promise<T[]>}
 */
const dall = (s) => Promise.race([_idbTimeout(CFG.IDB_TIMEOUT_DALL), new Promise((ok,fail) => {
  const r = tx(s).getAll();
  r.onsuccess = () => ok(r.result);
  r.onerror   = () => fail(r.error);
})]);

/**
 * Put (insert or update) a record in a store.
 *
 * @param {string} s           - Store name
 * @param {any}    v           - Value to store
 * @param {IDBValidKey} [k]    - Explicit key (omit if store has keyPath)
 * @returns {Promise<void>}
 */
const dput = (s,v,k) => Promise.race([_idbTimeout(8000), new Promise((ok,fail) => {
  const r = k !== undefined ? tx(s,'readwrite').put(v,k) : tx(s,'readwrite').put(v);
  r.onsuccess = () => ok();
  r.onerror   = () => fail(r.error);
})]);

/**
 * Delete a record by key from a store.
 *
 * @param {string} s          - Store name
 * @param {IDBValidKey} k     - Key to delete
 * @returns {Promise<void>}
 */
const ddel = (s,k) => Promise.race([_idbTimeout(8000), new Promise((ok,fail) => {
  const r = tx(s,'readwrite').delete(k);
  r.onsuccess = () => ok();
  r.onerror   = () => fail(r.error);
})]);

export { openDB, tx, dget, dall, dput, ddel };
