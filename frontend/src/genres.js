// LibreFlow — genres.js
// Vue Genres : constantes, rendu de la grille, drill-down, rescan.
// Extrait de app.js (Jalon 5).
//
// Dépendances :
//   import  : esc                      (utils.js)
//   import  : i18n                     (i18n.js)
//   import  : get, set                 (store.js)
//   import  : emit, EVENTS             (bus.js)
//   import  : _normalizeGenre, _coll,
//             invalidateFilterCache    (search.js)
//   import  : guessGenre               (tags.js)
//   import  : saveTracks               (library.js)
//   import  : toast                    (ui.js)
//   window  : updateBreadcrumb, updateStats, saveCfg (app.js — circulaire)
//
// Exports publics :
//   renderGenresGrid, drillGenre, setContentView, rescanGenres

import { esc }                                              from './utils.js';
import { i18n }                                            from './i18n.js';
import { get, set }                                        from './store.js';
import { emit, EVENTS }                                    from './bus.js';
import { _normalizeGenre, _coll, invalidateFilterCache }   from './search.js';
import { guessGenre }                                      from './tags.js';
import { saveTracks }                                      from './library.js';
import { toast }                                           from './ui.js';
import { updateBreadcrumb, updateStats }                    from './renderer.js';

// ── Cache de signature ────────────────────────────────────────────────────────
let _genreGridSig = null;

// ── Caches emoji / couleur (évite le scan O(n) répété pour le même genre) ────
const _emojiCache = new Map();
const _colorCache = new Map();

/** Invalider le cache de la grille genres (appelé par invalidateFilter() dans app.js). */
export function invalidateGenreGridSig() { _genreGridSig = null; }

// ══ Constantes (scope module — évite la réallocation à chaque render) ══════

// ── Emojis par genre (clé = clé canonique LibreFlow) ─────────────────────────
const GENRE_EMOJIS = {
  rap:        '🎤', hip:        '🎤', trap:      '🔮',
  phonk:      '💀', drill:      '🔩', afro:      '🥁',
  electro:    '⚡', electronic: '⚡', dance:     '💃',
  pop:        '🌸', rock:       '🎸', metal:     '🤘',
  punk:       '🔥', jazz:       '🎷', blues:     '🎵',
  soul:       '🎶', funk:       '🕺', rnb:       '💜',
  classical:  '🎻', country:    '🤠', folk:      '🪕',
  reggae:     '🌿', latin:      '💃', world:     '🌍',
  indie:      '🎸', ambient:    '🌊', lofi:      '☕',
  soundtrack: '🎬', gospel:     '✨', chanson:   '🎭',
  variete:    '🎭',
};

// ── Dégradés CSS par genre ────────────────────────────────────────────────────
const GENRE_COLORS = {
  rap:        'linear-gradient(135deg, #1a0533 0%, #6b21a8 100%)',
  hip:        'linear-gradient(135deg, #0f172a 0%, #7c3aed 100%)',
  trap:       'linear-gradient(135deg, #0a000f 0%, #4a044e 100%)',
  phonk:      'linear-gradient(135deg, #0d0010 0%, #7f1d1d 100%)',
  drill:      'linear-gradient(135deg, #080808 0%, #374151 100%)',
  afro:       'linear-gradient(135deg, #1a0800 0%, #c2410c 100%)',
  electro:    'linear-gradient(135deg, #001a2c 0%, #0ea5e9 100%)',
  electronic: 'linear-gradient(135deg, #001a2c 0%, #06b6d4 100%)',
  dance:      'linear-gradient(135deg, #0d1b2a 0%, #3b82f6 100%)',
  pop:        'linear-gradient(135deg, #2d0a1f 0%, #ec4899 100%)',
  rock:       'linear-gradient(135deg, #1a0a00 0%, #f97316 100%)',
  metal:      'linear-gradient(135deg, #0a0a0a 0%, #475569 100%)',
  punk:       'linear-gradient(135deg, #1a0000 0%, #ef4444 100%)',
  jazz:       'linear-gradient(135deg, #1a1000 0%, #f59e0b 100%)',
  blues:      'linear-gradient(135deg, #000d1a 0%, #2563eb 100%)',
  soul:       'linear-gradient(135deg, #1a0500 0%, #dc2626 100%)',
  funk:       'linear-gradient(135deg, #1a0a00 0%, #d97706 100%)',
  rnb:        'linear-gradient(135deg, #1a0029 0%, #9333ea 100%)',
  classical:  'linear-gradient(135deg, #0a1a0a 0%, #16a34a 100%)',
  country:    'linear-gradient(135deg, #1a1000 0%, #ca8a04 100%)',
  folk:       'linear-gradient(135deg, #0f1a0a 0%, #65a30d 100%)',
  reggae:     'linear-gradient(135deg, #0a1a00 0%, #15803d 100%)',
  latin:      'linear-gradient(135deg, #1a0500 0%, #ea580c 100%)',
  world:      'linear-gradient(135deg, #001a1a 0%, #0d9488 100%)',
  indie:      'linear-gradient(135deg, #0a001a 0%, #7c3aed 100%)',
  ambient:    'linear-gradient(135deg, #001020 0%, #0369a1 100%)',
  lofi:       'linear-gradient(135deg, #0a0f1a 0%, #475569 100%)',
  soundtrack: 'linear-gradient(135deg, #0a0a1a 0%, #4f46e5 100%)',
  gospel:     'linear-gradient(135deg, #1a1000 0%, #b45309 100%)',
  chanson:    'linear-gradient(135deg, #0a1a10 0%, #15803d 100%)',
  variete:    'linear-gradient(135deg, #1a0020 0%, #a855f7 100%)',
};

// ── Noms d'affichage canoniques (clé → label affiché sur la card) ─────────────
const GENRE_DISPLAY_NAMES = {
  rap:        'Rap',        hip:        'Hip-Hop',    trap:      'Trap',
  phonk:      'Phonk',     drill:      'Drill',       afro:      'Afrobeats',
  electro:    'Electro',   electronic: 'Electronic',  dance:     'Dance',
  pop:        'Pop',        rock:       'Rock',        metal:     'Metal',
  punk:       'Punk',       jazz:       'Jazz',        blues:     'Blues',
  soul:       'Soul',       funk:       'Funk',        rnb:       'R&B',
  classical:  'Classical',  country:    'Country',     folk:      'Folk',
  reggae:     'Reggae',     latin:      'Latin',       world:     'World',
  indie:      'Indie',      ambient:    'Ambient',     lofi:      'Lo-Fi',
  soundtrack: 'Soundtrack', gospel:     'Gospel',      chanson:   'Chanson',
  variete:    'Variété',
};

// ── Alias de normalisation : variante brute (lowercase) → clé canonique ───────
// GENRE_ALIASES, _normalizeGenre → search.js (importés ci-dessus)

// ══ Helpers purs ══════════════════════════════════════════════════════════════

/**
 * Retourne l'emoji associé à une clé de genre canonique.
 * Utilise d'abord une correspondance exacte, puis partielle en fallback.
 * @param {string} key - Clé canonique (ex: "rap", "phonk")
 * @returns {string} Emoji
 */
export function _genreGetEmoji(key) {
  const n = key.toLowerCase();
  if (_emojiCache.has(n)) return _emojiCache.get(n);
  let result;
  if (GENRE_EMOJIS[n]) result = GENRE_EMOJIS[n];
  else {
    result = '🎵';
    for (const [k, e] of Object.entries(GENRE_EMOJIS)) { if (n.includes(k)) { result = e; break; } }
  }
  _emojiCache.set(n, result);
  return result;
}

/**
 * Retourne le dégradé CSS associé à une clé de genre canonique.
 * Utilise d'abord une correspondance exacte, puis un gradient déterministe
 * basé sur un hash du nom pour les genres inconnus.
 * @param {string} key - Clé canonique (ex: "rap", "phonk")
 * @returns {string} Valeur CSS de background (linear-gradient)
 */
export function _genreGetColor(key) {
  const n = key.toLowerCase();
  if (_colorCache.has(n)) return _colorCache.get(n);
  let result;
  if (GENRE_COLORS[n]) {
    result = GENRE_COLORS[n];
  } else {
    result = null;
    for (const [k, c] of Object.entries(GENRE_COLORS)) { if (n.includes(k)) { result = c; break; } }
    if (result === null) {
      // Gradient déterministe basé sur hash djb2 (genres hors-liste)
      let h = 0;
      for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xfffff;
      const hue = h % 360;
      result = `linear-gradient(135deg, hsl(${hue},28%,9%) 0%, hsl(${hue},60%,32%) 100%)`;
    }
  }
  _colorCache.set(n, result);
  return result;
}

function _genreFormatDur(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? String(m).padStart(2,'0') : ''}`;
  return `${m}min`;
}

// ══ Utilitaire CSS vue ════════════════════════════════════════════════════════

/** Bascule l'attribut data-view sur #content-area (le CSS gère l'affichage). */
export function setContentView(mode) {
  const area = document.getElementById('content-area');
  if (area) area.dataset.view = mode;
}

// ══ Rendu de la grille genres ═════════════════════════════════════════════════

export function renderGenresGrid() {
  const tracks    = get('tracks');
  const query     = get('query');
  const genreSort = get('genreSort');

  const _sig = `${tracks.length}|${genreSort}|${query}`;
  const _grid = document.getElementById('genre-grid');
  if (_sig === _genreGridSig && _grid && _grid.children.length > 0) {
    setContentView('genres'); updateBreadcrumb(); return;
  }
  _genreGridSig = _sig;

  setContentView('genres');

  let grid = document.getElementById('genre-grid');
  if (!grid) {
    grid = document.createElement('div');
    grid.id = 'genre-grid';
    document.getElementById('content-area').appendChild(grid);
  }

  // Construire la map des genres (enrichie : arts, durée totale, top artiste, variantes)
  // _normalizeGenre() fusionne les variantes : "Rap Français" + "Rap" → même clé "rap"
  const genreMap = new Map();
  for (const t of tracks) {
    const g = (t.genre || '').trim();
    if (!g) continue;
    const parts = g.split(/[\/,;|]/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
      const key         = _normalizeGenre(part);
      const displayName = GENRE_DISPLAY_NAMES[key]
                        || (key.charAt(0).toUpperCase() + key.slice(1));
      if (!genreMap.has(key)) {
        genreMap.set(key, {
          key,
          name:        displayName,
          count:       0,
          arts:        [],
          artsSet:     new Set(),
          totalDur:    0,
          artistCount: new Map(),
          variants:    new Set(),
        });
      }
      const ge = genreMap.get(key);
      ge.count++;
      ge.totalDur += t.duration || 0;
      if (t.artist) ge.artistCount.set(t.artist, (ge.artistCount.get(t.artist) || 0) + 1);
      if (t.art && ge.arts.length < 4 && !ge.artsSet.has(t.art)) { ge.artsSet.add(t.art); ge.arts.push(t.art); }
      const rawLc = part.toLowerCase();
      if (rawLc !== key) ge.variants.add(part);
    }
  }

  const genres = [...genreMap.values()];
  const qg = query ? query.toLowerCase() : null;
  const filteredG = qg ? genres.filter(g => g.name.toLowerCase().includes(qg)) : genres;
  if (genreSort === 'name') filteredG.sort((a, b) => _coll.compare(a.name, b.name));
  else filteredG.sort((a, b) => b.count - a.count);

  const sortBtn = document.getElementById('genre-sort-btn');
  if (sortBtn) sortBtn.textContent = genreSort === 'name' ? 'A–Z' : 'Titres';

  if (!filteredG.length) {
    grid.innerHTML = `<div class="genre-empty">
      <div style="opacity:.12;margin-bottom:12px"><svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
      <div style="font-size:15px;font-weight:700;color:var(--t2);margin-bottom:6px">Aucun genre trouvé</div>
      <div style="font-size:12px;color:var(--t3);margin-bottom:16px">Tes fichiers audio n'ont pas de tags de genre</div>
      <button class="mbtn" style="background:var(--gd);color:var(--g);border:1px solid var(--gg);font-size:12px;display:flex;align-items:center;gap:6px"
        data-action="rescan-genres"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><polyline points="12 6 12 12 16 14"/></svg> Détecter automatiquement</button>
    </div>`;
    updateBreadcrumb();
    return;
  }

  grid.innerHTML = filteredG.map((g, idx) => {
    const color   = _genreGetColor(g.key);
    const emoji   = _genreGetEmoji(g.key);
    const isTop   = genreSort !== 'name' && idx === 0;
    const badge   = isTop ? `<div class="genre-badge">⭐ Top</div>` : '';

    const mosaic  = g.arts.length > 0
      ? `<div class="genre-mosaic">${g.arts.map(a => `<img src="${esc(a)}" alt="" class="genre-mosaic-img">`).join('')}</div>`
      : '';

    const variantCount = g.variants.size;
    const variantTip   = variantCount > 0
      ? Array.from(g.variants).slice(0, 4).map(esc).join(', ')
      : '';
    const variantBadge = variantCount > 0
      ? `<div class="genre-variants-badge" title="${variantTip}">+${variantCount}</div>`
      : '';

    const durStr  = g.totalDur > 0 ? _genreFormatDur(g.totalDur) : null;
    let topArtist = null;
    if (g.artistCount.size > 0) {
      let maxC = 0;
      for (const [a, c] of g.artistCount) { if (c > maxC) { maxC = c; topArtist = a; } }
    }
    const metaParts = [durStr, topArtist ? esc(topArtist) : null].filter(Boolean);
    const meta = metaParts.length
      ? `<div class="genre-meta">${metaParts.join('<span class="genre-meta-sep"> · </span>')}</div>`
      : '';

    return `<div class="genre-card" style="--gc:${color}"
        data-action="drill-genre" data-key="${esc(g.key)}" data-name="${esc(g.name)}">
      ${badge}${variantBadge}${mosaic}
      <div class="genre-card-inner">
        <span class="genre-emoji">${emoji}</span>
        <div class="genre-info">
          <span class="genre-name">${esc(g.name)}</span>
          <span class="genre-count">${g.count} titre${g.count > 1 ? 's' : ''}</span>
          ${meta}
        </div>
      </div>
    </div>`;
  }).join('');

  updateBreadcrumb();
}

// ══ Drill-down genre → genre-detail ══════════════════════════════════════════

export function drillGenre(key, displayName) {
  set('drillKey',         key);
  set('drillDisplayName', displayName || key);
  set('drillFrom',        'genres');
  set('view',             'genre-detail');
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {});
  setContentView('list');
  const ag = document.getElementById('album-grid');
  const rg = document.getElementById('artist-grid');
  const pg = document.getElementById('playlist-grid');
  if (ag) ag.style.display = 'none';
  if (rg) rg.style.display = 'none';
  if (pg) pg.style.display = 'none';
  const vhtitle = document.getElementById('vhtitle');
  if (vhtitle) vhtitle.textContent = displayName;
  const _tl = document.getElementById('tlist');
  if (_tl) _tl.scrollTop = 0;
  emit(EVENTS.RENDER_LIB, {});
}

// ══ Rescan genres ══════════════════════════════════════════════════════════════

export async function rescanGenres(force = false) {
  const tracks = get('tracks');
  if (!tracks.length) { toast(i18n('t_genre_lib_empty'), 'warning'); return; }
  const toProcess = force ? tracks : tracks.filter(t => !t.genre);
  if (!toProcess.length) { toast(i18n('t_genre_all_done'), 'success'); return; }
  toast(i18n('t_genre_start', toProcess.length, force));

  // Passe 1 — heuristique tags (instantané, par chunks pour ne pas bloquer l'UI)
  const CHUNK = 200;
  let countHeuristic = 0;
  for (let i = 0; i < toProcess.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, toProcess.length);
    for (let j = i; j < end; j++) {
      const t = toProcess[j];
      const guessed = guessGenre(t);
      if (guessed) { t.genre = guessed; saveTracks(t); countHeuristic++; }
    }
    await new Promise(r => setTimeout(r, 0));
  }
  invalidateFilterCache(); emit(EVENTS.FILTER_CHANGED, {}); emit(EVENTS.RENDER_LIB, {}); updateStats();

  if (countHeuristic > 0) {
    toast(i18n('t_genre_done', countHeuristic), 'success');
  }
}
