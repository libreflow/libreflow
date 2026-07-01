// LibreFlow — Play log
//
// Tracks listening history for statistics.
// Flushes to IndexedDB asynchronously to avoid blocking the UI.
//
// Exports:
//   playLog               Mutable array of {ts, id, dur} entries (live binding)
//   setPlayLog(arr)       Replace the array — called once from boot() after IDB load
//   logPlay(track)        Record a play event and schedule a flush
//   flushPlayLog()        Persist pending entries to IDB immediately
//   cancelPlayLogFlush()  Cancel any pending flush timer (call before DB.close)

import { CFG } from './cfg.js';
import { DB  } from './db.js';

export let playLog = [];
let _playLogFlushTimer = null;
// BUG FIX : seules les entrées "pending" (nouvelles) doivent être flushées.
// Les entrées chargées depuis l'IDB au boot ne doivent PAS être supprimées de playLog.
const _pendingTs = new Set();
// Compteur monotone µs pour garantir des ts uniques même sous bursts < 1 ms.
let _lastTs = 0;

/** Replace the playLog array (used by boot() after loading from IDB). */
export function setPlayLog(arr) { playLog = arr; }

/** Cancel any pending flush timer — must be called before DB.close(). */
export function cancelPlayLogFlush() {
  if (_playLogFlushTimer) {
    clearTimeout(_playLogFlushTimer);
    _playLogFlushTimer = null;
  }
}

/**
 * Record one play event. Schedules an async flush to IDB.
 * @param {{ id: string, duration?: number }} t
 */
export function logPlay(t) {
  if (!t?.id) return;
  // UNITÉ DOCUMENTÉE : ts est stocké en MICROSECONDES (µs).
  // Raison : éviter les collisions de clés IDB dans la même milliseconde (clé primaire = ts).
  //   ts = max(Date.now()*1000, _lastTs + 1) — strict-monotonic, garanti unique.
  // Conséquence pour les lecteurs : toujours diviser par 1000 pour obtenir des ms.
  //   Ex. stats.js : Math.floor(entry.ts / 1000) → ms ✓
  let ts = Date.now() * 1000;
  if (ts <= _lastTs) ts = _lastTs + 1;
  _lastTs = ts;
  const entry = { ts, id: t.id, dur: t.duration || 0 };
  playLog.push(entry);
  _pendingTs.add(entry.ts);
  if (playLog.length > CFG.PLAYLOG_MAX_ENTRIES) playLog = playLog.slice(-CFG.PLAYLOG_MAX_ENTRIES);
  if (_playLogFlushTimer) clearTimeout(_playLogFlushTimer);
  _playLogFlushTimer = setTimeout(flushPlayLog, CFG.PLAYLOG_FLUSH_DELAY);
}

/** Persist pending play-log entries to IndexedDB. */
export async function flushPlayLog() {
  _playLogFlushTimer = null;
  if (!playLog.length || !DB) return;
  try {
    // BUG FIX : flush uniquement les entrées "pending" (nouvelles), pas les historiques.
    // L'ancienne version faisait toFlush=[...playLog] ce qui vidait playLog entier après flush.
    const toFlush = playLog.filter(e => _pendingTs.has(e.ts));
    if (!toFlush.length) return;
    const tx    = DB.transaction('playlog', 'readwrite');
    const store = tx.objectStore('playlog');
    for (const entry of toFlush) store.put(entry);
    await new Promise((ok, fail) => { tx.oncomplete = ok; tx.onerror = () => fail(tx.error); });
    // Supprimer uniquement les pending flushés (garder playLog intact pour les stats)
    toFlush.forEach(e => _pendingTs.delete(e.ts));
    // BUG FIX : l'ancienne condition `toFlush.length > CFG.PLAYLOG_MAX_ENTRIES` était
    // toujours fausse (playLog est déjà capé à PLAYLOG_MAX_ENTRIES en mémoire).
    // On purge l'IDB via un count + cursor pour rester sous la limite sur le disque.
    try {
      const purgeTx    = DB.transaction('playlog', 'readwrite');
      const purgeStore = purgeTx.objectStore('playlog');
      // AUDIT-2026-05-22 : sans onerror, une erreur IDB sur la purge par cursor
      // est avalee silencieusement → le playlog disque croit au-dela de la limite.
      purgeTx.onerror = e => console.warn('[flushPlayLog purge tx]', e);
      const cntReq     = purgeStore.count();
      cntReq.onerror   = e => console.warn('[flushPlayLog purge count]', e);
      cntReq.onsuccess = () => {
        const total = cntReq.result;
        if (total > CFG.PLAYLOG_MAX_ENTRIES) {
          let toDelete = total - CFG.PLAYLOG_MAX_ENTRIES;
          const curReq = purgeStore.openCursor();
          curReq.onerror   = e => console.warn('[flushPlayLog purge cursor]', e);
          curReq.onsuccess = ev => {
            const c = ev.target.result;
            if (c && toDelete > 0) { toDelete--; c.delete(); c.continue(); }
          };
        }
      };
    } catch(pe) { console.warn('[flushPlayLog purge]', pe); }
  } catch(e) { console.warn('[flushPlayLog]', e); }
}
