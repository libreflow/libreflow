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
//   import  : animateArtChange, applyArtColor, clearArtColor,
//             _updateArtBlur                                  (settings.js)
//   import  : extEmoji                                        (utils.js)
//   import  : extractColor                                    (tags.js)
//   import  : wfLoad                                          (waveform.js)
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
import { animateArtChange, applyArtColor, clearArtColor,
         _updateArtBlur }                            from './settings.js';
import { extEmoji }                                  from './utils.js';
import { extractColor }                              from './tags.js';
import { wfLoad }                                    from './waveform.js';

// ── Volume slider ─────────────────────────────────────────────────────────────
let _volHideTimer = 0;

/**
 * Met à jour le fond dégradé du slider volume et affiche un tooltip temporaire.
 * @param {Element|null} [el] — élément #vol ; résolu via getElementById si omis.
 */
export function updateVolSlider(el) {
  const vel = (el instanceof Element) ? el : document.getElementById('vol');
  if (!vel) return;
  const pct = Math.round(+vel.value * 100);
  vel.style.background = `linear-gradient(to right, var(--g) ${pct}%, var(--bg5) ${pct}%)`;
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

// ── Now-playing bar update ────────────────────────────────────────────────────
// Tracking de la dernière notification envoyée (évite les doublons).
let _lastNotifTrackId = null;

/**
 * Met à jour le panneau inférieur "Now Playing" (titre, artiste, pochette, like,
 * icône) et déclenche en Phase 2 les mises à jour lourdes (couleur, waveform,
 * cinéma, notification OS, MediaSession).
 */
export function updateBar() {
  const curIdx = get('curIdx');
  if (curIdx < 0) return;
  const tracks = get('tracks');
  const t = tracks[curIdx];
  if (!t) return; // guard : curIdx hors bornes (ex. clearLibrary pendant un event en queue)

  // Phase 1 : feedback visuel critique — même frame que l'event (INP-1)
  document.title = `${t.name} — ${t.artistFull || t.artist || i18n('unknown_artist')} · LibreFlow`;
  // UX-5 : mettre à jour la région ARIA live pour les lecteurs d'écran
  const _npLive = document.getElementById('np-live');
  if (_npLive) _npLive.textContent = `${t.name} — ${t.artistFull || t.artist || i18n('unknown_artist')}`;
  setupMarquee(document.getElementById('pl-n'), t.name);
  setupMarquee(document.getElementById('pl-a'), t.artistFull || t.artist || i18n('unknown_artist'));

  const img = document.getElementById('pl-img'), em = document.getElementById('pl-em');
  if (t.art) { img.src = t.art; img.style.display = 'block'; em.style.display = 'none'; animateArtChange(); }
  else       { img.style.display = 'none'; em.style.display = ''; em.innerHTML = extEmoji(t.ext); }

  const liked = get('liked');
  const _isLikedNow = liked instanceof Set ? liked.has(t.id) : false;
  document.getElementById('pl-lk').classList.toggle('on', _isLikedNow);
  document.getElementById('pl-lk').setAttribute('aria-pressed', String(_isLikedNow));
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

  // Phase 2 : opérations lourdes — différées après le premier paint
  requestAnimationFrame(() => setTimeout(() => {
    if (t.artColor) applyArtColor(t.artColor);
    else if (t.art) extractColor(t.art).then(c => { if (c) { t.artColor = c; applyArtColor(c); } }).catch(() => {});
    else clearArtColor();
    _updateArtBlur(t.art || null);
    wfLoad(t.id, t.url);
    if (cinemaOpen) updateCinema();
    if (_shouldNotify) {
      // ART-IDB : base64 généré lazily depuis _artBuf (fire-and-forget, pas bloquant)
      (async () => {
        let artUrl = null;
        if (t._b64) {
          artUrl = t._b64;
        } else if (t.art && t.art.startsWith('data:')) {
          artUrl = t.art;
        } else if (t._artBuf) {
          artUrl = await new Promise(res => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(new Blob([t._artBuf], { type: t._artMime || 'image/jpeg' }));
          });
          t._b64 = artUrl; // cache pour le prochain changement de piste
        }
        invoke('notify_track', { data: { title: t.name, artist: t.artistFull || t.artist || '', art: artUrl } }).catch(() => {});
      })();
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
export function initNextPreview() {
  const btn      = document.getElementById('btn-next');
  const artEl    = document.getElementById('np-art');
  const emEl     = document.getElementById('np-em');
  const nameEl   = btn?.querySelector('.np-name');
  const artistEl = btn?.querySelector('.np-artist');
  if (!btn || !artEl || !emEl || !nameEl || !artistEl) return;

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
