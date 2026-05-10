// LibreFlow — tagedit.js
// Éditeur de tags inline (double-clic sur une piste).
// Extrait de app.js.
//
// Dépendances :
//   import  : extEmoji, esc, mainArtist  (utils.js)
//   import  : VIRT                       (virt.js)
//   import  : invoke                     (ipc.js)
//   window  : _trackIdxMap, tracks       (getters)
//             saveTrackNow, invalidateFilter, renderLib,
//             trackIdx, updateBar, toast  (callbacks)
//
// Exports publics :
//   openTagEditor, saveTagEdit, cancelTagEdit

import { extEmoji, esc, mainArtist } from './utils.js';
import { VIRT }                       from './virt.js';
import { invoke }                     from './ipc.js';
import { i18n }                       from './i18n.js';
import { get, subscribe }               from './store.js'; // Phase 4
import { emit, EVENTS }               from './bus.js';
import { toast }                                        from './ui.js';
import { _trackIdxMap, trackIdx, invalidateFilterCache } from './search.js';
import { updateBar } from './playerbar.js';
import { saveTrackNow } from './library.js';
import { queueOpen, renderQueue } from './queue.js';

// ── État interne ──────────────────────────────────────────────
let _editingTrackId     = null;
let _tagKeyHandler      = null; // BUG FIX 4 : stocké au niveau module, pas sur l'élément DOM
                                 // (le virt-scroll peut remplacer l'élément pendant l'édition)
let _stopClickHandler   = null; // SEC: remplace setAttribute('onclick',...) — no inline handlers
let _outsideClickActive = false; // BUG-3 : évite double listener mousedown si openTagEditor appelé 2× rapidement

// Cache datalists — invalidé sur mutation tracks (évite 15 allocations × n pistes par ouverture)
let _dlArtistsCache = null;
let _dlAlbumsCache  = null;
let _dlGenresCache  = null;
subscribe('tracks', () => { _dlArtistsCache = _dlAlbumsCache = _dlGenresCache = null; });

// ── Éditeur ───────────────────────────────────────────────────

export function openTagEditor(trackId) {
  // Fermer tout éditeur déjà ouvert
  if (_editingTrackId) cancelTagEdit();

  const t = (_trackIdxMap.has(trackId) ? get('tracks')[_trackIdxMap.get(trackId)] : undefined);
  if (!t) return;

  const el = document.getElementById('tr-' + trackId);
  if (!el) return;

  _editingTrackId = trackId;
  el.classList.add('editing');
  // Bloquer les clics/dblclics pendant l'édition sans inline handler
  el.removeAttribute('ondblclick');
  el.removeAttribute('onkeydown');
  _stopClickHandler = (e) => e.stopPropagation();
  el.addEventListener('click', _stopClickHandler);

  const _lTitle  = i18n('te_title');
  const _lArtist = i18n('te_artist');
  const _lAlbum  = i18n('te_album');
  const _lGenre  = i18n('te_genre');
  const _lYear   = i18n('te_year');
  const _lTrack  = i18n('te_track_num');
  const _lHint   = i18n('te_hint');
  const _lSave   = i18n('te_save');
  const _lCancel = i18n('te_cancel');

  // UX-TAG-1 : datalist suggestions depuis la bibliothèque courante (lazy cache — invalidé par subscribe)
  if (!_dlArtistsCache) _dlArtistsCache = [...new Set(get('tracks').map(x => x.artistFull || x.artist).filter(Boolean))].sort().slice(0, 200);
  if (!_dlAlbumsCache)  _dlAlbumsCache  = [...new Set(get('tracks').map(x => x.album).filter(Boolean))].sort().slice(0, 200);
  if (!_dlGenresCache)  _dlGenresCache  = [...new Set(get('tracks').map(x => x.genre).filter(Boolean))].sort().slice(0, 100);
  const _dlArtists = _dlArtistsCache;
  const _dlAlbums  = _dlAlbumsCache;
  const _dlGenres  = _dlGenresCache;
  const _dlOpts = (arr) => arr.map(v => `<option value="${esc(v)}">`).join('');

  el.innerHTML = `
    <div class="tart">${t.art
      ? `<img src="${esc(t.art)}" alt="">`
      : `<span class="tart-ph">${extEmoji(t.ext)}</span>`}
    </div>
    <div class="tag-edit-form">
      <datalist id="te-dl-artist">${_dlOpts(_dlArtists)}</datalist>
      <datalist id="te-dl-album">${_dlOpts(_dlAlbums)}</datalist>
      <datalist id="te-dl-genre">${_dlOpts(_dlGenres)}</datalist>
      <div class="tag-edit-row">
        <label class="tag-edit-lbl" for="te-name">${_lTitle}</label>
        <!-- A11Y-08: aria-describedby pointe vers le message d'erreur (vide à l'ouverture) -->
        <input class="tag-edit-inp" id="te-name" value="${esc(t.name)}" placeholder="${_lTitle}" autocomplete="off" aria-describedby="te-name-error">
        <span id="te-name-error" role="alert" class="sr-only"></span>
      </div>
      <div class="tag-edit-row">
        <label class="tag-edit-lbl" for="te-artist">${_lArtist}</label>
        <input class="tag-edit-inp" id="te-artist" value="${esc(t.artistFull||t.artist||'')}" placeholder="${_lArtist}" autocomplete="off" list="te-dl-artist">
        <label class="tag-edit-lbl" for="te-album" style="width:36px">${_lAlbum}</label>
        <input class="tag-edit-inp" id="te-album"  value="${esc(t.album||'')}"                placeholder="${_lAlbum}" autocomplete="off" list="te-dl-album">
      </div>
      <div class="tag-edit-row">
        <label class="tag-edit-lbl" for="te-genre">${_lGenre}</label>
        <input class="tag-edit-inp" id="te-genre"  value="${esc(t.genre||'')}"                placeholder="${_lGenre}" autocomplete="off" list="te-dl-genre" style="max-width:120px">
        <label class="tag-edit-lbl" for="te-year" style="width:36px">${_lYear}</label>
        <input class="tag-edit-inp" id="te-year"   value="${esc(t.year||'')}"                 placeholder="2024" type="number" min="1900" max="2099" autocomplete="off" style="max-width:72px">
        <label class="tag-edit-lbl" for="te-track" style="width:28px" title="${_lTrack}">${_lTrack}</label>
        <input class="tag-edit-inp" id="te-track"  value="${esc(t.track||'')}"                placeholder="1" type="number" min="1" max="999" autocomplete="off" style="max-width:56px">
      </div>
      <div class="tag-edit-actions">
        <span class="tag-edit-hint">${_lHint}</span>
        <button class="tag-edit-cancel" data-action="cancel-tag-edit">${_lCancel}</button>
        <button class="tag-edit-save"   data-action="save-tag-edit" data-track-id="${trackId}">${_lSave}</button>
      </div>
      ${(() => {
        // C-3 : panneau info audio (read-only) — affiché uniquement si données disponibles
        const parts = [];
        if (t.ext)        parts.push(`<span class="tei-codec">${t.ext.toUpperCase()}</span>`);
        if (t.bitDepth)   parts.push(`${t.bitDepth}-bit`);
        if (t.sampleRate) parts.push(`${(t.sampleRate / 1000).toFixed(t.sampleRate % 1000 === 0 ? 0 : 1)} kHz`);
        if (t.bitrate)    parts.push(`${t.bitrate} kbps`);
        if (t.channels)   parts.push(t.channels === 1 ? 'Mono' : t.channels === 2 ? 'Stéréo' : `${t.channels} ch`);
        return parts.length ? `<div class="tag-edit-audio-info">${parts.join('<span class="tei-sep">·</span>')}</div>` : '';
      })()}
    </div>`;

  // Masquer l'artwork si l'image échoue à charger (sans inline onerror)
  const _artImg = el.querySelector('.tart img');
  if (_artImg) _artImg.addEventListener('error', () => { _artImg.style.display = 'none'; }, { once: true });

  // Focus sur le champ titre
  setTimeout(() => {
    if (!_editingTrackId) return;
    const inp = document.getElementById('te-name');
    if (inp) { inp.focus(); inp.select(); }
  }, 30);

  // Raccourcis clavier dans l'éditeur
  _tagKeyHandler = (e) => {
    if (e.code === 'Enter' && !e.shiftKey) { e.preventDefault(); saveTagEdit(trackId); }
    if (e.code === 'Escape') { e.stopImmediatePropagation(); cancelTagEdit(); }
  };
  el.addEventListener('keydown', _tagKeyHandler);

  // BUG FIX 5 : enregistrer le listener mousedown ici (once:true) au lieu
  // d'un listener global permanent qui tourne même sans éditeur ouvert
  // BUG-3 : guard contre double enregistrement si openTagEditor appelé 2× rapidement
  if (_outsideClickActive) return;
  _outsideClickActive = true;
  document.addEventListener('mousedown', function _onOutsideClick(e) {
    if (!_editingTrackId) { _outsideClickActive = false; return; }
    const editorEl = document.getElementById('tr-' + _editingTrackId);
    if (!editorEl) { _editingTrackId = null; _outsideClickActive = false; return; }
    if (editorEl.contains(e.target)) {
      // re-enregistrer pour le prochain clic (once:true consommé)
      document.addEventListener('mousedown', _onOutsideClick, { once: true });
      return;
    }
    _outsideClickActive = false;
    cancelTagEdit();
  }, { once: true });
}

export async function saveTagEdit(trackId) {
  const t = (_trackIdxMap.has(trackId) ? get('tracks')[_trackIdxMap.get(trackId)] : undefined);
  const el = document.getElementById('tr-' + trackId);
  if (!t || !el) { cancelTagEdit(); return; }

  const name   = (document.getElementById('te-name')?.value   || '').trim();
  const artist = (document.getElementById('te-artist')?.value || '').trim();
  const album  = (document.getElementById('te-album')?.value  || '').trim();
  const genre  = (document.getElementById('te-genre')?.value  || '').trim();
  const year   = (() => { const v = parseInt(document.getElementById('te-year')?.value  || ''); return (Number.isInteger(v) && v >= 1900 && v <= 2099) ? v : null; })();
  const track  = (() => { const v = parseInt(document.getElementById('te-track')?.value || ''); return (Number.isInteger(v) && v >= 1 && v <= 999)   ? v : null; })();

  if (!name) {
    // A11Y-08: signaler le champ invalide au screen reader via aria-invalid + message d'erreur
    const nameInp  = document.getElementById('te-name');
    const nameErr  = document.getElementById('te-name-error');
    if (nameInp) nameInp.setAttribute('aria-invalid', 'true');
    if (nameErr) nameErr.textContent = i18n('te_required') || 'Le titre est requis.';
    nameInp?.focus();
    return;
  }
  // A11Y-08: effacer l'état d'erreur si le titre est valide
  const _nameInp = document.getElementById('te-name');
  const _nameErr = document.getElementById('te-name-error');
  if (_nameInp) _nameInp.removeAttribute('aria-invalid');
  if (_nameErr) _nameErr.textContent = '';

  // Appliquer les modifications en mémoire
  const _unknownArtist = i18n('unknown_artist');
  t.name       = name;
  t.artistFull = artist || _unknownArtist;
  t.artist     = mainArtist(artist) || artist || _unknownArtist;
  t.album      = album  || '';
  t.genre      = genre  || null;
  t.year       = year   || null;
  t.track      = track  || null;
  // Invalider les clés fuzzy cachées sur l'objet track (sessions 71 + 119)
  delete t._albumKey; delete t._artistKey;
  delete t._nlc; delete t._alc; delete t._ablc; delete t._glc; delete t._genreParts;

  // Nettoyer l'éditeur
  _cleanTagEditor(el);
  _editingTrackId = null;

  // 1. Persister en IDB immédiatement (toujours réussit)
  await saveTrackNow(t);

  // 2. Écrire dans le fichier audio via Rust (lofty)
  //    Erreur non fatale : les modifs sont déjà en IDB, on avertit juste l'utilisateur
  // Tauri v2 : les args sont { nomDuParamètreRust: valeur }
  // La commande Rust prend `data: WriteTagsData` → il faut passer { data: {...} }
  const writeResult = await invoke('write_tags', {
    data: {
      path:        t.path,
      title:       name,
      artist:      artist,
      album:       album,
      genre:       genre  || '',
      year:        year   || null,
      track_number: track || null,
    },
  }).then(() => null).catch(err => String(err));

  // Invalider le cache et re-render complet (plus fiable que outerHTML sur un élément virtualisé)
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  VIRT._lastListSig = '';
  emit(EVENTS.RENDER_LIB, {});
  if (queueOpen) renderQueue(); // rafraîchir la file si ouverte (cohérence affichage)

  // Mettre à jour la barre de lecture si c'est la piste en cours
  if (trackIdx(t.id) === get('curIdx')) updateBar();

  if (writeResult) {
    // Écriture fichier échouée → avertissement (les modifs restent dans l'IDB)
    toast(i18n('te_write_fail', writeResult), 'warning');
    console.warn('[write_tags]', writeResult);
  } else {
    toast(i18n('te_saved'), 'success');
  }
}

export function cancelTagEdit() {
  if (!_editingTrackId) return;
  const trackId = _editingTrackId;
  const el = document.getElementById('tr-' + trackId);
  _cleanTagEditor(el);
  _editingTrackId = null;
  _outsideClickActive = false;
  // Bug #10 fix : si la piste a été supprimée pendant l'édition (ex. suppression depuis
  // le menu contextuel), ne pas invalider le cache ni ré-émettre RENDER_LIB avec un ID
  // fantôme — ça provoquait un re-render inutile avec un _trackIdxMap stale.
  if (!_trackIdxMap.has(trackId)) return;
  // Re-render proprement via le moteur virtuel (cohérent avec saveTagEdit)
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  VIRT._lastListSig = '';
  emit(EVENTS.RENDER_LIB, {});
}

function _cleanTagEditor(el) {
  // BUG FIX 4 : utiliser le handler stocké au niveau module (l'élément DOM peut avoir été
  // remplacé par le virt-scroll — chercher l'élément frais via l'ID)
  const freshEl = _editingTrackId ? document.getElementById('tr-' + _editingTrackId) : null;
  if (_tagKeyHandler) {
    if (freshEl) freshEl.removeEventListener('keydown', _tagKeyHandler);
    _tagKeyHandler = null;
  }
  if (_stopClickHandler) {
    if (freshEl) freshEl.removeEventListener('click', _stopClickHandler);
    _stopClickHandler = null;
  }
  if (!el) return;
  el.classList.remove('editing');
}
