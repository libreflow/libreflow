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
};

function virtBuildRows(fl, { sort = 'az', query = '', view = 'all' } = {}) {
  const rows = [];
  const grouped = ['az','za','artist','album'].includes(sort) && !query && view === 'all';
  if (grouped) {
    const keyFn = sort==='artist' ? t=>t.artist||'?' : sort==='album' ? t=>t.album||'?' : t=>t.name[0]?.toUpperCase().replace(/[^A-Z]/,'#')||'#';
    const grps = {};
    fl.forEach(t => { const k = keyFn(t); (grps[k]=grps[k]||[]).push(t); });
    const keys = Object.keys(grps).sort((a,b) => sort==='za' ? _cmp(b, a) : _cmp(a, b));
    let fi = 0;
    keys.forEach(k => {
      // Pour le tri album : inclure l'artiste majoritaire du groupe comme indice visuel
      let artistHint = '';
      if (sort === 'album' && grps[k].length) {
        const artistCounts = {};
        grps[k].forEach(t => { const a = t.artist||''; artistCounts[a] = (artistCounts[a]||0) + 1; });
        artistHint = Object.entries(artistCounts).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
      }
      rows.push({ type:'grp', key: k, artistHint });
      grps[k].forEach(t => { rows.push({ type:'tr', track: t, fi: fi++ }); });
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
