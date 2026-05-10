// LibreFlow — state.js
// Mutateurs d'état centralisés : synchronisent la variable locale d'app.js
// ET le store réactif en un seul appel.
// Extrait de app.js (ARCH-1 — casser les dépendances circulaires).
//
// Dépendances :
//   import  : get, set, notify (store.js)
//   import  : rebuildTrackIdxMap (search.js)
//
// Exports publics :
//   setCurIdx(v)                  — met à jour curIdx dans app.js + store
//   setTracks(v)                  — met à jour tracks dans app.js + store
//   setLiked(v)                   — met à jour liked dans app.js + store
//   setCtxTrackId(v)              — met à jour ctxTrackId dans app.js + store
//
// ── Mutateurs atomiques de tracks[] (ARCH-3) ──────────────────────────────
// Ces fonctions garantissent l'invariant critique :
//   "Toute mutation de tracks[] → rebuildTrackIdxMap() OBLIGATOIRE"
// en l'encapsulant dans une seule primitive sans side-effect supplémentaire.
//
//   pushTracks(items)             — ajoute des pistes et rebuild la map
//   removeTrackAt(idx)            — supprime une piste par index et rebuild la map
//   replaceTracks(newArray)       — remplace l'array entier et rebuild la map

import { get, set, notify } from './store.js';
import { rebuildTrackIdxMap }  from './search.js';

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
 * ⚠ INVARIANT : tout appelant DOIT appeler rebuildTrackIdxMap() immédiatement après
 *   pour maintenir _trackIdxMap en sync avec tracks[]. Ne pas omettre cette étape
 *   sous peine de corrompre silencieusement tous les lookups par ID.
 */
export function setTracks(v)     { set('tracks',     v); }

/**
 * Sync ctxTrackId (cible du menu contextuel) dans app.js et dans le store.
 * Utilisé par : ctxmenu.js.
 * @param {string|null} v
 */
export function setCtxTrackId(v) { set('ctxTrackId', v); }

// ── Mutateurs atomiques de tracks[] (ARCH-3) ──────────────────────────────

/**
 * Ajoute des pistes en fin de tableau et rebuild _trackIdxMap.
 * Notify est émis APRÈS rebuild — les subscribers voient toujours un map cohérent.
 * Utilisé par : library.js (scan), dropin.js, watchfolder.js.
 *
 * ⚠ Pour les boucles qui accumulent plusieurs push avant un seul rebuild,
 *   continuer à utiliser get('tracks').push() + rebuildTrackIdxMap() + notify('tracks').
 *
 * @param {object[]} items — nouvelles pistes à ajouter
 */
export function pushTracks(items) {
  get('tracks').push(...items);
  rebuildTrackIdxMap();
  notify('tracks');
}

/**
 * Supprime une seule piste par index et rebuild _trackIdxMap.
 * Notify est émis APRÈS rebuild.
 * Utilisé par : library.js, ctxmenu.js.
 *
 * ⚠ Prérequis : appeler adjustShuffleQAfterDelete(idx) et setCurIdx()
 *   AVANT cet appel — ils utilisent l'index original (avant splice).
 *
 * @param {number} idx — index dans tracks[] (doit être >= 0)
 */
export function removeTrackAt(idx) {
  get('tracks').splice(idx, 1);
  rebuildTrackIdxMap();
  notify('tracks');
}

/**
 * Remplace l'intégralité du tableau tracks[] et rebuild _trackIdxMap.
 * Utilisé par : selection.js (delete sélection + undo).
 *
 * Note : set() notifie immédiatement (nouveau référence) → les subscribers
 * qui appellent trackIdx() juste après verront la map reconstruite car
 * rebuildTrackIdxMap() est appelé en synchrone dans la même frame.
 *
 * @param {object[]} newArray — nouveau tableau de pistes
 */
export function replaceTracks(newArray) {
  set('tracks', newArray);
  rebuildTrackIdxMap();
}
