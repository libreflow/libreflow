// LibreFlow — IndexedDB layer
//
// Database schema (version 5):
//   tracks    { id, name, artist, album, path, ext, duration, dateAdded, artColor, genre, rgGain } // PERF-LH v6 : artwork déplacé dans le store dédié
//   artwork   { id, buf, b64, mime } // pochettes — lus paresseusement par artLoader.js
//   cfg       { state: <app config object> }
//   playlists { id, name, trackIds[] }
//   playlog   { ts, id, dur }
//   imports   { id, date, source, paths[], count }

import { CFG } from './cfg.js';

/** @type {IDBDatabase|null} Singleton IDB connection. Initialised by openDB(). */
export let DB = null;

// ══ IndexedDB ══════════════════════════════════

/** @type {Promise<void>|null} In-flight openDB() promise — prevents double-open race. */
let _openingPromise = null;

/**
 * Open (or reuse) the 'lp4' IndexedDB database.
 * Must be called once at boot before any IDB helpers are used.
 * Safe to call multiple times — returns immediately if already open,
 * or awaits the in-flight open if a concurrent call is in progress.
 *
 * @returns {Promise<void>}
 */
async function openDB() {
  if (DB) return;
  if (_openingPromise) {
    await _openingPromise;
    return;
  }
  _openingPromise = new Promise((ok, fail) => {
    const r = indexedDB.open('lp4', 6); // v6 : store artwork dédié (PERF-LH)
    let _postUpgrade = null;
    r.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('cfg')) d.createObjectStore('cfg');
      if (!d.objectStoreNames.contains('playlists'))
        d.createObjectStore('playlists', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('playlog'))
        d.createObjectStore('playlog', { keyPath: 'ts' });
      if (!d.objectStoreNames.contains('imports'))
        d.createObjectStore('imports', { keyPath: 'id' });
      // PERF-LH v6 : les pochettes (artBuf/artB64, jusqu'à ~3 Mo/piste) quittent le
      // store tracks → dall('tracks') au boot ne désérialise plus les images.
      if (!d.objectStoreNames.contains('artwork')) {
        d.createObjectStore('artwork', { keyPath: 'id' });
        // Migration : déplacer les pochettes des records tracks existants et
        // stripper les champs du store tracks dans LA MÊME transaction d'upgrade
        // (atomique, pas de fenêtre de corruption). e.oldVersion < 6 → migration.
        if (e.oldVersion > 0 && e.oldVersion < 6) {
          const tracksStore = e.target.transaction.objectStore('tracks');
          const artStore = e.target.transaction.objectStore('artwork');
          tracksStore.openCursor().onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return;
            const rec = cursor.value;
            if (rec.artBuf || rec.artB64) {
              artStore.put({ id: rec.id, buf: rec.artBuf || null, b64: rec.artB64 || null, mime: rec.artMime || null });
              const stripped = { ...rec };
              delete stripped.artBuf;
              delete stripped.artB64;
              delete stripped.artMime;
              cursor.update(stripped);
            }
            cursor.continue();
          };
        }
      }
    };
    r.onsuccess = (e) => ok(e.target.result);
    r.onerror = () => fail(r.error);
    r.onblocked = () => fail(new Error('IDB bloqué — fermer les autres instances de LibreFlow'));
  });
  try {
    DB = await _openingPromise;
  } finally {
    _openingPromise = null;
  }
}

/**
 * Open a transaction on a single store and return the IObjectStore.
 * Throws synchronously if DB has not been initialised yet.
 *
 * @param {string} s             - Store name ('tracks' | 'cfg' | 'playlists' | 'playlog' | 'imports' | 'artwork')
 * @param {'readonly'|'readwrite'} [m='readonly'] - Transaction mode
 * @returns {IDBObjectStore}
 */
const tx = (s, m = 'readonly') => {
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
const dget = (s, k) =>
  _raceWithTimeout(
    new Promise((ok, fail) => {
      const r = tx(s).get(k);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    }),
    CFG.IDB_TIMEOUT_DEFAULT
  );

/**
 * Get all records from a store.
 * Uses a longer timeout (CFG.IDB_TIMEOUT_DALL) to handle large libraries.
 *
 * @template T
 * @param {string} s - Store name
 * @returns {Promise<T[]>}
 */
const dall = (s) =>
  _raceWithTimeout(
    new Promise((ok, fail) => {
      const r = tx(s).getAll();
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    }),
    CFG.IDB_TIMEOUT_DALL
  );

/**
 * Put (insert or update) a record in a store.
 *
 * @param {string} s           - Store name
 * @param {any}    v           - Value to store
 * @param {IDBValidKey} [k]    - Explicit key (omit if store has keyPath)
 * @returns {Promise<void>}
 */
const dput = (s, v, k) => {
  // Skip persisting ephemeral CD tracks — they're tied to the inserted disc's lifetime
  if (s === 'tracks' && v && v._isEphemeralCd === true) return Promise.resolve();
  return _raceWithTimeout(
    new Promise((ok, fail) => {
      const r = k !== undefined ? tx(s, 'readwrite').put(v, k) : tx(s, 'readwrite').put(v);
      r.onsuccess = () => ok();
      r.onerror = () => fail(r.error);
    }),
    CFG.IDB_TIMEOUT_DEFAULT
  );
};

/**
 * Delete a record by key from a store.
 *
 * @param {string} s          - Store name
 * @param {IDBValidKey} k     - Key to delete
 * @returns {Promise<void>}
 */
const ddel = (s, k) =>
  _raceWithTimeout(
    new Promise((ok, fail) => {
      const r = tx(s, 'readwrite').delete(k);
      r.onsuccess = () => ok();
      r.onerror = () => fail(r.error);
    }),
    CFG.IDB_TIMEOUT_DEFAULT
  );

/**
 * Get all keys (not values) from a store. Lightweight — IndexedDB returns
 * key arrays without deserialising record payloads (PERF-LH v6 : used at
 * boot to build the _hasArt flag set from the artwork store cheaply).
 *
 * @param {string} s
 * @returns {Promise<IDBValidKey[]>}
 */
const dkeys = (s) =>
  _raceWithTimeout(
    new Promise((ok, fail) => {
      const r = tx(s).getAllKeys();
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    }),
    CFG.IDB_TIMEOUT_DEFAULT
  );

// ── Storage quota ─────────────────────────────────────────────

/**
 * Returns navigator.storage.estimate() or null if the API is unavailable.
 * Usage: { usage: bytes, quota: bytes }
 * @returns {Promise<StorageEstimate|null>}
 */
export async function getStorageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch (e) {
    console.warn('[getStorageEstimate]', e);
    return null;
  }
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
  const name = /** @type {any} */ (e)?.name ?? '';
  const code = /** @type {any} */ (e)?.code ?? 0;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 || // legacy DOMException QUOTA_EXCEEDED_ERR
    (typeof name === 'string' && name.toLowerCase().includes('quota'))
  );
}

export { openDB, tx, dget, dall, dput, ddel, dkeys };
