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
 * Applique l'invariant ARCH-3 : rebuildTrackIdxMap() est garanti en interne.
 * @param {object[]} v
 */
export function setTracks(v) {
  // ARCH-3 / H-09 : set() notifie les subscribers de façon synchrone.
  // Pour garantir que tout subscriber voit un _trackIdxMap cohérent, on
  // adopte le même pattern que pushTracks/removeTrackAt :
  //   1. Muter tracks[] en place (même référence → set() no-op, pas de notify prématuré)
  //   2. rebuildTrackIdxMap() — la map est à jour avant toute notification
  //   3. notify('tracks') explicite — subscribers voient map + tableau cohérents
  const arr = get('tracks');
  arr.length = 0;
  for (let i = 0; i < v.length; i++) arr[i] = v[i];
  rebuildTrackIdxMap();
  notify('tracks');
}

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
  const arr = get('tracks');
  for (let i = 0; i < items.length; i++) arr.push(items[i]);
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
 * Même pattern que setTracks() : mutation in-place → rebuild → notify.
 * Garantit que _trackIdxMap est cohérent AVANT que les subscribers
 * reçoivent la notification (set() notifie de façon synchrone, donc
 * appeler set() avant rebuildTrackIdxMap() exposerait une map périmée
 * à tout subscriber qui appelle trackIdx() dans son callback).
 *
 * @param {object[]} newArray — nouveau tableau de pistes
 */
export function replaceTracks(newArray) {
  const arr = get('tracks');
  arr.length = 0;
  for (let i = 0; i < newArray.length; i++) arr[i] = newArray[i];
  rebuildTrackIdxMap();
  notify('tracks');
}

/**
 * Supprime plusieurs pistes par index, en un seul rebuild + notify.
 * Les indices DOIVENT être triés décroissants pour rester valides pendant
 * la boucle de splice (haute → basse). La fonction valide cet ordre en debug.
 *
 * Préférée à un simple `for (const idx of indices) tracks.splice(idx, 1)`
 * suivi d'un rebuild manuel : centralise l'invariant CLAUDE.md §2 et évite
 * que des sites appelants oublient le rebuild.
 *
 * ⚠ Prérequis : adjustShuffleQAfterDelete + setCurIdx déjà appelés AVANT
 *   sur chaque idx — ils utilisent l'index *avant* splice.
 *
 * @param {number[]} sortedDescIndices — indices triés décroissants
 */
export function removeTracksBatch(sortedDescIndices) {
  if (!sortedDescIndices.length) return;
  const tracks = get('tracks');
  // B24 FIX : le splice (haut → bas) EXIGE un ordre strictement décroissant.
  // Avant, le garde-fou warn + break mais laissait la boucle splicer avec les
  // indices erronés (corruption silencieuse) — on trie défensivement à la place.
  let indices = sortedDescIndices;
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] >= indices[i - 1]) {
      console.warn('[state] removeTracksBatch: indices NON triés décroissants — tri défensif appliqué', sortedDescIndices);
      indices = [...sortedDescIndices].sort((a, b) => b - a);
      break;
    }
  }
  for (const idx of indices) {
    if (idx >= 0 && idx < tracks.length) tracks.splice(idx, 1);
  }
  rebuildTrackIdxMap();
  notify('tracks');
}
