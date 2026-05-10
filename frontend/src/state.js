// LibreFlow — state.js
// Mutateurs d'état centralisés : synchronisent la variable locale d'app.js
// ET le store réactif en un seul appel.
// Extrait de app.js (ARCH-1 — casser les dépendances circulaires).
//
// Dépendances :
//   import  : set (store.js)
//
// Exports publics :
//   setCurIdx(v)      — met à jour curIdx dans app.js + store
//   setTracks(v)      — met à jour tracks dans app.js + store
//   setLiked(v)       — met à jour liked dans app.js + store
//   setCtxTrackId(v)  — met à jour ctxTrackId dans app.js + store

import { set } from './store.js';

/**
 * Sync curIdx dans app.js et dans le store réactif.
 * Utilisé par : dupes.js, ctxmenu.js, library.js, selection.js, orphans.js.
 * @param {number} v
 */
export function setCurIdx(v)     { set('curIdx',     v); }

/**
 * Sync liked dans app.js et dans le store réactif.
 * Utilisé par : selection.js.
 * @param {Set<string>} v
 */
export function setLiked(v)      { set('liked',      v); }

/**
 * Sync tracks dans app.js et dans le store réactif.
 * Utilisé par : selection.js.
 * @param {object[]} v
 */
export function setTracks(v)     { set('tracks',     v); }

/**
 * Sync ctxTrackId (cible du menu contextuel) dans app.js et dans le store.
 * Utilisé par : ctxmenu.js.
 * @param {string|null} v
 */
export function setCtxTrackId(v) { set('ctxTrackId', v); }
