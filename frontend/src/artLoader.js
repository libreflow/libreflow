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

// ── Constantes ────────────────────────────────────────────────
const MAX_CACHE = CFG.MAX_ART_CACHE;   // 60 entrées ≈ 6 MB max
const ART_MIME_ALLOWLIST = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff'];

// ── Cache LRU ─────────────────────────────────────────────────
// Map insertion-ordered : le premier élément est le plus ancien (LRU).
const _cache = new Map(); // trackId → blob: URL

/** Éviction LRU — supprime l'entrée la plus ancienne qui n'est pas la piste en cours. */
function _evict() {
  if (_cache.size < MAX_CACHE) return;
  const curIdx = get('curIdx');
  const tracks = get('tracks');
  const curId  = curIdx >= 0 ? tracks[curIdx]?.id : null;
  for (const [id, url] of _cache) {
    if (id !== curId) {
      URL.revokeObjectURL(url);
      _cache.delete(id);
      // Effacer la référence dans l'objet track pour que thtml() retombe sur le placeholder
      const idx = trackIdx(id);
      if (idx >= 0 && tracks[idx]) tracks[idx].art = null;
      return;
    }
  }
  // Cas dégénéré : toutes les entrées sont la piste en cours (impossible avec MAX_CACHE > 1).
  // On dépasse légèrement le quota plutôt que de révoquer l'artwork actif.
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
export async function loadArt(t) {
  if (!t._hasArt || t.noArt) return;

  // Artwork déjà chargé (blob: URL) — juste patcher le DOM si le nœud existe
  if (t.art) {
    _patchArtDOM(t);
    return;
  }

  // Hit LRU — réutiliser l'URL existante (rafraîchir l'ordre LRU)
  if (_cache.has(t.id)) {
    const cached = _cache.get(t.id);
    _cache.delete(t.id);
    _cache.set(t.id, cached);           // déplace en fin (= plus récent)
    t.art = cached;
    _patchArtDOM(t);
    if (trackIdx(t.id) === get('curIdx')) window.updateBar?.();
    return;
  }

  // Bytes déjà en mémoire (LRU évicté, mais _artBuf non effacé) — recréer sans IDB
  if (t._artBuf) {
    _evict();
    const url = URL.createObjectURL(new Blob([t._artBuf], { type: t._artMime || 'image/jpeg' }));
    _cache.set(t.id, url);
    t.art = url;
    _patchArtDOM(t);
    if (trackIdx(t.id) === get('curIdx')) window.updateBar?.();
    return;
  }

  // Miss — charger depuis IDB
  try {
    if (!DB) return;
    const rec = await dget('tracks', t.id);
    if (!rec) return;

    let buf, mime;
    if (rec.artBuf) {
      buf  = rec.artBuf;
      mime = ART_MIME_ALLOWLIST.includes(rec.artMime) ? rec.artMime : 'image/jpeg';
    } else if (rec.artB64) {
      // Compat : anciens enregistrements IDB avec data: URL base64
      const rawMime = rec.artB64.match(/data:([^;]+)/)?.[1] || 'image/jpeg';
      mime = ART_MIME_ALLOWLIST.includes(rawMime) ? rawMime : 'image/jpeg';
      const b64 = rec.artB64.split(',')[1];
      if (!b64) { t.noArt = true; return; }
      const arr = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      buf = arr.buffer;
    } else {
      // IDB ne contient pas d'artwork — corriger le flag
      t.noArt    = true;
      t._hasArt  = false;
      return;
    }

    _evict();
    const url = URL.createObjectURL(new Blob([buf], { type: mime }));
    _cache.set(t.id, url);
    // Garder les bytes en mémoire pour que _resolveArtBuf (flushTrackBatch) ne refasse pas l'IDB
    t._artBuf  = buf;
    t._artMime = mime;
    t.art      = url;
    _patchArtDOM(t);
    if (trackIdx(t.id) === get('curIdx')) window.updateBar?.();
  } catch(e) {
    console.warn('[artLoader] loadArt failed:', t.id, e);
  }
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
      loadArt(t).catch(() => {});
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
