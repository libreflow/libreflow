// organize.js — Réorganisation de la bibliothèque en arborescence sur disque.
//
// Flux :
//   1. organizePreview(scheme) — calcule les moves, dry-run Rust, affiche modal
//   2. organizeConfirm()       — exécute les moves, met à jour IDB + mémoire
//   3. organizeCancel()        — ferme le modal, vide _pendingMoves
//
// Les déplacements sont atomiques (fs::rename Rust). Rollback sur première erreur.
// Jamais de copy+delete.
//
// Exports :
//   computeMoves(tracks, basePath, scheme) — pur, testable
//   sanitizeName(s)                        — pur, testable
//   organizePreview(scheme)
//   organizeConfirm()
//   organizeCancel()

import { get, set, notify }     from './store.js';
import { saveTracks }            from './library.js';
import { getWatchPath }          from './watchfolder.js';
import { invoke }                from './ipc.js';
import { toast, esc }            from './ui.js';
import { VIRT }                  from './virt.js';
import { rebuildTrackIdxMap,
         invalidateFilterCache } from './search.js';

// ── État module ───────────────────────────────────────────────────────────────
/** @type {Array<{from:string,to:string}>} */
let _pendingMoves = [];
/** @type {HTMLElement|null} — élément à re-focuser à la fermeture (a11y) */
let _prevFocus = null;

// ── Helpers de chemin ─────────────────────────────────────────────────────────

/**
 * Remplace les caractères interdits par '_', tronque à 80 chars.
 * @param {string|undefined} s
 * @returns {string}
 */
export function sanitizeName(s) {
  return (String(s || 'Inconnu'))
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\x00-\x1f]/g, '_')
    .trim()
    .replace(/\s+$/, '')
    .replace(/\.+$/, '')
    .slice(0, 80) || 'Inconnu';
}

function _getBasename(filePath) {
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
}

function _sep(basePath) {
  return basePath.includes('\\') ? '\\' : '/';
}

// ── computeMoves ─────────────────────────────────────────────────────────────

/**
 * Calcule la liste des déplacements à effectuer pour organiser la bibliothèque.
 * Fonction pure — facilement testable.
 *
 * @param {Array<{path:string,artist?:string,album?:string}>} tracks
 * @param {string} basePath — dossier racine de la bibliothèque
 * @param {'artist-album'|'artist'|'flat'} scheme
 * @returns {Array<{from:string,to:string}>}
 */
export function computeMoves(tracks, basePath, scheme) {
  const sep  = _sep(basePath);
  const base = basePath.replace(/[\\/]+$/, '');
  const moves = [];
  const seen  = new Set();

  for (const t of tracks) {
    if (!t.path) continue;

    const file   = _getBasename(t.path);
    const artist = sanitizeName(t.artist);
    const album  = sanitizeName(t.album);

    let targetDir;
    if      (scheme === 'artist-album') targetDir = [base, artist, album].join(sep);
    else if (scheme === 'artist')       targetDir = [base, artist].join(sep);
    else if (scheme === 'flat')         targetDir = base;
    else continue;

    const to    = targetDir + sep + file;
    const fromN = t.path.replace(/\\/g, '/');
    const toN   = to.replace(/\\/g, '/');

    if (fromN === toN) continue;
    if (seen.has(toN)) continue;
    seen.add(toN);

    moves.push({ from: t.path, to });
  }

  return moves;
}

// ── organizePreview ───────────────────────────────────────────────────────────

/**
 * Étape 1 : calcule les moves, valide via Rust (dry-run), ouvre le modal.
 * @param {'artist-album'|'artist'|'flat'} scheme
 */
export async function organizePreview(scheme) {
  const tracks   = get('tracks');
  const basePath = getWatchPath();

  if (!basePath) {
    toast('Aucun dossier de surveillance configuré', 'error');
    return;
  }
  if (!tracks.length) {
    toast('Aucune piste dans la bibliothèque', 'error');
    return;
  }

  const moves = computeMoves(tracks, basePath, scheme);
  if (!moves.length) {
    toast('Toutes les pistes sont déjà correctement organisées', 'info');
    return;
  }

  let dryResult;
  try {
    dryResult = await invoke('organize_files', { moves, dryRun: true });
  } catch (e) {
    toast(`Erreur de validation : ${e}`, 'error');
    return;
  }

  const valid  = dryResult.moves.filter(m => m.ok);
  const errors = dryResult.moves.filter(m => !m.ok);

  _pendingMoves = valid.map(m => ({ from: m.from, to: m.to }));

  _showOrganizeModal(valid, errors, scheme);
}

// ── organizeConfirm ───────────────────────────────────────────────────────────

/**
 * Étape 2 : exécute les moves stockés dans _pendingMoves, met à jour IDB + mémoire.
 */
export async function organizeConfirm() {
  if (!_pendingMoves.length) {
    organizeCancel();
    return;
  }

  const btn = document.getElementById('organize-confirm-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'En cours…'; }

  let result;
  try {
    result = await invoke('organize_files', { moves: _pendingMoves, dryRun: false });
  } catch (e) {
    toast(`Erreur lors de l'organisation : ${e}`, 'error');
    organizeCancel();
    return;
  }

  const failCount = result.error_count;

  if (failCount > 0) {
    // Rust rolled back all moves on first failure — do not update any paths
    _pendingMoves = [];
    organizeCancel();
    toast(`Erreur lors de l'organisation : ${failCount} fichier(s) non déplacé(s). Aucune modification appliquée.`, 'error');
    return;
  }

  // All moves succeeded — update paths in memory + IDB
  const succeeded = result.moves.filter(m => m.ok);
  const tracks    = get('tracks');
  const pathMap   = new Map(succeeded.map(m => [m.from, m.to]));

  // B-2 FIX: accumuler les pistes modifiées, puis appeler saveTracks() une seule
  // fois après la boucle — évite N transactions IDB individuelles non-debounced.
  const movedTracks = [];
  for (const track of tracks) {
    const newPath = pathMap.get(track.path);
    if (newPath) {
      track.path = newPath;
      movedTracks.push(track);
    }
  }
  if (movedTracks.length) saveTracks(...movedTracks);

  // INVARIANT: toute mutation de tracks[] → rebuildTrackIdxMap() AVANT notify()
  // mutation in-place — set() would no-op (same array reference)
  rebuildTrackIdxMap();
  invalidateFilterCache();
  VIRT._lastListSig = '';
  notify('tracks');

  _pendingMoves = [];
  organizeCancel();
  toast(`${succeeded.length} fichier(s) organisé(s) avec succès`, 'success');
}

// ── organizeCancel ────────────────────────────────────────────────────────────

/** Annule / ferme le modal d'organisation sans rien modifier. */
export function organizeCancel() {
  _pendingMoves = [];
  const bg = document.getElementById('organize-modal-bg');
  if (!bg || bg.classList.contains('modal-closing')) return;
  bg.classList.add('modal-closing');
  bg.addEventListener('animationend', () => {
    bg.classList.remove('on', 'modal-closing');
  }, { once: true });
  // Fallback si l'animation CSS ne se déclenche pas (ex: prefers-reduced-motion).
  // Stocké pour pouvoir être annulé si le modal est rouvert avant l'échéance.
  bg._closeTimer = setTimeout(() => bg.classList.remove('on', 'modal-closing'), 300);
  // A11Y : restaurer le focus à l'élément qui a ouvert le modal.
  if (_prevFocus && typeof _prevFocus.focus === 'function') _prevFocus.focus();
  _prevFocus = null;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

const _SCHEME_LABELS = {
  'artist-album': 'Artiste / Album / fichier',
  'artist':       'Artiste / fichier',
  'flat':         'Plat (tous les fichiers à la racine)',
};

const _MAX_PREVIEW = 8;

function _showOrganizeModal(valid, errors, scheme) {
  const bg = document.getElementById('organize-modal-bg');
  if (!bg) return;

  // Annule un close en cours pour éviter que le timer/anim ne strip 'on' juste après réouverture
  if (bg._closeTimer) { clearTimeout(bg._closeTimer); bg._closeTimer = null; }
  bg.classList.remove('modal-closing');

  const title   = document.getElementById('organize-modal-title');
  const summary = document.getElementById('organize-modal-summary');
  const list    = document.getElementById('organize-modal-list');
  const btn     = document.getElementById('organize-confirm-btn');

  if (title) title.textContent = `Organiser — ${_SCHEME_LABELS[scheme] || scheme}`;

  const totalValid = valid.length;
  const totalErr   = errors.length;

  let summaryHtml = `<strong>${totalValid}</strong> fichier(s) seront déplacés.`;
  if (totalErr > 0) {
    summaryHtml += ` <span style="color:var(--danger,#f87)"><strong>${totalErr}</strong> ignoré(s) (source introuvable ou destination occupée)</span>.`;
  }
  if (summary) summary.innerHTML = summaryHtml;

  if (list) {
    const preview = valid.slice(0, _MAX_PREVIEW);
    const extra   = totalValid - preview.length;
    list.innerHTML = preview.map(m => {
      const fromShort = esc(m.from.replace(/\\/g, '/').split('/').slice(-2).join('/'));
      const toShort   = esc(m.to.replace(/\\/g, '/').split('/').slice(-3).join('/'));
      return `<div class="organize-move-row">
        <span class="organize-move-from" title="${esc(m.from)}">…/${fromShort}</span>
        <span class="organize-move-arrow">→</span>
        <span class="organize-move-to" title="${esc(m.to)}">…/${toShort}</span>
      </div>`;
    }).join('') + (extra > 0
      ? `<div class="organize-move-more">…et ${extra} autre(s)</div>`
      : '');
  }

  if (btn) {
    btn.disabled    = totalValid === 0;
    btn.textContent = totalValid === 0 ? 'Rien à faire' : 'Confirmer';
  }

  // A11Y : sauvegarder l'élément focusé avant ouverture (restauré dans organizeCancel)
  _prevFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  bg.classList.add('on');

  setTimeout(() => {
    bg.querySelector('[data-action="organize-cancel"]')?.focus();
  }, 50);
}
