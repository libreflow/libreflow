// LibreFlow — dropin.js
// Gestion du Drag & Drop de fichiers/dossiers audio depuis l'OS vers la bibliothèque.
// Extrait de app.js (CQ-2 — réduction du module god).
//
// Dépendances :
//   import  : get             (store.js)
//   import  : emit, EVENTS     (bus.js)
//   import  : i18n             (i18n.js)
//   import  : toast            (ui.js)
//   import  : invalidateFilterCache (search.js)
//   import  : pushTracks            (state.js)       ARCH-3
//   import  : invalidateGenreGridSig (genres.js)
//   import  : loadTagsBg            (library.js)
//   import  : updateStats, renderLib (renderer.js)
//   import  : showView              (views.js)
//
// Exports publics :
//   initDrop

import { get }                                         from './store.js';
import { emit, EVENTS }                                from './bus.js';
import { i18n }                                        from './i18n.js';
import { toast }                                       from './ui.js';
import { invalidateFilterCache }                        from './search.js';
import { pushTracks }                                   from './state.js';
import { invalidateGenreGridSig }                      from './genres.js';
import { loadTagsBg }                                  from './library.js';
import { logImport }                                   from './imports.js';
import { updateStats, renderLib }                      from './renderer.js';
import { showView }                                    from './views.js';

// Extensions audio acceptées — synchronisé avec watchfolder.js et le watcher Rust
const _EXTS = new Set(['mp3','flac','aac','m4a','ogg','opus','wav','wma','aiff','ape','alac']);

// ── État interne ─────────────────────────────────────────────────────────────
let _drago    = null;  // #drago overlay — résolu après DOMContentLoaded
// Compteur dragenter/dragleave — évite le flickering sur WebView2
// (e.relatedTarget est parfois null même en intra-fenêtre sur Windows)
let _dragDepth = 0;

// ── Handlers ─────────────────────────────────────────────────────────────────

function _onDragEnter(e) {
  e.preventDefault();
  _dragDepth++;
  if (_drago) _drago.classList.add('on');
}

function _onDragOver(e) {
  e.preventDefault();
}

function _onDragLeave(e) {
  _dragDepth = Math.max(0, _dragDepth - 1);
  if (_drago && _dragDepth === 0) _drago.classList.remove('on');
}

async function _onDrop(e) {
  e.preventDefault();
  _dragDepth = 0;
  if (_drago) _drago.classList.remove('on');

  const items    = [...e.dataTransfer.items];
  const allFiles = [];

  // Support dossiers via DataTransferItem API (webkitGetAsEntry)
  async function traverseEntry(entry) {
    if (entry.isFile) {
      await new Promise(res => entry.file(
        f => { allFiles.push(f); res(); },
        err => { console.warn('[dropin] entry.file error', entry.name, err); res(); },
      ));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      // readEntries() retourne max 100 entrées à la fois — boucler jusqu'au tableau vide
      const readAll = () => new Promise(res => {
        const batch = [];
        const readBatch = () => {
          reader.readEntries(async entries => {
            if (!entries.length) { res(batch); return; }
            batch.push(...entries);
            readBatch();
          }, (err) => { console.warn('[dropin] readEntries error', err); res(batch); });
        };
        readBatch();
      });
      const allEntries = await readAll();
      for (const sub of allEntries) await traverseEntry(sub);
    }
  }

  if (items.length && items[0].webkitGetAsEntry) {
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (entry) await traverseEntry(entry);
    }
  } else {
    allFiles.push(...e.dataTransfer.files);
  }

  const audioFiles = allFiles.filter(f => _EXTS.has(f.name.split('.').pop().toLowerCase()));
  if (!audioFiles.length) { toast(i18n('t_drag_hint'), 'warning'); return; }

  showView('scan');
  const tracks    = get('tracks');
  const newTracks = [];

  for (const file of audioFiles) {
    // Dédup : comparer les basenames (file.webkitRelativePath est toujours vide en drag-drop Tauri).
    // Fonctionne pour t.path = nom seul (drag-drop) ou chemin complet (scan dossier).
    const _dnL = file.name.toLowerCase();
    if (tracks.some(t => t.path.split(/[/\\]/).pop().toLowerCase() === _dnL)) continue;

    const ext = file.name.split('.').pop().toUpperCase();
    const url = URL.createObjectURL(file);

    const dur = await new Promise(res => {
      const a = new Audio(); a.preload = 'metadata'; a.src = url;
      // BUG FIX F5 : libérer l'Audio temporaire après lecture des métadonnées
      const done = (v) => { a.src = ''; a.load(); res(v); };
      a.addEventListener('loadedmetadata', () => done(a.duration || 0), { once: true });
      a.addEventListener('error',          () => done(0),               { once: true });
      setTimeout(() => done(a.duration || 0), 3000);
    });

    const t = {
      id:         crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now(),
      name:       file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim(),
      artist:     i18n('unknown_artist'),
      artistFull: i18n('unknown_artist'),
      album:      '',
      ext,
      path:       file.webkitRelativePath || file.name,
      duration:   dur,
      dateAdded:  Date.now(),
      art:        null,
      artColor:   null,
      url,
      file,
      metaDone:   false,
    };

    newTracks.push(t);
    const snEl = document.getElementById('sn');
    if (snEl) snEl.textContent = newTracks.length;
  }

  pushTracks(newTracks); // ARCH-3 : push + rebuildTrackIdxMap + notify (rebuild avant notify ✓)
  emit(EVENTS.LIBRARY_UPDATED, { tracks: get('tracks') });
  // Équivalent de invalidateFilter() (app.js) sans dépendance circulaire
  invalidateFilterCache();
  invalidateGenreGridSig();
  emit(EVENTS.FILTER_CHANGED, {});
  updateStats();
  renderLib();
  showView('lib');
  toast(i18n('t_files_added', newTracks.length), 'success');
  newTracks.forEach(t => loadTagsBg(t));
  if (newTracks.length) logImport('drag-drop', newTracks.map(t => t.path));
}

// ── Init ─────────────────────────────────────────────────────────────────────

/**
 * Initialise le drag & drop audio sur la fenêtre principale.
 * À appeler une seule fois après DOMContentLoaded.
 */
export function initDrop() {
  _drago = document.getElementById('drago');
  document.addEventListener('dragenter', _onDragEnter);
  document.addEventListener('dragover',  _onDragOver);
  document.addEventListener('dragleave', _onDragLeave);
  document.addEventListener('drop',      _onDrop);
}
