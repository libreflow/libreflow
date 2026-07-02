// LibreFlow — cinema-seek.js
// Scrubbing complet de la barre de progression du mode Cinéma (Task 5).
//
// Toute la logique de scrub vit ici (cinema.js ne fait que câbler) :
//   - pointerdown/move/up/cancel + setPointerCapture -> drag au pointeur
//   - hover -> tooltip flottante affichant le temps sous le curseur
//   - clavier (pbar focalisée) -> Home/End/PageUp/PageDown (les ←/→ ±5s globaux
//     restent gérés par _onCinKey dans cinema.js -- non dupliqués ici)
//
// Injection de dépendances via initCinemaSeek({ audio, pbar, fill, thumb, timeEl, tooltip })
// -- aucun import de player.js/eq.js ici ; cinema.js fournit les refs (CLAUDE.md §6, zéro
// import cross-feature). `audio` reste la seule ref lue/écrite (currentTime -- pas un
// AudioParam, l'assignation directe est autorisée, CLAUDE.md §9).
//
// Exports publics :
//   seekPosFromPointer(clientX, rectLeft, rectWidth, duration) -- logique pure (core.test.cjs)
//   formatSeekTime(s)                                          -- logique pure (core.test.cjs)
//   isSeekDragging()      -- consommé par updateCinemaProgress()/syncCinProgress() pour ne
//                            pas écraser le fill pendant un drag manuel
//   initCinemaSeek(deps)  -- câblage des listeners, appelé une fois depuis cinema.js
//   resetCinemaSeek()     -- appelé par closeCinema() : coupe un drag en cours + masque
//                            la tooltip (évite un fantôme si le mode cinéma se ferme
//                            pendant un scrub)

const PAGE_STEP_S = 30; // PageUp/PageDown -- ±30s (Home/End -> 0/durée)

let _deps      = null; // { audio, pbar, fill, thumb, timeEl, tooltip }
let _dragging  = false;
let _pointerId = null;

/**
 * Position de seek (secondes), clampée [0, duration], à partir d'un clientX de pointeur.
 * Retourne null si la durée est invalide (0, NaN, undefined, <=0) ou si rectWidth <= 0
 * (pbar non rendue / piste sans métadonnées chargées -- pas de seek possible).
 */
export function seekPosFromPointer(clientX, rectLeft, rectWidth, duration) {
  if (!duration || !isFinite(duration) || duration <= 0) return null;
  if (!rectWidth || rectWidth <= 0) return null;
  const ratio = Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth));
  return ratio * duration;
}

/** Formatte des secondes en M:SS (identique à fmt() de utils.js -- "–:––" si invalide). */
export function formatSeekTime(s) {
  if (s == null || !isFinite(s) || s < 0) return '–:––';
  const total = Math.floor(s);
  const m  = Math.floor(total / 60);
  const ss = total % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/** Vrai pendant un drag actif -- geler updateCinemaProgress()/syncCinProgress() côté cinema.js. */
export function isSeekDragging() { return _dragging; }

function _applyLive(sec, duration) {
  const { fill, thumb, timeEl, pbar } = _deps;
  const ratio = duration > 0 ? sec / duration : 0;
  if (fill)   fill.style.transform = 'scaleX(' + ratio + ')';
  if (thumb)  thumb.style.left     = (ratio * 100) + '%';
  if (timeEl) timeEl.textContent   = formatSeekTime(sec);
  if (pbar) {
    pbar.setAttribute('aria-valuenow', Math.round(ratio * 100));
    pbar.setAttribute('aria-valuetext', formatSeekTime(sec) + ' / ' + formatSeekTime(duration));
  }
}

function _commit(sec) {
  const { audio } = _deps;
  if (audio) audio.currentTime = sec;
}

function _hideTooltip() {
  const tooltip = _deps?.tooltip;
  if (!tooltip) return;
  tooltip.classList.remove('show');
  tooltip.setAttribute('aria-hidden', 'true');
}

/** Positionne + affiche la tooltip au-dessus du curseur -- clampée aux bords du viewport. */
function _showTooltipAt(clientX, sec) {
  const { tooltip, pbar } = _deps;
  if (!tooltip || !pbar) return;
  tooltip.textContent = formatSeekTime(sec);
  tooltip.classList.add('show');
  tooltip.removeAttribute('aria-hidden');
  const r      = pbar.getBoundingClientRect();
  const ttW    = tooltip.offsetWidth || 40;
  const halfW  = ttW / 2;
  const margin = 4;
  const clampedClientX = Math.min(
    Math.max(clientX, halfW + margin),
    window.innerWidth - halfW - margin
  );
  tooltip.style.left = (clampedClientX - r.left) + 'px';
}

function _seekFromEvent(e) {
  const { pbar, audio } = _deps;
  const r = pbar.getBoundingClientRect();
  return seekPosFromPointer(e.clientX, r.left, r.width, audio?.duration);
}

function _onPointerDown(e) {
  const { pbar, audio } = _deps;
  const sec = _seekFromEvent(e);
  if (sec == null) return; // pas de durée valide -- rien à scrubber
  e.preventDefault();
  _dragging  = true;
  _pointerId = e.pointerId;
  try { pbar.setPointerCapture(e.pointerId); } catch { /* capture indisponible -- drag reste fonctionnel */ }
  _applyLive(sec, audio.duration);
  _showTooltipAt(e.clientX, sec);
}

function _onPointerMove(e) {
  const { audio } = _deps;
  const sec = _seekFromEvent(e);
  if (_dragging) {
    if (sec == null) return;
    _applyLive(sec, audio.duration);
    _showTooltipAt(e.clientX, sec);
    return;
  }
  // Survol sans drag -- tooltip seule, pas de mise à jour du fill/temps/aria.
  if (sec == null) { _hideTooltip(); return; }
  _showTooltipAt(e.clientX, sec);
}

function _stopDragging() {
  const pbar = _deps?.pbar;
  if (pbar && _pointerId != null) {
    try { pbar.releasePointerCapture(_pointerId); } catch { /* déjà relâchée */ }
  }
  _dragging  = false;
  _pointerId = null;
  _hideTooltip();
}

function _onPointerUp(e) {
  if (!_dragging) return;
  const sec = _seekFromEvent(e);
  if (sec != null) _commit(sec); // commit au relâchement ET au clic simple (pointerdown+up sans move)
  _stopDragging();
}

/** pointercancel (geste OS interrompu) -- pas de commit, juste sortir du drag proprement.
 *  Le prochain tick timeupdate (isSeekDragging() redevenu false) resynchronise le fill. */
function _onPointerCancel() { _stopDragging(); }

function _onPointerLeave() { if (!_dragging) _hideTooltip(); }

/** Fenêtre perd le focus pendant un drag (glisser hors WebView) -- même traitement que cancel. */
function _onWindowBlur() { if (_dragging) _stopDragging(); }

function _onKeyDown(e) {
  const { audio } = _deps;
  const duration = audio?.duration;
  if (!duration || !isFinite(duration)) return;
  let sec;
  if      (e.key === 'Home')     sec = 0;
  else if (e.key === 'End')      sec = duration;
  else if (e.key === 'PageUp')   sec = Math.min(duration, audio.currentTime + PAGE_STEP_S);
  else if (e.key === 'PageDown') sec = Math.max(0, audio.currentTime - PAGE_STEP_S);
  else return;
  e.preventDefault(); // pas de stopPropagation : _onCinKey (cinema.js) doit voir l'évènement
                       // bulle pour réarmer _showControls() (idle timer contrôles)
  _applyLive(sec, duration);
  _commit(sec);
}

/** Câblage des listeners -- appelé une fois au chargement (remplace l'ancien handler
 *  DOMContentLoaded basique). Idempotent : removeEventListener avant chaque add. */
export function initCinemaSeek(deps) {
  _deps = deps;
  const { pbar } = deps;
  if (!pbar) return;
  pbar.removeEventListener('pointerdown',   _onPointerDown);
  pbar.addEventListener('pointerdown',      _onPointerDown);
  pbar.removeEventListener('pointermove',   _onPointerMove);
  pbar.addEventListener('pointermove',      _onPointerMove);
  pbar.removeEventListener('pointerup',     _onPointerUp);
  pbar.addEventListener('pointerup',        _onPointerUp);
  pbar.removeEventListener('pointercancel', _onPointerCancel);
  pbar.addEventListener('pointercancel',    _onPointerCancel);
  pbar.removeEventListener('pointerleave',  _onPointerLeave);
  pbar.addEventListener('pointerleave',     _onPointerLeave);
  pbar.removeEventListener('keydown',       _onKeyDown);
  pbar.addEventListener('keydown',          _onKeyDown);
  window.removeEventListener('blur',        _onWindowBlur);
  window.addEventListener('blur',           _onWindowBlur);
}

/** closeCinema() -- coupe un drag en cours + masque la tooltip (évite un fantôme si le
 *  mode cinéma se ferme pendant un scrub). */
export function resetCinemaSeek() {
  _dragging  = false;
  _pointerId = null;
  _hideTooltip();
}
