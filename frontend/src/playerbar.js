// LibreFlow — playerbar.js
// Barre "Now Playing" : mise à jour du titre, de l'artiste, de la pochette,
// de l'indicateur de like, du marquee et du slider volume.
// Extrait de app.js (CQ-2 — réduction du module god).
//
// Dépendances :
//   import  : get                                              (store.js)
//   import  : i18n                                            (i18n.js)
//   import  : invoke                                          (ipc.js)
//   import  : audio, setIcon, updateMediaSession              (player.js)
//   import  : refreshQueueBadge, queueOpen, renderQueue       (queue.js)
//   import  : cinemaOpen, updateCinema                        (cinema.js)
//   import  : applyArtColor, clearArtColor, _updateArtBlur    (settings.js)
//   import  : extEmoji                                        (utils.js)
//   import  : extractColor                                    (tags.js)
//
// Exports publics :
//   updateBar()        — met à jour toute la barre now-playing
//   updateVolSlider(el) — met à jour l'UI du slider de volume
//   setupMarquee(container, text) — texte avec défilement smooth si overflow

import { get }                                      from './store.js';
import { i18n }                                     from './i18n.js';
import { invoke }                                   from './ipc.js';
import { audio, setIcon, updateMediaSession,
         peekNext }                                 from './player.js';
import { refreshQueueBadge, queueOpen, renderQueue } from './queue.js';
import { cinemaOpen, updateCinema }                  from './cinema.js';
import { applyArtColor, clearArtColor,
         _updateArtBlur }                            from './settings.js';
import { extractDominantHsl }                        from './artcolor.js';
import { trackSwap }                                 from './motion.js';
import { extEmoji }                                  from './utils.js';
import { extractColor }                              from './tags.js';
// ── Now Playing HSL ambient tokens ───────────────────────────────────────────
// Write/clear --np-hue / --np-sat / --np-light on :root so style.css consumers
// (#pl::before hairline, rowBreath animation) breathe with the current track art.
function _applyNpHsl({ hue, sat, light }) {
  const r = document.documentElement.style;
  r.setProperty('--np-hue',   hue);
  r.setProperty('--np-sat',   sat + '%');
  r.setProperty('--np-light', light + '%');
}
function _clearNpHsl() {
  const r = document.documentElement.style;
  r.removeProperty('--np-hue');
  r.removeProperty('--np-sat');
  r.removeProperty('--np-light');
}

// ── Volume slider ─────────────────────────────────────────────────────────────
let _volHideTimer = 0;

/**
 * Met à jour le fond dégradé du slider volume et affiche un tooltip temporaire.
 * @param {Element|null} [el]        — élément #vol ; résolu via getElementById si omis.
 * @param {string|null}  [fillColor] — couleur de remplissage CSS (défaut : var(--g)).
 *                                     Cinéma passe rgb(_cinArtRGB) pour teinte pochette.
 */
export function updateVolSlider(el, fillColor) {
  const vel = (el instanceof Element) ? el : document.getElementById('vol');
  if (!vel) return;
  const pct  = Math.round(+vel.value * 100);
  const fill = fillColor ?? 'var(--g)';
  vel.style.background = `linear-gradient(to right, ${fill} ${pct}%, var(--bg5) ${pct}%)`;
  const tip = document.getElementById('vol-tip');
  if (tip) {
    tip.textContent = pct + '%';
    // UX-10 : afficher/masquer le tooltip avec classe .on
    tip.classList.add('on');
    clearTimeout(_volHideTimer);
    _volHideTimer = setTimeout(() => tip.classList.remove('on'), 1200);
  }
}

// ── Marquee ───────────────────────────────────────────────────────────────────
// Annuler les RAF orphelins si updateBar() est rappelé avant la fin du frame
// (ex. changement de piste rapide). Sans ça, le callback orphelin accède à un span
// qui n'est plus dans le DOM et tente de lui appliquer des styles inutilement.
const _mqRafMap = new Map();

/**
 * Insère `text` dans `container` avec une animation CSS de défilement si le
 * texte est plus large que son conteneur.
 * @param {Element|null} container
 * @param {string} text
 */
export function setupMarquee(container, text) {
  if (!container) return;
  const prevRaf = _mqRafMap.get(container);
  if (prevRaf !== undefined) { cancelAnimationFrame(prevRaf); _mqRafMap.delete(container); }
  container.textContent = '';
  const span = document.createElement('span');
  span.className = 'mq';
  span.textContent = text;
  container.appendChild(span);
  const rafId = requestAnimationFrame(() => {
    _mqRafMap.delete(container);
    if (!span.isConnected) return;
    const overflow = span.scrollWidth - container.offsetWidth;
    if (overflow > 4) {
      const shift = -(overflow + 24);
      const dur   = Math.max(6, Math.abs(shift) / 38);
      span.style.setProperty('--mq-shift', `${shift}px`);
      span.style.setProperty('--mq-dur',   `${dur}s`);
      span.classList.add('mq-on');
    }
  });
  _mqRafMap.set(container, rafId);
}

/**
 * R-L9 : ré-évalue le marquee titre/artiste de la barre now-playing.
 * Le débordement n'est mesuré qu'une fois dans `setupMarquee` ; élargir la
 * fenêtre laisse un titre court continuer à défiler (ou l'inverse). Appelé par
 * le listener `resize` centralisé d'app.js.
 */
export function reflowMarquee() {
  const curIdx = get('curIdx');
  if (curIdx < 0) return;
  const tracks = get('tracks');
  const t = tracks?.[curIdx];
  if (!t) return;
  setupMarquee(document.getElementById('pl-n'), t.name);
  setupMarquee(document.getElementById('pl-a'), t.artistFull || t.artist || i18n('unknown_artist'));
}

// ── Now-playing bar update ────────────────────────────────────────────────────
// Tracking de la dernière notification envoyée (évite les doublons).
let _lastNotifTrackId = null;

/**
 * Met à jour le panneau inférieur "Now Playing" (titre, artiste, pochette, like,
 * icône) et déclenche en Phase 2 les mises à jour lourdes (couleur, waveform,
 * cinéma, notification OS, MediaSession).
 */
export function updateBar() {
  const _phase1Idx = get('curIdx');
  if (_phase1Idx < 0) return;
  const tracks = get('tracks');
  const t = tracks[_phase1Idx];
  if (!t) return; // guard : curIdx hors bornes (ex. clearLibrary pendant un event en queue)

  // Phase 1 : feedback visuel critique — même frame que l'event (INP-1)
  document.title = `${t.name} — ${t.artistFull || t.artist || i18n('unknown_artist')} · LibreFlow`;
  // UX-5 : mettre à jour la région ARIA live pour les lecteurs d'écran
  const _npLive = document.getElementById('np-live');
  if (_npLive) _npLive.textContent = `${t.name} — ${t.artistFull || t.artist || i18n('unknown_artist')}`;
  setupMarquee(document.getElementById('pl-n'), t.name);
  setupMarquee(document.getElementById('pl-a'), t.artistFull || t.artist || i18n('unknown_artist'));

  const img = document.getElementById('pl-img'), em = document.getElementById('pl-em');
  if (img && em) {
    if (t.art) { img.src = t.art; img.alt = t.album || t.name || ''; img.style.display = 'block'; em.style.display = 'none'; }
    else       { img.alt = ''; img.style.display = 'none'; em.style.display = ''; em.textContent = extEmoji(t.ext); }
  }

  // GSAP track swap — animate art container + title + artist after content update
  const artEl    = document.getElementById('pl-art');
  const titleEl  = document.getElementById('pl-n');
  const artistEl = document.getElementById('pl-a');
  if (artEl && titleEl && artistEl) trackSwap(artEl, titleEl, artistEl);

  const liked = get('liked');
  const _isLikedNow = liked instanceof Set ? liked.has(t.id) : false;
  const _plLk = document.getElementById('pl-lk');
  if (_plLk) { _plLk.classList.toggle('on', _isLikedNow); _plLk.setAttribute('aria-pressed', String(_isLikedNow)); }
  document.getElementById('cinema-lk')?.classList.toggle('on', _isLikedNow);
  document.getElementById('cinema-lk')?.setAttribute('aria-pressed', String(_isLikedNow));

  // Heart-beat : piste déjà aimée qui devient active → pulse unique
  if (_isLikedNow && t.id !== _lastNotifTrackId) {
    const _hb = document.getElementById('pl-lk');
    if (_hb) {
      void _hb.offsetWidth;
      _hb.classList.remove('popping');
      requestAnimationFrame(() => {
        _hb.classList.add('popping');
        _hb.addEventListener('animationend', () => _hb.classList.remove('popping'), { once: true });
      });
    }
  }
  setIcon(!audio.paused);
  refreshQueueBadge();
  const _shouldNotify = t.id !== _lastNotifTrackId;
  if (_shouldNotify) _lastNotifTrackId = t.id;

  // Phase 2 : opérations lourdes — différées après le premier paint.
  // RACE-3 / PLAYERBAR-1 FIX : capturer _phase1Idx en Phase 1 et le comparer
  // au store en Phase 2 — si curIdx a changé, un nouveau updateBar() a pris
  // la main ; ce callback est périmé et doit s'arrêter.
  requestAnimationFrame(() => setTimeout(() => {
    if (get('curIdx') !== _phase1Idx) return; // stale — newer track took over
    const _p2Tracks = get('tracks');
    const t = _p2Tracks[_phase1Idx]; // re-read — may differ from Phase-1 t if track changed
    if (!t) return;
    if (t.artColor) applyArtColor(t.artColor);
    else if (t.art) extractColor(t.art).then(c => { if (c) { t.artColor = c; applyArtColor(c); } }).catch(e => console.warn('[playerbar:extractColor]', e));
    else clearArtColor();
    _updateArtBlur(t.art || null);
    // NP-HSL: extract dominant HSL for --np-* ambient tokens (hairline + rowBreath)
    if (t._npHsl) {
      _applyNpHsl(t._npHsl);
    } else if (t.art) {
      // V6/M6 (audit bugs visuels 2026-06-11) : repartir des tokens par défaut
      // pendant l'extraction — sinon la couleur de la piste précédente persiste
      // si l'extraction échoue (load jamais tiré, image corrompue).
      _clearNpHsl();
      const _plImg = document.getElementById('pl-img');
      const _doExtract = () => {
        // V6 : ignorer les callbacks périmés — sur skip rapide A→B→C, les
        // listeners load {once:true} s'empilent et la closure de B reçoit
        // la pochette de C (HSL caché sur la mauvaise piste).
        if (get('curIdx') !== _phase1Idx) return;
        const hsl = extractDominantHsl(_plImg);
        if (hsl) { t._npHsl = hsl; _applyNpHsl(hsl); }
      };
      // V6 : `complete` obligatoire — naturalWidth>0 seul peut refléter
      // l'ANCIENNE current request de <img> tant que la nouvelle pochette
      // n'est pas décodée (drawImage lirait le bitmap de la piste N-1).
      if (_plImg && _plImg.complete && _plImg.naturalWidth) _doExtract();
      else if (_plImg) _plImg.addEventListener('load', _doExtract, { once: true });
    } else {
      _clearNpHsl();
    }
    if (cinemaOpen) updateCinema();
    if (_shouldNotify) {
      // Notifier immédiatement (art retiré de notify_track — payloads 2-10 MB interdits §IPC).
      invoke('notify_track', { data: { title: t.name, artist: t.artistFull || t.artist || '' } }).catch(e => console.warn('[playerbar:notify_track]', e));
      // Pré-cacher t._b64 lazily pour miniplayer.js (transfer cross-window blob: → data:).
      if (!t._b64 && t._artBuf) {
        new Promise(res => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(new Blob([t._artBuf], { type: t._artMime || 'image/jpeg' }));
        }).then(b64 => { t._b64 = b64; }).catch(() => {});
      } else if (!t._b64 && t.art && t.art.startsWith('data:')) {
        t._b64 = t.art;
      }
      updateMediaSession(t);
    }
    if (queueOpen) renderQueue();
  }, 0));
}

// ── Next-preview mini-card ────────────────────────────────────────────────────

/**
 * Peuple la mini-card #next-preview au mouseenter du bouton ⏭.
 * L'affichage est géré par CSS #btn-next:hover — pas de manipulation de classe ici.
 */
let _nextPreviewInit = false;
export function initNextPreview() {
  if (_nextPreviewInit) return; // idempotent : evite duplication sur HMR/re-init
  const btn      = document.getElementById('btn-next');
  const artEl    = document.getElementById('np-art');
  const emEl     = document.getElementById('np-em');
  const nameEl   = btn?.querySelector('.np-name');
  const artistEl = btn?.querySelector('.np-artist');
  if (!btn || !artEl || !emEl || !nameEl || !artistEl) return;
  _nextPreviewInit = true;

  btn.addEventListener('mouseenter', () => {
    const t = peekNext();
    if (!t) return;
    nameEl.textContent   = t.name || '';
    artistEl.textContent = t.artistFull || t.artist || '';
    if (t.art) {
      artEl.src           = t.art;
      artEl.style.display = '';
      emEl.textContent    = '';
      emEl.style.display  = 'none';
    } else {
      artEl.src           = '';
      artEl.style.display = 'none';
      emEl.textContent    = extEmoji(t.ext);
      emEl.style.display  = '';
    }
  });
}
