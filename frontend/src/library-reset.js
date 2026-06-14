// @ts-nocheck
// frontend/src/library-reset.js
// Extracted clearLibrary helpers from app.js.
// These functions must NOT import from app.js (no circular deps).
import { get, set }                               from './store.js';
import { emit, EVENTS }                           from './bus.js';
import { audio, setIcon, clearCrossfadeTimers, resetShuffleQ } from './player.js';
import { tx }                                     from './db.js';
import { saveCfgNow }                             from './cfgsave.js';
import { replaceTracks }                          from './state.js';
import { invalidateFilterCache }                  from './search.js';
import { invalidateGenreGridSig }                 from './genres.js';
import { cancelTrackBatch }                       from './library.js';
import { cancelPlayLogFlush, setPlayLog }         from './playlog.js';
import { resetRadio }                             from './radio.js';
import { cancelSleepTimer }                       from './sleep.js';
import { stopWatchFolder }                        from './watchfolder.js';
import { setupMarquee }                           from './playerbar.js';
import { _updateArtBlur, clearArtColor }          from './settings.js';
import { updateSidebarCounts }                    from './renderer.js';
import { showView }                               from './views.js';
import { i18n }                                   from './i18n.js';

/** Révoque les blob URLs et réinitialise toutes les variables d'état en mémoire. */
export function _clearLibraryState() {
  // B4 FIX : guard blob: — data: URIs ne doivent pas être révoquées
  for (const t of (get('tracks') || [])) {
    if (t.url && t.url.startsWith('blob:'))  try { URL.revokeObjectURL(t.url);  } catch(e) { console.warn('[app:revokeObjectURL url]', e); }
    if (t.art && t.art.startsWith('blob:'))  try { URL.revokeObjectURL(t.art);  } catch(e) { console.warn('[app:revokeObjectURL art]', e); }
  }
  // FIX freeze : vider tracks[] AVANT d'émettre FILTER_CHANGED (bus synchrone).
  replaceTracks([]);
  invalidateFilterCache();
  invalidateGenreGridSig();
  emit(EVENTS.FILTER_CHANGED, {});
  set('liked', new Set());
  set('playlists', []); set('recentPlays', []);
  set('curPlId', null);
  set('plFolders', []); set('recentPls', []);
  set('curIdx', -1);
  set('shuffle', false); resetShuffleQ();
  set('repeat', 'none');
  set('query', '');
  set('formatFilter', '');
  set('albumSort', 'name');
  set('artistSort', 'name');
  set('genreSort', 'count');
  set('albumDetailSort', 'track');
}

/** Remet à zéro tous les éléments DOM : barre player, recherche, sidebar. */
export function _clearLibraryDOM() {
  // (_lastNotifTrackId dans playerbar.js se réinitialise naturellement au prochain updateBar)
  audio.pause();
  audio.src = '';
  document.title = 'LibreFlow';
  setupMarquee(document.getElementById('pl-n'), '–');
  setupMarquee(document.getElementById('pl-a'), '–');
  _updateArtBlur(null);
  clearArtColor(); // réinitialise --art-color, --g, --g-rgb, --gd, --gg
  const _plImg = document.getElementById('pl-img');
  if (_plImg) _plImg.style.display = 'none';
  const _plEm = document.getElementById('pl-em');
  if (_plEm) _plEm.style.display  = '';
  if (_plEm) _plEm.innerHTML      = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  const _pfill = document.getElementById('pfill');
  if (_pfill) _pfill.style.transform = 'scaleX(0)';
  const _tc = document.getElementById('tc');
  if (_tc) _tc.textContent = '0:00';
  const _td = document.getElementById('td');
  if (_td) _td.textContent = '–:––';
  document.getElementById('pl-lk')?.classList.remove('on');
  document.getElementById('pl-lk')?.setAttribute('aria-pressed', 'false');
  document.getElementById('cinema-lk')?.classList.remove('on');
  document.getElementById('cinema-lk')?.setAttribute('aria-pressed', 'false');
  document.getElementById('pc-shuf')?.classList.remove('on');
  document.getElementById('pc-shuf')?.setAttribute('aria-pressed', 'false');
  document.getElementById('cinema-shuf')?.classList.remove('on');
  document.getElementById('cinema-shuf')?.setAttribute('aria-pressed', 'false');
  document.getElementById('pc-rep')?.classList.remove('on');
  document.getElementById('pc-rep')?.setAttribute('aria-pressed', 'false');
  document.getElementById('cinema-rep')?.classList.remove('on');
  document.getElementById('cinema-rep')?.setAttribute('aria-pressed', 'false');
  setIcon(false);
  const _srch = document.getElementById('srch');
  if (_srch) _srch.value = '';
  const _srchClr = document.getElementById('srch-clear');
  if (_srchClr) _srchClr.style.display = 'none';
  document.getElementById('srch-badge')?.remove();
  const _sbSpan = document.createElement('span'); _sbSpan.className = 'sb-empty-msg';
  _sbSpan.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
  _sbSpan.append(document.createTextNode(i18n('sb_empty')));
  document.getElementById('sb-stats')?.replaceChildren(_sbSpan);
  updateSidebarCounts();
  const _btnClear = document.getElementById('btn-clear');
  if (_btnClear) _btnClear.disabled = true;
}

/** Vide les trois stores IDB (tracks, playlists, playlog) et flush cfg. */
export async function _clearLibraryIDB() {
  try {
    await new Promise((ok, fail) => {
      const store = tx('tracks', 'readwrite');
      store.clear().onerror = e => fail(e.target.error);
      store.transaction.oncomplete = ok;
      store.transaction.onerror   = e => fail(e.target.error);
      store.transaction.onabort   = () => fail(new Error('[clearLibrary] tracks tx aborted'));
    });
    await new Promise((ok, fail) => {
      const store = tx('playlists', 'readwrite');
      store.clear().onerror = e => fail(e.target.error);
      store.transaction.oncomplete = ok;
      store.transaction.onerror   = e => fail(e.target.error);
      store.transaction.onabort   = () => fail(new Error('[clearLibrary] playlists tx aborted'));
    });
    await new Promise((ok, fail) => {
      const store = tx('playlog', 'readwrite');
      store.clear().onerror = e => fail(e.target.error);
      store.transaction.oncomplete = ok;
      store.transaction.onerror   = e => fail(e.target.error);
      store.transaction.onabort   = () => fail(new Error('[clearLibrary] playlog tx aborted'));
    });
    await saveCfgNow();
  } catch(e) { console.warn('[clearLibrary] DB error:', e); }
}

/** Réinitialise radio, crossfade, sleep, watchfolder, vue/drill, et navigue vers l'écran d'accueil. */
export function _clearLibraryView() {
  resetRadio();
  clearCrossfadeTimers();
  cancelSleepTimer(true);
  stopWatchFolder();
  set('view', 'all');
  set('drillKey', '');
  set('drillFrom', '');
  set('drillDisplayName', '');
  document.getElementById('drill-header')?.remove();
  const _tlistClr = document.getElementById('tlist');
  if (_tlistClr) _tlistClr.innerHTML = '';
  ['album-grid', 'artist-grid', 'playlist-grid'].forEach(id => {
    const g = document.getElementById(id);
    if (g) g.innerHTML = '';
  });
  showView('wlc');
}
