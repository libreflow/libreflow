// LibreFlow — cinema-queue.js
// Panneau file d'attente dépliable du mode Cinéma (Task 9).
//
// AUCUN import cross-feature ici (CLAUDE.md §6) — dependency injection uniquement,
// même discipline que cinema-seek.js (Task 5) : cinema.js/cinema-render.js fournissent
// getUpcoming()/onPlayTrack(t) déjà câblés sur LEURS propres imports (search.js/queue.js/
// radio.js/player.js). Ce module ne connaît que le DOM (panel, trigger) + ces 2 callbacks.
//
// Exports publics :
//   buildUpcoming(opts)          — logique pure (priorité IDENTIQUE à cinema.js/
//                                   _updateNextTrack : explicite > radio > shuffle-hint
//                                   (vide) > séquentiel). Testée exhaustivement en copie
//                                   inline dans core.test.cjs (house style, cf. cinema-seek.js).
//   initCinemaQueue(deps)         — câblage unique : { getUpcoming, onPlayTrack, panel, trigger }
//   refreshCinemaQueuePanel()     — re-rend si le panneau est ouvert (appelé par updateCinema())
//   closeCinemaQueuePanel()       — ferme sans état orphelin (appelé par closeCinema())
//
// Clavier — garde Échap/flèches (décision documentée, cf. task-9-report.md) :
// le listener keydown est posé DIRECTEMENT sur #cinema-queue-panel (phase bulle, pas de
// capture). Comme le panneau est un ANCÊTRE des rangées focalisées, il reçoit l'évènement
// AVANT que la bulle n'atteigne document (où vivent _onCinKey/_onCinemaTrapKey, cinema.js).
// stopPropagation() sur Échap/↑/↓/Tab empêche donc cinema.js de réinterpréter ces touches
// (Échap → fermerait tout le cinéma ; ↑/↓ → changeraient le volume ; Tab → piège overlay
// entier au lieu du panneau seul).

let _deps  = null; // { getUpcoming, onPlayTrack, panel, trigger }
let _open  = false;
let _rows  = [];    // boutons de rangée actuellement rendus (navigation flèches/Tab)

/**
 * Construit la liste des ≤ limit prochaines pistes. Même priorité que
 * cinema.js/_updateNextTrack() (source de vérité, Task 6) :
 *   1. File explicite (entrées valides — présentes dans `filtered`) : priorité absolue,
 *      complétée par la suite séquentielle de `filtered` si elle ne remplit pas `limit`.
 *   2. Radio active (sans file explicite) : tête de la file radio SEULE — pas de
 *      complément séquentiel (radioRefillQueue() génère la suite dynamiquement, imprévisible).
 *   3. Shuffle actif (sans file explicite ni radio) : imprévisible → [] (le panneau
 *      affiche le hint shuffle existant, Task 6).
 *   4. Séquentiel standard : suite de `filtered` depuis curFilteredIdx+1 ; si
 *      `repeatAll` (repeat==='all' — même source de vérité que getNextIdx()/player.js,
 *      qui boucle sur filtered[0]) le remplissage wrappe vers le début — piste
 *      courante exclue, un seul cycle complet maximum (fix post-review Task 9).
 * Fonction PURE — aucun accès DOM/store, testable en isolation (core.test.cjs).
 * @param {{
 *   explicitQueue?: object[], filtered?: object[], curFilteredIdx?: number,
 *   shuffle?: boolean, radioActive?: boolean, radioQueue?: object[],
 *   repeatAll?: boolean, limit?: number
 * }} [opts]
 * @returns {object[]}
 */
export function buildUpcoming({
  explicitQueue  = [],
  filtered       = [],
  curFilteredIdx = -1,
  shuffle        = false,
  radioActive    = false,
  radioQueue     = [],
  repeatAll      = false,
  limit          = 8,
} = {}) {
  if (limit <= 0) return [];

  const filteredIds   = new Set(filtered.map(t => t.id));
  // "Stale" : entrée absente/nulle ou dont l'id n'est plus dans `filtered` (piste
  // supprimée de la bibliothèque, ou hors de la vue filtrée courante) — ignorée.
  const validExplicit = explicitQueue.filter(t => t && filteredIds.has(t.id));

  if (validExplicit.length) {
    const out = validExplicit.slice(0, limit);
    _fillSequential(out, filtered, curFilteredIdx, repeatAll, limit);
    return out;
  }

  if (radioActive) return radioQueue.slice(0, limit);
  if (shuffle) return [];

  const out = [];
  _fillSequential(out, filtered, curFilteredIdx, repeatAll, limit);
  return out;
}

/** Remplissage séquentiel partagé (branche explicite + branche séquentielle pure) :
 *  suite de `filtered` depuis curFilteredIdx+1, dédupliquée contre `out`, puis wrap
 *  vers le début si `repeatAll` — piste courante (curFilteredIdx) exclue, un cycle max. */
function _fillSequential(out, filtered, curFilteredIdx, repeatAll, limit) {
  const seen = new Set(out.map(t => t.id));
  for (let i = curFilteredIdx + 1; i < filtered.length && out.length < limit; i++) {
    if (!seen.has(filtered[i].id)) { out.push(filtered[i]); seen.add(filtered[i].id); }
  }
  if (!repeatAll) return;
  for (let i = 0; i < curFilteredIdx && out.length < limit; i++) {
    if (!seen.has(filtered[i].id)) { out.push(filtered[i]); seen.add(filtered[i].id); }
  }
}

// ── Rendu (textContent uniquement — jamais innerHTML avec des tags, §13) ─────

function _clearList(list) {
  while (list.firstChild) list.removeChild(list.firstChild);
}

/** Une rangée = un vrai <button> ; nom accessible = titre + artiste (brief Step 2/5). */
function _buildRow(t) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'cqp-row';
  const artist = t.artistFull || t.artist || '';
  row.setAttribute('aria-label', artist ? `${t.name || '–'} — ${artist}` : (t.name || '–'));

  const body = document.createElement('div');
  body.className = 'cn-body';

  if (t.art) {
    const img = document.createElement('img');
    img.className = 'cn-img';
    img.src = t.art;
    img.alt = '';
    body.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'cn-img cqp-img--empty';
    ph.setAttribute('aria-hidden', 'true');
    body.appendChild(ph);
  }

  const info  = document.createElement('div');
  info.className = 'cn-info';
  const title = document.createElement('div');
  title.className = 'cn-title';
  title.textContent = t.name || '–';
  const artEl = document.createElement('div');
  artEl.className = 'cn-artist';
  artEl.textContent = artist || '–';
  info.append(title, artEl);
  body.appendChild(info);
  row.appendChild(body);

  row.addEventListener('click', () => {
    _deps.onPlayTrack(t);
    _closePanel();
  });
  return row;
}

/** Reconstruit la liste ; préserve la position focalisée (clampée) si le panneau est ouvert. */
function _render() {
  const { panel, getUpcoming } = _deps;
  const list  = panel.querySelector('.cqp-list');
  const empty = panel.querySelector('.cqp-empty');
  if (!list) return;
  const prevFocusedIdx = _open ? _rows.indexOf(document.activeElement) : -1;

  _clearList(list);
  const upcoming = getUpcoming() || [];
  _rows = upcoming.map(t => _buildRow(t));
  _rows.forEach(r => list.appendChild(r));

  if (empty) empty.hidden = _rows.length > 0;
  list.hidden = _rows.length === 0;

  if (_open && prevFocusedIdx >= 0 && _rows.length) {
    _rows[Math.min(prevFocusedIdx, _rows.length - 1)].focus();
  }
}

/** Re-rend le panneau s'il est ouvert — appelé par cinema.js/updateCinema() à chaque tick. */
export function refreshCinemaQueuePanel() {
  if (_open) _render();
}

// ── Navigation clavier au sein du panneau ────────────────────

function _moveFocus(dir) {
  if (!_rows.length) return;
  const idx  = _rows.indexOf(document.activeElement);
  const next = idx < 0 ? 0 : Math.max(0, Math.min(_rows.length - 1, idx + dir));
  _rows[next].focus();
}

function _onPanelKey(e) {
  if (!_open) return;
  if (e.key === 'Escape') {
    // Ferme UNIQUEMENT le panneau — stopPropagation empêche _onCinKey (cinema.js) de
    // voir cet Échap et de quitter le plein écran / fermer tout le mode cinéma.
    e.stopPropagation();
    e.preventDefault();
    _closePanel();
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    // stopPropagation : _onCinKey interprète sinon ↑/↓ comme un changement de volume.
    e.stopPropagation();
    e.preventDefault();
    _moveFocus(e.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (e.key === 'Tab') {
    // Piège Tab DANS le panneau — stopPropagation évite que le trap overlay-entier
    // (_onCinemaTrapKey) cycle aussi sur les autres contrôles du cinéma.
    e.stopPropagation();
    if (!_rows.length) { e.preventDefault(); return; }
    const first = _rows[0], last = _rows[_rows.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  }
}

function _onOutsidePointer(e) {
  if (!_open) return;
  const { panel, trigger } = _deps;
  if (panel.contains(e.target) || trigger.contains(e.target)) return;
  _closePanel({ restoreFocus: false });
}

// ── Ouverture / fermeture ─────────────────────────────────────

function _openPanel() {
  if (_open || !_deps) return;
  _open = true;
  const { panel, trigger } = _deps;
  panel.hidden = false;
  _render();
  requestAnimationFrame(() => panel.classList.add('cqp-open'));
  trigger.setAttribute('aria-expanded', 'true');
  // L'auto-hide (Task 2, cinema.js) masque #cinema-next via .ctrl-on après 3s d'inactivité
  // souris — mais un panneau OUVERT ne doit jamais disparaître avec son déclencheur (brief
  // Task 9). .cqp-trigger-pinned court-circuite la garde .ctrl-on (règle CSS dédiée) tant
  // que le panneau reste ouvert, indépendamment du timer d'auto-hide des autres contrôles.
  trigger.classList.add('cqp-trigger-pinned');
  if (_rows.length) requestAnimationFrame(() => _rows[0].focus());
}

function _closePanel({ restoreFocus = true } = {}) {
  if (!_open) return;
  _open = false;
  const { panel, trigger } = _deps;
  panel.classList.remove('cqp-open');
  panel.hidden = true;
  // Fix post-review (CRITIQUE) : purger les rangées à la fermeture. Des .cqp-row
  // fantômes (display:none via [hidden] ancêtre) resteraient sinon dans le DOM et
  // fausseraient le calcul first/last du Tab-trap overlay (_onCinemaTrapKey,
  // cinema.js) — la boucle de focus ne wrappe plus et le focus S'ÉCHAPPE du modal
  // (invariant WCAG focus-trap, CLAUDE.md §2). Verrouillé par un scan a11y.test.cjs.
  const list = panel.querySelector('.cqp-list');
  if (list) _clearList(list);
  _rows = [];
  trigger.setAttribute('aria-expanded', 'false');
  trigger.classList.remove('cqp-trigger-pinned');
  if (restoreFocus && typeof trigger.focus === 'function') trigger.focus();
}

function _onTriggerClick(e) {
  e.stopPropagation(); // n'affecte pas _onCinemaMouseMove (mousemove, pas click)
  if (_open) _closePanel(); else _openPanel();
}

/**
 * Câblage unique — appelé une fois depuis cinema.js (DOMContentLoaded, même pattern
 * qu'initCinemaSeek). Idempotent : removeEventListener avant chaque add.
 * @param {{ getUpcoming: () => object[], onPlayTrack: (t: object) => void,
 *           panel: HTMLElement, trigger: HTMLElement }} deps
 */
export function initCinemaQueue(deps) {
  _deps = deps;
  const { panel, trigger } = deps;
  if (!panel || !trigger) return;
  trigger.removeEventListener('click', _onTriggerClick);
  trigger.addEventListener('click', _onTriggerClick);
  panel.removeEventListener('keydown', _onPanelKey);
  panel.addEventListener('keydown', _onPanelKey);
  document.removeEventListener('pointerdown', _onOutsidePointer);
  document.addEventListener('pointerdown', _onOutsidePointer);
}

/** closeCinema() — ferme sans état orphelin (pas de aria-expanded="true" résiduel,
 *  pas de listener outside-click qui survivrait à la fermeture du cinéma). */
export function closeCinemaQueuePanel() {
  _closePanel({ restoreFocus: false });
}
