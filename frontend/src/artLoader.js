// artLoader.js — ARCH-2/PERF-1 : chargement d'artwork paresseux avec éviction LRU
//
// Problème résolu :
//   Avant ARCH-2, tous les artBuf (ArrayBuffer) de la bibliothèque étaient chargés
//   au boot et convertis en blob: URL → 200-400 MB de RAM pour 5k pistes.
//
// Solution :
//   - Au boot, seul un flag `_hasArt` (boolean) est gardé en mémoire.
//   - Quand une piste est visible dans le virtual scroll, prefetchArts() appelle
//     loadArt() qui lit le record IDB à la demande et crée un blob: URL.
//   - Un cache LRU (MAX_ART_CACHE entrées) borne la mémoire à ~6 MB en régime normal.
//
// Exports :
//   loadArt(t)            — charge et affiche l'artwork d'une piste
//   prefetchArts(list)    — batch fire-and-forget (virtual scroll window)
//   revokeArt(trackId)    — libère le blob: URL d'une piste supprimée

import { DB, dget }    from './db.js';
import { get }         from './store.js';
import { CFG }         from './cfg.js';
import { trackIdx }    from './search.js';
import { updateBar }   from './playerbar.js';

// ── Constantes ────────────────────────────────────────────────
const MAX_CACHE = CFG.MAX_ART_CACHE;   // 60 entrées ≈ 6 MB max
export const ART_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];

// ── Cache LRU ─────────────────────────────────────────────────
// Map insertion-ordered : le premier élément est le plus ancien (LRU).
const _cache = new Map(); // trackId → blob: URL

// PERF-CRIT-2 FIX : Set des blob: URLs actuellement référencées par un <img> dans le DOM.
// Maintenue par _patchArtDOM (add) et revokeArt (delete).
// Remplace le document.querySelectorAll('img') global dans _evict() — élimine le
// scan DOM complet à chaque éviction LRU (5-15 ms/frame sur sessions longues).
// Compromis accepté : si un innerHTML= efface des <img> sans passer par revokeArt,
// les URLs restent dans _domBlobUrls jusqu'à leur prochaine éviction. La garde
// primaire `id === curId` reste correcte — seule la précision du "est-ce en DOM"
// peut être légèrement pessimiste (évite une révocation, ne cause pas de fuite).
const _domBlobUrls = new Set(); // blob: URL → présente dans un <img> DOM

/** Éviction LRU — supprime l'entrée la plus ancienne qui n'est NI la piste en
 *  cours NI actuellement affichée dans le DOM (ligne de liste, carte de grille,
 *  drill header). Révoquer une blob: URL encore référencée par un <img> visible
 *  casserait l'image — c'est la cause des pochettes qui disparaissent. */
function _evict() {
  if (_cache.size < MAX_CACHE) return;
  const curIdx = get('curIdx');
  const tracks = get('tracks');
  const curId  = curIdx >= 0 ? tracks[curIdx]?.id : null;
  // PERF-CRIT-2 FIX : utiliser la Set maintenue plutôt que querySelectorAll('img').
  const inDom = _domBlobUrls;
  for (const [id, url] of _cache) {
    if (id === curId || inDom.has(url)) continue;
    _domBlobUrls.delete(url);
    URL.revokeObjectURL(url);
    _cache.delete(id);
    // Effacer la référence dans l'objet track pour que thtml() retombe sur le placeholder
    const idx = trackIdx(id);
    if (idx >= 0 && tracks[idx]) tracks[idx].art = null;
    return;
  }
  // Aucune entrée évictable (toutes visibles / piste courante) : on dépasse
  // temporairement le quota plutôt que de casser une image affichée.
}

/** Patch le DOM : remplace le .tart-ph par un <img> dans la ligne de piste. */
function _patchArtDOM(t) {
  const row = document.getElementById('tr-' + t.id);
  if (!row) return;
  const ph = row.querySelector('.tart-ph');
  if (!ph) return;                      // déjà remplacé ou piste absente de la fenêtre
  const img = document.createElement('img');
  img.className = 'art-img';
  img.alt       = '';
  img.setAttribute('aria-hidden', 'true');
  img.onload    = () => img.classList.add('art-loaded');
  img.src       = t.art;
  // PERF-CRIT-2 FIX : enregistrer l'URL dans la Set pour que _evict() sache
  // qu'elle est référencée dans le DOM sans scanner querySelectorAll('img').
  if (t.art) _domBlobUrls.add(t.art);
  ph.replaceWith(img);
}

// ── API publique ──────────────────────────────────────────────

/**
 * Charge l'artwork d'une piste depuis le cache LRU ou depuis IDB.
 * Patch le DOM de la ligne et met à jour la barre Now Playing si nécessaire.
 * No-op si la piste n'a pas d'artwork ou si l'artwork est déjà chargé.
 *
 * @param {object} t - Track object (doit avoir _hasArt, noArt, id, art)
 */
/**
 * Résout le blob: URL de l'artwork d'une piste (cache LRU → _artBuf → IDB).
 * NE patche PAS le DOM — primitive partagée par loadArt() (vue liste) et par
 * l'hydratation paresseuse des grilles albums/artistes (renderer.js).
 *
 * @param {object} t - Track object (doit avoir _hasArt, noArt, id)
 * @returns {Promise<string|null>} blob: URL ou null si la piste n'a pas d'artwork
 */
export async function getArtUrl(t) {
  if (!t || !t._hasArt || t.noArt) return null;

  // Artwork déjà résolu
  if (t.art) return t.art;

  // Hit LRU — réutiliser l'URL existante (rafraîchir l'ordre LRU)
  if (_cache.has(t.id)) {
    const cached = _cache.get(t.id);
    _cache.delete(t.id);
    _cache.set(t.id, cached);           // déplace en fin (= plus récent)
    t.art = cached;
    return cached;
  }

  // Bytes déjà en mémoire (LRU évicté, mais _artBuf non effacé) — recréer sans IDB
  if (t._artBuf) {
    _evict();
    const url = URL.createObjectURL(new Blob([t._artBuf], { type: t._artMime || 'image/jpeg' }));
    _cache.set(t.id, url);
    t.art = url;
    return url;
  }

  // Miss — charger depuis IDB
  try {
    if (!DB) return null;
    const rec = await dget('tracks', t.id);
    if (!rec) return null;

    let buf, mime;
    if (rec.artBuf) {
      buf  = rec.artBuf;
      mime = ART_MIME_ALLOWLIST.includes(rec.artMime) ? rec.artMime : 'image/jpeg';
    } else if (rec.artB64) {
      // Compat : anciens enregistrements IDB avec data: URL base64
      const rawMime = rec.artB64.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
      mime = ART_MIME_ALLOWLIST.includes(rawMime) ? rawMime : 'image/jpeg';
      const b64 = rec.artB64.split(',')[1];
      if (!b64) { t.noArt = true; return null; }
      const arr = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      buf = arr.buffer;
    } else {
      // IDB ne contient pas d'artwork — corriger le flag
      t.noArt    = true;
      t._hasArt  = false;
      return null;
    }

    _evict();
    const url = URL.createObjectURL(new Blob([buf], { type: mime }));
    _cache.set(t.id, url);
    // Garder les bytes en mémoire pour que _resolveArtBuf (flushTrackBatch) ne refasse pas l'IDB
    t._artBuf  = buf;
    t._artMime = mime;
    t.art      = url;
    return url;
  } catch(e) {
    console.warn('[artLoader] getArtUrl failed:', t.id, e);
    return null;
  }
}

/**
 * Charge l'artwork d'une piste et patche sa ligne dans la vue liste.
 * Met à jour la barre Now Playing si la piste est la piste courante.
 *
 * @param {object} t - Track object (doit avoir _hasArt, noArt, id, art)
 */
export async function loadArt(t) {
  if (!t._hasArt || t.noArt) return;
  const hadArt = !!t.art;
  const url = await getArtUrl(t);
  if (!url) return;
  _patchArtDOM(t);
  // updateBar uniquement quand l'artwork vient d'être résolu (parité avec l'ancien comportement).
  if (!hadArt && trackIdx(t.id) === get('curIdx')) updateBar();
}

/**
 * Déclenche le chargement d'artwork pour une liste de pistes (fire-and-forget).
 * Appelé par virtRenderWindow() après chaque rendu de la fenêtre visible.
 *
 * @param {object[]} trackList - Pistes à précharger
 */
export function prefetchArts(trackList) {
  for (const t of trackList) {
    if (t._hasArt && !t.art && !t.noArt) {
      loadArt(t).catch(e => console.warn('[artLoader:prefetchArts]', t.id, e));
    }
  }
}

/**
 * Révoque le blob: URL d'une piste supprimée et la retire du cache LRU.
 * Appelé quand une piste est supprimée de la bibliothèque.
 *
 * @param {string} trackId
 */
export function revokeArt(trackId) {
  const url = _cache.get(trackId);
  if (url) {
    // PERF-CRIT-2 FIX : retirer de la Set avant de révoquer.
    _domBlobUrls.delete(url);
    URL.revokeObjectURL(url);
    _cache.delete(trackId);
  }
}

/**
 * Crée un blob: URL pour une piste depuis son _artBuf et l'enregistre dans le cache LRU.
 * Permet à library.js (path tag-load batch) de bénéficier de l'éviction LRU au lieu
 * de créer des blob: URLs hors-cache qui s'accumulent en RAM.
 *
 * @param {object} t - Track object (doit avoir id, _artBuf, _artMime)
 * @returns {string|null} blob: URL ou null si _artBuf manquant
 */
export function cacheArt(t) {
  if (!t._artBuf) return null;
  // Si une entrée existe deja (rare), revoke pour eviter la fuite avant remplacement
  const existing = _cache.get(t.id);
  if (existing) { URL.revokeObjectURL(existing); _cache.delete(t.id); }
  _evict();
  const url = URL.createObjectURL(new Blob([t._artBuf], { type: t._artMime || 'image/jpeg' }));
  _cache.set(t.id, url);
  return url;
}
