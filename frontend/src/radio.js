// LibreFlow — radio.js
// Radio intelligente : scoring pondéré (genre, artiste, époque, popularité),
// file auto-alimentée, bannière UI, regénération à la volée.
// Algorithme inspiré de Spotify. Extrait de app.js.
//
// Dépendances :
//   import  : esc            (utils.js)
//   import  : CFG            (cfg.js)
//   window  : tracks, curIdx, liked, recentPlays, _trackIdxMap  (getters)
//             confirmAction, closeCtxMenu, getFiltered, playAt, setView
//             setManualQueue, toast, ctxTrackId  (callbacks / getter)
//
// Exports publics :
//   radioActive   (live binding lu par app.js / sleep.js)
//   startRadio, stopRadio, resetRadio, radioRefillQueue, toggleRadio
//   ctxStartRadio, updateRadioBanner (stub compat), showRadioBanner (stub), hideRadioBanner (stub)
//   radioRegenerateFromCurrent, renderRadioView, openRadioView

import { esc, fmt }                           from './utils.js';
import { CFG }                                from './cfg.js';
import { i18n }                               from './i18n.js';
import { get, notify }                        from './store.js';
import { getFiltered, filteredIdx, _trackIdxMap } from './search.js';
import { audio, playAt }                      from './player.js';
import { toast, toastWithAction, confirmAction }                       from './ui.js';
import { setView } from './views.js';
import { setManualQueue } from './player.js';
import { closeCtxMenu } from './ctxmenu.js';
import { cinemaOpen, toggleCinemaRadio } from './cinema.js';
import { savePlaylists, renderPlNav, setupPlNavDrop } from './playlists.js';

// ── Constantes ───────────────────────────────────────────────
const RADIO_SIZE           = CFG.RADIO_QUEUE_SIZE;
const RADIO_REFILL         = CFG.RADIO_REFILL_THRESHOLD;
const RADIO_MANUAL_PREVIEW = 8; // titres max exposés dans la file manuelle

// ── État interne ─────────────────────────────────────────────
export let radioActive    = false;
let radioSeedId           = null;

/** Retourne le seed courant — pour la persistance cfg. */
export function getRadioSeedId() { return radioSeedId; }
/** Restaure silencieusement le seedId au boot (sans démarrer la radio). */
export function initRadioSeedId(id) { if (id) radioSeedId = id; }
let radioQueue            = [];
let _radioPlayedIds       = new Set();
let _radioStopInProgress  = false; // guard anti-concurrence pour stopRadio (async)
let _radioRefillInProgress = false; // B34 : guard anti-concurrence pour le refill async de radioRefillQueue

// ── Progress bar live (rv-prog-fill) ─────────────────────────
// NOTE : la mise à jour de rv-prog-fill est gérée directement par le handler
// timeupdate de app.js (avec guard isConnected pour supporter les re-renders
// sans passer par setView). Ces helpers locaux sont supprimés pour éviter un
// double handler sur l'événement 'timeupdate'.
function _cleanRvProg()       { /* no-op — géré par app.js */ }
function _installRvProgUpdate() { /* no-op — géré par app.js */ }

// ── Scoring ──────────────────────────────────────────────────

function radioScore(seed, candidate, recentCountMap, recentSlice, recentWindow, likedSet) {
  if (candidate.id === seed.id) return -1;
  let score = 0;

  // 1. GENRE (35 pts)
  const seedGenres = (seed.genre || '').toLowerCase().split(/[\/,;|]/).map(s => s.trim()).filter(Boolean);
  const candGenres = (candidate.genre || '').toLowerCase().split(/[\/,;|]/).map(s => s.trim()).filter(Boolean);
  if (seedGenres.length && candGenres.length) {
    const shared = seedGenres.filter(g => candGenres.some(cg =>
      cg === g || cg.includes(g) || g.includes(cg)
    )).length;
    score += (shared / Math.max(seedGenres.length, candGenres.length)) * 35;
  } else if (!seedGenres.length || !candGenres.length) {
    score += 5;
  }

  // 2. ARTISTE (30 pts)
  const sArt = (seed.artist || '').toLowerCase().trim();
  const cArt = (candidate.artist || '').toLowerCase().trim();
  const _unknownArtistLC = i18n('unknown_artist').toLowerCase(); // BUG-M1 FIX : était hardcodé 'artiste inconnu' — casse en EN
  if (sArt && sArt !== _unknownArtistLC && cArt && cArt !== _unknownArtistLC) {
    if (sArt === cArt) score += 30;
    else if (sArt.split(' ')[0] === cArt.split(' ')[0]) score += 10;
  }

  // 3. ÉPOQUE (20 pts)
  const msPerYear = 365.25 * 24 * 3600 * 1000;
  const sYear = seed.year      || Math.floor((seed.dateAdded      || Date.now()) / msPerYear + 1970);
  const cYear = candidate.year || Math.floor((candidate.dateAdded || Date.now()) / msPerYear + 1970);
  const diff = Math.abs(sYear - cYear);
  if (diff === 0)       score += 20;
  else if (diff <= 2)   score += 16;
  else if (diff <= 5)   score += 10;
  else if (diff <= 10)  score += 5;

  // 4. RÉCENCE / POPULARITÉ — anti-répétition calibré par taille de bibliothèque.
  // Problème : avec une fenêtre fixe de 30, une bibliothèque de 20 titres accumulait
  // des pénalités négatives sur 100% des candidats après quelques cycles → fallback
  // permanent, classement dégradé. La fenêtre est maintenant proportionnelle :
  //   recentWindow = min(30, max(5, floor(libSize × 0.4)))
  //   → 500 titres : 30 (inchangé) | 50 titres : 20 | 15 titres : 6
  // La pénalité max reste window × 0.7 (≤ 21), cohérente avec l'ancienne valeur sur
  // grandes bibliothèques mais drastiquement réduite sur petites.
  const recentPos    = recentSlice.indexOf(candidate.id);
  if (recentPos >= 0) {
    // Pénalité décroissante proportionnelle : joué très récemment = fortement pénalisé
    score -= Math.round((recentWindow - recentPos) * 0.7);
  } else {
    // Bonus popularité uniquement si hors fenêtre récente
    const playCount = recentCountMap ? (recentCountMap.get(candidate.id) || 0) : 0;
    score += Math.min(playCount * 2, 10);
  }

  // 5. BONUS likes (+8 pts)
  if (likedSet.has(candidate?.id)) score += 8;

  // 6. Pénalité même album
  if (seed.album && candidate.album && seed.album === candidate.album) score -= 8;

  // 7. Légère randomisation
  score += Math.random() * 6;

  return score;
}

async function buildRadioQueue(seedTrack, excludeIds = new Set()) {
  const tracks = get('tracks'); // Phase 4
  if (tracks.length < 2) return [];
  // Précalculer les compteurs d'écoutes (évite O(n×m) dans radioScore)
  const recentCountMap = new Map();
  for (const id of get('recentPlays')) recentCountMap.set(id, (recentCountMap.get(id) || 0) + 1);

  // PERF2-01/02 : hisser les calculs coûteux hors de la boucle de scoring
  const _libSize     = tracks.length;
  const recentWindow = Math.min(30, Math.max(5, Math.floor(_libSize * 0.4)));
  const _rawRecent   = get('recentPlays') || [];
  const recentSlice  = _rawRecent.filter(id => _trackIdxMap.has(id)).slice(0, recentWindow);
  const likedSet     = get('liked');

  // Tous les candidats scorés (hors seed et exclus)
  const _candidates = tracks
    .filter(t => t.id !== seedTrack.id && !excludeIds.has(t.id))
    .map(t => ({ t, s: radioScore(seedTrack, t, recentCountMap, recentSlice, recentWindow, likedSet) }));
  // PERF-7 : yield avant le tri pour libérer le thread principal (~10ms sur 5000 objets)
  await new Promise(r => setTimeout(r, 0));
  const allScored = _candidates.sort((a, b) => b.s - a.s);

  // Filtre optimiste : préférer les titres à score >= 0 (pas récemment joués)
  // FALLBACK : si tous les scores sont négatifs (bibliothèque petite / tout récemment joué),
  // inclure quand même tous les candidats triés par score — la radio ne doit jamais retourner [].
  const scored = allScored.filter(x => x.s >= 0).length > 0
    ? allScored.filter(x => x.s >= 0)
    : allScored; // fallback : tous les candidats, au moins les moins mauvais en tête

  const poolSize = Math.max(RADIO_SIZE * 2, Math.ceil(scored.length * 0.6));
  const pool     = scored.slice(0, poolSize);

  // ── Diversité artiste : max 2 titres par artiste dans le résultat ──
  const artistCount = new Map();
  const selected    = [];
  for (const { t } of pool) {
    if (selected.length >= RADIO_SIZE) break;
    const a   = (t.artist || '').toLowerCase().trim() || '__unknown__';
    const cnt = artistCount.get(a) || 0;
    if (cnt < 2) { selected.push(t); artistCount.set(a, cnt + 1); }
  }
  // Fallback : bibliothèque trop petite → compléter sans contrainte d'artiste
  if (selected.length < Math.ceil(RADIO_SIZE / 2)) {
    for (const { t } of pool) {
      if (selected.length >= RADIO_SIZE) break;
      if (!selected.some(s => s.id === t.id)) selected.push(t);
    }
  }

  // ── Injection découverte : ~20% de titres peu/pas écoutés récemment ──
  // Réutiliser recentWindow et recentSlice déjà calculés ci-dessus (PERF2-02).
  const recentSet  = new Set(recentSlice);
  const DISCO_SLOTS   = Math.max(1, Math.floor(RADIO_SIZE * 0.2));
  const discoveryPool = tracks
    .filter(t =>
      !excludeIds.has(t.id) &&
      t.id !== seedTrack.id &&
      !recentSet.has(t.id) &&
      (recentCountMap.get(t.id) || 0) < 2 &&
      !selected.some(s => s.id === t.id)
    )
    .sort(() => Math.random() - 0.5)
    .slice(0, DISCO_SLOTS);
  // Insérer à des positions non-initiales (évite de démarrer la radio sur un titre inconnu)
  for (const dt of discoveryPool) {
    const pos = Math.min(
      selected.length,
      Math.floor(RADIO_SIZE * 0.35 + Math.random() * RADIO_SIZE * 0.5)
    );
    selected.splice(pos, 0, dt);
  }

  return selected.slice(0, RADIO_SIZE);
}

// ── Démarrage / arrêt ────────────────────────────────────────

export async function startRadio(trackId) {
  if (get('tracks').length < 3) {
    toast(i18n('radio_need_more'), 'warning');
    return;
  }

  if (radioActive) {
    const ok = await confirmAction(
      i18n('radio_restart_title'),
      i18n('radio_restart_body'),
      i18n('radio_restart_btn'),
      'danger'
    );
    if (!ok) return;
  }

  // Relire APRÈS l'éventuel await (rebuildTrackIdxMap crée un nouveau Map → snapshot stale)
  const tracks       = get('tracks'); // Phase 4
  const curIdx       = get('curIdx');

  const seed = trackId
    ? (_trackIdxMap.has(trackId) ? tracks[_trackIdxMap.get(trackId)] : undefined)
    : (curIdx >= 0 ? tracks[curIdx] : tracks[Math.floor(Math.random() * tracks.length)]);

  if (!seed) {
    toast(i18n('radio_no_track'), 'warning');
    return;
  }

  radioActive     = true;
  radioSeedId     = seed.id;
  try {
    radioQueue = await buildRadioQueue(seed);
  } catch(e) {
    console.error('[radio] buildRadioQueue failed in startRadio:', e);
    radioActive = false;
    radioSeedId = null;
    _syncRadioButtons(false);
    toast(i18n('radio_no_track'), 'error');
    return;
  }
  _radioPlayedIds = new Set([seed.id]);

  _syncRadioButtons(true);
  _radioSyncManualQueue();

  if (curIdx < 0 || tracks[curIdx]?.id !== seed.id) {
    const fi = filteredIdx(seed);
    if (fi >= 0) { playAt(fi); }
    else {
      // Le seed n'est pas dans la vue filtrée courante → basculer sur "Tous les titres"
      // et attendre que _withVT + la transition CSS soient terminées (≥ 250ms) avant playAt.
      setView('all', document.getElementById('ni-all'));
      setTimeout(() => {
        const fi2 = filteredIdx(seed);
        if (fi2 >= 0) playAt(fi2);
      }, 320); // 320ms > durée max de _withVT (~250ms) + marge de sécurité
    }
  }
  toast(i18n('radio_started', seed.name), 'success');
}

/** Teardown synchrone de l'état radio + UI. Partagé par stopRadio() et stopRadioSilent(). */
function _radioTeardown() {
  _cleanRvProg();
  radioActive     = false;
  radioSeedId     = null;
  radioQueue      = [];
  _radioPlayedIds = new Set();
  setManualQueue([]);
  _syncRadioButtons(false);
  // Si on est sur la vue radio, retour à Tous les titres
  if (get('view') === 'radio') {
    setView('all', document.getElementById('ni-all'));
  }
}

export async function stopRadio() {
  if (_radioStopInProgress) return; // guard : empêche deux appels concurrents pendant l'await
  _radioStopInProgress = true;
  try {
  // Confirmation si la file contient encore des titres
  if (radioActive && radioQueue.length > 0) {
    const n  = radioQueue.length;
    const ok = await confirmAction(
      i18n('radio_stop_title'),
      i18n('radio_stop_body', n),
      i18n('radio_stop_btn'),
      'danger'
    );
    if (!ok) return;
  }
  _radioTeardown();
  toast(i18n('radio_stopped'));
  } finally {
    _radioStopInProgress = false;
  }
}

/**
 * Arrêt radio synchrone sans dialog de confirmation.
 * Appelé depuis des contextes synchrones (ex: _sleepTick) où un await/confirmAction
 * serait hors-contexte. Pas de toast — l'appelant gère son propre feedback.
 */
export function stopRadioSilent() {
  if (!radioActive) return;
  _radioTeardown();
}

/** Réinitialise tout l'état radio sans side-effects UI (appelé depuis clearLibrary). */
export function resetRadio() {
  _cleanRvProg();
  radioActive     = false;
  radioSeedId     = null;
  radioQueue      = [];
  _radioPlayedIds = new Set();
  setManualQueue([]);
  _syncRadioButtons(false);
}

export function ctxStartRadio() {
  // Snapshot ctxTrackId une seule fois — évite un TypeError si la piste est
  // supprimée entre deux appels à get() (race condition lors de suppressions rapides).
  const ctxId = get('ctxTrackId');
  const tracks = get('tracks');
  const t = (_trackIdxMap.has(ctxId) ? tracks[_trackIdxMap.get(ctxId)] : undefined);
  closeCtxMenu();
  if (t) startRadio(t.id);
}

// ── Auto-alimentation de la file ─────────────────────────────

function _radioSyncManualQueue() {
  setManualQueue(
    radioQueue.slice(0, RADIO_MANUAL_PREVIEW)
      .map(t => _trackIdxMap.get(t?.id) ?? -1)
      .filter(i => i >= 0)
  );
}

export async function radioRefillQueue() {
  if (!radioActive) return;
  const tracks = get('tracks'); // Phase 4
  const curIdx = get('curIdx');
  if (tracks.length < 3) { resetRadio(); return; }
  const cur = tracks[curIdx];
  if (!cur) return;

  _radioPlayedIds.add(cur.id);

  while (radioQueue.length && _radioPlayedIds.has(radioQueue[0].id)) {
    radioQueue.shift();
  }

  // B34 FIX : guard anti-concurrence. Deux radioRefillQueue() qui se chevauchent
  // (changements de piste très rapprochés) passeraient tous deux le test, feraient
  // chacun un `await buildRadioQueue()` puis un push → file dupliquée / surremplie.
  if (radioQueue.length < RADIO_REFILL && !_radioRefillInProgress) {
    _radioRefillInProgress = true;
    try {
      // Seed glissant : à chaque recharge, le seed évolue vers le titre en cours.
      radioSeedId = cur.id;

      // Anti-overflow : si _radioPlayedIds a couvert toute la bibliothèque (ou presque),
      // on réinitialise pour éviter que buildRadioQueue retourne [] → file définitivement vide.
      const totalTracks = tracks.length; // Phase 4 — tracks déjà local get('tracks')
      if (_radioPlayedIds.size >= totalTracks - RADIO_SIZE) {
        // Conserver seulement les titres de la file courante + le seed courant
        // pour garder une diversité minimale.
        _radioPlayedIds = new Set([cur.id, ...radioQueue.map(t => t.id)]);
      }

      const exclude = new Set([..._radioPlayedIds, ...radioQueue.map(t => t.id)]);
      const extra   = (await buildRadioQueue(cur, exclude)).slice(0, RADIO_SIZE - radioQueue.length);
      radioQueue.push(...extra);
    } finally {
      _radioRefillInProgress = false;
    }
  }

  if ((get('manualQueue')?.length ?? 0) < 3) {
    _radioSyncManualQueue();
  }
  // Mettre à jour les UIs dépendantes de la queue — différé après le retour
  // synchrone de radioRefillQueue() pour éviter un reflow synchrone dans la
  // chaîne de callback player.js (BUG-D3A-5).
  requestAnimationFrame(() => {
    try {
      _syncRadioLibBar(true);
      if (get('view') === 'radio') renderRadioView();
    } catch(e) { console.warn('[radio] rAF update failed:', e); }
  });
}

// ── Sync boutons radio (cinéma + sidebar nav) ─────────────────
function _syncRadioButtons(active) {
  const cinBtn  = document.getElementById('cinema-radio');
  const navBtn  = document.getElementById('ni-radio');
  if (cinBtn) {
    cinBtn.classList.toggle('on', active);
    cinBtn.setAttribute('aria-pressed', String(active));
    const cinLbl = active
      ? (i18n('radio_stop_lbl')  || 'Arrêter la radio [R]')
      : (i18n('radio_start_lbl') || 'Activer la radio intelligente [R]');
    cinBtn.title = cinLbl;
    cinBtn.setAttribute('aria-label', cinLbl);
  }
  // Badge "live" sur le bouton Radio de la sidebar quand la radio tourne
  if (navBtn) {
    let badge = navBtn.querySelector('.ni-radio-live');
    if (active) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ni-radio-live';
        navBtn.appendChild(badge);
      }
    } else {
      badge?.remove();
    }
  }
  // Bannière dans la vue bibliothèque principale
  _syncRadioLibBar(active);
}

/** Bannière "Radio active" dans #vlib — affichée quand la radio tourne et que l'utilisateur
 *  est dans la bibliothèque (pas dans #vradio). Mise à jour légère, pas de re-render complet. */
function _syncRadioLibBar(active) {
  const bar = document.getElementById('radio-lib-bar');
  if (!bar) return;
  if (!active) {
    bar.classList.remove('on');
    bar.dataset.seedId = '';
    bar.innerHTML = '';
    return;
  }

  const seed = _trackIdxMap?.has(radioSeedId)
    ? get('tracks')[_trackIdxMap.get(radioSeedId)] // Phase 4
    : null;
  const qCount     = radioQueue.length;
  const seedName   = esc(seed?.name || '–');
  const seedArtist = esc(seed?.artistFull || seed?.artist || '');
  const seedIdStr  = String(radioSeedId ?? '');

  // Mise à jour légère si le seed n'a pas changé — évite de détruire les boutons
  if (bar.classList.contains('on') && bar.dataset.seedId === seedIdStr) {
    const ct = bar.querySelector('.rlb-ct');
    if (ct) ct.textContent = i18n('radio_queue_ct', qCount);
    return;
  }

  bar.classList.add('on');
  bar.dataset.seedId = seedIdStr;
  const t_see  = esc(i18n('radio_see_queue'));
  const t_save = esc(i18n('radio_save_lbl'));
  const t_stop = esc(i18n('radio_stop_btn'));
  bar.innerHTML = `
    <div class="rlb-left">
      <svg class="rlb-ico" viewBox="0 0 24 24" fill="none" stroke="var(--g)" stroke-width="2">
        <path d="M2.5 17a24.12 24.12 0 0 1 0-10"/><path d="M5.5 7a18.5 18.5 0 0 1 0 10"/>
        <path d="M21.5 17a24.12 24.12 0 0 0 0-10"/><path d="M18.5 7a18.5 18.5 0 0 0 0 10"/>
        <circle cx="12" cy="12" r="2"/>
      </svg>
      <div class="rlb-info">
        <span class="rlb-label">${esc(i18n('radio_active_lbl'))}</span>
        <span class="rlb-seed">${seedName}${seedArtist ? ` — <span class="rlb-artist">${seedArtist}</span>` : ''}
          <span class="rlb-ct">${esc(i18n('radio_queue_ct', qCount))}</span>
        </span>
      </div>
    </div>
    <div class="rlb-actions">
      <button class="rlb-btn" data-action="open-radio" title="${t_see}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
        ${esc(i18n('radio_see_file'))}
      </button>
      <button class="rlb-btn rlb-save" data-action="radio-save-pl" title="${t_save}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        ${esc(i18n('radio_save_lbl'))}
      </button>
      <button class="rlb-btn rlb-stop" data-action="radio-stop" title="${t_stop}">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
}

// Lock anti-double-clic : empêche deux dialogs "Arrêter ?" simultanées.
let _radioToggleLock = false;

/** Toggle radio depuis le player bar : démarre depuis le titre courant, ou arrête. */
export async function toggleRadio() {
  if (_radioToggleLock) return;
  _radioToggleLock = true;
  try {
    if (radioActive) { await stopRadio(); return; }
    const curIdx = get('curIdx');
    const tracks = get('tracks'); // Phase 4
    const seed   = (curIdx >= 0 && tracks && tracks[curIdx]) ? tracks[curIdx] : null;
    if (!seed) { toast(i18n('radio_no_seed'), 'warning'); return; }
    await startRadio(seed.id);
  } finally {
    _radioToggleLock = false;
  }
}

/** Synchronise #radio-lib-bar dans #vlib. Appelé depuis setView() à chaque
 *  entrée dans la vue bibliothèque, pour garantir l'affichage immédiat. */
export function syncRadioLibBar() { _syncRadioLibBar(radioActive); }

// ── Stubs bannière (conservé pour compat. imports) ─────────────
/** @deprecated — la bannière flottante a été supprimée. Utilisez renderRadioView(). */
export function showRadioBanner()  { /* supprimée */ }
export function hideRadioBanner()  { /* supprimée */ }
export function updateRadioBanner() {
  if (get('view') === 'radio') renderRadioView();
}

export async function radioSaveAsPlaylist() {
  if (!radioActive) return;
  const seed = _trackIdxMap.has(radioSeedId)
    ? get('tracks')[_trackIdxMap.get(radioSeedId)] // Phase 4
    : null;

  // seed + file complète (dédoublonnée via Set → O(1))
  const seen = new Set();
  const ids  = [];
  const push = id => { if (!seen.has(id)) { seen.add(id); ids.push(id); } };
  if (seed) push(seed.id);
  for (const t of radioQueue) push(t.id);
  if (!ids.length) { toast(i18n('radio_pl_empty'), 'warning'); return; }

  const name = i18n('radio_pl_name', seed ? seed.name : 'Mix');
  const pl = { id: 'pl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8), name, trackIds: ids }; // BUG-m2 FIX : suffixe aléatoire pour éviter collision si sauvegardé 2× dans la même ms
  get('playlists').push(pl);
  notify('playlists'); // CM-5 FIX: push() in-place → notify() so subscribers see the change
  try {
    await savePlaylists();
  } catch (e) {
    // Roll back : retirer la playlist ajoutée optimistiquement si la sauvegarde échoue
    const playlists = get('playlists');
    const idx = playlists.indexOf(pl);
    if (idx >= 0) playlists.splice(idx, 1);
    toast(i18n('radio_save_error') || 'Erreur lors de la sauvegarde', 'error');
    return;
  }
  renderPlNav();
  setupPlNavDrop();
  // Ne pas naviguer vers la playlist → ne polluent pas "Récentes" + l'utilisateur reste sur la radio.
  // Un toast avec bouton "Voir →" permet d'y accéder si besoin.
  toastWithAction(
    i18n('radio_pl_saved', name, ids.length),
    'success',
    i18n('radio_pl_see') || 'Voir →',
    () => setView('playlist', document.getElementById('ni-playlists'), pl.id),
    6000
  );
}

export async function radioRegenerateFromCurrent() {
  if (!radioActive) return;
  if (get('curIdx') < 0) {
    toast?.(i18n('radio_regen_need'), 'warning');
    return;
  }
  const cur = get('tracks')[get('curIdx')]; // Phase 4
  if (!cur) return;
  const _prevSeedId     = radioSeedId;
  const _prevPlayedIds  = new Set(_radioPlayedIds);
  radioSeedId     = cur.id;
  _radioPlayedIds = new Set([cur.id]);
  try {
    radioQueue = await buildRadioQueue(cur);
  } catch(e) {
    console.error('[radio] buildRadioQueue failed in radioRegenerateFromCurrent:', e);
    radioSeedId     = _prevSeedId;
    _radioPlayedIds = _prevPlayedIds;
    toast(i18n('radio_no_track'), 'error');
    return;
  }
  _radioSyncManualQueue();
  _syncRadioLibBar(true);
  if (get('view') === 'radio') renderRadioView();
  toast(i18n('radio_regen_done', cur.name), 'success');
}

export function getRadioQueue() { return radioQueue; }

// ── Vue Radio ────────────────────────────────────────────────

/** Joue un titre de la file radio par son index (depuis la vue radio). */
export function playRadioTrackAt(idx) {
  if (idx < 0 || idx >= radioQueue.length) return;
  const t = radioQueue[idx];
  // Marquer les titres sautés comme lus
  for (let i = 0; i < idx; i++) _radioPlayedIds.add(radioQueue[i].id);
  const fi = filteredIdx(t);
  if (fi >= 0) {
    playAt(fi);
    if (get('view') === 'radio') renderRadioView();
  } else {
    toast?.(i18n('radio_track_nf'), 'warning');
  }
}

/** Retire un titre de la file radio par son index. */
export function removeRadioTrack(idx) {
  if (idx < 0 || idx >= radioQueue.length) return;
  const removed = radioQueue[idx];
  radioQueue.splice(idx, 1);
  if (get('view') === 'radio') renderRadioView();
  _syncRadioLibBar(true);
  // Bug #15 fix : feedback utilisateur manquant — la suppression était silencieuse.
  toast(i18n('t_removed'), 'success');
}

/** Génère le HTML de la vue radio dans #vradio. */
export function renderRadioView() {
  const el = document.getElementById('vradio');
  if (!el) return;

  // Nettoyer l'écouteur timeupdate précédent avant tout remplacement du DOM
  _cleanRvProg();

  if (!radioActive) {
    el.innerHTML = `
      <div class="rv-empty">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".3">
          <path d="M2.5 17a24.12 24.12 0 0 1 0-10"/><path d="M5.5 7a18.5 18.5 0 0 1 0 10"/>
          <path d="M21.5 17a24.12 24.12 0 0 0 0-10"/><path d="M18.5 7a18.5 18.5 0 0 0 0 10"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
        <div class="rv-empty-title">${esc(i18n('radio_empty_title'))}</div>
        <div class="rv-empty-sub">${esc(i18n('radio_empty_sub'))}</div>
        <button class="rv-start-btn" data-action="open-radio">${esc(i18n('radio_start_current'))}</button>
      </div>`;
    return;
  }

  const seed = _trackIdxMap?.has(radioSeedId)
    ? get('tracks')[_trackIdxMap.get(radioSeedId)] // Phase 4
    : null;
  const queue = radioQueue;
  // Id du titre en cours de lecture (pour l'indicateur actif dans la file)
  const _tracks     = get('tracks'); // Phase 4 — snapshot local pour ce rendu
  const _curTrackId = (get('curIdx') >= 0 && _tracks?.[get('curIdx')])
    ? _tracks[get('curIdx')].id : null;

  // ── Seed card (bannière centrale enrichie) ───────────────────
  // audio est importé depuis player.js au niveau module — ne pas redéclarer (TDZ)
  const progPct = (audio && audio.duration > 0)
    ? ((audio.currentTime / audio.duration * 100) | 0)
    : 0;

  const seedArt = seed?.art
    ? `<img src="${esc(seed.art)}" class="rv-seed-art" alt="">`
    : `<div class="rv-seed-art rv-seed-art-em"></div>`;

  const t_regen = esc(i18n('radio_regen_btn'));
  const t_save  = esc(i18n('radio_save_btn'));
  const t_stop  = esc(i18n('radio_stop_btn'));

  const seedHtml = seed ? `
    <div class="rv-header">
      <div class="rv-header-top">
        <div class="rv-header-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--g)" stroke-width="2" width="18" height="18">
            <path d="M2.5 17a24.12 24.12 0 0 1 0-10"/>
            <path d="M5.5 7a18.5 18.5 0 0 1 0 10"/>
            <path d="M21.5 17a24.12 24.12 0 0 0 0-10"/>
            <path d="M18.5 7a18.5 18.5 0 0 0 0 10"/>
            <circle cx="12" cy="12" r="2"/>
          </svg>
          <span class="rv-header-label">${i18n('radio_header_lbl')}</span>
          <span class="rv-queue-ct">${i18n('radio_queue_ct', queue.length)}</span>
        </div>
        <div class="rv-header-actions">
          <button class="rv-action-btn" data-action="radio-regen" title="${t_regen}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.46"/></svg>
            ${t_regen}
          </button>
          <button class="rv-action-btn" data-action="radio-save-pl" title="${t_save}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            ${t_save}
          </button>
          <button class="rv-action-btn rv-action-stop" data-action="radio-stop" title="${t_stop}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            ${t_stop}
          </button>
        </div>
      </div>
      <div class="rv-seed-card">
        ${seedArt}
        <div class="rv-seed-info">
          <div class="rv-seed-label">${i18n('radio_seed_lbl')}</div>
          <div class="rv-seed-name">${esc(seed.name)}</div>
          <div class="rv-seed-artist">${esc(seed.artistFull || seed.artist || '–')}</div>
        </div>
      </div>
      <div class="rv-prog-track">
        <div class="rv-prog-fill" id="rv-prog-fill" style="width:${progPct}%"></div>
      </div>
    </div>` : '';

  // ── Queue list ───────────────────────────────────────────────
  let queueHtml = '';
  if (queue.length === 0) {
    queueHtml = `<div class="rv-queue-empty">${i18n('radio_queue_fill')}</div>`;
  } else {
    const t_play   = esc(i18n('radio_play_track'));
    const t_remove = esc(i18n('radio_remove_track'));
    const rows = queue.map((t, i) => {
      const art = t.art
        ? `<img src="${esc(t.art)}" class="rv-row-art" alt="">`
        : `<div class="rv-row-art rv-row-art-em"></div>`;
      const dur = t.duration ? fmt(t.duration) : '';
      const isActive = t.id === _curTrackId;
      const eqIcon = isActive
        ? `<div class="rv-row-eq"><span></span><span></span><span></span></div>`
        : `<span class="rv-row-num">${i + 1}</span>`;
      return `<div class="rv-row${isActive ? ' rv-row-active' : ''}" data-action="play-radio-track" data-idx="${i}" title="${t_play}">
        ${eqIcon}
        ${art}
        <div class="rv-row-info">
          <div class="rv-row-name">${esc(t.name)}</div>
          <div class="rv-row-sub">${esc(t.artistFull || t.artist || '–')}${dur ? ` · ${dur}` : ''}</div>
        </div>
        <button class="rv-row-remove" data-action="remove-radio-track" data-idx="${i}" title="${t_remove}">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
    }).join('');
    queueHtml = `
      <div class="rv-queue-header">
        <span>${i18n('radio_next_tracks')}</span>
      </div>
      <div class="rv-queue">${rows}</div>`;
  }

  el.innerHTML = seedHtml + queueHtml;

  // Installer la mise à jour live de la progress bar APRÈS le rendu du DOM
  _installRvProgUpdate();
}

/** Ouvre la vue radio (démarre si nécessaire). Appelé depuis la sidebar ou la bannière. */
export async function openRadioView(btn) {
  // Si en mode cinéma → toggle via cinema.js (met à jour updateCinema() + bouton #cinema-radio)
  if (cinemaOpen) { toggleCinemaRadio(); return; }

  // Bug #8 fix : ignorer le `btn` passé (peut être un bouton bannière ou n'importe quel élément
  // cliqué). setView() attend l'item nav #ni-radio pour activer la bonne entrée de sidebar.
  const niBtn = document.getElementById('ni-radio');

  if (!radioActive) {
    const curIdx = get('curIdx');
    const tracks = get('tracks'); // Phase 4
    const seed = (curIdx >= 0 && tracks?.[curIdx]) ? tracks[curIdx] : null;
    if (!seed) { toast?.(i18n('radio_start_need'), 'warning'); return; }
    await startRadio(seed.id);
    if (!radioActive) return; // startRadio a échoué (ex. bibliothèque trop petite)
  }

  // Déjà sur la vue radio → rien à faire (évite un flash de transition inutile)
  if (get('view') === 'radio') return;

  setView('radio', niBtn);
}

// window.* supprimé — playRadioTrackAt/removeRadioTrack sont des exports ES


