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
import { on, EVENTS }                               from './bus.js';
// UX FIX (2026-09-01) : drillDown pour ctxGoToArtist — même hub central que
// ctxmenu.js/dropin.js/genres.js/handlers.js/library.js/player.js/queue.js/
// playlists.js/shortcuts.js/views.js, qui importent déjà tous depuis renderer.js.
import { drillDown }                                from './renderer.js';
// UX FIX (2026-09-01) : getMiniOpen pour éviter la double notification OS
// (voir Phase 2 de updateBar() plus bas) — déjà exporté publiquement et
// consommé par settings.js, pas de cycle (miniplayer.js n'importe pas playerbar.js).
import { getMiniOpen }                              from './miniplayer.js';
// Cinéma demande la mise à jour du slider volume — évite le cycle cinema.js ↔ playerbar.js.
on(EVENTS.VOL_SLIDER_UPDATE, ({ elId }) => updateVolSlider(document.getElementById(elId)));
on(EVENTS.PLAYERBAR_UPDATE, () => updateBar());
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
  // UX FIX (2026-09-01) : remplacer l'assignation `.style.background =` (shorthand)
  // par une custom property consommée en CSS. Le shorthand `background` réinitialise
  // TOUJOURS `background-clip` à sa valeur par défaut (`border-box`) même si le CSS
  // externe déclare `background-clip: content-box` — donc le gradient peignait toute
  // la hauteur de l'élément (padding vertical inclus, ~29px) au lieu d'être clippé aux
  // 3px centraux de la piste, comme prévu par le padding-block de .vslider. C'était la
  // cause racine de la capsule pleine et épaisse (incohérente avec la seek bar fine
  // .pbar) — pas un choix de design, un bug de spécificité CSS shorthand vs propriété.
  vel.style.setProperty('--vol-pct', pct + '%');
  const tip = document.getElementById('vol-tip');
  if (tip) {
    tip.textContent = pct + '%';
    // UX-10 : afficher/masquer le tooltip avec classe .on
    tip.classList.add('on');
    clearTimeout(_volHideTimer);
    _volHideTimer = setTimeout(() => tip.classList.remove('on'), 1200);
  }
  _syncVolIcon(+vel.value);
}

function _syncVolIcon(vol) {
  const muted = vol <= 0;
  const low   = vol > 0 && vol < 0.5;
  const w1 = document.getElementById('vol-wave1');
  const w2 = document.getElementById('vol-wave2');
  const x1 = document.getElementById('vol-x1');
  const x2 = document.getElementById('vol-x2');
  const btn = document.getElementById('btn-vol-mute');
  if (w1) w1.style.display = muted ? 'none' : '';
  if (w2) w2.style.display = (muted || low) ? 'none' : '';
  if (x1) x1.style.display = muted ? '' : 'none';
  if (x2) x2.style.display = muted ? '' : 'none';
  if (btn) {
    btn.setAttribute('aria-pressed', String(muted));
    btn.setAttribute('aria-label', muted ? i18n('vol_unmute') : i18n('vol_mute'));
    btn.title = muted ? i18n('vol_unmute') : i18n('vol_mute');
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

// UX FIX (2026-09-01) : .pl-a (nom d'artiste) affichait déjà cursor:pointer +
// hover souligné + :focus-visible en CSS (style.css) — une affordance de lien
// jamais câblée. Pire : imbriqué dans .pl-info (role=button, toggle-now-playing),
// un clic dessus ouvrait la vue plein écran au lieu d'aller à l'artiste. Même
// pattern que ctxGoToArtist() (ctxmenu.js) : drillDown vers la vue Artistes,
// avec la même garde "artiste inconnu" pour ne pas driller sur un placeholder.
/** @param {MouseEvent} e */
export function goToArtistFromBar(e) {
  e.stopPropagation(); // ne pas laisser .pl-info parent ouvrir Now Playing
  const curIdx = get('curIdx');
  if (curIdx < 0) return;
  const t = get('tracks')?.[curIdx];
  if (!t) return;
  const unknownArtist = i18n('unknown_artist') || 'Artiste inconnu';
  if (!t.artist || t.artist === unknownArtist || t.artist === 'Unknown Artist') return;
  const rawKey      = t.artist.toLowerCase(); // cohérent avec ctxGoToArtist() — search.js fait un match exact
  const displayName = t.artistFull || t.artist;
  drillDown('artists', rawKey, displayName);
}

// ── Now-playing bar update ────────────────────────────────────────────────────
// Tracking de la dernière notification envoyée (évite les doublons).
let _lastNotifTrackId = null;
// BUG-FBA-3 FIX : piste ENTRANTE affichée pendant un crossfade, avant que curIdx
// ne bascule (cf. EVENTS.TRACK_PREVIEW, player.js). null = afficher tracks[curIdx]
// normalement. N'affecte QUE l'affichage (titre/artiste/pochette/like/OS media
// session) — curIdx reste la source de vérité pour la navigation (skip, surlignage
// de la ligne active dans la liste, historique).
let _previewTrack = null;
on(EVENTS.TRACK_PREVIEW, ({ track }) => { _previewTrack = track; updateBar(); });

/** Piste actuellement affichée dans la barre — preview crossfade en priorité sur curIdx. */
function _displayTrack() {
  if (_previewTrack) return _previewTrack;
  const curIdx = get('curIdx');
  if (curIdx < 0) return null;
  return get('tracks')[curIdx] || null;
}

/**
 * Met à jour le panneau inférieur "Now Playing" (titre, artiste, pochette, like,
 * icône) et déclenche en Phase 2 les mises à jour lourdes (couleur, waveform,
 * cinéma, notification OS, MediaSession).
 */
export function updateBar() {
  const t = _displayTrack();
  if (!t) return; // guard : curIdx hors bornes (ex. clearLibrary pendant un event en queue)

  // Phase 1 : feedback visuel critique — même frame que l'event (INP-1)
  document.title = `${t.name} — ${t.artistFull || t.artist || i18n('unknown_artist')} · LibreFlow`;
  // UX-5 : mettre à jour la région ARIA live pour les lecteurs d'écran
  const _npLive = document.getElementById('np-live');
  if (_npLive) _npLive.textContent = `${t.name} — ${t.artistFull || t.artist || i18n('unknown_artist')}`;
  setupMarquee(document.getElementById('pl-n'), t.name);
  setupMarquee(document.getElementById('pl-a'), t.artistFull || t.artist || i18n('unknown_artist'));

  const img = document.getElementById('pl-img'), em = document.getElementById('pl-em');
  // UX FIX (2026-09-01) : fallback si l'image échoue à charger (blob révoqué
  // prématurément, buffer corrompu, fichier déplacé) — sans onerror, l'utilisateur
  // voyait l'icône "image cassée" native du navigateur au lieu du fallback emoji
  // déjà utilisé pour "pas de pochette". onerror réassigné à chaque updateBar()
  // (pas d'accumulation de listeners : la même réassignation écrase la précédente).
  img.onerror = () => { img.style.display = 'none'; em.style.display = ''; em.innerHTML = extEmoji(t.ext); };
  // UX FIX (2026-09-01, réadapté depuis worktree-flagship-polish-pass b45c876) :
  // shimmer .pl-art.loading pendant que les tags/pochette de la piste hydratent
  // (!t.metaDone) — sans ça la pochette sautait directement du vide à l'image
  // finale, contrairement aux grilles albums/artistes et à la liste de pistes
  // qui ont déjà ce même pattern .loading (voir renderer-grids.js/renderer.js).
  const plArt = document.getElementById('pl-art');
  plArt?.classList.toggle('loading', !t.metaDone);
  if (!t.metaDone) {
    img.style.display = 'none'; em.style.display = 'none';
  } else if (t.art) {
    img.src = t.art; img.alt = t.album || t.name || ''; img.style.display = 'block'; em.style.display = 'none'; animateArtChange();
  } else {
    img.alt = ''; img.style.display = 'none'; em.style.display = ''; em.innerHTML = extEmoji(t.ext);
  }

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

  // Phase 2 : opérations lourdes — différées après le premier paint.
  // RACE-3 FIX : re-lire depuis le store/preview — la closure `t` peut être périmée
  // si un changement de piste rapide (ou un preview crossfade) survient entre Phase 1 et Phase 2.
  requestAnimationFrame(() => setTimeout(() => {
    const t = _displayTrack();
    if (!t) return;
    if (t.artColor) applyArtColor(t.artColor);
    else if (t.art) extractColor(t.art).then(c => { if (c) { t.artColor = c; applyArtColor(c); } }).catch(e => console.warn('[playerbar:extractColor]', e));
    else clearArtColor();
    _updateArtBlur(t.art || null);
    if (cinemaOpen) updateCinema();
    if (_shouldNotify) {
      // ART-IDB : base64 généré lazily depuis _artBuf (fire-and-forget, pas bloquant)
      // UX FIX (2026-09-01) : notify_track (notification OS native Tauri) sautée si le
      // mini-player est ouvert — miniplayer.js déclenche déjà sa propre notification
      // (Web Notification API, _notifyTrack) sur le même changement de piste. Sans cette
      // garde, l'utilisateur voyait 2 notifications OS empilées pour un seul changement.
      // Le calcul d'artUrl/t._b64 reste inconditionnel : le cache sert aussi à
      // miniplayer.js et à d'autres relectures futures de la même piste.
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
        if (getMiniOpen()) return; // miniplayer.js notifie déjà — éviter le doublon
        invoke('notify_track', { data: { title: t.name, artist: t.artistFull || t.artist || '', art: artUrl } }).catch(e => console.warn('[playerbar:notify_track]', e));
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
