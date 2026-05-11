// P3 FIX : Intl.Collator caché pour les tris de groupes
const _cmp = new Intl.Collator('fr', { sensitivity: 'base', ignorePunctuation: true }).compare;
// LibreFlow — Virtual scroll engine
//
// Renders only the rows visible in the viewport + VIRT_BUFFER rows on each side.
// Uses a prefix-sum (Int32Array) for O(1) offset lookups and O(log n) binary-search
// to find the first visible row.
//
// virtRenderWindow() and virtAttachScroll() are intentionally kept in app.js:
// virtRenderWindow calls thtml() (app-specific row renderer) and esc() (app utility);
// virtAttachScroll calls virtRenderWindow, so it must also live in app.js.
//
// Exports:
//   VIRT                             Mutable engine state object
//   virtBuildRows(fl, opts)          Build row descriptors + prefix-sum
//   virtIdxAtScroll(rows, scrollTop) Binary-search first visible row index
//   virtTotalH()                     Total scrollable height in px
//   virtOffsetOf(rows, idx)          Pixel offset of row at index (O(1) via prefix-sum)

import { CFG } from './cfg.js';

const VIRT = {
  ROW_H:      CFG.VIRT_ROW_H,
  GRP_H:      CFG.VIRT_GRP_H,
  BUFFER:     CFG.VIRT_BUFFER,
  _fl:        [],
  _rows:      [],
  _offsets:   [],   // prefix-sum des hauteurs — recalculé dans virtBuildRows
  _totalH:    0,
  _startIdx:  0,
  _endIdx:    0,
  _raf:       null,
  _lastSig:   '',
  _lastListSig: '',
  _lastScrollTop: null, // suivi de direction pour les animations d'entrée

  /**
   * Scroll #tlist so that the row at filtered-index `fi` is visible.
   * Uses _fiToRowIdx (O(1)) → virtOffsetOf (O(1)) to compute the pixel target.
   * Safe to call before rows are built (no-op in that case).
   * @param {number} fi - Index in the filtered track list (data-fi attribute)
   */
  scrollToIdx(fi) {
    const listEl = document.getElementById('tlist');
    if (!listEl) return;
    const rows = this._rows;
    if (!rows || !rows.length) return;

    // Resolve fi → rowIdx via the pre-built Map (O(1)); fall back to linear scan
    let rowIdx = this._fiToRowIdx?.get(fi);
    if (rowIdx == null) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].type === 'tr' && rows[i].fi === fi) { rowIdx = i; break; }
      }
    }
    if (rowIdx == null) return;

    const offset  = (this._offsets && this._offsets[rowIdx]) ? this._offsets[rowIdx] : rowIdx * this.ROW_H;
    const rowH    = this.ROW_H;
    const viewH   = listEl.clientHeight;
    const scrollT = listEl.scrollTop;

    // Already fully visible — no scroll needed
    if (offset >= scrollT && offset + rowH <= scrollT + viewH) return;

    const targetTop = Math.max(0, offset - (viewH / 2) + (rowH / 2));
    listEl.scrollTo({
      top:      targetTop,
      behavior: Math.abs(scrollT - targetTop) < window.innerHeight * 3 ? 'smooth' : 'instant',
    });
  },
};

function virtBuildRows(fl, { sort = 'az', query = '', view = 'all' } = {}) {
  if (!fl || !fl.length) return [];
  const rows = [];
  const grouped = ['az','za','artist','album'].includes(sort) && !query && view === 'all';
  if (grouped) {
    // BUG-i1 FIX : normalize() + decompose supprime les diacritiques → É/È/Ê → E (même groupe que les titres en E)
    const _normFirst = c => c ? (c.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/,'#') || '#') : '#';
    const keyFn = sort==='artist' ? t=>(t.artist||'').trim()||'?' : sort==='album' ? t=>(t.album||'').trim()||'?' : t=>_normFirst(t.name?.[0]);
    const grps = new Map();
    fl.forEach(t => { const k = keyFn(t); const g = grps.get(k); if (g) g.push(t); else grps.set(k, [t]); });
    const keys = [...grps.keys()].sort((a,b) => sort==='za' ? _cmp(b, a) : _cmp(a, b));
    let fi = 0;
    keys.forEach(k => {
      // Pour le tri album : inclure l'artiste majoritaire du groupe comme indice visuel
      let artistHint = '';
      if (sort === 'album' && grps.get(k).length) {
        const artistCounts = {};
        grps.get(k).forEach(t => { const a = t.artist||''; artistCounts[a] = (artistCounts[a]||0) + 1; });
        artistHint = Object.entries(artistCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
      }
      rows.push({ type:'grp', key: k, artistHint });
      grps.get(k).forEach(t => { rows.push({ type:'tr', track: t, fi: fi++ }); });
    });
  } else {
    fl.forEach((t, i) => rows.push({ type:'tr', track: t, fi: i }));
  }
  // Construire le prefix-sum des hauteurs (O(n) une fois → O(1) ensuite)
  const offsets = new Int32Array(rows.length + 1);
  for (let i = 0; i < rows.length; i++) {
    offsets[i + 1] = offsets[i] + (rows[i].type === 'grp' ? VIRT.GRP_H : VIRT.ROW_H);
  }
  VIRT._offsets = offsets;
  VIRT._totalH  = offsets[rows.length];
  return rows;
}

// O(1) grâce au prefix-sum
function virtTotalH(rows)         { return VIRT._totalH; }
function virtOffsetOf(rows, idx)  { return VIRT._offsets[idx] || 0; }

function virtIdxAtScroll(rows, scrollTop) {
  if (!rows || !rows.length) return 0;
  scrollTop = Math.min(scrollTop, VIRT._totalH);
  if (scrollTop <= 0) return 0;
  // Recherche binaire sur le prefix-sum VIRT._offsets — O(log n) au lieu de O(n)
  const offsets = VIRT._offsets;
  if (!offsets || offsets.length === 0) return 0;
  let lo = 0, hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}


export { VIRT, virtBuildRows, virtIdxAtScroll, virtTotalH, virtOffsetOf };
