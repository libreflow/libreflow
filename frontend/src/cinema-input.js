// LibreFlow — cinema-input.js
// Entrées utilisateur du mode Cinéma : raccourcis clavier globaux, tab-trap overlay
// (A11Y A.8), molette → volume, mousemove/focusin → contrôles auto-masquables,
// double-clic pochette → like + burst cœur.
// Extrait de cinema.js (Task 6, plan Cinema Polish Cycle 2) pour respecter la limite
// de lignes par fichier (CLAUDE.md §16).
//
// Injection de dépendances via initCinemaInput({ getCinemaOpen, closeCinema, updateCinema,
// toggleCinemaFullscreen, cycleCinemaBg, toggleCinemaRadio, toggleLike, next, prev, getAudio,
// setMasterGain, readVol, syncVol }) -- aucun import de player.js/eq.js ici ; cinema.js
// fournit les refs (CLAUDE.md §6, zéro import cross-feature — même discipline que
// cinema-seek.js, DI pure).
//
// Exports publics :
//   initCinemaInput(deps)       -- câblage unique, appelé depuis cinema.js
//   attachCinemaInput(overlay)  -- pose tous les listeners (appelé par openCinema)
//   detachCinemaInput(overlay)  -- retire tous les listeners + timers (appelé par closeCinema)
//   showCinemaControls()        -- ex-_showControls, consommé par cinema.js (et T24)

const CINEMA_CONTROLS_HIDE_MS = 3000; // délai avant masquage des contrôles
const HEART_BURST_MS          =  750; // durée de la particule cœur

let _deps           = null;
let cinemaHideTimer = null;
let _heartTimer     = null;

export function initCinemaInput(deps) { _deps = deps; }

// ── Double-clic pochette → like/unlike + particule cœur ──────
function _onArtDblClick(e) {
  e.stopPropagation();
  _deps.toggleLike();
  const wrap = document.querySelector('.cinema-art-wrap');
  const overlay = document.getElementById('cinema-overlay');
  if (!wrap || !overlay) return;
  const r = wrap.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const heart = document.createElement('div');
  heart.className = 'cin-heart-burst';
  heart.textContent = '❤';
  heart.style.left = cx + 'px';
  heart.style.top  = cy + 'px';
  overlay.appendChild(heart);
  // FIX (Task 6) : clearTimeout avant réassignation -- un double-double-clic rapide
  // laissait sinon le premier timer orphelin (heart déjà retiré par le second clic).
  if (_heartTimer) clearTimeout(_heartTimer);
  _heartTimer = setTimeout(() => { heart.remove(); _heartTimer = null; }, HEART_BURST_MS);
}

// ── Raccourcis clavier globaux du mode cinéma ─────────────────
function _onCinKey(e) {
  if (!_deps.getCinemaOpen()) return;
  // Ignorer si focus sur un input/slider
  const _ct = e.target.tagName;
  if (_ct === 'INPUT' || _ct === 'TEXTAREA' || _ct === 'SELECT' || e.target.isContentEditable) return;
  showCinemaControls(); // reset idle timer sur toute touche
  const audio = _deps.getAudio();
  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (audio) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); _deps.updateCinema(); }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      // FIX (Task 6) : garde isFinite(duration) -- pas indispensable pour le clamp à 0,
      // mais symétrique et lisible avec ArrowRight (miroir volontaire).
      if (audio && isFinite(audio.duration)) { audio.currentTime = Math.max(0, audio.currentTime - 5); }
      break;
    case 'ArrowRight':
      e.preventDefault();
      // FIX (Task 6) : sans cette garde, une durée NaN faisait `audio.duration || 0` -> 0,
      // et Math.min(0, currentTime+5) ramenait la lecture au tout début du morceau.
      if (audio && isFinite(audio.duration)) { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); }
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (audio) { const v = Math.min(1, _deps.readVol() + 0.05); _deps.setMasterGain(v); _deps.syncVol(v); _deps.updateCinema(); }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (audio) { const v = Math.max(0, _deps.readVol() - 0.05); _deps.setMasterGain(v); _deps.syncVol(v); _deps.updateCinema(); }
      break;
    case 'KeyN': case 'KeyL':
      if (e.repeat) return; // même classe de race que KeyR : next() ré-entrant avant la fin
                             // du changement de piste async désynchroniserait la file/radio.
      e.preventDefault();
      _deps.next();
      break;
    case 'KeyP':
      if (e.repeat) return;
      e.preventDefault();
      _deps.prev();
      break;
    case 'KeyF':
      if (e.repeat) return; // touche maintenue -- ignorer l'auto-répétition OS
      e.preventDefault();
      _deps.toggleCinemaFullscreen();
      break;
    case 'KeyB':
      if (e.repeat) return;
      e.preventDefault();
      _deps.cycleCinemaBg();
      break;
    case 'KeyR':
      // Bug fix : sans cette garde, une répétition avant la fin du buildRadioQueue() async
      // du premier appel pouvait ré-entrer toggleCinemaRadio() et désynchroniser
      // radioActive de l'état visible/en file (radio.js).
      if (e.repeat) return;
      e.preventDefault();
      _deps.toggleCinemaRadio().catch(err => console.warn('[cinema] radio toggle:', err));
      break;
    case 'KeyC':
      // FIX (Task 6) : la tooltip promet « Fermer [C / Échap] » (i18n t_cinema_close) mais
      // KeyC n'était pas géré -- seul Escape fermait effectivement le mode cinéma.
      e.preventDefault();
      _deps.closeCinema();
      break;
    case 'Escape':
      // Si plein écran actif → quitter le plein écran uniquement (pas fermer le cinéma)
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        _deps.closeCinema();
      }
      break;
  }
}

// ── A11Y A.8 — Tab trap ──────────────────────────────────────
// Separate from _onCinKey so it can be removed cleanly in detachCinemaInput().
// Traps Tab focus within the overlay. ESC and all other keys are handled
// exclusively by _onCinKey (which also manages fullscreen exit).
function _onCinemaTrapKey(e) {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;

  if (e.key === 'Tab') {
    showCinemaControls(); // A11Y : rendre les contrôles visibles lors de la navigation clavier
    const focusables = [...overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (!focusables.length) { e.preventDefault(); return; }
    const first  = focusables[0];
    const last   = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ── Scroll molette → volume ──────────────────────────────────
function _onCinWheel(e) {
  // FIX (Task 6) : early-return AVANT preventDefault quand la molette est utilisée
  // au-dessus du panneau file d'attente -- son scroll natif reprend ses droits au lieu
  // d'être toujours interprété comme un changement de volume global.
  if (e.target.closest('#cinema-queue-panel')) return;
  e.preventDefault();
  e.stopPropagation();
  const audio = _deps.getAudio();
  if (!audio) return;
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  const v = Math.min(1, Math.max(0, _deps.readVol() + delta));
  _deps.setMasterGain(v);
  _deps.syncVol(v);
  _deps.updateCinema();
}

// ── Contrôles — visibilité unifiée via .ctrl-on sur l'overlay ──
export function showCinemaControls() {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  overlay.classList.add('ctrl-on');
  if (cinemaHideTimer) clearTimeout(cinemaHideTimer);
  cinemaHideTimer = setTimeout(_hideControls, CINEMA_CONTROLS_HIDE_MS);
}

// A9 : vrai si le focus est CLAVIER (:focus-visible). Un clic souris sur un <button>
// le laisse activeElement indéfiniment sous Chromium/WebView2, mais :focus-visible
// reste false pour un focus souris — c'est exactement la distinction voulue :
// différer le masquage pour Tab, jamais épingler les contrôles pour la souris.
function _isKeyboardFocusInOverlay(overlay) {
  const active = document.activeElement;
  if (!active || active === overlay || !overlay.contains(active)) return false;
  try { return active.matches(':focus-visible'); } catch { return false; }
}

function _hideControls() {
  const overlay = document.getElementById('cinema-overlay');
  if (!overlay) return;
  // A11Y A9 — ne pas masquer les contrôles sous le focus clavier : si l'élément actif
  // dans l'overlay est focalisé au clavier (:focus-visible), réarmer le timer au lieu
  // de masquer — sinon un utilisateur clavier perd le contrôle qu'il vient de focaliser.
  if (_isKeyboardFocusInOverlay(overlay)) {
    cinemaHideTimer = setTimeout(_hideControls, CINEMA_CONTROLS_HIDE_MS);
    return;
  }
  overlay.classList.remove('ctrl-on');
}

function _onCinemaMouseMove() {
  showCinemaControls();
}

// A11Y A9 — focusin bubbling couvre Shift+Tab entrant depuis l'extérieur de l'overlay
// (le trap key handler ne voit que les Tab pressés pendant que l'overlay a déjà le focus).
function _onCinemaFocusIn() {
  showCinemaControls();
}

// ── Câblage / décâblage — appelés par openCinema()/closeCinema() (cinema.js) ──
export function attachCinemaInput(overlay) {
  overlay.removeEventListener('mousemove', _onCinemaMouseMove);
  overlay.addEventListener('mousemove', _onCinemaMouseMove);
  overlay.removeEventListener('click',     _onCinemaMouseMove);
  overlay.addEventListener('click',     _onCinemaMouseMove);
  overlay.removeEventListener('wheel',     _onCinWheel);
  overlay.addEventListener('wheel',     _onCinWheel, { passive: false });
  overlay.removeEventListener('focusin',   _onCinemaFocusIn);
  overlay.addEventListener('focusin',   _onCinemaFocusIn);
  document.removeEventListener('keydown',  _onCinKey);
  document.addEventListener('keydown',  _onCinKey);
  document.removeEventListener('keydown', _onCinemaTrapKey);
  document.addEventListener('keydown', _onCinemaTrapKey);
  // Double-clic pochette → like/unlike (removeEventListener d'abord : évite les listeners zombies)
  const _artWrapDb = document.querySelector('.cinema-art-wrap');
  _artWrapDb?.removeEventListener('dblclick', _onArtDblClick);
  _artWrapDb?.addEventListener('dblclick', _onArtDblClick);
}

export function detachCinemaInput(overlay) {
  overlay?.removeEventListener('mousemove', _onCinemaMouseMove);
  overlay?.removeEventListener('click',     _onCinemaMouseMove);
  overlay?.removeEventListener('wheel',     _onCinWheel);
  overlay?.removeEventListener('focusin',   _onCinemaFocusIn);
  document.removeEventListener('keydown',  _onCinKey);
  document.removeEventListener('keydown',  _onCinemaTrapKey);
  document.querySelector('.cinema-art-wrap')?.removeEventListener('dblclick', _onArtDblClick);
  if (cinemaHideTimer) { clearTimeout(cinemaHideTimer); cinemaHideTimer = null; }
  if (_heartTimer) { clearTimeout(_heartTimer); _heartTimer = null; } // pas de setTimeout orphelin
  overlay?.querySelectorAll('.cin-heart-burst').forEach(h => h.remove()); // retirer les cœurs restants
}
