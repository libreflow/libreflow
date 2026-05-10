// LibreFlow — cfgsave.js
// Sérialisation et persistance de la configuration applicative dans IndexedDB.
// Extrait de app.js (ARCH-1 — casser les dépendances circulaires).
// Utilisé par : cinema.js, ctxmenu.js, player.js, playlists.js,
//               replaygain.js, selection.js, settings.js, viz.js, views.js.
//
// Dépendances :
//   import  : get (store.js)
//   import  : CFG (cfg.js)
//   import  : DB, dput (db.js)
//   import  : audio (player.js)
//   import  : getLang (i18n.js)
//   import  : getTheme, getDynColor, getDisplayMode, getVinylSpin (settings.js)
//   import  : rgEnabled, rgTargetLUFS (replaygain.js)
//   store   : cinemaBg — synced by cinema.js via set('cinemaBg',…)
//   import  : eqEnabled, eqNodes, eqAutoMode,
//             getActiveEqPreset, getEQProfiles (eq.js)
//   import  : getVizMode, getVizEnabled (viz.js)
//   import  : getWatchPath (watchfolder.js)
//   import  : getMiniPos (miniplayer.js)
//   import  : getHeatPeriod (stats.js)
//   import  : getQueueState (queue.js)
//   import  : radioActive, getRadioSeedId (radio.js)
//
// Exports publics :
//   saveCfg()    — debounced config save (CFG.CFG_SAVE_DEBOUNCE ms)
//   saveCfgNow() — flush immédiat

import { get }                                        from './store.js';
import { CFG }                                        from './cfg.js';
import { DB, dput, isQuotaError }                     from './db.js';
import { audio }                                      from './player.js';
import { getLang }                                    from './i18n.js';
import { getTheme, getDynColor, getDisplayMode,
         getVinylSpin }                               from './settings.js';
import { rgEnabled, rgTargetLUFS }                    from './replaygain.js';
// cinemaBg is read from the store (set by cinema.js via set('cinemaBg',…))
// to avoid a cinema.js ↔ cfgsave.js circular dependency.
import { eqEnabled, eqNodes, eqAutoMode,
         getActiveEqPreset, getEQProfiles }            from './eq.js';
import { getVizMode, getVizEnabled }                  from './viz.js';
import { getWatchPath }                               from './watchfolder.js';
import { getMiniPos }                                 from './miniplayer.js';
import { getHeatPeriod }                              from './stats.js';
import { getQueueState }                              from './queue.js';
import { radioActive, getRadioSeedId }               from './radio.js';

// ── Debounce timer (module-local) ─────────────────────────────────────────────
let _saveCfgTimer = null;

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Flush immédiat de la configuration dans IndexedDB.
 * @returns {Promise<void>}
 */
export function saveCfgNow() {
  if (_saveCfgTimer) { clearTimeout(_saveCfgTimer); _saveCfgTimer = null; }
  return _doSaveCfg(); // FIX #13 — retourner la Promise
}

/**
 * Debounced config save (CFG.CFG_SAVE_DEBOUNCE ms).
 * Les appels fréquents (changement de piste, crossfade…) sont coalescés.
 */
export function saveCfg() {
  if (_saveCfgTimer) clearTimeout(_saveCfgTimer);
  _saveCfgTimer = setTimeout(_doSaveCfg, CFG.CFG_SAVE_DEBOUNCE);
}

// ── Implémentation ────────────────────────────────────────────────────────────

async function _doSaveCfg() {
  _saveCfgTimer = null;
  if (!DB) return; // DB pas encore ouverte (ex: premier démarrage avant boot())
  try {
    // ── State depuis le store ─────────────────────────────────────────────────
    const liked         = get('liked');          // Set<string>
    const curIdx        = get('curIdx');          // number
    const tracks        = get('tracks');          // Track[]
    const sort          = get('sort');
    const view          = get('view');
    const recentPlays   = get('recentPlays') ?? [];
    const crossfadeDur  = get('crossfadeDur') ?? 0;
    const playbackSpeed = get('playbackSpeed') ?? 1;
    const shuffle       = get('shuffle') ?? false;
    const repeat        = get('repeat') ?? 'none';
    const albumSort     = get('albumSort') ?? 'name';
    const artistSort    = get('artistSort') ?? 'name';
    const genreSort     = get('genreSort') ?? 'count';
    const albumDetailSort = get('albumDetailSort') ?? 'track';
    const curPlId       = get('curPlId') ?? null;
    const drillKey      = get('drillKey') ?? '';
    const drillFrom     = get('drillFrom') ?? '';
    const drillDisplayName = get('drillDisplayName') ?? '';
    const plFolders     = get('plFolders') ?? [];
    const recentPls     = get('recentPls') ?? [];
    const autoUpdate    = get('autoUpdate') !== false; // true par défaut

    const likedIds    = liked instanceof Set ? [...liked] : [];
    const curTrackId  = curIdx >= 0 && tracks[curIdx] ? tracks[curIdx].id : null;
    const curPos      = curTrackId && audio.duration > 0
      ? Math.floor(audio.currentTime)
      : 0;

    // ── État DOM supplémentaire ───────────────────────────────────────────────
    const volEl      = document.getElementById('vol');
    const volume     = volEl ? Math.round(parseFloat(volEl.value) * 100) / 100 : 1;
    const tlist      = document.getElementById('tlist');
    const scrollTop  = tlist ? Math.round(tlist.scrollTop) : 0;
    const ovEl       = document.getElementById('mp-ov');
    const miniOvOpen = ovEl ? ovEl.classList.contains('on') : false;
    const miniOvPos  = (ovEl && ovEl.style.left && ovEl.style.left !== '')
      ? { x: parseInt(ovEl.style.left) || 0, y: parseInt(ovEl.style.top) || 0 }
      : null;

    const _allViews = ['all','liked','albums','artists','genres','recent','playlist','stats','album-detail','artist-detail','genre-detail'];

    await dput('cfg', {
      likedIds, sort,
      view: (_allViews.includes(view) ? view : 'all'),
      recentPlays: recentPlays.slice(0, 50),
      lang: getLang(), theme: getTheme(), dynColor: getDynColor(),
      crossfadeDur, displayMode: getDisplayMode(), rgEnabled, rgTargetLUFS,
      playbackSpeed, cinemaBg: get('cinemaBg') ?? 'ambient',
      shuffle, repeat, albumSort, artistSort, genreSort, albumDetailSort,
      eqEnabled,
      eqGains: eqNodes.length ? eqNodes.map(n => n.gain.value) : null,
      eqPreset: getActiveEqPreset(),
      vizMode: getVizMode(), vizEnabled: getVizEnabled(), vinylSpin: getVinylSpin(),
      eqAutoMode, eqProfiles: getEQProfiles(),
      watchPath: getWatchPath(),
      curTrackId, curPos,
      miniPos: getMiniPos() ?? null,
      volume, curPlId, scrollTop,
      miniOvOpen, miniOvPos,
      drillKey, drillFrom, drillDisplayName,
      plFolders, recentPls,
      heatPeriod:  getHeatPeriod(),
      queueState:  getQueueState(),
      radioSeedId: radioActive ? getRadioSeedId() : null,
      autoUpdate,
    }, 'state');
  } catch (e) {
    if (isQuotaError(e)) {
      // ARCH-7 : quota IDB — cfg est petit, si ça échoue c'est vraiment critique
      console.error('[cfgsave] Quota IDB dépassé — configuration non persistée:', e);
    } else {
      console.warn('[cfgsave] IDB save failed — config non persistée:', e);
    }
  }
}
