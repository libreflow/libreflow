// LibreFlow — Statistics renderer
//
// Reads track and play-log data to render the stats panel.
// Pure renderer: receives data as parameters, no app state mutations.
//
// Exports:
//   renderStats(tracks, trackIdxMap)   Render the full stats panel

import { playLog } from './playlog.js';
import { esc, extEmoji, fmtDuration } from './utils.js';
import { getLang, i18n } from './i18n.js';
import { statsGoToGenre, statsGoToArtist } from './app.js';

// ── État UI persistent entre re-renders ───────────────────────
let _heatPeriod        = 30;   // 7 | 30 | 90 jours
let _cachedTracks      = null;
let _cachedTrackIdxMap = null;
// ── Memoïsation — évite de recalculer quand rien n'a changé ──
// sig = "${tracks.length}|${playLog.length}|${_heatPeriod}"
// Invalidé automatiquement dès que l'un des 3 facteurs change.
let _statsSig          = null;

/**
 * Render the statistics panel (#stats-content).
 * @param {object[]} tracks       Full track array from app.js
 * @param {Map}      trackIdxMap  Map of trackId → index in tracks
 */
// ── Changer la période du heatmap ─────────────────────────────────────────────
/** Retourne la période active (7 | 30 | 90) — pour la persistance en cfg. */
export function getHeatPeriod() { return _heatPeriod; }

/** Restaure la période sans déclencher de re-render (appelé au boot avant renderStats). */
export function initHeatPeriod(d) {
  if (d === 7 || d === 30 || d === 90) { _heatPeriod = d; _statsSig = null; }
}

export function setHeatPeriod(d) {
  _heatPeriod = d;
  _statsSig   = null; // forcer le recalcul
  // Bug #17 fix : fermer explicitement le panneau de détail du jour avant le re-render.
  // Sans ça, si la mémoïsation court-circuite renderStats(), le panneau reste affiché
  // avec les données de l'ancienne période (daysAgo calculé sur l'ancien _heatPeriod).
  const dayDetailEl = document.querySelector('#stats-content .stats-day-detail');
  if (dayDetailEl) {
    dayDetailEl.style.display = 'none';
    dayDetailEl.dataset.activeDay = '';
    // Retirer le marqueur .hm-active de la cellule précédente
    document.querySelectorAll('#stats-content .hm-cell.hm-active')
            .forEach(c => c.classList.remove('hm-active'));
  }
  if (_cachedTracks) renderStats(_cachedTracks, _cachedTrackIdxMap);
}

export function renderStats(tracks, trackIdxMap) {
  const el = document.getElementById('stats-content');
  if (!el) return;
  _cachedTracks      = tracks;
  _cachedTrackIdxMap = trackIdxMap;

  // Memoïsation : skip si rien n'a changé ET le panel a déjà du contenu
  const sig = `${tracks.length}|${playLog.length}|${_heatPeriod}`;
  if (sig === _statsSig && el.children.length > 0) return;
  _statsSig = sig;

  if (!tracks.length) {
    el.innerHTML = `<div class="empty"><div class="empty-ico">📊</div><div class="empty-h">${i18n('stats_empty_h')}</div><div class="empty-s">${i18n('stats_empty_s')}</div></div>`;
    return;
  }

  // ── Constantes temporelles ───────────────────────────────
  const now = Date.now();
  const DAY = 86400000;

  // ── Base metrics ─────────────────────────────────────────
  const totalPlays    = playLog.length;
  const totalListened = playLog.reduce((s, e) => s + (e.dur || 0), 0);
  const artistCount   = new Set(tracks.map(t => t.artist).filter(Boolean)).size;

  // ── Tendances (7j courants vs 7j précédents) ─────────────
  const week1Start = now - 7  * DAY;
  const week2Start = now - 14 * DAY;
  let playsW1 = 0, playsW2 = 0, listenW1 = 0, listenW2 = 0;
  for (const e of playLog) {
    if (!e.ts) continue; // guard : entrée corrompue sans timestamp
    const ts = Math.floor(e.ts / 1000); // µs → ms
    if (ts >= week1Start)                 { playsW1++; listenW1 += e.dur || 0; }
    else if (ts >= week2Start)            { playsW2++; listenW2 += e.dur || 0; }
  }
  function _trend(curr, prev) {
    if (prev === 0 && curr === 0) return '';
    const delta = prev === 0 ? 100 : ((curr - prev) / prev * 100);
    if (Math.abs(delta) < 5) return '<span class="stat-trend neutral">→</span>';
    return delta > 0
      ? `<span class="stat-trend up">↑ ${Math.round(delta)}%</span>`
      : `<span class="stat-trend down">↓ ${Math.round(Math.abs(delta))}%</span>`;
  }
  const trendPlays  = _trend(playsW1, playsW2);
  const trendListen = _trend(listenW1, listenW2);

  // ── Top tracks (by play count in playLog) ────────────────
  const playCounts = {};
  for (const e of playLog) playCounts[e.id] = (playCounts[e.id] || 0) + 1;
  const topTracks = Object.entries(playCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([id, n]) => ({ t: (trackIdxMap.has(id) ? tracks[trackIdxMap.get(id)] : undefined), n }))
    .filter(x => x.t);
  const maxPlays = topTracks[0]?.n || 1;

  // ── Top genres ────────────────────────────────────────────
  const _unknownGenre = i18n('stats_unknown_genre');
  const genreCounts = {};
  for (const t of tracks) {
    const g = t.genre || _unknownGenre;
    genreCounts[g] = (genreCounts[g] || 0) + 1;
  }
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxGenre  = topGenres[0]?.[1] || 1;

  // ── Top artistes du mois (30 derniers jours) ─────────────
  const monthAgo = now - 30 * DAY;
  const artistMonthCounts = {};
  for (const e of playLog) {
    if (!e.ts) continue; // guard : entrée corrompue sans timestamp
    const ts = Math.floor(e.ts / 1000);
    if (ts < monthAgo) continue;
    const t = trackIdxMap.has(e.id) ? tracks[trackIdxMap.get(e.id)] : null;
    if (!t) continue;
    const a = t.artistFull || t.artist;
    if (!a) continue;
    artistMonthCounts[a] = (artistMonthCounts[a] || 0) + 1;
  }
  const topArtistsMonth  = Object.entries(artistMonthCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxArtistMonth   = topArtistsMonth[0]?.[1] || 1;

  // ── Activity heatmap — période variable ──────────────────
  const heatCounts = new Array(_heatPeriod).fill(0);
  for (const e of playLog) {
    if (!e.ts) continue; // guard : entrée corrompue sans timestamp
    const ago = Math.floor((now - Math.floor(e.ts / 1000)) / DAY); // µs → ms → jours
    if (ago >= 0 && ago < _heatPeriod) heatCounts[_heatPeriod - 1 - ago]++;
  }
  const maxDay = Math.max(1, ...heatCounts);

  function heatLevel(n) {
    if (n === 0) return 0;
    const r = n / maxDay;
    if (r < .25) return 1;
    if (r < .5)  return 2;
    if (r < .75) return 3;
    return 4;
  }
  const dayLabels = [];
  for (let i = _heatPeriod - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY);
    dayLabels.push(d.toLocaleDateString(getLang() === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }));
  }

  // ── Render ────────────────────────────────────────────────
  el.innerHTML = `
  <div>
    <div class="stats-heading">${i18n('stats_overview')}</div>
    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-card-ico"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg></div>
        <div class="stat-card-val">${totalPlays.toLocaleString()}</div>
        <div class="stat-card-lbl">${i18n('stats_total_plays')}</div>
        ${trendPlays ? `<div class="stat-card-trend">${trendPlays}<span class="stat-trend-sub">${i18n('stats_vs_prev_week')}</span></div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-card-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
        <div class="stat-card-val">${totalListened > 0 ? fmtDuration(totalListened) : '—'}</div>
        <div class="stat-card-lbl">${i18n('stats_listen_time')}</div>
        ${trendListen ? `<div class="stat-card-trend">${trendListen}<span class="stat-trend-sub">${i18n('stats_vs_prev_week')}</span></div>` : ''}
      </div>
      <div class="stat-card">
        <div class="stat-card-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <div class="stat-card-val">${tracks.length.toLocaleString()}</div>
        <div class="stat-card-lbl">${i18n('stats_tracks_artists', tracks.length, artistCount)}</div>
      </div>
    </div>
  </div>

  ${topArtistsMonth.length ? `
  <div>
    <div class="stats-heading">${i18n('stats_top_artists_month')}</div>
    <div class="stats-artists-month">
      ${topArtistsMonth.map(([a, n]) => `
      <div class="artist-month-row stats-link" data-artist="${esc(a)}" title="${i18n('stats_goto_artist')}">
        <span class="artist-month-name">${esc(a)}</span>
        <div class="artist-month-bar-wrap"><div class="artist-month-bar-fill" style="width:${Math.round(n / maxArtistMonth * 100)}%"></div></div>
        <span class="artist-month-count">${n}×</span>
      </div>`).join('')}
    </div>
  </div>` : ''}

  <div class="stats-row-2">
    ${topTracks.length ? `
    <div>
      <div class="stats-heading">${i18n('stats_top_tracks')}</div>
      <div class="stats-top">
        ${topTracks.map(({ t, n }, i) => `
        <div class="stats-top-row" data-action="play-track" data-track-id="${t.id}">
          <span class="stats-rank${i < 3 ? ' top3' : ''}">${i + 1}</span>
          ${t.art ? `<img class="stats-top-art" src="${t.art}" alt="">` : `<div class="stats-top-art" style="display:flex;align-items:center;justify-content:center;font-size:14px">${extEmoji(t.ext)}</div>`}
          <div class="stats-top-info">
            <div class="stats-top-name">${esc(t.name)}</div>
            <div class="stats-top-artist">${esc(t.artistFull || t.artist || '')}</div>
          </div>
          <div class="stats-top-bar"><div class="stats-top-fill" style="width:${Math.round(n / maxPlays * 100)}%"></div></div>
          <span class="stats-top-count">${n}×</span>
        </div>`).join('')}
      </div>
    </div>` : ''}

    <div>
      <div class="stats-heading">${i18n('stats_genres')} <span style="font-size:9px;opacity:.5;font-weight:400;letter-spacing:0">${i18n('stats_genres_hint')}</span></div>
      <div class="stats-genres">
        ${topGenres.map(([g, n]) => `
        <div class="genre-bar-row" data-genre="${esc(g)}" data-genre-key="${esc(g.toLowerCase())}">
          <span class="genre-bar-name">${esc(g)}</span>
          <div class="genre-bar-wrap"><div class="genre-bar-fill" style="width:${Math.round(n / maxGenre * 100)}%"></div></div>
          <span class="genre-bar-pct">${Math.round(n / tracks.length * 100)}%</span>
        </div>`).join('')}
      </div>
    </div>
  </div>

  <div>
    <div class="stats-heading" style="display:flex;align-items:center;gap:10px">
      ${i18n('stats_activity', _heatPeriod)}
      <div class="heat-filters">
        <button class="heat-filter-btn${_heatPeriod===7?' on':''}" data-action="heat-period" data-days="7">7j</button>
        <button class="heat-filter-btn${_heatPeriod===30?' on':''}" data-action="heat-period" data-days="30">30j</button>
        <button class="heat-filter-btn${_heatPeriod===90?' on':''}" data-action="heat-period" data-days="90">90j</button>
      </div>
      <span style="font-size:9px;opacity:.5;font-weight:400;letter-spacing:0;margin-left:auto">${i18n('stats_click_day')}</span>
    </div>
    <div class="stats-heatmap">
      <div class="heatmap-grid" style="grid-template-columns:repeat(${_heatPeriod},1fr);gap:${_heatPeriod > 30 ? 2 : 3}px">
        ${heatCounts.map((n, i) => `<div class="hm-cell" data-n="${heatLevel(n)}" data-day="${i}" title="${dayLabels[i]} · ${i18n('stats_plays', n)}"></div>`).join('')}
      </div>
      <div class="hm-legend">
        <span>${i18n('stats_hm_less')}</span>
        ${[0, 1, 2, 3, 4].map(l => `<div class="hm-legend-cell" data-n="${l}"></div>`).join('')}
        <span>${i18n('stats_hm_more')}</span>
      </div>
    </div>
    <div class="stats-day-detail" style="display:none"></div>
  </div>`;

  // ── Post-render: animations ───────────────────────────────
  requestAnimationFrame(() => {
    el.querySelectorAll('.stats-top-fill, .genre-bar-fill, .artist-month-bar-fill').forEach(b => {
      const w = b.style.width; b.style.width = '0'; requestAnimationFrame(() => { b.style.width = w; });
    });
  });

  // ── Artiste click → naviguer vers la vue artiste ─────────
  const artistsContainer = el.querySelector('.stats-artists-month');
  if (artistsContainer) {
    artistsContainer.addEventListener('click', e => {
      const row = e.target.closest('.artist-month-row[data-artist]');
      if (!row) return;
      statsGoToArtist(row.dataset.artist);
    });
  }

  // ── Genre click → naviguer vers la vue genre ─────────────
  const genresContainer = el.querySelector('.stats-genres');
  if (genresContainer) {
    genresContainer.addEventListener('click', e => {
      const row = e.target.closest('.genre-bar-row[data-genre-key]');
      if (!row) return;
      const key     = row.dataset.genreKey;
      const display = row.dataset.genre;
      statsGoToGenre(key, display);
    });
  }

  // ── Changer la période du heatmap : voir export setHeatPeriod() ci-dessous ─

  // ── Heatmap click → panneau de détail du jour ────────────
  const heatmapGrid  = el.querySelector('.heatmap-grid');
  const dayDetailEl  = el.querySelector('.stats-day-detail');
  if (heatmapGrid && dayDetailEl) {
    heatmapGrid.addEventListener('click', e => {
      const cell = e.target.closest('.hm-cell[data-day]');
      if (!cell) return;

      const dayIdx  = parseInt(cell.dataset.day, 10);
      const daysAgo = (_heatPeriod - 1) - dayIdx; // 0 = le plus ancien, _heatPeriod-1 = aujourd'hui

      // Toggle : re-clic sur la même cellule → fermer
      if (dayDetailEl.dataset.activeDay === String(dayIdx) && dayDetailEl.style.display !== 'none') {
        dayDetailEl.style.display = 'none';
        dayDetailEl.dataset.activeDay = '';
        cell.classList.remove('hm-active');
        return;
      }

      // Désactiver l'ancienne cellule active
      el.querySelectorAll('.hm-cell.hm-active').forEach(c => c.classList.remove('hm-active'));
      cell.classList.add('hm-active');
      dayDetailEl.dataset.activeDay = String(dayIdx);

      // Calculer la plage horaire du jour (minuit → minuit)
      const dayStart = now - (daysAgo + 1) * DAY;
      const dayEnd   = now - daysAgo * DAY;

      // Agréger les écoutes de ce jour
      const dayPlayCounts = {};
      for (const entry of playLog) {
        const ts = Math.floor(entry.ts / 1000); // µs → ms
        if (ts >= dayStart && ts < dayEnd) {
          dayPlayCounts[entry.id] = (dayPlayCounts[entry.id] || 0) + 1;
        }
      }
      const dayTracks = Object.entries(dayPlayCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => ({ t: trackIdxMap.has(id) ? tracks[trackIdxMap.get(id)] : null, n }))
        .filter(x => x.t);
      const totalDayPlays = dayTracks.reduce((s, x) => s + x.n, 0);

      dayDetailEl.style.display = '';

      if (dayTracks.length === 0) {
        dayDetailEl.innerHTML = `<div class="stats-day-empty">${i18n('stats_no_history', dayLabels[dayIdx])}</div>`;
      } else {
        dayDetailEl.innerHTML = `
          <div class="stats-day-header">
            <span class="stats-day-date">${dayLabels[dayIdx]}</span>
            <span class="stats-day-count">${i18n('stats_plays', totalDayPlays)}</span>
          </div>
          <div class="stats-top">
            ${dayTracks.slice(0, 8).map(({ t, n }, i) => `
            <div class="stats-top-row" data-action="play-track" data-track-id="${t.id}">
              <span class="stats-rank${i < 3 ? ' top3' : ''}">${i + 1}</span>
              ${t.art
                ? `<img class="stats-top-art" src="${t.art}" alt="">`
                : `<div class="stats-top-art" style="display:flex;align-items:center;justify-content:center;font-size:14px">${extEmoji(t.ext)}</div>`}
              <div class="stats-top-info">
                <div class="stats-top-name">${esc(t.name)}</div>
                <div class="stats-top-artist">${esc(t.artistFull || t.artist || '')}</div>
              </div>
              ${n > 1 ? `<span class="stats-top-count">${n}×</span>` : '<span class="stats-top-count" style="opacity:.3">1×</span>'}
            </div>`).join('')}
          </div>`;
      }
    });
  }
}
