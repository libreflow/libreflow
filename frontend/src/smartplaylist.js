// LibreFlow — smartplaylist.js
// Smart Playlist : construction de playlists intelligentes basées sur un titre seed.
// Extrait de app.js.
//
// Dépendances :
//   import  : esc          (utils.js)
//   window  : curIdx, tracks, _trackIdxMap, playlists, view, curPlId, liked  (getters)
//             toast, savePlaylists, renderPlNav, setupPlNavDrop, closePlModal,
//             setView, openNewPlaylistModal, trackIdx                          (callbacks)
//             setPlModalMode                                                    (setter)
//
// Exports publics :
//   switchPlTab, openSmartPlaylistModal, _setSmartSeed, smartSeedSearch
//   smartPreview, confirmSmartPlaylist, regenerateSmartPlaylist

import { esc } from './utils.js';
import { i18n } from './i18n.js';
import { get, notify }  from './store.js'; // Phase 4
import { playLog } from './playlog.js'; // Bug #1 fix : accès direct, window.__playLogRef__ n'existe pas
import { emit, EVENTS } from './bus.js';
import { _trackIdxMap, trackIdx } from './search.js';
import { toast }                                        from './ui.js';
import { setView } from './views.js';
import { setPlModalMode, savePlaylists, renderPlNav, setupPlNavDrop, closePlModal } from './playlists.js';

// ── État interne ──────────────────────────────────────────────
let _smartSeedId  = null;
let _smartMode    = 'seed'; // 'seed' | 'rules'
let _smartRules   = [];     // [{ field, op, value }]

// ── Définitions des champs de règles ─────────────────────────

const RULE_FIELDS = [
  { id: 'artist',     label: 'Artiste',          type: 'text'   },
  { id: 'genre',      label: 'Genre',             type: 'text'   },
  { id: 'album',      label: 'Album',             type: 'text'   },
  { id: 'format',     label: 'Format',            type: 'format' },
  { id: 'liked',      label: 'Favoris',           type: 'bool'   },
  { id: 'duration',   label: 'Durée (min)',        type: 'number' },
  { id: 'addedSince', label: 'Ajouté depuis (j)', type: 'number' },
  { id: 'playCount',  label: 'Écoutes',           type: 'number' },
];

const RULE_OPS = {
  text:   [{ id:'contains',    label:'contient'     },
           { id:'not_contains',label:'ne contient pas'},
           { id:'is',          label:'est'          },
           { id:'is_not',      label:'n\'est pas'   }],
  format: [{ id:'is',    label:'est'      },
           { id:'is_not',label:'n\'est pas'}],
  bool:   [{ id:'is',   label:'est'  }],
  number: [{ id:'gt',   label:'supérieur à' },
           { id:'lt',   label:'inférieur à' },
           { id:'eq',   label:'égal à'      }],
};

const FORMAT_OPTIONS = ['FLAC','MP3','OGG','OPUS','WAV','AIFF','AAC','M4A','WMA','APE'];

// ── Mode switcher ─────────────────────────────────────────────

export function switchSmartMode(mode) {
  _smartMode = mode;
  const seedPanel  = document.getElementById('smart-seed-panel');
  const rulesPanel = document.getElementById('smart-rules-panel');
  const btnSeed    = document.getElementById('spl-mode-seed');
  const btnRules   = document.getElementById('spl-mode-rules');
  if (!seedPanel || !rulesPanel) return;
  seedPanel.style.display  = mode === 'seed'  ? '' : 'none';
  rulesPanel.style.display = mode === 'rules' ? '' : 'none';
  btnSeed?.classList.toggle('active',  mode === 'seed');
  btnRules?.classList.toggle('active', mode === 'rules');
  // Masquer le preview quand on change de mode
  const prev = document.getElementById('smart-preview');
  if (prev) prev.style.display = 'none';
  // Initialiser avec une règle vide si aucune règle présente
  if (mode === 'rules' && _smartRules.length === 0) {
    _smartRules = [{ field: 'genre', op: 'contains', value: '' }];
    _renderRules();
  }
}

// ── Rendu des lignes de règles ────────────────────────────────

function _renderRules() {
  const list = document.getElementById('spl-rules-list');
  if (!list) return;
  list.innerHTML = '';
  _smartRules.forEach((rule, idx) => {
    const field = RULE_FIELDS.find(f => f.id === rule.field) || RULE_FIELDS[0];
    const ops   = RULE_OPS[field.type] || RULE_OPS.text;
    const row   = document.createElement('div');
    row.className = 'spl-rule-row';

    // Field selector
    const fieldSel = document.createElement('select');
    fieldSel.className = 'spl-rule-field pl-modal-inp';
    RULE_FIELDS.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.label;
      opt.selected = f.id === rule.field;
      fieldSel.appendChild(opt);
    });
    fieldSel.addEventListener('change', () => {
      _smartRules[idx].field = fieldSel.value;
      const ft = RULE_FIELDS.find(f => f.id === fieldSel.value)?.type || 'text';
      _smartRules[idx].op = RULE_OPS[ft][0].id;
      _smartRules[idx].value = '';
      _renderRules();
    });

    // Operator selector
    const opSel = document.createElement('select');
    opSel.className = 'spl-rule-op pl-modal-inp';
    ops.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.label;
      opt.selected = o.id === rule.op;
      opSel.appendChild(opt);
    });
    opSel.addEventListener('change', () => {
      _smartRules[idx].op = opSel.value;
      _triggerRulesPreview();
    });

    // Value input (depends on field type)
    let valEl;
    if (field.type === 'format') {
      valEl = document.createElement('select');
      valEl.className = 'spl-rule-val pl-modal-inp';
      FORMAT_OPTIONS.forEach(fmt => {
        const opt = document.createElement('option');
        opt.value = fmt.toLowerCase();
        opt.textContent = fmt;
        opt.selected = fmt.toLowerCase() === (rule.value || '').toLowerCase();
        valEl.appendChild(opt);
      });
      if (!rule.value) _smartRules[idx].value = FORMAT_OPTIONS[0].toLowerCase();
      valEl.addEventListener('change', () => { _smartRules[idx].value = valEl.value; _triggerRulesPreview(); });
    } else if (field.type === 'bool') {
      valEl = document.createElement('select');
      valEl.className = 'spl-rule-val pl-modal-inp';
      [{ v:'true', l:'Oui ♥' }, { v:'false', l:'Non' }].forEach(({ v, l }) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = l;
        opt.selected = v === (rule.value || 'true');
        valEl.appendChild(opt);
      });
      if (!rule.value) _smartRules[idx].value = 'true';
      valEl.addEventListener('change', () => { _smartRules[idx].value = valEl.value; _triggerRulesPreview(); });
    } else if (field.type === 'number') {
      valEl = document.createElement('input');
      valEl.type = 'number';
      valEl.className = 'spl-rule-val pl-modal-inp';
      valEl.min = '0';
      valEl.placeholder = '0';
      valEl.value = rule.value || '';
      valEl.addEventListener('input', () => { _smartRules[idx].value = valEl.value; _triggerRulesPreview(); });
    } else {
      valEl = document.createElement('input');
      valEl.type = 'text';
      valEl.className = 'spl-rule-val pl-modal-inp';
      valEl.placeholder = '…';
      valEl.value = rule.value || '';
      valEl.addEventListener('input', () => { _smartRules[idx].value = valEl.value; _triggerRulesPreview(); });
    }

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'spl-rule-del';
    delBtn.title = 'Supprimer';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      _smartRules.splice(idx, 1);
      _renderRules();
      _triggerRulesPreview();
    });

    row.appendChild(fieldSel);
    row.appendChild(opSel);
    row.appendChild(valEl);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

export function addSmartRule() {
  _smartRules.push({ field: 'genre', op: 'contains', value: '' });
  _renderRules();
}

let _rulesPreviewTimer = null;
function _triggerRulesPreview() {
  clearTimeout(_rulesPreviewTimer);
  _rulesPreviewTimer = setTimeout(() => {
    if (_smartMode === 'rules') _doPreviewRules();
  }, 300);
}

// ── Évaluation des règles ─────────────────────────────────────

function _evalRule(t, rule, playCountMap, likedSet) {
  const { field, op, value } = rule;
  const val = (value ?? '').toString().toLowerCase().trim();

  switch (field) {
    case 'artist': {
      const ta = ((t.artistFull || t.artist || '')).toLowerCase();
      if (op === 'contains')     return ta.includes(val);
      if (op === 'not_contains') return !ta.includes(val);
      if (op === 'is')           return ta === val;
      if (op === 'is_not')       return ta !== val;
      break;
    }
    case 'genre': {
      const tg = (t.genre || '').toLowerCase();
      if (op === 'contains')     return tg.includes(val);
      if (op === 'not_contains') return !tg.includes(val);
      if (op === 'is')           return tg === val;
      if (op === 'is_not')       return tg !== val;
      break;
    }
    case 'album': {
      const tb = (t.album || '').toLowerCase();
      if (op === 'contains')     return tb.includes(val);
      if (op === 'not_contains') return !tb.includes(val);
      if (op === 'is')           return tb === val;
      if (op === 'is_not')       return tb !== val;
      break;
    }
    case 'format': {
      const ext = (t.ext || '').toLowerCase().replace(/^\./, '');
      if (op === 'is')     return ext === val;
      if (op === 'is_not') return ext !== val;
      break;
    }
    case 'liked': {
      const isLiked = (likedSet ?? get('liked')).has(t.id);
      if (op === 'is') return value === 'true' ? isLiked : !isLiked;
      break;
    }
    case 'duration': {
      const durMin = (t.duration || 0) / 60;
      const n = parseFloat(val) || 0;
      if (op === 'gt') return durMin > n;
      if (op === 'lt') return durMin < n;
      if (op === 'eq') return Math.round(durMin) === n;
      break;
    }
    case 'addedSince': {
      const days = parseInt(val) || 0;
      const cutoff = Date.now() - days * 86400000;
      if (op === 'gt') return (t.dateAdded || 0) < cutoff;       // older than N days
      if (op === 'lt') return (t.dateAdded || 0) > cutoff;       // added within N days
      if (op === 'eq') {
        const d = Math.round((Date.now() - (t.dateAdded || 0)) / 86400000);
        return d === (parseInt(val) || 0);
      }
      break;
    }
    case 'playCount': {
      const count = playCountMap.get(t.id) || 0;
      const n = parseInt(val) || 0;
      if (op === 'gt') return count > n;
      if (op === 'lt') return count < n;
      if (op === 'eq') return count === n;
      break;
    }
  }
  return false;
}

function _buildPlayCountMap() {
  // Bug #1 fix : playLog importé directement depuis playlog.js
  // window.__playLogRef__ n'est jamais défini → retournait toujours une Map vide.
  const map = new Map();
  for (const entry of playLog) {
    map.set(entry.id, (map.get(entry.id) || 0) + 1);
  }
  return map;
}

function _buildRulesTracks() {
  const tracks  = get('tracks');
  const combinator = document.getElementById('spl-combinator')?.value || 'all';
  const maxSize = Math.min(parseInt(document.getElementById('spl-rules-size')?.value || '20') || 20, tracks.length);
  const rules   = _smartRules.filter(r => r.value !== '' || r.field === 'liked' || r.field === 'format');
  if (!rules.length) return [];

  const pcMap = _buildPlayCountMap();
  const likedSet = get('liked');

  const matchAll = combinator === 'all';
  const matched = tracks.filter(t => {
    if (matchAll) {
      for (const r of rules) { if (!_evalRule(t, r, pcMap, likedSet)) return false; }
      return true;
    } else {
      for (const r of rules) { if (_evalRule(t, r, pcMap, likedSet)) return true; }
      return false;
    }
  });

  return matched.slice(0, maxSize);
}


function _doPreviewRules() {
  const result = _buildRulesTracks();
  const countEl = document.getElementById('smart-preview-count');
  const listEl  = document.getElementById('smart-preview-list');
  const prev    = document.getElementById('smart-preview');
  if (!prev) return;
  if (!result.length) {
    if (countEl) countEl.textContent = '0 titre';
    if (listEl)  listEl.innerHTML = `<div style="padding:10px;font-size:12px;color:var(--t3);text-align:center">Aucun titre ne correspond aux règles.</div>`;
    prev.style.display = 'block';
    return;
  }
  if (countEl) countEl.textContent = result.length + ' titre' + (result.length !== 1 ? 's' : '');
  if (listEl) {
    listEl.innerHTML = result.slice(0, 8).map((t, i) => `
      <div class="smart-prev-item">
        <span style="font-size:10px;color:var(--t3);min-width:16px;text-align:right">${i + 1}</span>
        <span class="spn">${esc(t.name)}</span>
        <span class="spa">${esc(t.artist || '')}</span>
      </div>`).join('') +
      (result.length > 8 ? `<div style="padding:5px 10px;font-size:11px;color:var(--t3);text-align:center">+ ${result.length - 8} autre${result.length - 8 > 1 ? 's' : ''}…</div>` : '');
  }
  prev.style.display = 'block';
}

// ── Onglets du modal playlist ─────────────────────────────────

export function switchPlTab(tab) {
  const panelManual = document.getElementById('pl-panel-manual');
  const panelSmart  = document.getElementById('pl-panel-smart');
  const tabManual   = document.getElementById('pl-tab-manual');
  const tabSmart    = document.getElementById('pl-tab-smart');
  if (panelManual) panelManual.style.display = tab==='manual' ? '' : 'none';
  if (panelSmart)  panelSmart.style.display  = tab==='smart'  ? '' : 'none';
  if (tabManual) {
    tabManual.classList.toggle('active', tab==='manual');
    tabManual.setAttribute('aria-selected', String(tab==='manual'));
  }
  if (tabSmart) {
    tabSmart.classList.toggle('active',  tab==='smart');
    tabSmart.setAttribute('aria-selected', String(tab==='smart'));
  }
}

export function openSmartPlaylistModal(seedTrackId) {
  setPlModalMode('new');
  const tabs = document.querySelector('.pl-modal-tabs');
  if (tabs) tabs.style.display = '';
  switchPlTab('smart');
  document.getElementById('pl-modal-bg').classList.add('on');
  document.getElementById('pl-modal-bg').dataset.pendingTrack = '';
  document.getElementById('pl-modal-bg').dataset.renamePlId   = '';
  document.getElementById('smart-seed-search').value = '';
  document.getElementById('smart-seed-results').style.display = 'none';
  document.getElementById('smart-preview').style.display = 'none';
  document.getElementById('smart-pl-name').value = '';
  _smartSeedId = null;
  _smartRules  = [];
  switchSmartMode('seed');
  const tracks = get('tracks');
  const curIdx = get('curIdx');
  const tid = seedTrackId || (curIdx >= 0 && tracks[curIdx] ? tracks[curIdx].id : null);
  if (tid) _setSmartSeed(tid);
  else {
    document.getElementById('smart-seed-name').textContent = i18n('t_smart_no_seed');
    document.getElementById('smart-seed-display').classList.remove('has-track');
  }
}

export function _setSmartSeed(trackId) {
  const tracks = get('tracks');
  _smartSeedId = trackId;
  const t = (_trackIdxMap.has(trackId) ? tracks[_trackIdxMap.get(trackId)] : undefined);
  const box  = document.getElementById('smart-seed-display');
  const name = document.getElementById('smart-seed-name');
  if (t) {
    name.textContent = t.name + (t.artist && t.artist !== i18n('unknown_artist') ? ' — ' + t.artist : '');
    box.classList.add('has-track');
    const inp = document.getElementById('smart-pl-name');
    if (!inp.value) inp.value = _autoSmartName(t);
  }
  document.getElementById('smart-seed-results').style.display = 'none';
  document.getElementById('smart-seed-search').value = '';
  smartPreview();
}

function _autoSmartName(t) {
  if (t.artist && t.artist !== i18n('unknown_artist')) {
    return t.genre ? t.artist + ' · ' + t.genre : t.artist;
  }
  return t.name;
}

export function smartSeedSearch(q) {
  const tracks = get('tracks');
  const res = document.getElementById('smart-seed-results');
  if (!q.trim()) { res.style.display = 'none'; return; }
  const hits = tracks.filter(t =>
    (t.name || '').toLowerCase().includes(q.toLowerCase()) ||
    (t.artist||'').toLowerCase().includes(q.toLowerCase())
  ).slice(0, 8);
  if (!hits.length) { res.style.display = 'none'; return; }
  res.style.display = 'block';
  res.innerHTML = hits.map(t => `
    <div data-action="set-smart-seed" data-track-id="${t.id}"
      style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--bg4)"
      onmouseenter="this.style.background='var(--bg4)'" onmouseleave="this.style.background=''">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".4"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t)">${esc(t.name)}</span>
      <span style="color:var(--t3);font-size:11px;white-space:nowrap;max-width:90px;overflow:hidden;text-overflow:ellipsis">${esc(t.artist||'')}</span>
    </div>`).join('');
}

function _buildSmartTracks() {
  const tracks = get('tracks');
  const liked = get('liked');
  if (!_smartSeedId) return [];
  const seed = (_trackIdxMap.has(_smartSeedId) ? tracks[_trackIdxMap.get(_smartSeedId)] : undefined);
  if (!seed) return [];

  const useArtist    = document.getElementById('crit-artist')?.checked ?? true;
  const useGenre     = document.getElementById('crit-genre')?.checked  ?? true;
  const useAlbum     = document.getElementById('crit-album')?.checked  ?? false;
  const useSimilar   = document.getElementById('crit-similar-artist')?.checked ?? false;
  const maxSize      = Math.min(parseInt(document.getElementById('smart-size')?.value || '20') || 20, tracks.length);

  const seedArtist = (seed.artistFull || seed.artist || '').toLowerCase().trim();
  const seedGenre  = (seed.genre || '').toLowerCase().trim();
  const seedAlbum  = (seed.album || '').toLowerCase().trim();
  const seedWords  = seedArtist.split(/[\s&,]+/).filter(w => w.length > 2);

  const scored = tracks
    .filter(t => t.id !== seed.id)
    .map(t => {
      let score = 0;
      const ta = (t.artistFull || t.artist || '').toLowerCase().trim();
      const tg = (t.genre || '').toLowerCase().trim();
      const tb = (t.album || '').toLowerCase().trim();
      const tw = ta.split(/[\s&,]+/).filter(w => w.length > 2);

      if (useArtist && seedArtist && ta === seedArtist) score += 100;
      if (useAlbum  && seedAlbum  && tb === seedAlbum)  score += 60;
      if (useGenre  && seedGenre) {
        if (tg === seedGenre)                                 score += 40;
        else if (tg && (tg.includes(seedGenre) || seedGenre.includes(tg))) score += 20;
      }
      if (useSimilar && seedArtist && ta !== seedArtist) {
        const common = seedWords.filter(w => tw.includes(w)).length;
        if (common > 0) score += common * 25;
      }
      if (liked.has(t.id)) score += 8;

      return { t, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    const fallback = tracks.filter(t => t.id !== seed.id && (
      (seed.artist && (t.artist||'').toLowerCase() === seedArtist) ||
      (seed.genre  && (t.genre||'').toLowerCase()  === seedGenre)
    ));
    if (fallback.length) fallback.forEach(t => scored.push({ t, score: 1 }));
  }

  const topScore = scored[0]?.score || 0;
  const topTier  = scored.filter(x => x.score >= topScore * 0.6);
  const lowTier  = scored.filter(x => x.score <  topScore * 0.6);
  for (let i = topTier.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [topTier[i], topTier[j]] = [topTier[j], topTier[i]];
  }

  const result = [seed, ...topTier.map(x=>x.t), ...lowTier.map(x=>x.t)];
  return result.slice(0, maxSize);
}

export function smartPreview() {
  if (_smartMode === 'rules') { _doPreviewRules(); return; }
  if (!_smartSeedId) { toast(i18n('t_smart_seed_first'), 'warning'); return; }
  const result = _buildSmartTracks();
  const countEl = document.getElementById('smart-preview-count');
  const listEl  = document.getElementById('smart-preview-list');
  const prev    = document.getElementById('smart-preview');
  if (countEl) countEl.textContent = result.length + ' titre' + (result.length!==1?'s':'');
  if (listEl) {
    listEl.innerHTML = result.slice(0,8).map((t,i) => `
      <div class="smart-prev-item">
        <span style="font-size:10px;color:var(--t3);min-width:16px;text-align:right">${i+1}</span>
        <span class="spn">${esc(t.name)}</span>
        <span class="spa">${esc(t.artist||'')}</span>
        ${t.id===_smartSeedId ? '<span class="spi">seed</span>' : ''}
      </div>`).join('') +
      (result.length>8 ? `<div style="padding:5px 10px;font-size:11px;color:var(--t3);text-align:center">+ ${result.length-8} autre${result.length-8>1?'s':''}…</div>` : '');
  }
  if (prev) prev.style.display = 'block';
}

export async function confirmSmartPlaylist() {
  const tracks = get('tracks');
  if (_smartMode === 'rules') {
    const result = _buildRulesTracks();
    if (!result.length) { toast(i18n('t_smart_no_match'), 'warning'); return; }
    const name = document.getElementById('spl-rules-name')?.value.trim() || 'Smart Rules';
    const combinator = document.getElementById('spl-combinator')?.value || 'all';
    const maxSize = parseInt(document.getElementById('spl-rules-size')?.value || '20') || 20;
    const criteria = { mode: 'rules', rules: JSON.parse(JSON.stringify(_smartRules)), combinator, size: maxSize };
    // B31 FIX : suffixe aléatoire — 2 smart playlists créées dans la même ms
    // (double-clic « Créer ») produiraient le même id 'pl_<ts>' → collision IDB.
    const pl = { id:'pl_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), name, trackIds:result.map(t=>t.id), smart:true, seedId:null, criteria, createdAt:Date.now() };
    get('playlists').push(pl);
    notify('playlists'); // CM-5 FIX: push() in-place → notify() so subscribers see the change
    await savePlaylists();
    renderPlNav(); setupPlNavDrop();
    closePlModal();
    setView('playlist', document.getElementById('ni-pl-'+pl.id), pl.id);
    toast(i18n('t_smart_pl_created', name, result.length), 'success');
    return;
  }
  // Seed mode
  if (!_smartSeedId) { toast(i18n('t_smart_seed_first'), 'warning'); return; }
  const result = _buildSmartTracks();
  if (!result.length) { toast(i18n('t_smart_no_match'), 'warning'); return; }
  const seed = (_trackIdxMap.has(_smartSeedId) ? tracks[_trackIdxMap.get(_smartSeedId)] : undefined);
  let name = document.getElementById('smart-pl-name').value.trim() || (seed ? _autoSmartName(seed) : 'Smart Mix');
  const criteria = {
    mode:    'seed',
    artist:  !!document.getElementById('crit-artist')?.checked,
    genre:   !!document.getElementById('crit-genre')?.checked,
    album:   !!document.getElementById('crit-album')?.checked,
    similar: !!document.getElementById('crit-similar-artist')?.checked,
    size:    parseInt(document.getElementById('smart-size')?.value || '20'),
  };
  // B31 FIX : suffixe aléatoire — évite la collision d'id en cas de double création
  // dans la même milliseconde (le 2e put écraserait le 1er en IDB).
  const pl = { id:'pl_'+Date.now()+'_'+Math.random().toString(36).slice(2,7), name, trackIds:result.map(t=>t.id), smart:true, seedId:_smartSeedId, criteria, createdAt:Date.now() };
  get('playlists').push(pl);
  notify('playlists'); // CM-5 FIX: push() in-place → notify() so subscribers see the change
  await savePlaylists();
  renderPlNav(); setupPlNavDrop();
  closePlModal();
  setView('playlist', document.getElementById('ni-pl-'+pl.id), pl.id);
  toast(i18n('t_smart_pl_created', name, result.length), 'success');
}

export async function regenerateSmartPlaylist(plId) {
  const pl = get('playlists').find(p => p.id === plId);
  if (!pl) return;
  const crit = pl.criteria || { mode: 'seed', artist: true, genre: true, album: false, similar: false, size: 20 };

  if (crit.mode === 'rules') {
    // Régénération mode règles — pas besoin d'ouvrir le modal
    _smartRules  = JSON.parse(JSON.stringify(crit.rules || []));
    _smartMode   = 'rules';
    // Simuler le combinator + size en injectant temporairement des éléments (ou compute directement)
    const combinator = crit.combinator || 'all';
    const maxSize    = crit.size || 20;
    const tracks     = get('tracks');
    const pcMap      = _buildPlayCountMap();
    const likedSet   = get('liked');
    const rules      = _smartRules.filter(r => r.value !== '' || r.field === 'liked' || r.field === 'format');
    if (!rules.length) { toast(i18n('t_smart_no_regen'), 'warning'); _smartMode = 'seed'; return; }
    const _matchAll  = combinator === 'all';
    const matched = tracks.filter(t => {
      if (_matchAll) {
        for (const r of rules) { if (!_evalRule(t, r, pcMap, likedSet)) return false; }
        return true;
      } else {
        for (const r of rules) { if (_evalRule(t, r, pcMap, likedSet)) return true; }
        return false;
      }
    }).slice(0, maxSize);
    if (!matched.length) { toast(i18n('t_smart_no_regen'), 'warning'); _smartMode = 'seed'; return; }
    pl.trackIds  = matched.map(t => t.id);
    pl.createdAt = Date.now();
    await savePlaylists();
    renderPlNav();
    if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});
    toast(i18n('t_smart_pl_regen', matched.length), 'success');
    _smartMode = 'seed';
    return;
  }

  // Seed mode (rétro-compat : criteria sans mode = seed)
  if (!pl.seedId) return;
  _smartSeedId = pl.seedId;
  const patch = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  patch('crit-artist', crit.artist ?? true);
  patch('crit-genre',  crit.genre  ?? true);
  patch('crit-album',  crit.album  ?? false);
  patch('crit-similar-artist', crit.similar ?? false);
  const sizeEl = document.getElementById('smart-size');
  if (sizeEl) sizeEl.value = crit.size || 20;
  const result = _buildSmartTracks();
  if (!result.length) { toast(i18n('t_smart_no_regen'), 'warning'); _smartSeedId = null; return; }
  pl.trackIds  = result.map(t => t.id);
  pl.createdAt = Date.now();
  await savePlaylists();
  renderPlNav();
  if (get('view') === 'playlist' && get('curPlId') === plId) emit(EVENTS.RENDER_LIB, {});
  toast(i18n('t_smart_pl_regen', result.length), 'success');
  _smartSeedId = null;
}
