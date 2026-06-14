// player-likes.js — toggleLike / likeat. Barrel re-exported from player.js.
import { get, set }              from './store.js';
import { emit, EVENTS }          from './bus.js';
import { saveCfg, saveCfgNow }   from './cfgsave.js';
import { invalidateFilterCache } from './search.js';
import { VIRT }                  from './virt.js';
import { _allPlayerUI }          from './allplayerui.js';

/** @returns {void} */
export function toggleLike() {
  if (get('curIdx') < 0) return;
  const liked  = get('liked'); // Phase 4
  const tracks = get('tracks'); // Phase 4
  const trackId = tracks[get('curIdx')]?.id;
  if (!trackId) return;
  liked.has(trackId) ? liked.delete(trackId) : liked.add(trackId);
  set('liked', liked); // notifier les subscribers (mutation in-place sinon invisible)
  const isLiked = liked.has(trackId);
  const btns = [
    document.getElementById('pl-lk'),
    document.getElementById('cinema-lk'),
  ].filter(Boolean);
  btns.forEach(btn => {
    if (!btn) return; // filter(Boolean) guarantees non-null at runtime; guard for TS
    btn.classList.toggle('on', isLiked);
    btn.setAttribute('aria-pressed', String(isLiked));
    btn.classList.remove('popping');
    // @ts-ignore — btn is HTMLElement at runtime, Element type lacks offsetWidth
    void btn.offsetWidth;
    btn.classList.add('popping');
    btn.addEventListener('animationend', () => btn.classList.remove('popping'), { once: true });
  });
  // NowPlaying panel like button — classe 'active' (pas 'on'), SVG fill aussi
  const npBtn = document.querySelector('.np-lk');
  if (npBtn) {
    npBtn.classList.toggle('active', isLiked);
    npBtn.setAttribute('aria-pressed', String(isLiked));
    const svg = npBtn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isLiked ? 'currentColor' : 'none');
    npBtn.classList.remove('popping');
    // @ts-ignore — npBtn is HTMLElement at runtime, Element type lacks offsetWidth
    void npBtn.offsetWidth;
    npBtn.classList.add('popping');
    npBtn.addEventListener('animationend', () => npBtn.classList.remove('popping'), { once: true });
  }
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); // Jalon 4
  if (get('view') === 'liked') emit(EVENTS.RENDER_LIB, {}); // Jalon 4
  saveCfgNow();
  _allPlayerUI();
}

/**
 * @param {Event} e
 * @param {string} trackId
 * @param {Element | null} [el]
 * @returns {void}
 */
export function likeat(e, trackId, el) {
  e.stopPropagation();
  if (!trackId) return;
  const liked = get('liked'); // Phase 4
  liked.has(trackId) ? liked.delete(trackId) : liked.add(trackId);
  set('liked', liked); // notifier les subscribers (mutation in-place sinon invisible)
  // MEM-4 FIX: e.currentTarget est `document` dans un listener délégué → utiliser el si fourni
  // @ts-ignore — Element vs Document comparison intentional (delegated listener guard)
  const btn = el instanceof Element ? el : (e.currentTarget instanceof Element && e.currentTarget !== document ? e.currentTarget : null);
  if (btn) {
    btn.classList.remove('popping');
    // @ts-ignore — btn is HTMLElement at runtime, Element type lacks offsetWidth
    void btn.offsetWidth;
    btn.classList.add('popping');
    btn.addEventListener('animationend', () => btn.classList.remove('popping'), { once: true });
    btn.setAttribute('aria-pressed', String(liked.has(trackId))); // A11Y: aria-pressed reflect
  }
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); // Jalon 4
  if (VIRT) VIRT._lastListSig = '';
  const tlist = document.getElementById('tlist');
  const savedScroll = tlist ? tlist.scrollTop : 0;
  emit(EVENTS.RENDER_LIB, {}); // Jalon 4
  if (tlist && get('view') === 'liked') requestAnimationFrame(() => { tlist.scrollTop = savedScroll; });
  saveCfg();
}
