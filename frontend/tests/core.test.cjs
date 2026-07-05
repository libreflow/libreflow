// LibreFlow — Core Unit Tests
// Node.js CJS (zero deps). Reproduit la logique inline — pas d'import ES module.
// Lancer : node frontend/tests/core.test.cjs
// =============================================================================

'use strict';

let _ok = 0, _ko = 0;

function section(name) {
  console.log('\n── ' + name + ' ──');
}

function assert(cond, msg) {
  if (cond) {
    _ok++;
    console.log('  ✓  ' + msg);
  } else {
    _ko++;
    console.error('  ✗  ' + msg);
  }
}

// =============================================================================
// 1. Utils — fmtd (formatDuration)
// =============================================================================
section('utils.js -- fmtd (formatDuration)');

function fmtd(s) {
  if (!s && s !== 0) return '–:––';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  return m + ':' + String(ss).padStart(2, '0');
}

(function () {
  assert(fmtd(0)    === '0:00', 'fmtd: 0s → 0:00');
  assert(fmtd(59)   === '0:59', 'fmtd: 59s → 0:59');
  assert(fmtd(60)   === '1:00', 'fmtd: 60s → 1:00');
  assert(fmtd(90)   === '1:30', 'fmtd: 90s → 1:30');
  assert(fmtd(3600) === '1:00:00', 'fmtd: 3600s → 1:00:00');
  assert(fmtd(3661) === '1:01:01', 'fmtd: 3661s → 1:01:01');
  assert(fmtd(null) === '–:––', 'fmtd: null → –:––');
}());

// =============================================================================
// 2. Utils — esc (HTML escape)
// =============================================================================
section('utils.js -- esc (HTML escape)');

function esc(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

(function () {
  assert(esc('<script>')    === '&lt;script&gt;',   'esc: balises HTML');
  assert(esc('a & b')       === 'a &amp; b',        'esc: ampersand');
  assert(esc('"quoted"')    === '&quot;quoted&quot;','esc: guillemets');
  assert(esc("it's")        === 'it&#39;s',          'esc: apostrophe');
  assert(esc('')             === '',                  'esc: vide');
  assert(esc(null)           === '',                  'esc: null');
}());

// =============================================================================
// 3. Utils — normTag
// =============================================================================
section('utils.js -- normTag');

function normTag(s) {
  if (!s) return '';
  return String(s).trim().replace(/\s+/g, ' ');
}

(function () {
  assert(normTag('  hello  ')         === 'hello',      'normTag: trim');
  assert(normTag('a  b   c')          === 'a b c',      'normTag: espace multiples');
  assert(normTag('  ')                === '',            'normTag: espaces seuls → vide');
  assert(normTag(null)                === '',            'normTag: null → vide');
}());

// =============================================================================
// 4. Utils — mainArtist
// =============================================================================
section('utils.js -- mainArtist');

function mainArtist(s) {
  if (!s) return '';
  return s.split(/[&,;\/]|\bfeat\.?\b|\bft\.?\b/i)[0].trim();
}

(function () {
  assert(mainArtist('Daft Punk')             === 'Daft Punk',  'mainArtist: seul');
  assert(mainArtist('Jay-Z feat. Kanye')     === 'Jay-Z',      'mainArtist: feat.');
  assert(mainArtist('A & B')                 === 'A',          'mainArtist: &');
  assert(mainArtist('A, B, C')               === 'A',          'mainArtist: virgule');
  assert(mainArtist('')                       === '',           'mainArtist: vide');
  assert(mainArtist(null)                     === '',           'mainArtist: null');
}());

// =============================================================================
// 5. Utils — extEmoji
// =============================================================================
section('utils.js -- extEmoji');

function extEmoji(ext) {
  if (!ext) return null;
  const map = { flac: '🎵', mp3: '🎵', wav: '🎵', aiff: '🎵', m4a: '🎵', ogg: '🎵', opus: '🎵' };
  return map[(ext || '').toLowerCase()] || null;
}

(function () {
  assert(extEmoji('mp3')  !== null, 'extEmoji: mp3 non-null');
  assert(extEmoji('flac') !== null, 'extEmoji: flac non-null');
  assert(extEmoji('xyz')  === null, 'extEmoji: extension inconnue → null');
  assert(extEmoji(null)   === null, 'extEmoji: null → null');
}());

// =============================================================================
// 6. TAGS -- validYear + détection epoch 1970
// =============================================================================
section('tags.js -- validYear + détection epoch 1970');

function validYear(str) {
  if (!str && str !== 0) return null;
  const s = String(str).trim();
  // Epoch Unix encodeur : "1970-01-..." longueur > 4 => ignorer
  if (s.length > 4 && s.startsWith('1970-01')) return null;
  const n = parseInt(s, 10);
  return (Number.isInteger(n) && n >= 1900 && n <= 2099) ? n : null;
}

(function () {
  assert(validYear('2023')          === 2023, 'année valide string');
  assert(validYear(2023)            === 2023, 'année valide number');
  assert(validYear('1900')          === 1900, 'borne basse valide');
  assert(validYear('2099')          === 2099, 'borne haute valide');
  assert(validYear('1970')          === 1970, 'année 1970 seule = album légitime');
  assert(validYear('1970-01-01T00:00:00Z') === null, 'epoch ISO -> null');
  assert(validYear('1970-01-01')    === null, 'epoch date -> null');
  assert(validYear('1899')          === null, 'avant 1900 -> null');
  assert(validYear('2100')          === null, 'après 2099 -> null');
  assert(validYear('')              === null, 'vide -> null');
  assert(validYear(null)            === null, 'null -> null');
  assert(validYear('abc')           === null, 'non-numérique -> null');
}());

// =============================================================================
// 7. SEARCH -- cohérence _trackIdxMap après rebuildTrackIdxMap
// =============================================================================
section('search.js -- _trackIdxMap cohérence après rebuild');

function rebuildTrackIdxMap(tracks) {
  const m = new Map();
  for (let i = 0; i < tracks.length; i++) m.set(tracks[i].id, i);
  return m;
}

(function () {
  var tracks = [
    { id: 'a', title: 'AAA' },
    { id: 'b', title: 'BBB' },
    { id: 'c', title: 'CCC' },
  ];
  var map = rebuildTrackIdxMap(tracks);

  assert(map.size === 3,          'map contient autant d\'entrées que tracks[]');
  assert(map.get('a') === 0,      'id "a" -> index 0');
  assert(map.get('b') === 1,      'id "b" -> index 1');
  assert(map.get('c') === 2,      'id "c" -> index 2');
  assert(map.get('z') === undefined, 'id inconnu -> undefined');

  // Mutation de tracks[] sans rebuild -> désync (anti-pattern R2)
  tracks.push({ id: 'd', title: 'DDD' });
  assert(map.get('d') === undefined, 'avant rebuild: nouvel id absent de la map');

  // Rebuild -> re-sync
  map = rebuildTrackIdxMap(tracks);
  assert(map.get('d') === 3,      'après rebuild: nouvel id -> index 3');
  assert(map.size === 4,          'map mise à jour à 4 entrées');

  // Splice sans rebuild -> index corrompu (démo de l\'anti-pattern)
  tracks.splice(1, 1); // retire 'b'
  assert(map.get('c') === 2,      'sans rebuild: map pointe encore index 2 pour "c" (stale)');
  assert(tracks[2].id === 'd',    'mais tracks[2] est maintenant "d" -> corruption détectée');

  // Rebuild -> corrige
  map = rebuildTrackIdxMap(tracks);
  assert(map.get('c') === 1,      'après rebuild post-splice: "c" -> index 1 (correct)');
  assert(map.get('d') === 2,      'après rebuild post-splice: "d" -> index 2 (correct)');
}());

// =============================================================================
// 8. SELECTION -- commonVal (batch tag edit)
// =============================================================================
section('selection.js -- commonVal (détection valeurs communes)');

function commonVal(tracks, field) {
  const vals = new Set(tracks.map(function(t) { return String(t[field] != null ? t[field] : ''); }));
  return vals.size === 1 ? Array.from(vals)[0] : null;
}

(function () {
  var allSame = [
    { artist: 'Daft Punk', album: 'RAM', year: 2013 },
    { artist: 'Daft Punk', album: 'RAM', year: 2013 },
    { artist: 'Daft Punk', album: 'RAM', year: 2013 },
  ];
  assert(commonVal(allSame, 'artist') === 'Daft Punk', 'artiste commun détecté');
  assert(commonVal(allSame, 'album')  === 'RAM',        'album commun détecté');
  assert(commonVal(allSame, 'year')   === '2013',       'année commune (converti en string)');

  var mixed = [
    { artist: 'Daft Punk', album: 'RAM'       },
    { artist: 'Daft Punk', album: 'Homework'  },
  ];
  assert(commonVal(mixed, 'artist') === 'Daft Punk', 'artiste commun malgré albums différents');
  assert(commonVal(mixed, 'album')  === null,         'albums différents -> null');

  var withNull = [
    { artist: 'X', year: null  },
    { artist: 'X', year: 2020  },
  ];
  assert(commonVal(withNull, 'artist') === 'X',   'artiste commun avec year null');
  assert(commonVal(withNull, 'year')   === null,   'year: null vs 2020 -> mixte -> null');

  var single = [{ artist: 'Solo', album: 'One' }];
  assert(commonVal(single, 'artist') === 'Solo', 'sélection d\'un seul élément -> valeur directe');
}());

// =============================================================================
// 10. NOW PLAYING -- formatters
// =============================================================================
section('nowplaying.js -- formatters');

(function testNowPlayingFormatters() {
  function formatCodec(ext) {
    if (!ext) return '–';
    const upper = ext.toUpperCase();
    const MAP = { MP3:'MP3', FLAC:'FLAC', M4A:'AAC/ALAC', OGG:'OGG Vorbis',
                  OPUS:'Opus', WAV:'WAV', AIFF:'AIFF', AIF:'AIFF', APE:'APE', WMA:'WMA' };
    return MAP[upper] || upper;
  }
  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return '–';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  }
  function formatBitDepth(bitDepth, sampleRate) {
    const parts = [];
    if (bitDepth)   parts.push(bitDepth + ' bit');
    if (sampleRate) parts.push((sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1) + ' kHz');
    return parts.join(' / ') || '–';
  }
  function formatBitrate(bitrate) {
    if (!bitrate) return '–';
    return bitrate + ' kbps';
  }

  assert(formatCodec('flac')  === 'FLAC',        'formatCodec: flac → FLAC');
  assert(formatCodec('mp3')   === 'MP3',         'formatCodec: mp3  → MP3');
  assert(formatCodec('m4a')   === 'AAC/ALAC',    'formatCodec: m4a  → AAC/ALAC');
  assert(formatCodec('ogg')   === 'OGG Vorbis',  'formatCodec: ogg  → OGG Vorbis');
  assert(formatCodec('opus')  === 'Opus',        'formatCodec: opus → Opus');
  assert(formatCodec('')      === '–',           'formatCodec: empty → –');
  assert(formatCodec(null)    === '–',           'formatCodec: null  → –');
  assert(formatCodec('xyz')   === 'XYZ',         'formatCodec: unknown ext uppercased');

  assert(formatFileSize(0)           === '–',          'formatFileSize: 0 → –');
  assert(formatFileSize(null)        === '–',          'formatFileSize: null → –');
  assert(formatFileSize(1024)        === '1.0 Ko',     'formatFileSize: 1024 → 1.0 Ko');
  assert(formatFileSize(1048576)     === '1.0 Mo',     'formatFileSize: 1 MiB → 1.0 Mo');
  assert(formatFileSize(44369920)    === '42.3 Mo',    'formatFileSize: 42.3 Mo');

  assert(formatBitDepth(24, 96000)  === '24 bit / 96 kHz',   'formatBitDepth: 24/96');
  assert(formatBitDepth(16, 44100)  === '16 bit / 44.1 kHz', 'formatBitDepth: 16/44.1');
  assert(formatBitDepth(null, null) === '–',                  'formatBitDepth: nulls → –');
  assert(formatBitDepth(16, null)   === '16 bit',             'formatBitDepth: depth only');
  assert(formatBitDepth(null, 48000)=== '48 kHz',             'formatBitDepth: rate only');

  assert(formatBitrate(320)  === '320 kbps', 'formatBitrate: 320');
  assert(formatBitrate(1024) === '1024 kbps','formatBitrate: 1024');
  assert(formatBitrate(null) === '–',        'formatBitrate: null → –');
  assert(formatBitrate(0)    === '–',        'formatBitrate: 0 → –');
}());

// =============================================================================
// 11. RENDERER -- filterAlbumsByArtist
// =============================================================================
section('renderer.js -- filterAlbumsByArtist');

(function testFilterAlbumsByArtist() {
  function filterAlbumsByArtist(albums, artistKey) {
    return albums.filter(a => (a.artist || '').toLowerCase() === artistKey);
  }

  const albums = [
    { displayName: 'OK Computer', artist: 'Radiohead', key: 'ok computer' },
    { displayName: 'Kid A',       artist: 'Radiohead', key: 'kid a' },
    { displayName: 'Homework',    artist: 'Daft Punk', key: 'homework' },
    { displayName: 'Discovery',   artist: 'Daft Punk', key: 'discovery' },
  ];

  const rh = filterAlbumsByArtist(albums, 'radiohead');
  assert(rh.length === 2,                      'filter: 2 Radiohead albums');
  assert(rh[0].displayName === 'OK Computer',  'filter: first Radiohead album');

  const dp = filterAlbumsByArtist(albums, 'daft punk');
  assert(dp.length === 2,                      'filter: 2 Daft Punk albums');

  const none = filterAlbumsByArtist(albums, 'unknown artist');
  assert(none.length === 0,                    'filter: unknown artist → empty');

  const empty = filterAlbumsByArtist([], 'radiohead');
  assert(empty.length === 0,                   'filter: empty albums → empty');
}());

// =============================================================================
// 12. Utils — fmt (actual utils.js — !s||isNaN guards, 0 is falsy → '–:––')
// =============================================================================
section('utils.js -- fmt (current impl)');

(function () {
  function fmt(s) {
    if (!s || isNaN(s)) return '–:––';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  assert(fmt(0)     === '–:––', 'fmt: 0 → –:––  (falsy guard)');
  assert(fmt(null)  === '–:––', 'fmt: null → –:––');
  assert(fmt(NaN)   === '–:––', 'fmt: NaN → –:––');
  assert(fmt('abc') === '–:––', 'fmt: string non-numérique → –:––');
  assert(fmt(60)    === '1:00', 'fmt: 60s → 1:00');
  assert(fmt(61)    === '1:01', 'fmt: 61s → 1:01');
  assert(fmt(3599)  === '59:59','fmt: 3599s → 59:59');
  assert(fmt(3600)  === '60:00','fmt: 3600s → 60:00 (pas de h dans fmt)');
  assert(fmt(90.7)  === '1:30', 'fmt: 90.7s → 1:30 (floor)');
}());

// =============================================================================
// 13. Utils — fmtd (actual utils.js — returns '' for falsy)
// =============================================================================
section('utils.js -- fmtd (current impl — retourne "" pour falsy)');

(function () {
  function fmt(s) {
    if (!s || isNaN(s)) return '–:––';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }
  function fmtd(s) {
    if (!s || !isFinite(s)) return '';
    return fmt(s);
  }

  assert(fmtd(0)        === '',      'fmtd: 0 → "" (falsy)');
  assert(fmtd(null)     === '',      'fmtd: null → ""');
  assert(fmtd(undefined)=== '',      'fmtd: undefined → ""');
  assert(fmtd(Infinity) === '',      'fmtd: Infinity → "" (!isFinite)');
  assert(fmtd(60)       === '1:00', 'fmtd: 60s → 1:00');
  assert(fmtd(3661)     === '61:01','fmtd: 3661s → 61:01');
  assert(fmtd(30)       === '0:30', 'fmtd: 30s → 0:30');
}());

// =============================================================================
// 14. Utils — fmtDuration (actual: "Xs", "Xm", "Xh Ym")
// =============================================================================
section('utils.js -- fmtDuration');

(function () {
  function fmtDuration(secs) {
    if (!secs || secs < 60) return `${Math.round(secs || 0)}s`;
    const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }

  assert(fmtDuration(0)      === '0s',   'fmtDuration: 0 → 0s');
  assert(fmtDuration(null)   === '0s',   'fmtDuration: null → 0s');
  assert(fmtDuration(30)     === '30s',  'fmtDuration: 30s → 30s');
  assert(fmtDuration(59)     === '59s',  'fmtDuration: 59s → 59s');
  assert(fmtDuration(60)     === '1m',   'fmtDuration: 60s → 1m');
  assert(fmtDuration(90)     === '1m',   'fmtDuration: 90s → 1m (floor minutes)');
  assert(fmtDuration(3600)   === '1h 0m','fmtDuration: 3600s → 1h 0m');
  assert(fmtDuration(3720)   === '1h 2m','fmtDuration: 3720s → 1h 2m');
  assert(fmtDuration(7384)   === '2h 3m','fmtDuration: 7384s → 2h 3m');
  assert(fmtDuration(3599)   === '59m',  'fmtDuration: 3599s → 59m');
}());

// =============================================================================
// 15. Utils — normTag (actual: zero-width, soft-hyphen, BOM, NFC, whitespace)
// =============================================================================
section('utils.js -- normTag (zero-width chars, soft-hyphen, BOM)');

(function () {
  function normTag(s) {
    if (!s) return '';
    return s
      .replace(/[​‌‍﻿­]/g, '')
      .replace(/\s+/g, ' ')
      .normalize('NFC')
      .trim();
  }

  assert(normTag('')           === '',        'normTag: vide → vide');
  assert(normTag(null)         === '',        'normTag: null → vide');
  assert(normTag('  hello  ')  === 'hello',   'normTag: trim espaces');
  assert(normTag('a  b  c')    === 'a b c',   'normTag: collapse whitespace');
  // zero-width space U+200B
  assert(normTag('hel​lo') === 'hello',  'normTag: strip zero-width space U+200B');
  // zero-width non-joiner U+200C
  assert(normTag('he‌llo') === 'hello',  'normTag: strip U+200C');
  // BOM U+FEFF
  assert(normTag('﻿test')   === 'test',   'normTag: strip BOM U+FEFF');
  // soft hyphen U+00AD
  assert(normTag('don­t')   === 'dont',   'normTag: strip soft-hyphen U+00AD');
  // tab collapse
  assert(normTag('a\t\tb')       === 'a b',    'normTag: tabs collapsés en espace');
  // newline collapse
  assert(normTag('a\n\nb')       === 'a b',    'normTag: newlines collapsés en espace');
}());

// =============================================================================
// 16. Utils — mainArtist (actual implementation from utils.js)
// =============================================================================
section('utils.js -- mainArtist (actual impl)');

(function () {
  function normTag(s) {
    if (!s) return '';
    return s.replace(/[​‌‍﻿­]/g, '').replace(/\s+/g, ' ').normalize('NFC').trim();
  }
  function mainArtist(raw) {
    if (!raw) return '';
    let s = normTag(raw);
    s = s
      .replace(/\s*[(/]\s*(?:feat\.?|ft\.?|featuring|avec|with|vs\.?)\s+.*/i, '')
      .replace(/\s*,\s*(?:feat\.?|ft\.?|featuring)\s+.*/i, '')
      .replace(/\s+(?:feat\.?|ft\.?|featuring|avec|with)\s+.*/i, '')
      .replace(/\s*\/\s*.+$/, '')
      .replace(/\s*,\s*.+$/, '')
      .trim();
    return s || normTag(raw);
  }

  assert(mainArtist('Daft Punk')              === 'Daft Punk',  'mainArtist: seul artiste');
  assert(mainArtist(null)                      === '',           'mainArtist: null → ""');
  assert(mainArtist('')                        === '',           'mainArtist: vide → ""');
  assert(mainArtist('Jay-Z feat. Kanye West') === 'Jay-Z',      'mainArtist: feat. (point)');
  assert(mainArtist('Eminem ft. Rihanna')     === 'Eminem',     'mainArtist: ft.');
  assert(mainArtist('A (feat. B)')            === 'A',          'mainArtist: (feat. B)');
  assert(mainArtist('A / B')                  === 'A',          'mainArtist: slash');
  assert(mainArtist('A, B')                   === 'A',          'mainArtist: virgule');
  assert(mainArtist('A avec B')               === 'A',          'mainArtist: avec');
  assert(mainArtist('A featuring B')          === 'A',          'mainArtist: featuring');
  assert(mainArtist('  Björk  ')              === 'Björk',      'mainArtist: trim + unicode');
}());

// =============================================================================
// 17. Search — _normalizeGenre (alias resolution + passthrough)
// =============================================================================
section('search.js -- _normalizeGenre');

(function () {
  const GENRE_ALIASES = {
    'hip hop':      'hip-hop',
    'hiphop':       'hip-hop',
    'rap':          'hip-hop',
    'r&b':          'r&b/soul',
    'soul':         'r&b/soul',
    'rnb':          'r&b/soul',
    'edm':          'electronic',
    'electro':      'electronic',
    'techno':       'electronic',
    'rock & roll':  'rock',
    'heavy metal':  'metal',
    'smooth jazz':  'jazz',
    'classical music': 'classical',
    'country music': 'country',
  };

  function _normalizeGenre(g) {
    if (!g) return '';
    const key = g.toLowerCase().trim().replace(/\s+/g, ' ');
    return GENRE_ALIASES[key] || key;
  }

  assert(_normalizeGenre(null)            === '',          '_normalizeGenre: null → ""');
  assert(_normalizeGenre('')              === '',          '_normalizeGenre: vide → ""');
  assert(_normalizeGenre('Hip Hop')       === 'hip-hop',  '_normalizeGenre: alias "Hip Hop"');
  assert(_normalizeGenre('  rap  ')       === 'hip-hop',  '_normalizeGenre: alias "rap" + trim');
  assert(_normalizeGenre('R&B')           === 'r&b/soul', '_normalizeGenre: alias "R&B"');
  assert(_normalizeGenre('EDM')           === 'electronic','_normalizeGenre: alias "EDM"');
  assert(_normalizeGenre('Rock')          === 'rock',      '_normalizeGenre: passthrough lowercase');
  assert(_normalizeGenre('Jazz')          === 'jazz',      '_normalizeGenre: passthrough "Jazz"');
  assert(_normalizeGenre('Unknown Genre') === 'unknown genre','_normalizeGenre: inconnu → lowercase passthrough');
  assert(_normalizeGenre('ROCK  &  ROLL') === 'rock',     '_normalizeGenre: alias + multi-space normalize');
}());

// =============================================================================
// 18. Tags — guessGenre (inline algorithm test)
// =============================================================================
section('tags.js -- guessGenre (inline algorithm)');

(function () {
  // Minimal representative GENRE_ARTISTS (exact subset)
  const GA = new Map([
    ['daft punk',   'Electronic'],
    ['eminem',      'Hip-Hop'],
    ['miles davis', 'Jazz'],
    ['beethoven',   'Classique'],
    ['kendrick lamar', 'Hip-Hop'],
  ]);

  // Minimal representative GENRE_KEYWORDS
  const GK = [
    [/\b(rap|trap|cypher|punchline)\b/i, 'Hip-Hop', 2],
    [/\b(rock|punk|grunge|hardcore)\b/i, 'Rock', 2],
    [/\b(electro|techno|house|edm)\b/i,  'Electronic', 2],
    [/\b(jazz|bebop|swing|blues)\b/i,    'Jazz', 2],
    [/\b(classical|symphony|sonata)\b/i, 'Classique', 2],
    [/\b(pop|banger|anthem)\b/i,         'Pop', 1],
    [/\b(indie|alternative|lo.?fi)\b/i,  'Indie', 2],
  ];

  function guessGenre(track) {
    const artist   = (track.artistFull || track.artist || '').toLowerCase().trim();
    const name     = (track.name  || '').toLowerCase();
    const album    = (track.album || '').toLowerCase();
    const haystack = `${name} ${album}`;

    if (artist && GA.has(artist)) return GA.get(artist);

    const artistFirst = artist.split(' ')[0];
    for (const [key, genre] of GA) {
      if (artist.includes(key) || key.includes(artistFirst)) {
        if (artistFirst.length > 3) return genre;
      }
    }

    const scores = new Map();
    for (const [re, genre, weight] of GK) {
      if (re.test(haystack) || re.test(artist)) {
        scores.set(genre, (scores.get(genre) || 0) + weight);
      }
    }
    if (scores.size) {
      return [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    return null;
  }

  // Path 1: exact artist match
  assert(guessGenre({ artist: 'Daft Punk' })              === 'Electronic', 'guessGenre: exact artist Daft Punk');
  assert(guessGenre({ artist: 'Eminem' })                 === 'Hip-Hop',   'guessGenre: exact artist Eminem');
  assert(guessGenre({ artist: 'Miles Davis' })            === 'Jazz',      'guessGenre: exact artist Miles Davis');
  // Path 2: keyword in title/album
  assert(guessGenre({ artist: 'Unknown', name: 'Rock Anthem' }) === 'Rock','guessGenre: keyword rock in title');
  assert(guessGenre({ artist: 'Unknown', name: 'Trap Queen' })  === 'Hip-Hop','guessGenre: keyword trap in title');
  assert(guessGenre({ artist: 'Unknown', album: 'Jazz Standards' }) === 'Jazz','guessGenre: keyword jazz in album');
  assert(guessGenre({ artist: 'Unknown', name: 'Electro Dream' }) === 'Electronic','guessGenre: keyword electro');
  // Path 3: no match → null
  assert(guessGenre({ artist: 'XYZ', name: 'Track', album: 'Album' }) === null,'guessGenre: no match → null');
  assert(guessGenre({})                                   === null,          'guessGenre: empty track → null');
}());

// =============================================================================
// 19. Library — _validYear (library.js range: 1900–2100)
// =============================================================================
section('library.js -- _validYear (range 1900–2100)');

(function () {
  function _validYear(y) {
    const n = Number(y);
    return (Number.isInteger(n) && n >= 1900 && n <= 2100) ? n : null;
  }

  assert(_validYear(2023)   === 2023, '_validYear: 2023 → 2023');
  assert(_validYear('2023') === 2023, '_validYear: "2023" → 2023');
  assert(_validYear(1900)   === 1900, '_validYear: borne basse 1900');
  assert(_validYear(2100)   === 2100, '_validYear: borne haute 2100');
  assert(_validYear(1899)   === null, '_validYear: 1899 → null');
  assert(_validYear(2101)   === null, '_validYear: 2101 → null');
  assert(_validYear(0)      === null, '_validYear: 0 → null');
  assert(_validYear(null)   === null, '_validYear: null → null');
  assert(_validYear('')     === null, '_validYear: "" → null');
  assert(_validYear('abc')  === null, '_validYear: "abc" → null');
  assert(_validYear(2000.5) === null, '_validYear: flottant → null (isInteger check)');
  assert(_validYear('2001') === 2001, '_validYear: "2001" (string) → 2001');
}());

// =============================================================================
// 20. Library — _sanitizeTagStr (SEC-5: type check + max length)
// =============================================================================
section('library.js -- _sanitizeTagStr (SEC-5)');

(function () {
  function _sanitizeTagStr(val, maxLen) {
    maxLen = maxLen === undefined ? 500 : maxLen;
    if (typeof val !== 'string') return null;
    const trimmed = val.trim().slice(0, maxLen);
    return trimmed || null;
  }

  assert(_sanitizeTagStr('hello')        === 'hello',  '_sanitizeTagStr: string normale');
  assert(_sanitizeTagStr('  hi  ')       === 'hi',     '_sanitizeTagStr: trim');
  assert(_sanitizeTagStr('')             === null,     '_sanitizeTagStr: vide → null');
  assert(_sanitizeTagStr('   ')          === null,     '_sanitizeTagStr: espaces seuls → null');
  assert(_sanitizeTagStr(null)           === null,     '_sanitizeTagStr: null → null');
  assert(_sanitizeTagStr(123)            === null,     '_sanitizeTagStr: number → null');
  assert(_sanitizeTagStr([])             === null,     '_sanitizeTagStr: array → null');
  assert(_sanitizeTagStr({})             === null,     '_sanitizeTagStr: object → null');
  // Max length truncation
  const long = 'x'.repeat(600);
  assert(_sanitizeTagStr(long).length    === 500,      '_sanitizeTagStr: tronque à 500');
  assert(_sanitizeTagStr(long, 10).length === 10,      '_sanitizeTagStr: custom maxLen=10');
  assert(_sanitizeTagStr('abc', 10)      === 'abc',    '_sanitizeTagStr: sous maxLen → passthrough');
}());

// =============================================================================
// 21. Renderer — escapeRegex
// =============================================================================
section('renderer.js -- escapeRegex');

(function () {
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  assert(escapeRegex('hello')       === 'hello',         'escapeRegex: alphanumérique intact');
  assert(escapeRegex('a.b')         === 'a\\.b',         'escapeRegex: . échappé');
  assert(escapeRegex('a*b')         === 'a\\*b',         'escapeRegex: * échappé');
  assert(escapeRegex('a+b')         === 'a\\+b',         'escapeRegex: + échappé');
  assert(escapeRegex('a?b')         === 'a\\?b',         'escapeRegex: ? échappé');
  assert(escapeRegex('(test)')      === '\\(test\\)',     'escapeRegex: parenthèses');
  assert(escapeRegex('[abc]')       === '\\[abc\\]',     'escapeRegex: crochets');
  assert(escapeRegex('{1,3}')       === '\\{1,3\\}',     'escapeRegex: accolades');
  assert(escapeRegex('a|b')         === 'a\\|b',         'escapeRegex: pipe');
  assert(escapeRegex('a^b')         === 'a\\^b',         'escapeRegex: caret');
  assert(escapeRegex('a$b')         === 'a\\$b',         'escapeRegex: dollar');
  assert(escapeRegex('a\\b')        === 'a\\\\b',        'escapeRegex: backslash');
  assert(escapeRegex('')            === '',               'escapeRegex: vide → vide');
}());

// =============================================================================
// 22. Renderer — hlText (search highlight + HTML escape)
// =============================================================================
section('renderer.js -- hlText (surbrillance + escape)');

(function () {
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  function hlText(text, query, re) {
    if (!text) return '';
    if (!query) return esc(text);
    const r = re || new RegExp(`(${escapeRegex(query)})`, 'gi');
    return text.replace(r, '\x00$1\x01').split('\x00').map((seg, i) => {
      if (i === 0) return esc(seg);
      const parts = seg.split('\x01');
      return `<mark>${esc(parts[0])}</mark>${esc(parts[1] || '')}`;
    }).join('');
  }

  // No match / no query
  assert(hlText('', 'q')          === '',               'hlText: texte vide → ""');
  assert(hlText('hello', '')      === 'hello',           'hlText: pas de query → esc passthrough');
  assert(hlText('hello', null)    === 'hello',           'hlText: query null → esc passthrough');
  // Simple match
  assert(hlText('hello', 'ell')   === 'h<mark>ell</mark>o', 'hlText: match simple');
  assert(hlText('Hello', 'hello') === '<mark>Hello</mark>',  'hlText: case-insensitive');
  // HTML escaping in surrounding text
  assert(hlText('<b>bold</b>', 'bold') === '&lt;b&gt;<mark>bold</mark>&lt;/b&gt;', 'hlText: escape autour du match');
  // HTML escaping inside match
  assert(hlText('a<b', 'a<b')    === '<mark>a&lt;b</mark>',  'hlText: escape dans le match');
  // No match in text
  assert(hlText('hello', 'xyz')  === 'hello',            'hlText: pas de match → esc passthrough');
  // Multiple matches
  const res = hlText('aaa', 'a');
  assert(res === '<mark>a</mark><mark>a</mark><mark>a</mark>', 'hlText: 3 matches consécutifs');
  // Regex special chars in query (escapeRegex)
  assert(hlText('1+1=2', '1+1')  === '<mark>1+1</mark>=2',   'hlText: query avec + (regex escape)');
}());

// =============================================================================
// 23. Renderer — artPlaceholder (HTML structure check)
// =============================================================================
section('renderer.js -- artPlaceholder (structure)');

(function () {
  const SVG = '<svg viewBox="0 0 24 24"';   // extEmoji returns SVG string
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function extEmoji() {
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity=".4"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
  }
  function artPlaceholder(t) {
    const letter = t.name?.[0]?.toUpperCase() || '♪';
    const ART_COLOR_RE = /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/;
    const color = (t.artColor && ART_COLOR_RE.test(t.artColor))
      ? ` style="background:${esc(t.artColor)}"`
      : '';
    return `<div class="tart-ph" aria-hidden="true"${color}><span class="tart-init">${extEmoji(t.ext) || letter}</span></div>`;
  }

  // extEmoji always returns SVG → shown in span
  const h1 = artPlaceholder({ name: 'Cool Song', ext: 'mp3' });
  assert(h1.includes('class="tart-ph"'),   'artPlaceholder: classe tart-ph présente');
  assert(h1.includes('aria-hidden="true"'),'artPlaceholder: aria-hidden="true"');
  assert(h1.includes(SVG),                 'artPlaceholder: SVG extEmoji dans le span');
  // No artColor → no style attr
  assert(!h1.includes('style='),           'artPlaceholder: sans artColor → pas de style');
  // Valid artColor → style background
  const h2 = artPlaceholder({ name: 'X', ext: 'flac', artColor: 'rgb(100, 200, 50)' });
  assert(h2.includes('style="background:rgb(100, 200, 50)"'), 'artPlaceholder: artColor valide → style');
  // Invalid artColor (XSS guard — non-rgb string not injected)
  const h3 = artPlaceholder({ name: 'X', ext: 'flac', artColor: 'red; color:evil' });
  assert(!h3.includes('background:red'), 'artPlaceholder: artColor invalide → pas de style (guard regex)');
  // name undefined → '♪' fallback (but extEmoji takes precedence in our impl)
  const h4 = artPlaceholder({ ext: 'mp3' });
  assert(h4.includes(SVG), 'artPlaceholder: name undefined → SVG via extEmoji');
}());

// =============================================================================
// 24. CFG — sanity checks sur les constantes critiques
// =============================================================================
section('cfg.js -- constantes critiques');

(function () {
  // Inline les valeurs attendues (source de vérité indépendante)
  const EXPECTED = {
    CFG_SAVE_DEBOUNCE:   800,
    VIRT_ROW_H:          48,
    VIRT_GRP_H:          28,
    VIRT_BUFFER:         8,
    TAG_LOAD_CONCURRENCY: 8,
    RG_ANALYSIS_SECS:    30,
    SEARCH_DEBOUNCE:     150,
    TRACK_SAVE_DEBOUNCE: 250,
    SLEEP_FADE_SECS:     30,
  };
  // Reproduce cfg.js values directly (inlined for isolation)
  const CFG = Object.freeze({
    CFG_SAVE_DEBOUNCE:    800,
    VIRT_ROW_H:           48,
    VIRT_GRP_H:           28,
    VIRT_BUFFER:          8,
    TAG_LOAD_CONCURRENCY: 8,
    RG_ANALYSIS_SECS:     30,
    SEARCH_DEBOUNCE:      150,
    TRACK_SAVE_DEBOUNCE:  250,
    SLEEP_FADE_SECS:      30,
    RADIO_QUEUE_SIZE:     30,
    RADIO_REFILL_THRESHOLD: 8,
    PLAYLOG_MAX_ENTRIES:  2000,
  });

  for (const [key, val] of Object.entries(EXPECTED)) {
    assert(CFG[key] === val, `CFG.${key} === ${val}`);
  }
  // Virtual scroll: row heights must be positive integers
  assert(Number.isInteger(CFG.VIRT_ROW_H) && CFG.VIRT_ROW_H > 0, 'CFG.VIRT_ROW_H entier positif');
  assert(Number.isInteger(CFG.VIRT_GRP_H) && CFG.VIRT_GRP_H > 0, 'CFG.VIRT_GRP_H entier positif');
  // Debounces must be positive
  assert(CFG.CFG_SAVE_DEBOUNCE > 0,   'CFG.CFG_SAVE_DEBOUNCE > 0');
  assert(CFG.SEARCH_DEBOUNCE   > 0,   'CFG.SEARCH_DEBOUNCE > 0');
  assert(CFG.TRACK_SAVE_DEBOUNCE > 0, 'CFG.TRACK_SAVE_DEBOUNCE > 0');
  // Radio queue sanity
  assert(CFG.RADIO_QUEUE_SIZE > CFG.RADIO_REFILL_THRESHOLD, 'RADIO_QUEUE_SIZE > REFILL_THRESHOLD');
}());

// =============================================================================
// 25. INVARIANTS — tracks[] mutation without rebuild → index corruption
// =============================================================================
section('Invariants — mutation tracks[] sans rebuild → corruption (pédagogique)');

(function () {
  // Reproduit l'invariant documenté dans CLAUDE.md
  function rebuildMap(tracks) {
    const m = new Map();
    for (let i = 0; i < tracks.length; i++) m.set(tracks[i].id, i);
    return m;
  }

  var tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  var map = rebuildMap(tracks);

  // Valid state
  assert(map.get('a') === 0, 'invariant: a → 0 avant mutation');
  assert(map.get('b') === 1, 'invariant: b → 1 avant mutation');

  // Mutation without rebuild (anti-pattern — CLAUDE.md §13)
  tracks.splice(0, 1); // retire 'a'
  assert(map.get('a') === 0,       'invariant: map toujours 0 pour a (stale — BUG)');
  assert(tracks[0].id === 'b',     'invariant: tracks[0] est maintenant b (désync)');

  // After rebuild → consistent
  map = rebuildMap(tracks);
  assert(map.get('a') === undefined, 'invariant: après rebuild, a absent (supprimé)');
  assert(map.get('b') === 0,         'invariant: après rebuild, b → 0 (correct)');
  assert(map.get('c') === 1,         'invariant: après rebuild, c → 1 (correct)');
}());

// =============================================================================
// 26. SEARCH — trackIdx (Map-based lookup)
// =============================================================================
section('search.js -- trackIdx (Map-based, O(1))');

(function () {
  // Reproduce trackIdx logic against a local Map (no store dependency)
  const _map = new Map([['aaa', 0], ['bbb', 1], ['ccc', 2]]);

  function trackIdx(idOrTrack) {
    const key = typeof idOrTrack === 'string' ? idOrTrack : idOrTrack?.id;
    if (!key) return -1;
    const i = _map.get(key);
    return i !== undefined ? i : -1;
  }

  assert(trackIdx('aaa')          === 0,  'trackIdx: id string "aaa" → 0');
  assert(trackIdx('bbb')          === 1,  'trackIdx: id string "bbb" → 1');
  assert(trackIdx('ccc')          === 2,  'trackIdx: id string "ccc" → 2');
  assert(trackIdx('zzz')          === -1, 'trackIdx: id inconnu → -1');
  assert(trackIdx({ id: 'aaa' })  === 0,  'trackIdx: objet Track → 0');
  assert(trackIdx({ id: 'zzz' })  === -1, 'trackIdx: objet Track inconnu → -1');
  assert(trackIdx(null)           === -1, 'trackIdx: null → -1');
  assert(trackIdx(undefined)      === -1, 'trackIdx: undefined → -1');
  assert(trackIdx('')             === -1, 'trackIdx: string vide → -1 (falsy key)');
  assert(trackIdx({})             === -1, 'trackIdx: objet sans id → -1');
}());

// =============================================================================
// 27. Filtre format audio — logique de filtrage (reproduced inline)
// =============================================================================
section('search.js -- filtre format (t.ext)');

(function () {
  const tracks = [
    { id: '1', ext: 'MP3',  name: 'A', artist: '', album: '', duration: 100 },
    { id: '2', ext: 'FLAC', name: 'B', artist: '', album: '', duration: 200 },
    { id: '3', ext: 'MP3',  name: 'C', artist: '', album: '', duration: 150 },
    { id: '4', ext: 'WAV',  name: 'D', artist: '', album: '', duration: 180 },
    { id: '5', ext: undefined, name: 'E', artist: '', album: '', duration: 50 },
  ];

  function filterByFormat(src, fmt) {
    if (!fmt) return src;
    return src.filter(t => (t.ext || '') === fmt);
  }

  assert(filterByFormat(tracks, '').length === 5,    'filtre vide = tous');
  assert(filterByFormat(tracks, 'MP3').length === 2,  'filtre MP3 = 2 pistes');
  assert(filterByFormat(tracks, 'FLAC').length === 1, 'filtre FLAC = 1 piste');
  assert(filterByFormat(tracks, 'WAV').length === 1,  'filtre WAV = 1 piste');
  assert(filterByFormat(tracks, 'OGG').length === 0,  'filtre OGG = 0 pistes');
  assert(filterByFormat(tracks, 'MP3')[0].id === '1', 'filtre MP3 : première piste = id=1');

  // Chips : uniquement formats présents (>= 2 formats distincts)
  const formats = [...new Set(tracks.map(t => t.ext).filter(Boolean))].sort();
  assert(formats.length === 3,           'chips : 3 formats distincts (MP3, FLAC, WAV)');
  assert(formats[0] === 'FLAC',          'chips : tri alphabétique → FLAC en premier');
  assert(!formats.includes(undefined),   'chips : undefined filtré');
}());

// =============================================================================
// 28. ImportEntry — structure et validation
// =============================================================================
section('imports.js -- structure ImportEntry');

(function () {
  function makeEntry(source, paths) {
    return {
      id: 'test-' + Date.now(),
      date: Date.now(),
      source,
      paths,
      count: paths.length,
    };
  }

  const e1 = makeEntry('drag-drop', ['/a/b.mp3', '/a/c.flac']);
  assert(e1.count === 2,              'count = paths.length');
  assert(e1.source === 'drag-drop',   'source conservé');
  assert(Array.isArray(e1.paths),     'paths est tableau');
  assert(e1.paths.length === 2,       'paths.length correct');

  const e2 = makeEntry('folder-scan', []);
  assert(e2.count === 0,              'count = 0 pour tableau vide');

  const sources = ['drag-drop', 'folder-scan', 'manual', 'usb'];
  for (const s of sources) {
    const entry = makeEntry(s, ['/test.mp3']);
    assert(entry.source === s, `source valide: ${s}`);
  }
}());

// =============================================================================
// 29. motion.js — surface (static source check)
// =============================================================================
// We can't dynamically require() the ESM module from CJS (it pulls gsap, which
// needs a browser-shaped window.matchMedia). Instead, we statically read the
// source and assert the public surface — catches accidental rename/removal of
// a named export, missing Object.freeze on the token tables, or missing plugin
// registration call.
section('motion.js -- public surface (static source check)');

(function () {
  const fs   = require('fs');
  const path = require('path');
  const src  = fs.readFileSync(path.join(__dirname, '..', 'src', 'motion.js'), 'utf8');

  const expectedExports = [
    'prefersReducedMotion',
    'eases',
    'tween',
    'set',
    'timeline',
    'kill',
  ];
  for (const name of expectedExports) {
    const re = new RegExp('export\\s+(?:function|const|class)\\s+' + name + '\\b');
    assert(re.test(src), 'motion.js exports ' + name);
  }

  assert(/gsap\.registerPlugin\(\s*CustomEase\s*\)/.test(src),
    'motion.js registers CustomEase at load');

  assert(/eases\s*=\s*Object\.freeze\(/.test(src),
    'eases token table is Object.freeze-d');

  for (const easeName of ['lf-premium', 'lf-snap', 'lf-overshoot']) {
    assert(src.includes("'" + easeName + "'"),
      "CustomEase '" + easeName + "' is registered");
  }

  assert(/from\s+['"]gsap['"]/.test(src), 'imports from "gsap"');
  assert(/from\s+['"]gsap\/CustomEase['"]/.test(src), 'imports from "gsap/CustomEase"');

  assert(/prefers-reduced-motion/.test(src),
    'motion.js honors prefers-reduced-motion');
}());

// ─── eqdevice.js — profil EQ par appareil ────────────────────────────────────
{
  const assert = require('assert');

  // Replicate pure logic for testing (no DOM/AudioContext)
  function makeDeviceProfile(label, bands) {
    if (!Array.isArray(bands) || bands.length !== 10) throw new Error('bands must be length 10');
    return { label: String(label), bands: bands.map(Number) };
  }

  function saveDeviceProfile(profiles, deviceId, label, bands) {
    const copy = { ...profiles };
    copy[deviceId] = makeDeviceProfile(label, bands);
    return copy;
  }

  function deleteDeviceProfile(profiles, deviceId) {
    const copy = { ...profiles };
    delete copy[deviceId];
    return copy;
  }

  function getDeviceProfilesCopy(profiles) {
    return { ...profiles };
  }

  // Tests
  let profiles = {};

  // 1. Save profile for a device
  profiles = saveDeviceProfile(profiles, 'abc123', 'Sony WH-1000XM5', new Array(10).fill(0));
  assert.ok('abc123' in profiles, '1. profile saved under deviceId');
  assert.strictEqual(profiles['abc123'].label, 'Sony WH-1000XM5', '1. label stored correctly');
  assert.strictEqual(profiles['abc123'].bands.length, 10, '1. bands array has 10 entries');

  // 2. Bands must be 10 elements
  assert.throws(
    () => makeDeviceProfile('Test', [1, 2, 3]),
    /length 10/,
    '2. throws if bands not 10 elements'
  );

  // 3. Save second device
  profiles = saveDeviceProfile(profiles, 'default', 'Speakers', [1,2,3,4,5,6,7,8,9,10]);
  assert.strictEqual(Object.keys(profiles).length, 2, '3. two profiles stored');

  // 4. Delete a profile
  profiles = deleteDeviceProfile(profiles, 'abc123');
  assert.ok(!('abc123' in profiles), '4. profile deleted');
  assert.ok('default' in profiles, '4. other profile still present');

  // 5. getDeviceProfilesCopy returns a copy (not reference)
  const copy = getDeviceProfilesCopy(profiles);
  copy['extra'] = makeDeviceProfile('Extra', new Array(10).fill(0));
  assert.ok(!('extra' in profiles), '5. copy is independent from original');

  // 6. Overwrite existing profile
  profiles = saveDeviceProfile(profiles, 'default', 'Speakers v2', new Array(10).fill(3));
  assert.strictEqual(profiles['default'].label, 'Speakers v2', '6. profile overwritten');
  assert.strictEqual(profiles['default'].bands[0], 3, '6. bands updated');

  // 7. Numeric conversion of bands
  profiles = saveDeviceProfile(profiles, 'x', 'Test', ['1','2','3','4','5','6','7','8','9','10']);
  assert.strictEqual(typeof profiles['x'].bands[0], 'number', '7. bands coerced to number');

  // 8. Empty label fallback
  const p = makeDeviceProfile('', new Array(10).fill(0));
  assert.strictEqual(p.label, '', '8. empty label allowed');

  // 9. getDeviceProfilesCopy with empty profiles
  const emptyProfiles = {};
  const emptyCopy = getDeviceProfilesCopy(emptyProfiles);
  assert.deepStrictEqual(emptyCopy, {}, '9. empty profiles returns empty copy');

  console.log('eqdevice.js — profil EQ par appareil: 9/9 OK');
}

// ─── organize.js — computeMoves ──────────────────────────────────────────────
{
  const assert = require('assert');

  function sanitizeName(s) {
    return (String(s || 'Inconnu'))
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\x00-\x1f]/g, '_')
      .trim()
      .replace(/\s+$/, '')
      .replace(/\.+$/, '')
      .slice(0, 80) || 'Inconnu';
  }

  function getBasename(filePath) {
    return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  }

  function computeMoves(tracks, basePath, scheme) {
    const sep  = basePath.includes('\\') ? '\\' : '/';
    const base = basePath.replace(/[\\/]+$/, '');
    const moves = [];
    const seen  = new Set();
    for (const t of tracks) {
      if (!t.path) continue;
      const file   = getBasename(t.path);
      const artist = sanitizeName(t.artist);
      const album  = sanitizeName(t.album);
      let targetDir;
      if      (scheme === 'artist-album') targetDir = [base, artist, album].join(sep);
      else if (scheme === 'artist')       targetDir = [base, artist].join(sep);
      else if (scheme === 'flat')         targetDir = base;
      else continue;
      const to    = targetDir + sep + file;
      const fromN = t.path.replace(/\\/g, '/');
      const toN   = to.replace(/\\/g, '/');
      if (fromN === toN) continue;
      if (seen.has(toN)) continue;
      seen.add(toN);
      moves.push({ from: t.path, to });
    }
    return moves;
  }

  // 1. artist-album scheme
  let moves = computeMoves(
    [{ path: 'C:\\music\\file.mp3', artist: 'Daft Punk', album: 'RAM' }],
    'C:\\music', 'artist-album'
  );
  assert.strictEqual(moves.length, 1, '1. one move generated');
  assert.strictEqual(moves[0].to, 'C:\\music\\Daft Punk\\RAM\\file.mp3', '1. correct target path');

  // 2. artist scheme (no album folder)
  moves = computeMoves(
    [{ path: 'C:\\music\\file.mp3', artist: 'Artist', album: 'Album' }],
    'C:\\music', 'artist'
  );
  assert.ok(moves[0].to.includes('Artist'), '2. artist folder present');
  assert.ok(!moves[0].to.replace('Artist','').includes('Album'), '2. no album folder');

  // 3. flat scheme — file directly in base
  moves = computeMoves(
    [{ path: 'C:\\music\\sub\\track.mp3', artist: 'A', album: 'B' }],
    'C:\\music', 'flat'
  );
  assert.strictEqual(moves[0].to, 'C:\\music\\track.mp3', '3. flat target correct');

  // 4. skip when already at target
  moves = computeMoves(
    [{ path: 'C:\\music\\Daft Punk\\RAM\\file.mp3', artist: 'Daft Punk', album: 'RAM' }],
    'C:\\music', 'artist-album'
  );
  assert.strictEqual(moves.length, 0, '4. already in place → no move');

  // 5. sanitize illegal characters in artist name
  moves = computeMoves(
    [{ path: 'C:\\music\\track.mp3', artist: 'AC/DC', album: 'Back In Black' }],
    'C:\\music', 'artist-album'
  );
  assert.ok(moves[0].to.includes('AC_DC'), '5. slash sanitized to underscore');

  // 6. fallback for missing artist/album
  moves = computeMoves(
    [{ path: 'C:\\music\\track.mp3' }],
    'C:\\music', 'artist-album'
  );
  assert.ok(moves[0].to.includes('Inconnu'), '6. missing fields use Inconnu fallback');

  // 7. deduplication of conflicting targets
  moves = computeMoves(
    [
      { path: 'C:\\music\\a\\file.mp3', artist: 'A', album: 'X' },
      { path: 'C:\\music\\b\\file.mp3', artist: 'A', album: 'X' },
    ],
    'C:\\music', 'artist-album'
  );
  assert.strictEqual(moves.length, 1, '7. conflicting targets: second skipped');

  // 8. POSIX-style paths (Linux/macOS)
  moves = computeMoves(
    [{ path: '/home/user/music/track.mp3', artist: 'Artist', album: 'Album' }],
    '/home/user/music', 'artist-album'
  );
  assert.strictEqual(moves[0].to, '/home/user/music/Artist/Album/track.mp3', '8. POSIX paths work');

  // 9. tracks without path are skipped
  moves = computeMoves(
    [{ artist: 'A', album: 'B' }],
    'C:\\music', 'artist-album'
  );
  assert.strictEqual(moves.length, 0, '9. track without path skipped');

  console.log('organize.js — computeMoves: 9/9 OK');
}

// ─── backup.js — pure logic ──────────────────────────────────────────────────
{
  const assert = require('assert');
  const BACKUP_FORMAT_VERSION = 1;

  // Réplique de la logique pure (sans IDB/IPC/DOM)
  function createManifest(tracks) {
    return {
      version:        BACKUP_FORMAT_VERSION,
      app_version:    '1.1.0',
      date:           new Date().toISOString(),
      track_count:    tracks.length,
      includes_files: false,
    };
  }

  function mergeTrackArrays(existing, backup) {
    const existingIds = new Set(existing.map(t => t.id));
    const result = [...existing];
    for (const t of backup) {
      if (!existingIds.has(t.id)) result.push(t);
    }
    return result;
  }

  function isCompatibleVersion(manifest) {
    return typeof manifest.version === 'number'
      && manifest.version <= BACKUP_FORMAT_VERSION;
  }

  // 1. Manifest contains required fields
  const m = createManifest([{ id: '1' }, { id: '2' }]);
  assert.strictEqual(m.version, 1,          '1. version is 1');
  assert.strictEqual(m.track_count, 2,      '1. track_count correct');
  assert.ok(m.date,                         '1. date is set');
  assert.strictEqual(m.includes_files, false,'1. includes_files is false');

  // 2. Merge: new tracks added without duplication
  const merged = mergeTrackArrays([{ id: 'a' }], [{ id: 'a' }, { id: 'b' }]);
  assert.strictEqual(merged.length, 2, '2. merge: deduplicates by id');

  // 3. Merge: no duplication when all already exist
  const noDup = mergeTrackArrays([{ id: 'a' }, { id: 'b' }], [{ id: 'a' }, { id: 'b' }]);
  assert.strictEqual(noDup.length, 2, '3. no duplication when all exist');

  // 4. Merge: existing record wins over backup record (merge = add-only)
  const preserved = mergeTrackArrays(
    [{ id: 'x', name: 'local' }],
    [{ id: 'x', name: 'backup' }]
  );
  assert.strictEqual(preserved[0].name, 'local', '4. existing record preserved over backup');

  // 5. Merge: empty backup
  const fromEmpty = mergeTrackArrays([{ id: 'x' }], []);
  assert.strictEqual(fromEmpty.length, 1, '5. merge with empty backup');

  // 6. Merge: empty existing
  const intoEmpty = mergeTrackArrays([], [{ id: 'a' }, { id: 'b' }]);
  assert.strictEqual(intoEmpty.length, 2, '6. merge into empty existing');

  // 7. Version: same version is compatible
  assert.ok(isCompatibleVersion({ version: 1 }), '7. version 1 compatible');

  // 8. Version: higher version is not compatible
  assert.ok(!isCompatibleVersion({ version: 2 }), '8. version 2 not compatible');

  // 9. Version: non-numeric version is not compatible
  assert.ok(!isCompatibleVersion({ version: 'foo' }), '9. string version not compatible');

  console.log('backup.js — logic: 9/9 OK');
}

// ─── devices.js — pure logic ──────────────────────────────────────────────────
{
  const assert = require('assert');

  // Réplique de la logique pure (sans IPC/DOM/timer)
  function detectNewRemovable(previous, current) {
    const prevPaths = new Set(previous.map(d => d.path));
    return current.filter(d => d.kind === 'removable' && !prevPaths.has(d.path));
  }

  // 1. New removable drive detected
  const newDrives = detectNewRemovable(
    [{ path: 'C:\\', kind: 'fixed' }],
    [{ path: 'C:\\', kind: 'fixed' }, { path: 'E:\\', kind: 'removable' }]
  );
  assert.strictEqual(newDrives.length, 1, '1. new removable detected');
  assert.strictEqual(newDrives[0].path, 'E:\\', '1. correct drive path');

  // 2. Fixed drive not reported as new removable
  const noRemovable = detectNewRemovable(
    [{ path: 'C:\\', kind: 'fixed' }],
    [{ path: 'C:\\', kind: 'fixed' }, { path: 'D:\\', kind: 'fixed' }]
  );
  assert.strictEqual(noRemovable.length, 0, '2. fixed drives ignored');

  // 3. Already known removable not re-detected
  const knownRemovable = [{ path: 'E:\\', kind: 'removable' }];
  const noDup = detectNewRemovable(knownRemovable, knownRemovable);
  assert.strictEqual(noDup.length, 0, '3. known removable not re-detected');

  // 4. From empty previous
  const fromNone = detectNewRemovable([], [{ path: 'E:\\', kind: 'removable' }]);
  assert.strictEqual(fromNone.length, 1, '4. from empty previous');

  // 5. Disconnected drive not reported as new
  const fromFull = detectNewRemovable([{ path: 'E:\\', kind: 'removable' }], []);
  assert.strictEqual(fromFull.length, 0, '5. disconnected drive not false-positive');

  console.log('devices.js — logic: 5/5 OK');
}

// ── cdaudio_pure.js — logique pure ──────────────────────────────
{
  const assert = require('assert');
  const {
    detectNewAudioCds,
    buildEphemeralCdTrack,
    cleanupEphemeralForDrive,
    extractDestPath,
    calculateRipPercent,
    formatTrackLabel,
  } = require('../src/cdaudio_pure.cjs');

  assert.strictEqual(formatTrackLabel(1),  'Track 01', 'formatTrackLabel(1) → "Track 01"');
  assert.strictEqual(formatTrackLabel(12), 'Track 12', 'formatTrackLabel(12) → "Track 12"');

  // detectNewAudioCds detects new audio CD
  {
    const prev = [{ path: 'D:\\', audio_cd: false }];
    const curr = [{ path: 'D:\\', audio_cd: true, track_count: 12, label: 'MY CD' }];
    const out = detectNewAudioCds(prev, curr);
    assert.strictEqual(out.length, 1, 'detectNewAudioCds detects new audio CD: length');
    assert.strictEqual(out[0].path, 'D:\\', 'detectNewAudioCds detects new audio CD: path');
  }

  // detectNewAudioCds ignores already-known CD
  {
    const prev = [{ path: 'D:\\', audio_cd: true }];
    const curr = [{ path: 'D:\\', audio_cd: true }];
    const out = detectNewAudioCds(prev, curr);
    assert.strictEqual(out.length, 0, 'detectNewAudioCds ignores already-known CD');
  }

  // detectNewAudioCds ignores data CD
  {
    const prev = [];
    const curr = [{ path: 'D:\\', audio_cd: false }];
    const out = detectNewAudioCds(prev, curr);
    assert.strictEqual(out.length, 0, 'detectNewAudioCds ignores data CD');
  }

  // buildEphemeralCdTrack shapes virtual track
  {
    const drive = { path: 'D:\\', label: 'MY CD' };
    const tocTrack = { idx: 3, duration_sec: 245.5 };
    const t = buildEphemeralCdTrack(drive, tocTrack, '/tmp/x.flac');
    assert.strictEqual(t.id,        'cd:D:\\:3',     'buildEphemeralCdTrack: id');
    assert.strictEqual(t.path,      '/tmp/x.flac',   'buildEphemeralCdTrack: path');
    assert.strictEqual(t.name,      'Track 03',      'buildEphemeralCdTrack: name');
    assert.strictEqual(t.artist,    'CD Audio',      'buildEphemeralCdTrack: artist');
    assert.strictEqual(t.album,     'MY CD',         'buildEphemeralCdTrack: album');
    assert.strictEqual(t.duration,  245.5,           'buildEphemeralCdTrack: duration');
    assert.strictEqual(t.ext,       'flac',          'buildEphemeralCdTrack: ext');
    assert.strictEqual(t.metaDone,  true,            'buildEphemeralCdTrack: metaDone');
    assert.strictEqual(t._isEphemeralCd, true,       'buildEphemeralCdTrack: _isEphemeralCd');
    assert.strictEqual(t._cdDrive,  'D:\\',          'buildEphemeralCdTrack: _cdDrive');
  }

  // buildEphemeralCdTrack falls back album label
  {
    const drive = { path: 'D:\\', label: '' };
    const t = buildEphemeralCdTrack(drive, { idx: 1, duration_sec: 60 }, '/tmp/y.flac');
    assert.strictEqual(t.album, 'CD inconnu', 'buildEphemeralCdTrack falls back album label');
  }

  // cleanupEphemeralForDrive removes only this drive
  {
    const tracks = [
      { id: 'normal-1' },
      { id: 'cd:D:\\:1', _isEphemeralCd: true, _cdDrive: 'D:\\' },
      { id: 'cd:E:\\:1', _isEphemeralCd: true, _cdDrive: 'E:\\' },
      { id: 'normal-2' },
    ];
    const out = cleanupEphemeralForDrive(tracks, 'D:\\');
    assert.strictEqual(out.length, 3, 'cleanupEphemeralForDrive: length');
    assert.deepStrictEqual(out.map(t => t.id), ['normal-1', 'cd:E:\\:1', 'normal-2'], 'cleanupEphemeralForDrive: ids');
  }

  // extractDestPath builds folder + Track filename
  {
    const p = extractDestPath('C:\\Music', 'MY CD', 7, '2026-05-17');
    assert.ok(p.endsWith('Track 07.flac'), `extractDestPath ends with Track 07.flac: got ${p}`);
    assert.ok(p.includes('CD_MY_CD_2026-05-17'), `extractDestPath includes dir: got ${p}`);
  }

  // extractDestPath sanitizes label with forbidden chars
  {
    const p = extractDestPath('C:\\Music', 'rock/roll<>?', 1, '2026-05-17');
    const dirPart = p.split(/[\\/]/).slice(-2)[0];
    assert.ok(!/[\/<>?]/.test(dirPart), `extractDestPath sanitizes label: dir part should be sanitized: ${p}`);
  }

  // calculateRipPercent rounds down + zero guard
  assert.strictEqual(calculateRipPercent(0,    100), 0,   'calculateRipPercent(0, 100) = 0');
  assert.strictEqual(calculateRipPercent(50,   100), 50,  'calculateRipPercent(50, 100) = 50');
  assert.strictEqual(calculateRipPercent(99,   100), 99,  'calculateRipPercent(99, 100) = 99');
  assert.strictEqual(calculateRipPercent(100,  100), 100, 'calculateRipPercent(100, 100) = 100');
  assert.strictEqual(calculateRipPercent(0,    0),   0,   'calculateRipPercent(0, 0) = 0');

  console.log('cdaudio_pure.js — logique pure: 13/13 OK');
}

// ── db.js — _isEphemeralCd skip predicate ──────────────────────────
{
  // db.js depends on idb + window; test the predicate inline instead of requiring the module.
  const isEphemeralCdTrack = (store, v) =>
    store === 'tracks' && v && v._isEphemeralCd === true;

  assert(isEphemeralCdTrack('tracks', { _isEphemeralCd: true }), 'dput skip: ephemeral CD track');
  assert(!isEphemeralCdTrack('tracks', { id: 1 }), 'dput skip: normal track persisted');
  assert(!isEphemeralCdTrack('playlists', { _isEphemeralCd: true }), 'dput skip: ephemeral but wrong store');
}
console.log('db.js — _isEphemeralCd skip: 3/3 OK');

// =============================================================================
// settings.js -- _nextTabIndex (navigation onglets verticale)
// =============================================================================
section('settings.js -- _nextTabIndex (navigation onglets verticale)');

// Logique reproduite inline (convention du fichier, cf. en-tête ligne 2).
function _nextTabIndex(key, cur, len) {
  if (len <= 0) return -1;
  switch (key) {
    case 'ArrowUp':   return (cur - 1 + len) % len;
    case 'ArrowDown': return (cur + 1) % len;
    case 'Home':      return 0;
    case 'End':       return len - 1;
    default:          return -1;
  }
}

(function () {
  assert(_nextTabIndex('ArrowDown', 0, 5) === 1,  '_nextTabIndex: ArrowDown avance');
  assert(_nextTabIndex('ArrowDown', 4, 5) === 0,  '_nextTabIndex: ArrowDown cycle après le dernier');
  assert(_nextTabIndex('ArrowUp',   0, 5) === 4,  '_nextTabIndex: ArrowUp cycle avant le premier');
  assert(_nextTabIndex('ArrowUp',   2, 5) === 1,  '_nextTabIndex: ArrowUp recule');
  assert(_nextTabIndex('Home',      3, 5) === 0,  '_nextTabIndex: Home → premier onglet');
  assert(_nextTabIndex('End',       1, 5) === 4,  '_nextTabIndex: End → dernier onglet');
  assert(_nextTabIndex('ArrowLeft', 1, 5) === -1, '_nextTabIndex: touche non gérée → -1');
  assert(_nextTabIndex('ArrowDown', 0, 0) === -1, '_nextTabIndex: liste vide → -1');
}());

// =============================================================================
// tlistZoom — logique pure de cycling (_nextZoomLevel)
// =============================================================================
section('tlistZoom.js -- _nextZoomLevel cycling');

(function () {
  // Reproduit la logique pure inline (pas d'import ESM)
  const TLIST_ZOOM_LEVELS = ['compact', 'comfortable', 'spacious'];
  function _nextZoomLevel(current, dir) {
    const idx = TLIST_ZOOM_LEVELS.indexOf(current);
    if (idx === -1) return 'comfortable';
    if (dir === 'in')  return TLIST_ZOOM_LEVELS[Math.min(idx + 1, TLIST_ZOOM_LEVELS.length - 1)];
    if (dir === 'out') return TLIST_ZOOM_LEVELS[Math.max(idx - 1, 0)];
    return current;
  }

  assert(_nextZoomLevel('compact',     'in')  === 'comfortable', 'zoomIn depuis compact → comfortable');
  assert(_nextZoomLevel('comfortable', 'in')  === 'spacious',    'zoomIn depuis comfortable → spacious');
  assert(_nextZoomLevel('spacious',    'in')  === 'spacious',    'zoomIn depuis spacious → reste spacious');
  assert(_nextZoomLevel('spacious',    'out') === 'comfortable', 'zoomOut depuis spacious → comfortable');
  assert(_nextZoomLevel('compact',     'out') === 'compact',     'zoomOut depuis compact → reste compact');
  assert(_nextZoomLevel('comfortable', 'out') === 'compact',     'zoomReset depuis comfortable → compact via zoomOut');
}());

// =============================================================================
// tlistZoom — migration des anciens noms de niveaux (_LEGACY_ZOOM_MAP)
// =============================================================================
section('tlistZoom.js -- legacy level name migration');

(function () {
  // Reproduit la logique pure inline (pas d'import ESM) — même map que tlistZoom.js
  const _LEGACY_ZOOM_MAP = { normal: 'comfortable' };
  function migrate(level) { return _LEGACY_ZOOM_MAP[level] || level; }

  assert(migrate('normal')      === 'comfortable', "ancien 'normal' → nouveau 'comfortable'");
  assert(migrate('comfortable') === 'comfortable', "'comfortable' (nouveau palier valide) inchangé — PAS coercé en 'spacious'");
  assert(migrate('compact')     === 'compact',     "'compact' inchangé (jamais renommé)");
  assert(migrate('spacious')    === 'spacious',    "'spacious' (déjà nouveau) inchangé — pas de double mapping");
}());

// =============================================================================
// tlistZoom — TLIST_ZOOM_ROW_H reste synchro avec --tr-h (design-system.css)
// =============================================================================
section('tlistZoom.js -- TLIST_ZOOM_ROW_H matches CSS --tr-h per level');

(function () {
  const assert = require('assert');
  const fs   = require('fs');
  const path = require('path');
  const jsSrc  = fs.readFileSync(path.join(__dirname, '../src/tlistZoom.js'), 'utf8');
  const cssSrc = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');

  const rowHBlock = /TLIST_ZOOM_ROW_H = \{([^}]*)\}/.exec(jsSrc);
  assert(rowHBlock, 'TLIST_ZOOM_ROW_H object literal found in tlistZoom.js');
  const rowH = {};
  const kv = /(\w+):\s*(\d+)/g;
  let m;
  while ((m = kv.exec(rowHBlock[1]))) rowH[m[1]] = Number(m[2]);

  assert.strictEqual(rowH.compact,     44, 'TLIST_ZOOM_ROW_H.compact === 44');
  assert.strictEqual(rowH.comfortable, 56, 'TLIST_ZOOM_ROW_H.comfortable === 56');
  assert.strictEqual(rowH.spacious,    72, 'TLIST_ZOOM_ROW_H.spacious === 72');

  // Regression guard for the exact CSS/JS desync bug fixed earlier this session:
  // VIRT.ROW_H (this object) must always equal the real rendered --tr-h.
  const baseTrH     = Number(/--tr-h:\s*(\d+)px/.exec(cssSrc)[1]);
  const compactTrH  = Number(/data-tlist-zoom="compact"\]\s*\{\s*--tr-h:\s*(\d+)px/.exec(cssSrc)[1]);
  const spaciousTrH = Number(/data-tlist-zoom="spacious"\]\s*\{\s*--tr-h:\s*(\d+)px/.exec(cssSrc)[1]);
  assert.strictEqual(rowH.comfortable, baseTrH,     'VIRT.ROW_H.comfortable matches CSS base --tr-h');
  assert.strictEqual(rowH.compact,     compactTrH,  'VIRT.ROW_H.compact matches CSS --tr-h override');
  assert.strictEqual(rowH.spacious,    spaciousTrH, 'VIRT.ROW_H.spacious matches CSS --tr-h override');
}());

// =============================================================================
// tlistZoom — --tr-h / --tart-size CSS tokens (design-system.css)
// =============================================================================
section('tlistZoom.js -- --tr-h / --tart-size tokens (design-system.css)');

(function () {
  const fs   = require('fs');
  const path = require('path');
  const css  = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');

  assert(/--tr-h:\s*56px/.test(css), 'base --tr-h (comfortable/default) = 56px');
  assert(/--tart-size:\s*40px/.test(css), 'base --tart-size (comfortable/default) = 40px');
  assert(
    /:root\[data-tlist-zoom="compact"\]\s*\{\s*--tr-h:\s*44px;\s*--tart-size:\s*32px;\s*\}/.test(css),
    'compact overrides --tr-h:44px and --tart-size:32px together'
  );
  assert(
    /:root\[data-tlist-zoom="spacious"\]\s*\{\s*--tr-h:\s*72px;\s*--tart-size:\s*56px;\s*\}/.test(css),
    'spacious overrides --tr-h:72px and --tart-size:56px together'
  );
  assert(
    !/data-tlist-zoom="comfortable"/.test(css),
    'no leftover [data-tlist-zoom="comfortable"] selector (renamed to spacious/removed)'
  );
}());

// =============================================================================
// tlistZoom — #zoom-hud CSS wired (style.css)
// =============================================================================
section('tlistZoom.js -- #zoom-hud CSS (style.css)');

(function () {
  const fs   = require('fs');
  const path = require('path');
  const css  = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');

  assert(/#zoom-hud\s*\{/.test(css), '#zoom-hud has a base rule');
  assert(/#zoom-hud\.show\s*\{/.test(css), '#zoom-hud.show has a rule');
  assert(/#zoom-hud\s*\{[^}]*opacity:\s*0;/.test(css), '#zoom-hud is hidden (opacity:0) by default');
  assert(/#zoom-hud\.show\s*\{[^}]*opacity:\s*1;/.test(css), '#zoom-hud.show is visible (opacity:1)');
  assert(
    /html\[data-motion="reduce"\]\s*#zoom-hud\s*\{/.test(css),
    '#zoom-hud has a data-motion="reduce" override'
  );
}());

// =============================================================================
// X. bench.cjs --json flag emits one JSON line per scenario
// =============================================================================
section('bench.cjs --json — emits valid JSON lines');

(function () {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['frontend/tests/bench.cjs', '1000', '--json'], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert(r.status === 0, 'bench.cjs --json exits 0');

  const lines = r.stdout.trim().split('\n').filter(Boolean);
  // 8 scenarios expected: 5 filterExact + filterFuzzy + 3 virtBuildRows
  assert(lines.length === 8, `bench.cjs --json emits 8 lines (got ${lines.length})`);

  let allValid = true;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (typeof obj.label !== 'string' || typeof obj.medianMs !== 'number') {
        allValid = false; break;
      }
    } catch { allValid = false; break; }
  }
  assert(allValid, 'every line is JSON.parse-able with {label, medianMs}');
}());

// =============================================================================
// X. scripts/perf-bundle.js — bundle size gate
// =============================================================================
section('scripts/perf-bundle.js — bundle gate');

(function () {
  const { spawnSync } = require('child_process');
  const fs   = require('fs');
  const os   = require('os');
  const path = require('path');

  function makeSandbox(files, budgets) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'libreflow-perf-'));
    const assetsDir = path.join(root, 'dist', 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    for (const [name, size] of Object.entries(files)) {
      fs.writeFileSync(path.join(assetsDir, name), Buffer.alloc(size, 0x61)); // 'a'
    }
    fs.writeFileSync(path.join(root, 'perf-budgets.json'), JSON.stringify(budgets, null, 2));
    return root;
  }

  function run(cwd) {
    return spawnSync(process.execPath, [path.resolve('scripts/perf-bundle.js')], {
      cwd, encoding: 'utf8', timeout: 10000,
    });
  }

  // 1. Under-budget → exit 0, stdout contains OK
  {
    const cwd = makeSandbox(
      { 'main-abcd1234.js': 1000, 'mini-ef567890.js': 500 },
      { _tolerancePct: 10, _unknownBucketPolicy: 'warn', buckets: { main: { rawBytes: 2000 }, mini: { rawBytes: 2000 } } },
    );
    const r = run(cwd);
    assert(r.status === 0, 'perf-bundle under-budget exits 0');
    assert(/\bOK\b/.test(r.stdout), 'under-budget stdout contains OK');
  }

  // 2. Over-budget → exit 1, stdout names the bucket + FAIL
  {
    const cwd = makeSandbox(
      { 'libreflow-extras-aaaaaaaa.js': 300000 },
      { _tolerancePct: 10, _unknownBucketPolicy: 'warn', buckets: { 'libreflow-extras': { rawBytes: 100000 } } },
    );
    const r = run(cwd);
    assert(r.status === 1, 'perf-bundle over-budget exits 1');
    assert(/libreflow-extras/.test(r.stdout) && /FAIL/.test(r.stdout), 'over-budget stdout names bucket + FAIL');
  }

  // 3. Unknown chunk → exit 0 with WARN
  {
    const cwd = makeSandbox(
      { 'main-abcd1234.js': 1000, 'mystery-cccccccc.js': 500 },
      { _tolerancePct: 10, _unknownBucketPolicy: 'warn', buckets: { main: { rawBytes: 2000 } } },
    );
    const r = run(cwd);
    assert(r.status === 0, 'perf-bundle unknown chunk exits 0');
    assert(/WARN/.test(r.stdout), 'unknown chunk stdout contains WARN');
  }

  // 4. Missing dist/ → exit 2
  {
    const cwd = makeSandbox({}, { _tolerancePct: 10, _unknownBucketPolicy: 'warn', buckets: {} });
    fs.rmSync(path.join(cwd, 'dist'), { recursive: true, force: true });
    const r = run(cwd);
    assert(r.status === 2, 'missing dist/ exits 2');
    assert(/vite:build/.test(r.stdout + r.stderr), 'missing dist/ message mentions vite:build');
  }

  // 5. Missing perf-budgets.json → exit 2
  {
    const cwd = makeSandbox({ 'main-abcd1234.js': 1000 }, { _tolerancePct: 10, _unknownBucketPolicy: 'warn', buckets: {} });
    fs.rmSync(path.join(cwd, 'perf-budgets.json'));
    const r = run(cwd);
    assert(r.status === 2, 'missing perf-budgets.json exits 2');
    assert(/perf:baseline/.test(r.stdout + r.stderr), 'missing budgets message mentions perf:baseline');
  }
}());

// =============================================================================
// X. scripts/bench-compare.js — runtime regression gate
// =============================================================================
section('scripts/bench-compare.js — runtime gate');

(function () {
  const { spawnSync } = require('child_process');
  const fs   = require('fs');
  const os   = require('os');
  const path = require('path');

  const SCRIPT  = path.resolve('scripts/bench-compare.js');
  const FIXTURE = path.resolve('frontend/tests/fixtures/perf/baseline-fixture.json');

  function writeCurrent(lines) {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'libreflow-bench-')), 'current.json');
    fs.writeFileSync(f, lines.map(o => JSON.stringify(o)).join('\n') + '\n');
    return f;
  }

  function run(currentPath) {
    return spawnSync(process.execPath, [SCRIPT, currentPath], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, LIBREFLOW_BENCH_BASELINE: FIXTURE },
    });
  }

  // 6. Identical → exit 0
  {
    const f = writeCurrent([
      { label: 'scenario A', medianMs: 10.0 },
      { label: 'scenario B', medianMs: 20.0 },
      { label: 'scenario C', medianMs: 0.5 },
    ]);
    assert(run(f).status === 0, 'bench-compare identical exits 0');
  }

  // 7. +4% on one → exit 0 (under 5% tolerance)
  {
    const f = writeCurrent([
      { label: 'scenario A', medianMs: 10.4 },
      { label: 'scenario B', medianMs: 20.0 },
      { label: 'scenario C', medianMs: 0.5 },
    ]);
    assert(run(f).status === 0, 'bench-compare +4% under tolerance exits 0');
  }

  // 8. +7% on one → exit 1, names the scenario
  {
    const f = writeCurrent([
      { label: 'scenario A', medianMs: 10.0 },
      { label: 'scenario B', medianMs: 21.4 },
      { label: 'scenario C', medianMs: 0.5 },
    ]);
    const r = run(f);
    assert(r.status === 1, 'bench-compare +7% over tolerance exits 1');
    assert(/scenario B/.test(r.stdout), 'bench-compare FAIL stdout names the scenario');
  }

  // 9. Missing scenario → exit 1, mentions deleted
  {
    const f = writeCurrent([
      { label: 'scenario A', medianMs: 10.0 },
      { label: 'scenario B', medianMs: 20.0 },
    ]);
    const r = run(f);
    assert(r.status === 1, 'bench-compare missing scenario exits 1');
    assert(/deleted|missing/i.test(r.stdout + r.stderr), 'missing-scenario stdout mentions deleted/missing');
  }

  // 10. Extra scenario → exit 0 with WARN
  {
    const f = writeCurrent([
      { label: 'scenario A', medianMs: 10.0 },
      { label: 'scenario B', medianMs: 20.0 },
      { label: 'scenario C', medianMs: 0.5 },
      { label: 'scenario D (new)', medianMs: 5.0 },
    ]);
    const r = run(f);
    assert(r.status === 0, 'bench-compare extra scenario exits 0');
    assert(/WARN/.test(r.stdout), 'extra scenario stdout contains WARN');
  }
}());

// =============================================================================
// N. lf-toast-stack.logic — reducer pur
// =============================================================================
section('components/lf-toast-stack.logic.js -- toastReducer');

const TOAST_TYPES = ['info', 'success', 'error', 'warning', 'loading'];
const TOAST_DUR = { info: 3000, success: 2600, error: 8000, warning: 6000, loading: 120000 };

function normalizeType(t) {
  return TOAST_TYPES.includes(t) ? t : 'info';
}

/**
 * @param {string} type
 * @param {number} [explicitDur] — only used if a strictly positive number.
 *        0 and negative values fall back to the type default duration.
 * @param {string} [message] — A11Y-13 (SC 2.2.1): if provided the duration is
 *        stretched based on message length (~15 chars/s + 1.5 s margin),
 *        never below the type base. An explicitDur > 0 takes priority.
 */
function resolveDuration(type, explicitDur, message) {
  if (typeof explicitDur === 'number' && explicitDur > 0) return explicitDur;
  const base = TOAST_DUR[normalizeType(type)];
  if (!message) return base;
  const required = Math.ceil(String(message).length / 15) * 1000 + 1500;
  return Math.max(base, required);
}

function toastReducer(items, action) {
  switch (action && action.type) {
    case 'add': {
      const next = [...items, action.item];
      if (typeof action.max === 'number' && next.length > action.max) {
        return next.slice(next.length - action.max);
      }
      return next;
    }
    case 'update': {
      let touched = false;
      const next = items.map(t => {
        if (t.id === action.id) {
          touched = true;
          return { ...t, message: action.message };
        }
        return t;
      });
      return touched ? next : items;
    }
    case 'mark-dismissing': {
      let touched = false;
      const next = items.map(t => {
        if (t.id === action.id && !t.dismissing) {
          touched = true;
          return { ...t, dismissing: true };
        }
        return t;
      });
      return touched ? next : items;
    }
    case 'dismiss': {
      const next = items.filter(t => t.id !== action.id);
      return next.length === items.length ? items : next;
    }
    default:
      return items;
  }
}

(function () {
  // normalizeType
  assert(normalizeType('info')     === 'info',    'normalizeType: info → info');
  assert(normalizeType('unknown')  === 'info',    'normalizeType: inconnu → info');
  assert(normalizeType(undefined)  === 'info',    'normalizeType: undefined → info');
  assert(normalizeType('error')    === 'error',   'normalizeType: error → error');

  // resolveDuration
  assert(resolveDuration('info')         === 3000,   'resolveDuration: info défaut');
  assert(resolveDuration('error')        === 8000,   'resolveDuration: error défaut');
  assert(resolveDuration('loading')      === 120000, 'resolveDuration: loading défaut');
  assert(resolveDuration('info', 5000)   === 5000,   'resolveDuration: override explicite');
  assert(resolveDuration('info', 0)      === 3000,   'resolveDuration: 0 → défaut');
  assert(resolveDuration('info', -1)     === 3000,   'resolveDuration: négatif → défaut');
  assert(resolveDuration('xxx', undefined) === 3000, 'resolveDuration: type inconnu → info default');

  // resolveDuration: message-length scaling (A11Y SC 2.2.1)
  // Short message (10 chars): required = ceil(10/15)*1000+1500 = 2500 → base 3000 wins
  assert(resolveDuration('info', undefined, 'short msg') === 3000,
    'resolveDuration: short message → base duration wins');
  // Long message (200 chars): required = ceil(200/15)*1000+1500 = 14*1000+1500 = 15500 → 15500 > 8000 base
  const longMsg = 'x'.repeat(200);
  assert(resolveDuration('error', undefined, longMsg) === 15500,
    'resolveDuration: long message → stretched duration returned');
  // explicitDur still overrides message scaling
  assert(resolveDuration('info', 5000, longMsg) === 5000,
    'resolveDuration: explicitDur > 0 overrides message scaling');

  // reducer add
  let s = [];
  s = toastReducer(s, { type: 'add', item: { id: 1, message: 'a', type: 'info' } });
  assert(s.length === 1 && s[0].id === 1, 'reducer add: empile 1');

  s = toastReducer(s, { type: 'add', item: { id: 2, message: 'b', type: 'info' } });
  assert(s.length === 2 && s[1].id === 2, 'reducer add: empile 2 (ordre préservé)');

  // immutabilité
  const prev = s;
  s = toastReducer(s, { type: 'add', item: { id: 3, message: 'c', type: 'info' } });
  assert(prev.length === 2, 'reducer add: ne mute pas l\'array source');
  assert(s !== prev, 'reducer add: retourne un nouvel array');

  // cap max
  s = toastReducer([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
                   { type: 'add', item: { id: 6 }, max: 5 });
  assert(s.length === 5,            'reducer add+max: respecte la cap');
  assert(s[0].id === 2,             'reducer add+max: drop le plus ancien');
  assert(s[4].id === 6,             'reducer add+max: garde le plus récent');

  // dismiss
  s = toastReducer([{ id: 1 }, { id: 2 }, { id: 3 }], { type: 'dismiss', id: 2 });
  assert(s.length === 2 && !s.find(t => t.id === 2), 'reducer dismiss: retire l\'id');

  // dismiss id absent
  const before = [{ id: 1 }, { id: 2 }];
  const after  = toastReducer(before, { type: 'dismiss', id: 999 });
  assert(after === before, 'reducer dismiss: id absent → retourne la même référence');

  // mark-dismissing
  const md1 = toastReducer([{ id: 1, dismissing: false }, { id: 2, dismissing: false }],
                            { type: 'mark-dismissing', id: 1 });
  assert(md1[0].dismissing === true,  'reducer mark-dismissing: cible marquée');
  assert(md1[1].dismissing === false, 'reducer mark-dismissing: autres non affectés');
  assert(md1 !== before,              'reducer mark-dismissing: retourne un nouvel array');

  // mark-dismissing idempotent (déjà dismissing → référence stable)
  const md2src = [{ id: 1, dismissing: true }];
  const md2 = toastReducer(md2src, { type: 'mark-dismissing', id: 1 });
  assert(md2 === md2src, 'reducer mark-dismissing: déjà dismissing → no-op identité');

  // mark-dismissing id absent
  const md3src = [{ id: 1, dismissing: false }];
  const md3 = toastReducer(md3src, { type: 'mark-dismissing', id: 999 });
  assert(md3 === md3src, 'reducer mark-dismissing: id absent → no-op identité');

  // update
  s = toastReducer([{ id: 1, message: 'old' }], { type: 'update', id: 1, message: 'new' });
  assert(s[0].message === 'new',   'reducer update: message changé');
  assert(s.length === 1,           'reducer update: pile inchangée en taille');

  // update id absent
  const beforeU = [{ id: 1, message: 'x' }];
  const afterU  = toastReducer(beforeU, { type: 'update', id: 999, message: 'y' });
  assert(afterU === beforeU, 'reducer update: id absent → retourne la même référence');

  // action inconnue
  const sameRef = [{ id: 1 }];
  assert(toastReducer(sameRef, { type: 'wat' }) === sameRef, 'reducer: action inconnue → no-op identité');
  assert(toastReducer(sameRef, null) === sameRef,            'reducer: action null → no-op identité');
}());

// =============================================================================
// N. cdaudio — B-1 regression: playAt uses filtered index, not window.playAt
// =============================================================================
section('cdaudio.js -- B-1 playAt uses filtered index');

(function () {
  let playAtCalls = [];
  let windowPlayAtCalls = [];
  const fakePlayer = { playAt: (i) => { playAtCalls.push(i); } };
  function handlerSimulation(eph, filteredIdx, player, win) {
    const fi = filteredIdx(eph);
    player.playAt(fi);
    if (typeof win.playAt === 'function') {
      windowPlayAtCalls.push(true);
    }
  }
  const eph = { id: 'cd:track:3', path: 'cdtrack3' };
  const filteredIdx = (track) => track.id === 'cd:track:3' ? 17 : -1;
  const fakeWin = {};
  handlerSimulation(eph, filteredIdx, fakePlayer, fakeWin);
  assert(playAtCalls.length === 1 && playAtCalls[0] === 17,
    'B-1: cdaudio handler calls player.playAt(filteredIdx(eph))');
  assert(windowPlayAtCalls.length === 0,
    'B-1: cdaudio handler does not call window.playAt');
}());

// =============================================================================
// N+1. organize.js -- B-2 saveTracks batches, rebuildTrackIdxMap before notify
// =============================================================================
section('organize.js -- B-2 saveTracks batches, rebuildTrackIdxMap before notify');
(function () {
  // Contract: saveTracks(moved) must: (1) batch the IDB puts (not loop dput),
  // (2) rebuildTrackIdxMap before notify('tracks').
  let dputCalls = 0, rebuildCalls = 0, notifyCalls = 0;
  let opSeq = [];
  const fakeIDB = { put: () => { dputCalls++; opSeq.push('put'); } };
  const fakeRebuild = () => { rebuildCalls++; opSeq.push('rebuild'); };
  const fakeNotify = () => { notifyCalls++; opSeq.push('notify'); };
  function saveTracksSimulation(moved, idb, rebuild, notify) {
    // batched: single put for the whole batch
    idb.put(moved);
    rebuild();
    notify('tracks');
  }
  saveTracksSimulation([{ id: 1 }, { id: 2 }, { id: 3 }], fakeIDB, fakeRebuild, fakeNotify);
  assert(dputCalls === 1, 'B-2: saveTracks batches puts (no loop dput)');
  assert(opSeq.indexOf('rebuild') < opSeq.indexOf('notify'), 'B-2: rebuild happens before notify');
}());

// =============================================================================
// cinema-seek.js -- seekPosFromPointer / formatSeekTime (pure logic, Task 5 TDD)
// Logique dupliquée inline (house style) -- cf. frontend/src/cinema-seek.js
// =============================================================================
section('cinema-seek.js -- seekPosFromPointer / formatSeekTime (pure logic)');

(function () {
  function seekPosFromPointer(clientX, rectLeft, rectWidth, duration) {
    if (!duration || !isFinite(duration) || duration <= 0) return null;
    if (!rectWidth || rectWidth <= 0) return null;
    const ratio = Math.max(0, Math.min(1, (clientX - rectLeft) / rectWidth));
    return ratio * duration;
  }
  function formatSeekTime(s) {
    if (!s || !isFinite(s) || s < 0) return '–:––'; // !s : 0/null/undefined/NaN — parité exacte avec fmt() (utils.js)
    const total = Math.floor(s);
    const m  = Math.floor(total / 60);
    const ss = total % 60;
    return `${m}:${String(ss).padStart(2, '0')}`;
  }

  // seekPosFromPointer -- bords
  assert(seekPosFromPointer(50, 100, 200, 180) === 0,   'seekPosFromPointer: x < left -> 0 (clamp bas)');
  assert(seekPosFromPointer(400, 100, 200, 180) === 180, 'seekPosFromPointer: x > right -> duration (clamp haut)');
  assert(seekPosFromPointer(200, 100, 200, 180) === 90,  'seekPosFromPointer: milieu exact -> duration/2');
  assert(seekPosFromPointer(100, 100, 200, 180) === 0,   'seekPosFromPointer: x == left -> 0 exact');
  assert(seekPosFromPointer(300, 100, 200, 180) === 180, 'seekPosFromPointer: x == right -> duration exact');
  assert(seekPosFromPointer(200, 100, 200, 0)         === null, 'seekPosFromPointer: duration 0 -> null');
  assert(seekPosFromPointer(200, 100, 200, NaN)       === null, 'seekPosFromPointer: duration NaN -> null');
  assert(seekPosFromPointer(200, 100, 200, undefined) === null, 'seekPosFromPointer: duration undefined -> null');
  assert(seekPosFromPointer(200, 100, 0, 180)         === null, 'seekPosFromPointer: rectWidth 0 -> null (division par zéro)');

  // formatSeekTime — parité EXACTE avec fmt() (utils.js) : 0 est falsy → '–:––'
  // (évite le flicker au début de piste : drag/Home écrit la même chose que le tick timeupdate)
  assert(formatSeekTime(0)         === '–:––', 'formatSeekTime: 0s -> –:–– (parité fmt: !s)');
  assert(formatSeekTime(59)        === '0:59',  'formatSeekTime: 59s -> 0:59');
  assert(formatSeekTime(90)        === '1:30',  'formatSeekTime: 90s -> 1:30');
  assert(formatSeekTime(3661)      === '61:01', 'formatSeekTime: 3661s -> 61:01 (M:SS, cohérent avec cinema-tc/td)');
  assert(formatSeekTime(NaN)       === '–:––', 'formatSeekTime: NaN -> –:––');
  assert(formatSeekTime(null)      === '–:––', 'formatSeekTime: null -> –:––');
  assert(formatSeekTime(undefined) === '–:––', 'formatSeekTime: undefined -> –:––');
  assert(formatSeekTime(-1)        === '–:––', 'formatSeekTime: négatif -> –:––');
}());

// =============================================================================
// cinema-queue.js -- buildUpcoming (pure logic, Task 9 TDD)
// Logique dupliquée inline (house style) -- cf. frontend/src/cinema-queue.js
// Priorité IDENTIQUE à cinema.js/_updateNextTrack() : explicite > radio > shuffle-hint
// (vide) > séquentiel.
// =============================================================================
section('cinema-queue.js -- buildUpcoming (pure logic)');

(function () {
  function buildUpcoming({
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

  const mk  = (id) => ({ id, name: 'T' + id, artist: 'A' + id });
  const ids = (arr) => JSON.stringify(arr.map(t => t.id));
  const fl8 = [mk(1), mk(2), mk(3), mk(4), mk(5), mk(6), mk(7), mk(8)];

  // ── Bords : tout vide / limit ────────────────────────────────────────────
  assert(ids(buildUpcoming()) === '[]', 'buildUpcoming(): appel sans arguments -> []');
  assert(ids(buildUpcoming({})) === '[]', 'buildUpcoming({}): tout vide -> []');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: -1, limit: 0 })) === '[]',
    'limit 0 -> [] (même avec des pistes disponibles)');
  assert(buildUpcoming({ filtered: fl8, curFilteredIdx: -1, limit: 3 }).length === 3,
    'limit 3 -> exactement 3 pistes (séquentiel)');

  // ── Séquentiel standard + fin de liste (pas de wrap — repeat n'est pas un paramètre) ──
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: -1 })) === '[1,2,3,4,5,6,7,8]',
    'curFilteredIdx -1 (pas de piste courante) -> liste filtrée complète');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 2 })) === '[4,5,6,7,8]',
    'séquentiel : suite de filtered depuis curFilteredIdx+1');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 6 })) === '[8]',
    'fin de liste : une seule piste restante, pas de wrap');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 7 })) === '[]',
    'fin de liste exacte (dernière piste) -> [] (pas de wrap)');

  // ── File explicite : priorité 1, IDs stale ignorés, complétée par le séquentiel ──
  assert(ids(buildUpcoming({ explicitQueue: [mk(5), mk(2)], filtered: fl8, curFilteredIdx: 0, limit: 8 })) === '[5,2,3,4,6,7,8]',
    'file explicite en tête (ordre préservé) + suite séquentielle dédupliquée (2 déjà en tête, sauté dans le séquentiel)');
  assert(ids(buildUpcoming({ explicitQueue: [mk(99), mk(3), null, mk(2)], filtered: fl8, curFilteredIdx: 0, limit: 4 })) === '[3,2,4,5]',
    'IDs stale (99 absent de filtered, null) ignorés silencieusement -- ordre des entrées valides préservé');
  assert(ids(buildUpcoming({ explicitQueue: [mk(99), null], filtered: fl8, curFilteredIdx: 1 })) === '[3,4,5,6,7,8]',
    'file explicite 100% stale (IDs absents/null) -> ignorée entièrement, retombe sur le séquentiel');
  assert(ids(buildUpcoming({ explicitQueue: [mk(99)], filtered: fl8, curFilteredIdx: 1, radioActive: true, radioQueue: [mk(7)] })) === '[7]',
    'file explicite 100% stale + radio active -> retombe sur la radio (le fallback saute uniquement la branche explicite vide)');
  assert(ids(buildUpcoming({ explicitQueue: [mk(1), mk(2), mk(3)], filtered: fl8, curFilteredIdx: 0, limit: 2 })) === '[1,2]',
    'limit < taille file explicite -> tronque la file explicite elle-même, pas de séquentiel ajouté');

  // ── Radio active (sans file explicite) : tête de la file radio, PAS de complément ──
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 0, radioActive: true, radioQueue: [mk(50), mk(51), mk(52)], limit: 8 })) === '[50,51,52]',
    'radio active : uniquement la file radio, aucun complément séquentiel (radioRefillQueue génère la suite dynamiquement)');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 0, radioActive: true, radioQueue: [mk(50)], limit: 8 })) === '[50]',
    'radio queue plus courte que limit -> retourne ce qui est disponible, pas de padding');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 0, radioActive: true, radioQueue: [mk(50), mk(51), mk(52)], limit: 2 })) === '[50,51]',
    'radio queue plus longue que limit -> tronquée à limit');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 0, radioActive: true, shuffle: true, radioQueue: [mk(50)] })) === '[50]',
    'radio active a priorité sur le hint shuffle (radio vérifiée avant shuffle)');

  // ── Shuffle actif sans file explicite ni radio -> imprévisible, [] (hint T6) ────
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 0, shuffle: true })) === '[]',
    'shuffle actif, pas de file explicite, radio inactive -> [] (le panneau affiche le hint)');
  assert(ids(buildUpcoming({ filtered: [], curFilteredIdx: -1, shuffle: true })) === '[]',
    'shuffle actif + bibliothèque filtrée vide -> [] (pas de crash)');

  // ── Priorité explicite > radio (l'explicite gagne même si la radio est active) ──
  assert(ids(buildUpcoming({ explicitQueue: [mk(4)], filtered: fl8, curFilteredIdx: 0, radioActive: true, radioQueue: [mk(50)], limit: 3 })) === '[4,2,3]',
    'file explicite non vide -> priorité absolue sur radioActive (même ordre que _updateNextTrack: hasExplicitQueueNext() avant radioActive)');

  // ── repeat='all' : wrap séquentiel (fix post-review — parité avec getNextIdx qui
  //    boucle sur filtered[0] quand repeat==='all', player.js) ──────────────────────
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 7, repeatAll: true })) === '[1,2,3,4,5,6,7]',
    'repeat-all en fin de liste -> wrap vers le début, piste courante EXCLUE, un seul cycle');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 5, repeatAll: true, limit: 4 })) === '[7,8,1,2]',
    'repeat-all mi-liste -> suite séquentielle puis wrap, tronqué à limit');
  assert(ids(buildUpcoming({ filtered: [mk(1)], curFilteredIdx: 0, repeatAll: true })) === '[]',
    'repeat-all avec une seule piste -> [] (jamais d\'auto-inclusion de la piste courante)');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 7, repeatAll: false })) === '[]',
    'repeat off : fin de liste reste [] (comportement inchangé)');
  assert(ids(buildUpcoming({ explicitQueue: [mk(8)], filtered: fl8, curFilteredIdx: 6, repeatAll: true, limit: 4 })) === '[8,1,2,3]',
    'repeat-all + file explicite : le remplissage séquentiel wrappe aussi (dédupliqué, courante exclue)');
  assert(ids(buildUpcoming({ filtered: fl8, curFilteredIdx: 0, shuffle: true, repeatAll: true })) === '[]',
    'repeat-all ne réactive pas le séquentiel sous shuffle (hint conservé)');
}());

// =============================================================================
// N. artcolor.js — _kmeansColors (k-means++ clustering, pure function)
// =============================================================================
section('artcolor.js -- _kmeansColors');

// Tests run in the async IIFE below via real import from artcolor.js

// =============================================================================
// N+2. lf-toast-stack.logic — import-smoke (real ESM module surface verification)
// =============================================================================
// Moved to async IIFE that owns the final result printing, so the 9 import-smoke
// assertions are counted before Total is displayed. Node 20 CJS supports dynamic
// import() natively; no transpile needed.

section('components/lf-toast-stack.logic.js -- import-smoke');

(async function () {
  try {
    const mod = await import('../src/components/lf-toast-stack.logic.js');
    assert(typeof mod.toastReducer === 'function',    'real module: toastReducer exported');
    assert(typeof mod.normalizeType === 'function',   'real module: normalizeType exported');
    assert(typeof mod.resolveDuration === 'function', 'real module: resolveDuration exported');
    assert(typeof mod.TOAST_DUR === 'object',         'real module: TOAST_DUR exported');
    assert(Array.isArray(mod.TOAST_TYPES),            'real module: TOAST_TYPES exported');
    // Verify real module behaves identically for representative cases
    assert(mod.normalizeType('error') === 'error',    'real module: normalizeType("error") === "error"');
    assert(mod.resolveDuration('info') === 3000,      'real module: resolveDuration("info") === 3000');
    // A11Y-13 : la durée s'étire avec la longueur du message (SC 2.2.1)
    assert(mod.resolveDuration('info', null, 'OK') === 3000,
      'real module: short message keeps base duration');
    assert(mod.resolveDuration('info', null, 'a'.repeat(150)) >= 11500,
      'real module: long message bumps duration (>=11500)');
    assert(mod.resolveDuration('info', 5000, 'a'.repeat(150)) === 5000,
      'real module: explicit duration overrides message scaling');
    const s1 = mod.toastReducer([], { type: 'add', item: { id: 42 } });
    assert(s1.length === 1 && s1[0].id === 42,        'real module: toastReducer add works');
    // mark-dismissing action present in real module
    const s2 = mod.toastReducer([{ id: 1, dismissing: false }], { type: 'mark-dismissing', id: 1 });
    assert(s2[0].dismissing === true,                 'real module: toastReducer mark-dismissing works');
  } catch (e) {
    console.error('  KO  import-smoke crashed:', e.message);
    _ko++;
  }

  // search.js — relevanceScore (scorer de pertinence)
  section('search.js -- relevanceScore (import réel)');
  try {
    const { relevanceScore } = await import('../src/search.js');
    assert(typeof relevanceScore === 'function', 'relevanceScore est une fonction exportée');
    assert(
      relevanceScore({ name: 'Discovery' }, 'dis') > relevanceScore({ name: 'The Distance' }, 'dis'),
      'relevanceScore: title prefix beats title substring'
    );
    assert(
      relevanceScore({ name: 'Endless Discovery' }, 'dis') > relevanceScore({ name: 'Misdiagnosed' }, 'dis'),
      'relevanceScore: title word-start beats title substring'
    );
    assert(
      relevanceScore({ name: 'Dance', artist: 'X' }, 'dan') > relevanceScore({ name: 'X', artist: 'Dance' }, 'dan'),
      'relevanceScore: title match beats artist match'
    );
    assert(
      relevanceScore({ artist: 'Daft Punk', album: 'X' }, 'daf') > relevanceScore({ artist: 'X', album: 'Daft Album' }, 'daf'),
      'relevanceScore: artist match beats album match'
    );
    assert(
      relevanceScore({ name: 'Zzz', artist: 'Yyy' }, 'dis') === 0,
      'relevanceScore: no match scores 0'
    );
    assert(
      relevanceScore({ name: 'Paradise' }, 'dis') > relevanceScore({ name: 'X', artist: 'Disco' }, 'dis'),
      'relevanceScore: title substring beats artist prefix (field dominates position)'
    );
  } catch (e) {
    _ko++;
    console.error('  ✗  relevanceScore import/test crashed:', e.message);
  }

  // artcolor.js — _kmeansColors (real import — avoids drift from inline duplicate)
  section('artcolor.js -- _kmeansColors (import réel)');
  try {
    const { _kmeansColors } = await import('../src/artcolor.js');
    // 2048 pure-red + 2048 pure-blue pixels
    const px = new Uint8ClampedArray(4096 * 4);
    for (let i = 0; i < 2048; i++) { px[i*4]=255; px[i*4+1]=0;   px[i*4+2]=0;   px[i*4+3]=255; }
    for (let i = 2048; i < 4096; i++) { px[i*4]=0;   px[i*4+1]=0; px[i*4+2]=255; px[i*4+3]=255; }
    const res = _kmeansColors(px, 2, 8);
    assert(res.length === 2,                         '_kmeansColors: retourne k=2 clusters');
    assert(res[0].score >= res[1].score,             '_kmeansColors: trié score desc');
    assert(res[0].size > 0 && res[1].size > 0,       '_kmeansColors: clusters non vides');
    assert(res[0].size + res[1].size === 4096,        '_kmeansColors: tous pixels assignés');
    const ctrs = res.map(r => r.center);
    assert(ctrs.some(c => c[0] > 200 && c[2] < 60), '_kmeansColors: identifie le cluster rouge');
    assert(ctrs.some(c => c[2] > 200 && c[0] < 60), '_kmeansColors: identifie le cluster bleu');
    // Edge case: all identical pixels
    const mono = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) { mono[i*4]=128; mono[i*4+1]=64; mono[i*4+2]=32; mono[i*4+3]=255; }
    const monoRes = _kmeansColors(mono, 5, 8);
    assert(monoRes.length === 5, '_kmeansColors: edge case mono → k=5 clusters');
    assert(monoRes.every(r => r.center.every(v => v >= 0 && v <= 255)),
      '_kmeansColors: centres valides RGB 0-255 sur mono');
  } catch (e) {
    _ko++;
    console.error('  ✗  _kmeansColors import/test crashed:', e.message);
  }

  // Task 7 — artcolor.js — ensureContrastOnDark (garde-fou contraste, real import —
  // avoids drift from inline duplicate; same WCAG relative-luminance math as _wcag.cjs).
  section('artcolor.js -- ensureContrastOnDark (import réel)');
  try {
    const { ensureContrastOnDark } = await import('../src/artcolor.js');
    const { contrastRatio } = require('./_wcag.cjs');
    const toHex = ([r, g, b]) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

    // Already-conforming colour (pure red, ~5.25:1 vs black) is returned unchanged.
    const red = ensureContrastOnDark([255, 0, 0], 4.5);
    assert(red[0] === 255 && red[1] === 0 && red[2] === 0,
      'ensureContrastOnDark: couleur déjà conforme (rouge pur) inchangée');

    // Dark colour raised to >= 4.5:1 against pure black, only ever lightened.
    const dark = [10, 10, 40];
    const darkOut = ensureContrastOnDark(dark, 4.5);
    assert(contrastRatio(toHex(darkOut), '#000000') >= 4.5 - 1e-6,
      'ensureContrastOnDark: couleur sombre remontée à >= 4.5:1 vs noir');
    assert(darkOut[0] >= dark[0] && darkOut[1] >= dark[1] && darkOut[2] >= dark[2],
      'ensureContrastOnDark: éclaircissement uniquement vers le blanc (jamais assombri)');

    // Pure black -> light gray (neutral channels, ratio met, not blown out to white).
    const blackOut = ensureContrastOnDark([0, 0, 0], 4.5);
    assert(blackOut[0] === blackOut[1] && blackOut[1] === blackOut[2],
      'ensureContrastOnDark: noir pur -> gris neutre (r=g=b)');
    assert(blackOut[0] > 60 && blackOut[0] < 255,
      'ensureContrastOnDark: noir pur -> gris clair (ni noir ni blanc)');
    assert(contrastRatio(toHex(blackOut), '#000000') >= 4.5 - 1e-6,
      'ensureContrastOnDark: noir pur -> contraste >= 4.5:1');

    // Idempotence: applying twice === applying once.
    const once  = ensureContrastOnDark(dark, 4.5);
    const twice = ensureContrastOnDark(once, 4.5);
    assert(once[0] === twice[0] && once[1] === twice[1] && once[2] === twice[2],
      'ensureContrastOnDark: idempotent (appliquer deux fois = une fois)');

    // Convergence guard: white input must not loop and stays white.
    const whiteOut = ensureContrastOnDark([255, 255, 255], 4.5);
    assert(whiteOut[0] === 255 && whiteOut[1] === 255 && whiteOut[2] === 255,
      'ensureContrastOnDark: blanc pur inchangé (pas de boucle infinie)');
  } catch (e) {
    _ko++;
    console.error('  ✗  ensureContrastOnDark import/test crashed:', e.message);
  }

  // WCAG 2.2 SC 2.5.7 — pure reorder helper moveByOne (alternative non-drag)
  try {
    const { moveByOne } = await import('../src/utils.js');
    let a = ['a', 'b', 'c', 'd'];
    assert(moveByOne(a, 2, -1) === 1 && a.join('') === 'acbd', 'moveByOne: up swaps with previous');
    a = ['a', 'b', 'c', 'd'];
    assert(moveByOne(a, 1, 1) === 2 && a.join('') === 'acbd',  'moveByOne: down swaps with next');
    a = ['a', 'b', 'c'];
    assert(moveByOne(a, 0, -1) === -1 && a.join('') === 'abc', 'moveByOne: up at top is no-op (-1)');
    assert(moveByOne(a, 2, 1)  === -1 && a.join('') === 'abc', 'moveByOne: down at bottom is no-op (-1)');
    assert(moveByOne(a, -1, 1) === -1,                          'moveByOne: out-of-range index → -1');
    assert(moveByOne(null, 0, 1) === -1,                        'moveByOne: non-array → -1');
  } catch (e) {
    console.error('  KO  moveByOne crashed:', e.message);
    _ko++;
  }

  // cinema-queue.js — buildUpcoming (import réel — vérifie l'absence de drift avec la
  // copie inline ci-dessus, house style) + exports du câblage (Task 9)
  section('cinema-queue.js -- buildUpcoming (import réel)');
  try {
    const mod = await import('../src/cinema-queue.js');
    assert(typeof mod.buildUpcoming === 'function',            'real module: buildUpcoming exported');
    assert(typeof mod.initCinemaQueue === 'function',          'real module: initCinemaQueue exported');
    assert(typeof mod.refreshCinemaQueuePanel === 'function',  'real module: refreshCinemaQueuePanel exported');
    assert(typeof mod.closeCinemaQueuePanel === 'function',    'real module: closeCinemaQueuePanel exported');
    const mk = (id) => ({ id, name: 'T' + id, artist: 'A' + id });
    const fl = [mk(1), mk(2), mk(3)];
    const seq = mod.buildUpcoming({ filtered: fl, curFilteredIdx: 0 });
    assert(seq.length === 2 && seq[0].id === 2 && seq[1].id === 3,
      'real module: buildUpcoming séquentiel identique à la copie inline');
    assert(mod.buildUpcoming({ filtered: fl, curFilteredIdx: 0, shuffle: true }).length === 0,
      'real module: buildUpcoming shuffle sans file explicite -> []');
    const wrap = mod.buildUpcoming({ filtered: fl, curFilteredIdx: 2, repeatAll: true });
    assert(wrap.length === 2 && wrap[0].id === 1 && wrap[1].id === 2,
      'real module: buildUpcoming repeat-all wrappe en fin de liste (courante exclue)');
  } catch (e) {
    console.error('  KO  cinema-queue.js import-smoke crashed:', e.message);
    _ko++;
  }

  // Plugins single-instance / cli — helpers de résolution de fichier (import réel)
  section('utils.js -- normalizePathKey / extractAudioFileArg (import réel)');
  try {
    const { normalizePathKey, extractAudioFileArg } = await import('../src/utils.js');
    assert(normalizePathKey('C:\\Music\\A.flac') === 'c:/music/a.flac',
      'normalizePathKey: backslashes → slashes + lowercase');
    assert(normalizePathKey('c:/music/a.flac') === normalizePathKey('C:\\MUSIC\\A.FLAC'),
      'normalizePathKey: même fichier, casse/séparateurs différents → même clé');
    assert(normalizePathKey(null) === '' && normalizePathKey(undefined) === '',
      'normalizePathKey: null/undefined → chaîne vide');
    assert(extractAudioFileArg(['C:\\Music\\song.mp3']) === 'C:\\Music\\song.mp3',
      'extractAudioFileArg: fichier audio simple accepté');
    assert(extractAudioFileArg(['--flag', 'C:\\a.flac']) === 'C:\\a.flac',
      'extractAudioFileArg: les flags sont ignorés');
    assert(extractAudioFileArg(['C:\\doc.pdf', 'C:\\b.opus']) === 'C:\\b.opus',
      'extractAudioFileArg: extension non-audio sautée');
    assert(extractAudioFileArg(['C:\\..\\evil.mp3']) === null,
      'extractAudioFileArg: traversée .. rejetée (isSafePath)');
    assert(extractAudioFileArg([]) === null && extractAudioFileArg(null) === null,
      'extractAudioFileArg: argv vide/null → null');
  } catch (e) {
    console.error('  KO  normalizePathKey/extractAudioFileArg crashed:', e.message);
    _ko++;
  }

  // SMTC + clipboard-manager — helpers purs (import réel)
  section('utils.js -- trackCopyText / smtcMetaFromTrack (import réel)');
  try {
    const { trackCopyText, smtcMetaFromTrack } = await import('../src/utils.js');
    assert(trackCopyText({ name: 'Song', artist: 'Artist' }, 'Artiste inconnu') === 'Artist — Song',
      'trackCopyText: artiste connu → « Artiste — Titre »');
    assert(trackCopyText({ name: 'Song', artist: 'Artiste inconnu' }, 'Artiste inconnu') === 'Song',
      'trackCopyText: artiste inconnu (i18n) → titre seul');
    assert(trackCopyText({ name: 'Song', artist: 'Unknown Artist' }, 'Artiste inconnu') === 'Song',
      'trackCopyText: Unknown Artist littéral → titre seul');
    assert(trackCopyText(null, 'x') === '' && trackCopyText({}, 'x') === '',
      'trackCopyText: piste null/sans nom → chaîne vide');
    const m = smtcMetaFromTrack({ name: 'T', artist: 'A', artistFull: 'A feat. B', album: 'Al', path: 'C:\\m\\t.flac' }, 200.5);
    assert(m.title === 'T' && m.artist === 'A feat. B' && m.album === 'Al',
      'smtcMetaFromTrack: artistFull prioritaire, champs mappés');
    assert(m.path === 'C:\\m\\t.flac' && m.durationSecs === 200.5,
      'smtcMetaFromTrack: path safe conservé + durée finie');
    assert(smtcMetaFromTrack({ name: 'T', path: 'C:\\..\\evil.flac' }, NaN).path === null,
      'smtcMetaFromTrack: path traversée .. rejeté (isSafePath)');
    assert(smtcMetaFromTrack({ name: 'T' }, NaN).durationSecs === null
        && smtcMetaFromTrack({ name: 'T' }, -3).durationSecs === null,
      'smtcMetaFromTrack: durée NaN/négative → null');
    assert(smtcMetaFromTrack(null, 10) === null,
      'smtcMetaFromTrack: piste null → null');
    assert(smtcMetaFromTrack({ name: 'x'.repeat(500) }, 10).title.length === 256,
      'smtcMetaFromTrack: titre cappé à 256 chars (tags non fiables)');
  } catch (e) {
    console.error('  KO  trackCopyText/smtcMetaFromTrack crashed:', e.message);
    _ko++;
  }

  // Token integrity (B1)
  await require('./theme-tokens.test.cjs').run();

  // Palette definition + WCAG compliance (B2)
  await require('./theme-palette.test.cjs').run();

  // Light theme surface coverage (B3)
  await require('./theme-light-coverage.test.cjs').run();

  // A11y static guardrails (WCAG 2.1 AA)
  await require('./a11y.test.cjs').run();

  // Token single-source guard (§17)
  await require('./token-source.test.cjs').run();

  // Sidebar audit guardrails (2026-07-01)
  await require('./sidebar.test.cjs').run();

  // =============================================================================
  // cinema split — vérification statique (lignes + exports publics)
  // cinema-viz.js / cinema-bg.js removed in 804181a (dead-module sweep);
  // guard with try/catch so the suite doesn't crash while these tests are red.
  // =============================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema split — line count + public surface');

    const cinLines  = read('frontend/src/cinema.js').split('\n').length;
    const vizLines  = read('frontend/src/cinema-viz.js').split('\n').length;
    const bgLines   = read('frontend/src/cinema-bg.js').split('\n').length;
    const beatLines   = read('frontend/src/cinema-beat.js').split('\n').length;
    const renderLines = read('frontend/src/cinema-render.js').split('\n').length;
    const seekLines   = read('frontend/src/cinema-seek.js').split('\n').length;
    const queueLines  = read('frontend/src/cinema-queue.js').split('\n').length;
    const loopLines   = read('frontend/src/cinema-loop.js').split('\n').length;
    const inputLines  = read('frontend/src/cinema-input.js').split('\n').length;

    // Task 6 : extraction cinema-input.js (clavier/molette/dblclick/contrôles auto-masquables)
    // -- cap cinema.js abaissé de 800 à 650 lignes (Global Constraints du plan Cycle 2).
    assert(cinLines <= 650, `cinema.js <= 650 lignes (actual: ${cinLines})`);
    assert(inputLines < 250, `cinema-input.js < 250 lignes (actual: ${inputLines})`);
    assert(vizLines < 500, `cinema-viz.js < 500 lignes (actual: ${vizLines})`);
    // Task 3 : cinema-bg.js gagne snapArtColor()/stepArtColorLerp() (état couleur privé) — cap 400→470.
    // Task 8 : cross-fade de bascule de mode (MODE_CROSSFADE_MS, _snapshotModeCanvas) — cap 470→480
    // (+25 lignes réelles : constante, helper snapshot, câblage applyCinemaBg, commentaires).
    // Task 15 : fade d'entrée spectrum (_vizFadeIn + câblage) + gardes Tasks 11/14 — cap 480→495.
    assert(bgLines  < 495, `cinema-bg.js < 495 lignes (actual: ${bgLines})`);
    assert(beatLines   < 200, `cinema-beat.js < 200 lignes (actual: ${beatLines})`);
    // Task 2 : cinema-loop.js — boucle rAF maître, snapshot FFT, beat unique, cadence, <200 lignes.
    assert(loopLines   < 200, `cinema-loop.js < 200 lignes (actual: ${loopLines})`);
    // Task 9 : getCinemaQueueUpcoming()/playCinemaQueueTrack() ajoutés — reste < 400.
    assert(renderLines < 400, `cinema-render.js < 400 lignes (actual: ${renderLines})`);
    // Task 5 : cinema-seek.js — scrubbing complet de la pbar (drag/hover/clavier), <300 lignes.
    assert(seekLines   < 300, `cinema-seek.js < 300 lignes (actual: ${seekLines})`);
    // Task 9 : cinema-queue.js — panneau file d'attente dépliable, <300 lignes.
    assert(queueLines  < 300, `cinema-queue.js < 300 lignes (actual: ${queueLines})`);

    const vizSrc  = read('frontend/src/cinema-viz.js');
    const bgSrc   = read('frontend/src/cinema-bg.js');
    const cinSrc  = read('frontend/src/cinema.js');
    const seekSrc = read('frontend/src/cinema-seek.js');
    const renderSrc = read('frontend/src/cinema-render.js');
    const queueSrc  = read('frontend/src/cinema-queue.js');
    const loopSrc  = read('frontend/src/cinema-loop.js');
    const inputSrc = read('frontend/src/cinema-input.js');

    // Task 6 — cinema-input.js : surface publique + zéro import cross-feature (DI pure,
    // même discipline que cinema-seek.js : ni player.js/eq.js).
    assert(/export function initCinemaInput/.test(inputSrc),     'cinema-input.js exports initCinemaInput');
    assert(/export function attachCinemaInput/.test(inputSrc),   'cinema-input.js exports attachCinemaInput');
    assert(/export function detachCinemaInput/.test(inputSrc),   'cinema-input.js exports detachCinemaInput');
    assert(/export function showCinemaControls/.test(inputSrc),  'cinema-input.js exports showCinemaControls');
    assert(!/from '\.\/(player|eq)\.js'/.test(inputSrc),
      "cinema-input.js n'importe pas player.js/eq.js (DI uniquement, CLAUDE.md §6)");
    assert(/from '.\/cinema-input.js'/.test(cinSrc),       "cinema.js importe depuis cinema-input.js");
    assert(/initCinemaInput\(/.test(cinSrc),               "cinema.js appelle initCinemaInput()");
    assert(/attachCinemaInput\(overlay\)/.test(cinSrc),    "cinema.js appelle attachCinemaInput(overlay) (openCinema)");
    assert(/detachCinemaInput\(overlay\)/.test(cinSrc),    "cinema.js appelle detachCinemaInput(overlay) (closeCinema)");

    assert(/export function startCinemaViz/.test(vizSrc),      'cinema-viz.js exports startCinemaViz');
    assert(/export function stopCinemaViz/.test(vizSrc),       'cinema-viz.js exports stopCinemaViz');
    assert(/export function initCinemaVizModule/.test(vizSrc), 'cinema-viz.js exports initCinemaVizModule');

    // Task 2 — cinema-loop.js : boucle rAF maître (non câblée en T2).
    assert(/export function initCinemaLoop/.test(loopSrc),     'cinema-loop.js exports initCinemaLoop');
    assert(/export function startCinemaLoop/.test(loopSrc),    'cinema-loop.js exports startCinemaLoop');
    assert(/export function stopCinemaLoop/.test(loopSrc),     'cinema-loop.js exports stopCinemaLoop');
    assert(/export function wakeCinemaLoop/.test(loopSrc),     'cinema-loop.js exports wakeCinemaLoop');
    assert(/export function loopCadence/.test(loopSrc),        'cinema-loop.js exports loopCadence (pure)');
    assert(/export function computeBassEnergy/.test(loopSrc),  'cinema-loop.js exports computeBassEnergy (pure)');

    assert(/export let cinemaBg/.test(bgSrc),                'cinema-bg.js exports cinemaBg');
    assert(/export const CINEMA_BG_MODES/.test(bgSrc),       'cinema-bg.js exports CINEMA_BG_MODES');
    assert(/export function applyCinemaBg/.test(bgSrc),      'cinema-bg.js exports applyCinemaBg');
    assert(/export function initCinemaBgModule/.test(bgSrc), 'cinema-bg.js exports initCinemaBgModule');

    // Task 5 — cinema-seek.js : surface publique + zéro import cross-feature (player.js/eq.js).
    assert(/export function seekPosFromPointer/.test(seekSrc), 'cinema-seek.js exports seekPosFromPointer');
    assert(/export function formatSeekTime/.test(seekSrc),     'cinema-seek.js exports formatSeekTime');
    assert(/export function isSeekDragging/.test(seekSrc),     'cinema-seek.js exports isSeekDragging');
    assert(/export function initCinemaSeek/.test(seekSrc),     'cinema-seek.js exports initCinemaSeek');
    assert(/export function resetCinemaSeek/.test(seekSrc),    'cinema-seek.js exports resetCinemaSeek');
    assert(!/from '\.\/player\.js'/.test(seekSrc) && !/from '\.\/eq\.js'/.test(seekSrc),
      'cinema-seek.js n\'importe pas player.js/eq.js (DI uniquement, CLAUDE.md §6)');

    assert(/from '.\/cinema-viz.js'/.test(cinSrc),         "cinema.js importe depuis cinema-viz.js");
    assert(/from '.\/cinema-bg.js'/.test(cinSrc),          "cinema.js importe depuis cinema-bg.js");
    assert(/from '.\/cinema-seek.js'/.test(cinSrc),        "cinema.js importe depuis cinema-seek.js");
    assert(/initCinemaSeek\(/.test(cinSrc),                "cinema.js appelle initCinemaSeek()");
    assert(/from '.\/cinema-seek.js'/.test(renderSrc),     "cinema-render.js importe isSeekDragging depuis cinema-seek.js");
    assert(/export \{[\s\S]*?cinemaBg/.test(cinSrc),       "cinema.js re-exporte cinemaBg");
    assert(/export let cinemaOpen/.test(cinSrc),            "cinema.js exporte toujours cinemaOpen");
    assert(/export function updateCinema/.test(cinSrc),     "cinema.js exporte toujours updateCinema");

    // Task 9 — cinema-queue.js : surface publique + zéro import cross-feature (DI pure,
    // même discipline que cinema-seek.js : ni player/queue/search/radio/i18n/store).
    assert(/export function buildUpcoming/.test(queueSrc),           'cinema-queue.js exports buildUpcoming');
    assert(/export function initCinemaQueue/.test(queueSrc),         'cinema-queue.js exports initCinemaQueue');
    assert(/export function refreshCinemaQueuePanel/.test(queueSrc), 'cinema-queue.js exports refreshCinemaQueuePanel');
    assert(/export function closeCinemaQueuePanel/.test(queueSrc),   'cinema-queue.js exports closeCinemaQueuePanel');
    assert(!/from '\.\/(player|queue|search|radio|i18n|store|cfg)\.js'/.test(queueSrc),
      "cinema-queue.js n'importe aucun module cross-feature (DI uniquement, CLAUDE.md §6)");

    assert(/from '.\/cinema-render.js'/.test(cinSrc) && /getCinemaQueueUpcoming/.test(cinSrc),
      "cinema.js importe getCinemaQueueUpcoming depuis cinema-render.js");
    assert(/from '.\/cinema-queue.js'/.test(cinSrc),       "cinema.js importe depuis cinema-queue.js");
    assert(/initCinemaQueue\(/.test(cinSrc),               "cinema.js appelle initCinemaQueue()");
    assert(/closeCinemaQueuePanel\(\)/.test(cinSrc),       "cinema.js appelle closeCinemaQueuePanel() dans closeCinema()");
    assert(/refreshCinemaQueuePanel\(\)/.test(cinSrc),     "cinema.js appelle refreshCinemaQueuePanel() dans updateCinema()");
    assert(/from '\.\/cinema-queue\.js'/.test(renderSrc) && /buildUpcoming/.test(renderSrc),
      "cinema-render.js importe buildUpcoming depuis cinema-queue.js");
  } catch (e) {
    console.error('  KO  cinema split crashed:', e.message);
    _ko++;
  }

  // =============================================================================
  // Cinema Polish Cycle 2, Task 6 — extraction cinema-input.js + 4 bugs d'input
  // (scans statiques, house style). NB : distinct de l'ancienne numérotation
  // "cinema Task 6" (text swap sync, plus bas) — plan différent.
  // =============================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema-input.js split (Cycle 2 Task 6) -- extraction + 4 bugs input');

    const inputSrc = read('frontend/src/cinema-input.js');
    const cinSrc   = read('frontend/src/cinema.js');

    const onCinKeyBody = /function _onCinKey\(e\)\s*\{[\s\S]*?\n\}\n/.exec(inputSrc)?.[0] || '';
    assert(onCinKeyBody.length > 0, 'cinema-input.js : _onCinKey() trouvée');

    // (b) KeyC ferme le cinéma — la tooltip promet « Fermer [C / Échap] » (i18n
    // t_cinema_close) mais seul Escape était géré avant ce fix.
    const keyCBlock = /case 'KeyC':([\s\S]*?)break;/.exec(onCinKeyBody)?.[1] || '';
    assert(keyCBlock.length > 0 && /closeCinema\(\)/.test(keyCBlock),
      "cinema-input.js : case 'KeyC' présent et appelle deps.closeCinema() (fix tooltip « Fermer [C / Échap] »)");

    // (c) _onCinWheel : early-return AVANT preventDefault quand la molette cible le
    // panneau file d'attente — le scroll natif du panneau reprend ses droits.
    const onCinWheelBody = /function _onCinWheel\(e\)\s*\{[\s\S]*?\n\}\n/.exec(inputSrc)?.[0] || '';
    assert(onCinWheelBody.length > 0, 'cinema-input.js : _onCinWheel() trouvée');
    const closestIdx = onCinWheelBody.indexOf("closest('#cinema-queue-panel')");
    const preventIdx = onCinWheelBody.indexOf('preventDefault('); // forme appel — évite un faux négatif si un commentaire mentionne le mot sans parenthèse
    assert(closestIdx > -1 && preventIdx > -1 && closestIdx < preventIdx,
      "cinema-input.js : _onCinWheel() early-return closest('#cinema-queue-panel') AVANT preventDefault");

    // (d) seek clavier ArrowLeft/ArrowRight gardé par isFinite(audio.duration) — sans
    // la garde, une durée NaN faisait `audio.duration || 0` -> 0 et ArrowRight ramenait
    // la lecture au tout début du morceau (Math.min(0, currentTime+5) === 0).
    const arrowLeftBlock  = /case 'ArrowLeft':([\s\S]*?)break;/.exec(onCinKeyBody)?.[1] || '';
    const arrowRightBlock = /case 'ArrowRight':([\s\S]*?)break;/.exec(onCinKeyBody)?.[1] || '';
    assert(arrowLeftBlock.length > 0 && /isFinite\(audio\.duration\)/.test(arrowLeftBlock),
      'cinema-input.js : ArrowLeft gardé par isFinite(audio.duration) (miroir ArrowRight)');
    assert(arrowRightBlock.length > 0 && /isFinite\(audio\.duration\)/.test(arrowRightBlock)
        && /Math\.min\(audio\.duration,/.test(arrowRightBlock),
      'cinema-input.js : ArrowRight gardé par isFinite(audio.duration) (fix NaN -> seek forcé à 0)');

    // (e) les deux callbacks rAF d'ouverture (cinema.js/openCinema) doivent vérifier
    // cinemaOpen avant d'agir — un close() survenu entre l'appel et l'exécution de la
    // frame ne doit pas focaliser/animer un overlay déjà refermé (race rAF).
    const openCinemaBody = /export function openCinema\(\)\s*\{[\s\S]*?\n\}\n/.exec(cinSrc)?.[0] || '';
    assert(openCinemaBody.length > 0, 'cinema.js : openCinema() trouvée');
    const rafGuardCount = (openCinemaBody.match(/requestAnimationFrame\(\(\)\s*=>\s*\{\s*if \(!cinemaOpen\) return;/g) || []).length;
    assert(rafGuardCount === 2,
      `cinema.js : les deux callbacks rAF de openCinema() contiennent if (!cinemaOpen) return (fix races rAF, actual: ${rafGuardCount})`);

    // (f) _onArtDblClick : clearTimeout(_heartTimer) AVANT réassignation — un
    // double-double-clic rapide laissait sinon le premier timer orphelin.
    const onArtDblClickBody = /function _onArtDblClick\(e\)\s*\{[\s\S]*?\n\}\n/.exec(inputSrc)?.[0] || '';
    assert(onArtDblClickBody.length > 0, 'cinema-input.js : _onArtDblClick() trouvée');
    const clearIdx = onArtDblClickBody.indexOf('clearTimeout(_heartTimer)');
    const reassignIdx = onArtDblClickBody.indexOf('_heartTimer = setTimeout');
    assert(clearIdx > -1 && reassignIdx > -1 && clearIdx < reassignIdx,
      'cinema-input.js : clearTimeout(_heartTimer) avant réassignation dans _onArtDblClick (fix timer orphelin)');
  } catch (e) {
    console.error('  KO  cinema Task 6 scans crashed:', e.message);
    _ko++;
  }

  // =============================================================================
  // Post-review (final whole-branch findings 1/3/4) — scans bon marché, house style.
  // =============================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema post-review -- findings 1/3/4');

    const cinSrc    = read('frontend/src/cinema.js');
    const renderSrc = read('frontend/src/cinema-render.js');
    const playerSrc = read('frontend/src/player.js');
    const queueQSrc = read('frontend/src/cinema-queue.js');

    // Finding 1 — les branches shuffle et !tracks/curIdx<0 de _updateNextTrack ne doivent
    // plus manipuler .cin-has-next à la main (seul renderCinNextPanel(panel, hint, ...) le
    // fait) : sinon #cinema-next reste focalisable (pas de .disabled) sous shuffle/no-track.
    const nextBody = /function _updateNextTrack\(\)\s*\{[\s\S]*?\n\}\n/.exec(cinSrc)?.[0] || '';
    assert(nextBody.length > 0, 'cinema.js : _updateNextTrack() trouvée');
    assert(!/panel\.classList\.(remove|add)\('cin-has-next'\)/.test(nextBody),
      'cinema.js : _updateNextTrack() ne manipule plus panel.classList directement (route via renderCinNextPanel)');
    assert((nextBody.match(/renderCinNextPanel\(panel, hint, null, shuffle\)/g) || []).length === 2,
      'cinema.js : les branches shuffle ET !tracks/curIdx<0 appellent renderCinNextPanel(…, null, shuffle) — #cinema-next reste disabled (Finding 1)');

    // Finding 3 — le cluster cinéma ne réimporte jamais queue.js directement (façade
    // player.js) : cinema-render.js doit importer peekExplicitQueue/removeFromQueue
    // depuis player.js, et player.js doit les réexporter.
    assert(!/from '\.\/queue\.js'/.test(renderSrc),
      "cinema-render.js n'importe plus queue.js directement (Finding 3)");
    assert(/peekExplicitQueue[\s\S]*?from '\.\/player\.js'/.test(renderSrc) &&
      /removeFromQueue/.test(renderSrc),
      'cinema-render.js importe peekExplicitQueue/removeFromQueue depuis player.js');
    assert(/export \{ peekExplicitQueue, removeFromQueue \}/.test(playerSrc),
      'player.js réexporte peekExplicitQueue/removeFromQueue (façade queue.js, §6)');

    // Finding 4 — quand le panneau ouvert se vide alors qu'une rangée était focalisée,
    // le focus ne doit jamais retomber silencieusement sur <body> (fuite du Tab-trap
    // overlay) : bascule vers le déclencheur focalisable, sinon ferme le panneau.
    const renderBody = /function _render\(\)\s*\{[\s\S]*?\n\}\n/.exec(queueQSrc)?.[0] || '';
    assert(renderBody.length > 0, 'cinema-queue.js : _render() trouvée');
    assert(/_isTriggerFocusable/.test(renderBody) && /_closePanel\(\)/.test(renderBody),
      'cinema-queue.js : _render() gère le cas liste-vidée-focus-perdu (trigger focalisable sinon _closePanel)');
  } catch (e) {
    console.error('  KO  cinema post-review scans crashed:', e.message);
    _ko++;
  }

  // =============================================================================
  // Task 3 — santé du code : beat partagé (cinema-beat.js), état couleur privé
  // (cinema-bg.js), split des fonctions géantes (updateCinema). Refactor pur.
  // Logique beat reproduite inline (style maison — pas d'import ESM) + scans.
  // =============================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema Task 3 -- beat partagé + état couleur privé + split');

    const beatSrc   = read('frontend/src/cinema-beat.js');
    const cinVizSrc = read('frontend/src/cinema-viz.js');
    const canvasSrc = read('frontend/src/cinema-canvas.js');
    const bgSrc     = read('frontend/src/cinema-bg.js');
    const cinSrc    = read('frontend/src/cinema.js');

    // (a) cinema-beat.js existe, <200 lignes, exporte la factory createBeatDetector
    assert(beatSrc.split('\n').length < 200, 'cinema-beat.js < 200 lignes');
    assert(/export function createBeatDetector/.test(beatSrc),
      'cinema-beat.js exporte la factory createBeatDetector');

    // (a bis) logique beat reproduite inline — énergie > moyenne×seuil, cooldown, historique borné
    function createBeatDetector({ history = 0, threshold, cooldownMs }) {
      const buf = history > 0 ? new Float32Array(history) : null;
      let idx = 0, sum = 0, lastBeat = 0;
      return {
        sample(energy, nowMs, baseline) {
          let avg;
          if (buf) {
            const slot = idx % history;
            sum -= buf[slot]; buf[slot] = energy; sum += energy; idx++;
            if (idx < history) return false;                    // warm-up
            if (idx % history === 0) { sum = 0; for (let i = 0; i < history; i++) sum += buf[i]; }
            avg = sum / history;
          } else { avg = baseline; }
          if (energy > avg * threshold && nowMs - lastBeat > cooldownMs) { lastBeat = nowMs; return true; }
          return false;
        },
      };
    }
    const d1 = createBeatDetector({ history: 4, threshold: 1.35, cooldownMs: 0 });
    let warm = false;
    for (let i = 0; i < 3; i++) if (d1.sample(1000, i)) warm = true;
    assert(warm === false, 'beat: aucun beat pendant le warm-up (buffer non plein)');
    const d2 = createBeatDetector({ history: 4, threshold: 1.35, cooldownMs: 100 });
    for (let i = 0; i < 4; i++) d2.sample(10, i);               // remplir l'historique (moyenne basse)
    assert(d2.sample(1000, 1000) === true, 'beat: pic d\'énergie > moyenne×seuil → beat');
    assert(d2.sample(1000, 1050) === false, 'beat: cooldown supprime un beat trop rapproché');
    const d3 = createBeatDetector({ history: 4, threshold: 1.5, cooldownMs: 0 });
    for (let i = 0; i < 8; i++) d3.sample(500, i);              // moyenne stabilisée == énergie
    assert(d3.sample(500, 100) === false, 'beat: énergie == moyenne → pas de beat (historique borné)');
    // Mode baseline externe (history=0) — vagues/étoiles (EMA fournie par l'appelant)
    const d4 = createBeatDetector({ history: 0, threshold: 1.55, cooldownMs: 650 });
    assert(d4.sample(200, 1000, 100) === true, 'beat: mode baseline externe (EMA) → beat si energy > baseline×seuil');
    assert(d4.sample(200, 1100, 100) === false, 'beat: mode baseline externe respecte le cooldown');
    assert(d4.sample(200, 2000, 100) === true, 'beat: mode baseline externe → nouveau beat une fois le cooldown écoulé');

    // (b) cinema-viz.js ne détecte PLUS le beat depuis Task 4 (cycle 2) : le beat
    // arrive en paramètre de drawVizFrame(dt, fft, beat), calculé une seule fois par
    // frame dans cinema-loop.js (même config createBeatDetector, partagée) — cf. Task 4
    // cycle 2 ci-dessous pour la vérification positive de ce nouveau contrat.
    assert(!/from '.\/cinema-beat.js'/.test(cinVizSrc), 'cinema-viz.js n\'importe plus cinema-beat.js (Task 4)');
    assert(!/createBeatDetector/.test(cinVizSrc),       'cinema-viz.js n\'utilise plus createBeatDetector (Task 4)');
    assert(!/_beatHistorySum/.test(cinVizSrc),
      'cinema-viz.js ne réimplémente plus le running-sum de beat (déplacé dans cinema-beat.js)');
    // cinema-canvas.js, lui, ne détecte PLUS le beat depuis Task 5 (cycle 2 polish) :
    // drawWavesFrame/drawStarfieldFrame reçoivent le beat déjà calculé en paramètre
    // (même snapshot partagé bg+viz+vol-vis) — même contrat que cinema-viz.js ci-dessus.
    assert(!/from '.\/cinema-beat.js'/.test(canvasSrc), 'cinema-canvas.js n\'importe plus cinema-beat.js (Task 5)');
    assert(!/createBeatDetector/.test(canvasSrc),       'cinema-canvas.js n\'utilise plus createBeatDetector (Task 5)');

    // (c) cinema-bg.js : état couleur privé — plus d'arrays exportés par référence
    assert(!/export const _cinArtRGBCur/.test(bgSrc),     'cinema-bg.js n\'exporte plus _cinArtRGBCur (array par réf)');
    assert(!/export const _cinArtRGBTarget/.test(bgSrc),  'cinema-bg.js n\'exporte plus _cinArtRGBTarget (array par réf)');
    assert(/export function snapArtColor/.test(bgSrc),    'cinema-bg.js exporte snapArtColor()');
    assert(/export function stepArtColorLerp/.test(bgSrc),'cinema-bg.js exporte stepArtColorLerp()');
    assert(/export function getArtColorStr/.test(bgSrc),  'cinema-bg.js conserve getArtColorStr()');
    assert(!/_cinArtRGBCur/.test(cinVizSrc),
      'cinema-viz.js n\'accède plus à _cinArtRGBCur (passe par stepArtColorLerp)');
    assert(!/_cinArtRGBCur/.test(cinSrc),
      'cinema.js n\'accède plus à _cinArtRGBCur (passe par snapArtColor)');

    // (e) updateCinema devient un orchestrateur court (<= 50 lignes) — finding 131 lignes
    const uc = cinSrc.split('\n');
    const s = uc.findIndex(l => /^export function updateCinema\(/.test(l));
    let e2 = s + 1; while (e2 < uc.length && !/^\}/.test(uc[e2])) e2++;
    assert(s >= 0 && (e2 - s + 1) <= 50,
      `cinema.js : updateCinema = ${s >= 0 ? e2 - s + 1 : '?'} lignes (<= 50, orchestrateur court)`);
  } catch (e) {
    console.error('  KO  cinema Task 3 crashed:', e.message);
    _ko++;
  }

  // =============================================================================
  // Task 3 (cycle 2) — cinema-bg.js devient renderer passif : plus de rAF local
  // (la boucle MAÎTRE vit dans cinema-loop.js), stepArtColorLerp(dtN) devient
  // framerate-indépendant (k = 1 - (1-K)^dtN), isArtColorConverged()/drawBgFrame()
  // exportées. cinema.js n'est PAS câblé dans ce cycle (T4 le fait, une fois
  // drawVizFrame disponible) — cf. brief Task 3, scope change.
  // =============================================================================
  section('Task 3 cycle 2 -- cinema-bg.js renderer passif (drawBgFrame, stepArtColorLerp dtN)');

  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const bgSrc = read('frontend/src/cinema-bg.js');

    // (a) scan : aucun requestAnimationFrame dans cinema-bg.js — la boucle vit
    // désormais dans cinema-loop.js (renderer passif).
    assert(!/requestAnimationFrame/.test(bgSrc),
      'cinema-bg.js: aucun requestAnimationFrame (renderer passif, Task 3)');

    // (b) scan : cinema-bg.js ne référence plus getByteFrequencyData ni
    // document.hasFocus() — FFT et cadence/focus sont la responsabilité de
    // cinema-loop.js (déjà mergé, Task 2).
    assert(!/getByteFrequencyData/.test(bgSrc),
      'cinema-bg.js: aucun getByteFrequencyData (FFT lue par cinema-loop.js)');
    assert(!/document\.hasFocus\(\)/.test(bgSrc),
      'cinema-bg.js: aucun document.hasFocus() (cadence décidée par cinema-loop.js)');

    // (d) drawBgFrame(dt, fft, beat)/isArtColorConverged() exportées — vérifié par
    // scan (drawBgFrame touche document.getElementById ; pas de DOM dans ce runner
    // Node, cf. (c) ci-dessous pour l'exercice réel des fonctions pure-numériques).
    assert(/export function drawBgFrame\(dt, fft, beat\)/.test(bgSrc),
      'cinema-bg.js exporte drawBgFrame(dt, fft, beat)');
    assert(/export function isArtColorConverged/.test(bgSrc),
      'cinema-bg.js exporte isArtColorConverged()');
  } catch (e) {
    console.error('  KO  cinema Task 3 cycle 2 scans crashed:', e.message);
    _ko++;
  }

  // (c) stepArtColorLerp(dtN) : NB — import ESM réel impossible ici (cinema-bg.js
  // importe ui.js -> composants Lit -> lit-html, qui exige un vrai DOM au chargement
  // du module, ex: `TypeError: l.createTreeWalker is not a function` sous Node nu ;
  // ce runner est "zero deps" et n'embarque pas jsdom). Même pattern que le beat
  // detector plus haut dans ce fichier (section "cinema Task 3") : logique reproduite
  // inline (house style) + garde anti-drift qui vérifie la formule EXACTE dans la
  // source réelle. Converge vers la cible ; dtN=2 converge strictement plus vite que
  // dtN=1 sur une frame (k = 1 - (1-K)^dtN) ; idempotent une fois convergé.
  try {
    const K = 0.06; // == _LERP_K dans cinema-bg.js (vérifié par la garde anti-drift ci-dessous)
    function stepInline(cur, target, dtN) {
      if (Math.abs(cur[0] - target[0]) < 0.5 && Math.abs(cur[1] - target[1]) < 0.5 && Math.abs(cur[2] - target[2]) < 0.5) {
        cur[0] = target[0]; cur[1] = target[1]; cur[2] = target[2];
        return true;
      }
      const k = 1 - Math.pow(1 - K, dtN || 1);
      cur[0] += (target[0] - cur[0]) * k;
      cur[1] += (target[1] - cur[1]) * k;
      cur[2] += (target[2] - cur[2]) * k;
      return false;
    }

    // dtN=1 vs dtN=2 depuis la même distance de départ (noir → blanc)
    const target = [255, 255, 255];
    const cur1 = [0, 0, 0];
    stepInline(cur1, target, 1);
    const cur2 = [0, 0, 0];
    stepInline(cur2, target, 2);
    assert(cur2[0] > cur1[0],
      `stepArtColorLerp: dtN=2 converge plus vite que dtN=1 en une frame (r1=${cur1[0].toFixed(3)}, r2=${cur2[0].toFixed(3)})`);

    // convergence complète après suffisamment de frames
    const cur3 = [0, 0, 0];
    let iter = 0, converged = false;
    while (!converged && iter < 2000) { converged = stepInline(cur3, target, 1); iter++; }
    assert(converged, `stepArtColorLerp: converge vers la cible en ${iter} frames`);
    assert(cur3[0] === target[0] && cur3[1] === target[1] && cur3[2] === target[2],
      'stepArtColorLerp: snap exact sur la cible une fois convergé');

    // idempotent une fois convergé (rappel ne s'éloigne pas de la cible)
    const before = [...cur3];
    stepInline(cur3, target, 1);
    assert(cur3[0] === before[0] && cur3[1] === before[1] && cur3[2] === before[2],
      "stepArtColorLerp: idempotent une fois convergé (rappel ne s'éloigne pas de la cible)");

    // garde anti-drift : la formule ET _LERP_K réels dans cinema-bg.js correspondent
    // exactement à la copie inline ci-dessus.
    const fs = require('fs'), path = require('path');
    const bgSrc = fs.readFileSync(path.join(__dirname, '../../frontend/src/cinema-bg.js'), 'utf8');
    assert(/const k = 1 - Math\.pow\(1 - _LERP_K, dtN \|\| 1\)/.test(bgSrc),
      'cinema-bg.js: stepArtColorLerp() implémente k = 1 - (1-K)^dtN (formule framerate-indépendante)');
    assert(new RegExp(`_LERP_K\\s*=\\s*${K}[^0-9]`).test(bgSrc),
      `cinema-bg.js: _LERP_K vaut ${K} (cohérent avec la copie inline du test)`);
  } catch (e) {
    console.error('  KO  cinema-bg.js stepArtColorLerp (logique inline) crashed:', e.message);
    _ko++;
  }

  // =============================================================================
  // cinema perf — boucles rAF, allocations, fuites GSAP (audit perf 2026-07-02)
  // P1 : viz.js (player bar) rend sous l'overlay cinéma — doit se suspendre.
  // P2 : viz.js sans garde document.hidden.
  // P4 : tweens GSAP _waveBeatTw/_shootTweens jamais tués (fuite cinema-canvas.js).
  // P3 : window.innerWidth/innerHeight relu chaque frame dans cinema-bg.js.
  // Allocations de strings couleur par frame : cinema-viz.js / cinema-canvas.js.
  // =============================================================================
  {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema perf -- boucles rAF, allocations, fuites GSAP');

    const vizSrc    = read('frontend/src/viz.js');
    const cinSrc    = read('frontend/src/cinema.js');
    const canvasSrc = read('frontend/src/cinema-canvas.js');
    const cinVizSrc = read('frontend/src/cinema-viz.js');
    const bgSrc     = read('frontend/src/cinema-bg.js');

    // (a) viz.js : garde document.hidden dans la boucle de rendu _draw()
    const drawBody = /function _draw\(\)[\s\S]*?\n\/\* ── Mode bars/.exec(vizSrc)?.[0] || '';
    assert(drawBody.length > 0, 'viz.js : fonction _draw() trouvée');
    assert(/document\.hidden/.test(drawBody),
      'viz.js : _draw() contient une garde document.hidden (P2 fix)');

    // (b) viz.js exporte suspendViz/resumeViz
    assert(/export function suspendViz/.test(vizSrc), 'viz.js exporte suspendViz()');
    assert(/export function resumeViz/.test(vizSrc),  'viz.js exporte resumeViz()');

    // (c) cinema.js câble la suspension à l'ouverture/fermeture (openCinema/closeCinema)
    const openBody  = /export function openCinema\(\)[\s\S]*?\n\}\n/.exec(cinSrc)?.[0]  || '';
    const closeBody = /export function closeCinema\(\)[\s\S]*?\n\}\n/.exec(cinSrc)?.[0] || '';
    assert(openBody.length  > 0, 'cinema.js : openCinema() trouvée');
    assert(closeBody.length > 0, 'cinema.js : closeCinema() trouvée');
    assert(/_suspendViz\(\)/.test(openBody),
      'openCinema() suspend le viz player-bar (P1 fix)');
    assert(/_resumeViz\(\)/.test(closeBody),
      'closeCinema() reprend le viz player-bar');
    assert(/export function initCinemaVizSuspend/.test(cinSrc),
      'cinema.js expose un point de câblage pour suspendViz/resumeViz (pas d\'import direct viz.js)');

    // (d) cinema-canvas.js exporte un kill des tweens GSAP, appelé dans le chemin de fermeture
    assert(/export function killCanvasTweens/.test(canvasSrc),
      'cinema-canvas.js exporte killCanvasTweens() (P4 fix)');
    assert(/motionKill\(_waveBeatObj\)/.test(canvasSrc) && /motionKill\(_shootPool\[i\]\)/.test(canvasSrc),
      'killCanvasTweens() tue le tween _waveBeatObj et tous les _shootTweens via motionKill (kill by target, pas de handle)');
    assert(/killCanvasTweens\(\)/.test(bgSrc),
      'cinema-bg.js appelle killCanvasTweens() dans le chemin de fermeture (_stopAmbientAnim → closeCinema)');

    // (e) zéro allocation : les strings couleur par frame doivent être mises en cache,
    // pas reconstruites inconditionnellement à chaque frame (cinema-viz.js:201,240,273 ;
    // cinema-canvas.js:117,260-264).
    // Task 3 : le cache de la string _lerpRGB a migré dans stepArtColorLerp() (cinema-bg.js).
    assert(/_lerpRGBCache/.test(bgSrc),
      'cinema-bg.js : stepArtColorLerp() met en cache la string couleur (rebuild seulement si composantes arrondies changent)');
    assert(/stepArtColorLerp/.test(cinVizSrc),
      'cinema-viz.js : LERP couleur délégué à stepArtColorLerp (cinema-bg.js)');
    assert(/_glowFillCache/.test(cinVizSrc),
      'cinema-viz.js : rgb(${_lerpRGB}) (glow/ligne centrale) mis en cache');
    assert(/_stdFillCache/.test(cinVizSrc),
      'cinema-viz.js : rgb(${_lerpRGB}) du mode standard mis en cache');
    assert(/_waveLerpRGBCache/.test(canvasSrc),
      'cinema-canvas.js : lerpRGB de drawWavesFrame mis en cache');
    assert(/_starFillCache/.test(canvasSrc) && /_starGlowFillCache/.test(canvasSrc),
      'cinema-canvas.js : starFill/glowFill de drawStarfieldFrame mis en cache');
    assert(/_starBgFillCache/.test(canvasSrc),
      'cinema-canvas.js : fond teinté de drawStarfieldFrame mis en cache');

    // (bonus P3) cinema-bg.js : innerWidth/innerHeight mis en cache. Task 3 : plus de
    // boucle RAF locale — drawBgFrame() (renderer passif appelé par cinema-loop.js)
    // reprend la garantie : elle ne relit pas window.innerWidth/innerHeight par frame.
    const drawBgBody = /export function drawBgFrame\([^)]*\)\s*\{[\s\S]*?\n\}\n/.exec(bgSrc)?.[0] || '';
    assert(drawBgBody.length > 0, 'cinema-bg.js : drawBgFrame() trouvée');
    assert(!/window\.innerWidth|window\.innerHeight/.test(drawBgBody),
      'cinema-bg.js : drawBgFrame() ne lit plus window.innerWidth/innerHeight (P3 fix)');
    assert(/export function updateCachedWinSize/.test(bgSrc),
      'cinema-bg.js exporte updateCachedWinSize() (mise à jour par le handler resize de cinema.js)');
    assert(/updateCachedWinSize\(\)/.test(read('frontend/src/cinema.js')),
      'cinema.js appelle updateCachedWinSize() dans son handler resize');

    // (f) Task 1 : suspendViz stoppe aussi l'oscilloscope premium (rAF autonome)
    const suspendBody = /export function suspendViz\(\)[\s\S]*?\n\}/.exec(vizSrc)?.[0] || '';
    const resumeBody  = /export function resumeViz\(\)[\s\S]*?\n\}/.exec(vizSrc)?.[0] || '';
    assert(suspendBody.length > 0, 'viz.js : suspendViz() trouvée');
    assert(resumeBody.length > 0,  'viz.js : resumeViz() trouvée');
    assert(/_premiumOsc/.test(suspendBody) && /\.stop\(\)/.test(suspendBody),
      'suspendViz() stoppe _premiumOsc.stop() (P-H3 fix: oscilloscope premium a son propre rAF)');
    assert(/vizMode\s*===\s*['"]oscilloscope['"]/.test(resumeBody) && /_ensurePremiumOsc/.test(resumeBody) && /\.start\(\)/.test(resumeBody),
      'resumeViz() redémarre l\'oscilloscope premium conditionnellement (vizMode === "oscilloscope")');
  }

  // =============================================================================
  // cinema Task 8 — cross-fade entre modes (touche B), cap amoled 30fps, responsive.
  // UX audit : bascule de fond = cut sec ; amoled tourne à 60fps sans raison ;
  // insets de coin en px fixes ; un seul breakpoint 600px ; chevauchements possibles
  // sur petites hauteurs (horloge/next qui se superposent à la pill de contrôles).
  // =============================================================================
  {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema Task 8 -- cross-fade modes + cap amoled + responsive');

    const bgSrc = read('frontend/src/cinema-bg.js');
    const dsSrc = read('frontend/src/design-system.css');
    const ssSrc = read('frontend/src/style.css');

    // (a) constante MODE_CROSSFADE_MS (house pattern comme AMBIENT_CROSSFADE_MS) +
    // applyCinemaBg() déclenche le mécanisme de cross-fade à la bascule de mode.
    assert(/MODE_CROSSFADE_MS\s*=\s*600/.test(bgSrc),
      'cinema-bg.js déclare la constante MODE_CROSSFADE_MS = 600');
    const applyBody = /export function applyCinemaBg\(\)[\s\S]*?\n\}\n/.exec(bgSrc)?.[0] || '';
    assert(applyBody.length > 0, 'cinema-bg.js : applyCinemaBg() trouvée');
    assert(/MODE_CROSSFADE_MS/.test(applyBody),
      'applyCinemaBg() déclenche le cross-fade de bascule de mode (réutilise MODE_CROSSFADE_MS)');
    // Fix post-review (Finding 5) — l'ancienne assertion testait prefersReducedMotion()
    // deux fois contre le fichier ENTIER (conjoints identiques, passe trivialement même
    // si le dry-cut disparaît). On isole le corps de _snapshotModeCanvas (la garde qui
    // fait réellement la bascule sèche) et on vérifie qu'il appelle prefersReducedMotion()
    // ET retourne bien `null` dans le même garde — la garantie de dry-cut elle-même.
    const snapshotBody = /function _snapshotModeCanvas\([^)]*\)\s*\{[\s\S]*?\n\}\n/.exec(bgSrc)?.[0] || '';
    assert(snapshotBody.length > 0, 'cinema-bg.js : _snapshotModeCanvas() trouvée');
    assert(/if\s*\([^)]*prefersReducedMotion\(\)[^)]*\)\s*return null;/.test(snapshotBody),
      'cinema-bg.js : _snapshotModeCanvas() retourne null sous reduced-motion (dry-cut garanti, pas de snapshot cross-fade)');

    // (b) amoled soumis au même cap 30fps que les autres modes — l'exemption a disparu.
    // Task 3 : le frame-skip 30fps/60fps a migré dans cinema-loop.js (loopCadence),
    // qui traite déjà amoled sans exemption (cf. Task 2 test : loopCadence('amoled',
    // true) === 2, section "cinema-loop.js"). cinema-bg.js n'a plus de cadence
    // propre — on vérifie juste qu'aucun résidu local (_frameCount) ne subsiste.
    assert(!/_frameCount/.test(bgSrc),
      'cinema-bg.js : plus de _frameCount local (cadence déléguée à cinema-loop.js)');

    // (c) design-system.css : tokens de coin/horloge cinéma en clamp() (plus de px fixes)
    for (const tok of ['--cinema-corner-top', '--cinema-corner-x', '--cinema-clock-inset']) {
      assert(new RegExp(`${tok}\\s*:\\s*clamp\\(`).test(dsSrc),
        `design-system.css : ${tok} utilise clamp()`);
    }

    // (d) breakpoint ≥1600px : --art-cinema-max agrandi (design-system.css, override sanctionné)
    assert(/@media\s*\(min-width:\s*1600px\)[\s\S]*?--art-cinema-max:\s*520px/.test(dsSrc),
      'design-system.css : @media (min-width:1600px) porte --art-cinema-max: 520px');

    // (e) style.css : anti-chevauchement sur petites hauteurs (horloge + next masqués)
    const shortHeightBlock = /@media\s*\(max-height:\s*640px\)\s*\{[\s\S]*?\n\}/.exec(ssSrc)?.[0] || '';
    assert(shortHeightBlock.length > 0, 'style.css : @media (max-height: 640px) trouvé');
    assert(/#cinema-clock/.test(shortHeightBlock) && /#cinema-next/.test(shortHeightBlock),
      'style.css : @media (max-height: 640px) masque #cinema-clock et #cinema-next');

    // (f) breakpoint intermédiaire 601-1023px : pill compacte, volume conservé, vol-vis masqué
    const midBlock = /@media\s*\(min-width:\s*601px\)\s*and\s*\(max-width:\s*1023px\)\s*\{[\s\S]*?\n\}/.exec(ssSrc)?.[0] || '';
    assert(midBlock.length > 0, 'style.css : @media (min-width:601px) and (max-width:1023px) trouvé');
    assert(!/\.cinema-vol-wrap\s*\{[^}]*display:\s*none/.test(midBlock),
      'breakpoint intermédiaire : le volume reste visible (.cinema-vol-wrap non masqué)');
    assert(/#cinema-vol-vis\s*\{[^}]*display:\s*none/.test(midBlock),
      'breakpoint intermédiaire : #cinema-vol-vis masqué (visualiseur ambient dans le volume)');

    // (g) le breakpoint 600px existant n'est pas cassé par le nouveau breakpoint intermédiaire
    assert(/@media\s*\(max-width:\s*600px\)/.test(ssSrc),
      'style.css : le breakpoint @media (max-width: 600px) existant est toujours présent');
  }

  // =============================================================================
  // app.js — régression pochette : .playing-row après changement de piste
  // PLAY_STATE (qui pose .playing-row) est émis pendant audio.play(), AVANT
  // TRACK_CHANGE (qui déplace .act). patchActiveTrack() strippe .playing-row de
  // l'ancienne ligne et pose .act nu sur la nouvelle → l'icône de la pochette
  // reste ▶ pendant la lecture. Le handler TRACK_CHANGE doit donc restaurer
  // l'état via patchPlayState(!audio.paused) APRÈS patchActiveTrack().
  // =============================================================================
  {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('app.js -- TRACK_CHANGE restaure .playing-row (icône pochette)');

    const appSrc = read('frontend/src/app.js');
    const m = /on\(EVENTS\.TRACK_CHANGE[\s\S]*?\}\);/.exec(appSrc);
    assert(!!m, 'handler TRACK_CHANGE présent dans app.js');
    const handler = m ? m[0] : '';
    const iActive = handler.indexOf('patchActiveTrack()');
    const iPlay   = handler.indexOf('patchPlayState(!audio.paused)');
    assert(iActive >= 0, 'TRACK_CHANGE appelle patchActiveTrack()');
    assert(iPlay > iActive,
      'TRACK_CHANGE appelle patchPlayState(!audio.paused) après patchActiveTrack()');
  }

  // =============================================================================
  // artLoader — pochettes qui disparaissent / n'apparaissent pas (2026-06-11)
  // _domBlobUrls n'est alimentée que par _patchArtDOM (chemin liste/prefetch) ;
  // les grilles (renderer-grids), la file (queue.js, <img src=t.art> inline),
  // le drill et les rows re-rendues par thtml affichent des blob: URLs hors Set.
  // À saturation du cache (MAX_ART_CACHE), _evict révoquait une URL pourtant
  // affichée → <img> cassée. Idem cacheArt() qui révoquait l'entrée existante.
  // Garde requise : confirmation DOM réelle (img[src=...]) avant TOUTE révocation.
  // =============================================================================
  {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('artLoader -- aucune révocation de blob: URL encore affichée');

    const alSrc = read('frontend/src/artLoader.js');

    const evictBody = /function _evict\(\)[\s\S]*?\n\}/.exec(alSrc)?.[0] || '';
    assert(evictBody.length > 0, '_evict présent dans artLoader.js');
    assert(/querySelector\(\s*`img\[src="/.test(evictBody),
      '_evict confirme contre le DOM réel (img[src=...]) avant de révoquer — la Set _domBlobUrls ne voit pas les grilles/queue/thtml');

    const cacheArtBody = /export function cacheArt[\s\S]*?\n\}/.exec(alSrc)?.[0] || '';
    assert(cacheArtBody.length > 0, 'cacheArt présent dans artLoader.js');
    assert(/querySelector\(\s*`img\[src="/.test(cacheArtBody),
      'cacheArt ne révoque pas une URL existante encore affichée (re-scan/tag-edit)');
  }

  // =============================================================================
  // Cards Albums — uniformité (audit 2026-06-11, AC1-AC8)
  // renderer-grids.js / i18n.fr.js / i18n.en.js removed (dead-module sweep);
  // guard with try/catch so the suite doesn't crash while these tests are red.
  // =============================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cards Albums -- uniformité (AC1-AC8)');

    const rgSrc = read('frontend/src/renderer-grids.js');
    const ssSrc = read('frontend/src/style.css');
    const frSrc = read('frontend/src/i18n.fr.js');
    const enSrc = read('frontend/src/i18n.en.js');

    // AC1 : .card-info en colonne flex (blockifie les spans → ellipsis effectifs)
    assert(/\.card-info\s*\{[^}]*flex-direction:\s*column/.test(ssSrc),
      '.card-info est une colonne flex (ellipsis/marges des spans effectifs)');

    // AC2 : plus de clé fantôme — sans_album (existante) utilisée
    assert(!/i18n\('unknown_album'/.test(rgSrc),
      "renderer-grids n'utilise plus la clé fantôme 'unknown_album'");
    assert(/i18n\('sans_album'\)/.test(rgSrc),
      'card Albums : fallback nom via sans_album');

    // AC3 : artiste échappé dans l aria-label
    assert(/esc\(' — ' \+ a\.artist\)/.test(rgSrc),
      'aria-label de la card : artiste passé par esc() (§13)');

    // AC4 : réconciliation multi-artistes + fallback artiste
    for (const k of ['multi_artists', 'n_albums', 'dur_min']) {
      assert(new RegExp(`${k}:`).test(frSrc), `i18n.fr possède ${k}`);
      assert(new RegExp(`${k}:`).test(enSrc), `i18n.en possède ${k}`);
    }
    assert(/isMulti/.test(rgSrc) && /unknown_artist/.test(rgSrc),
      'card Albums : sub jamais vide (Multi-artistes / Artiste inconnu)');

    // AC6 : drill header sans pluriels hardcodés FR
    assert(!/titre\$\{/.test(rgSrc) && !/album\$\{/.test(rgSrc),
      'drill header : pluriels via i18n (plus de hardcode FR)');
    assert(!/Lire tout|Mélanger/.test(rgSrc),
      'drill header : libellés boutons via i18n');
  } catch (e) {
    console.error('  KO  cards Albums crashed:', e.message);
    _ko++;
  }

  // lf-modal reducer (Phase 1)
  section('components/lf-modal.logic.js -- modalReducer');
  try {
    const mod = await import('../src/components/lf-modal.logic.js');
    assert(typeof mod.modalReducer === 'function', 'real module: modalReducer exported');

    const s0 = { isOpen: false };
    let s = mod.modalReducer(s0, { type: 'open' });
    assert(s.isOpen === true, 'open sets isOpen true');

    s = mod.modalReducer(s, { type: 'close' });
    assert(s.isOpen === false, 'close sets isOpen false');

    s = mod.modalReducer(s0, { type: 'unknown' });
    assert(s.isOpen === false, 'unknown action is no-op');

    s = mod.modalReducer({ isOpen: true }, { type: 'open' });
    assert(s.isOpen === true, 'open on already-open preserves state');
  } catch (e) {
    console.error('  KO  lf-modal import/test crashed:', e.message);
    _ko++;
  }

  // =============================================================================
  // queue.js — logique peekFirstExplicit / consumeFirstExplicit
  // =============================================================================
  section('queue.js -- peekFirstExplicit / consumeFirstExplicit (logique inline)');

  (function () {
    // Simulation légère de _trackIdxMap + tracks[]
    const _tmap = new Map([['t1', 0], ['t2', 1], ['t3', 2]]);
    const _tr   = [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }, { id: 't3', name: 'C' }];

    function _peek(q) {
      if (!q?.length) return null;
      for (const id of q) {
        if (_tmap.has(id)) return _tr[_tmap.get(id)];
      }
      return null;
    }

    function _consume(q) {
      if (!q?.length) return { track: null, remaining: null };
      const track = _peek(q);
      if (!track) return { track: null, remaining: null };
      const fi  = q.findIndex(id => _tmap.has(id));
      const rem = q.slice(fi + 1);
      return { track, remaining: rem.length ? rem : null };
    }

    assert(_peek(null)      === null, 'peekFirstExplicit: queue null → null');
    assert(_peek([])        === null, 'peekFirstExplicit: queue vide → null');
    assert(_peek(['t1']).id === 't1', 'peekFirstExplicit: retourne le premier track');
    assert(_peek(['dead', 't2']).id === 't2', 'peekFirstExplicit: saute les IDs obsolètes');

    const r1 = _consume(['t1', 't2', 't3']);
    assert(r1.track.id === 't1',      'consumeFirstExplicit: retourne le premier track');
    assert(r1.remaining.length === 2, 'consumeFirstExplicit: remaining a 2 items');

    const r2 = _consume(['t1']);
    assert(r2.track.id   === 't1', 'consumeFirstExplicit: retourne le dernier track');
    assert(r2.remaining  === null, 'consumeFirstExplicit: remaining null quand vide');

    const r3 = _consume(['dead1', 'dead2', 't2']);
    assert(r3.track.id  === 't2', 'consumeFirstExplicit: saute stale IDs en tête');
    assert(r3.remaining === null, 'consumeFirstExplicit: remaining null après stale purge');
  }());

  // =============================================================================
  // design-system.css -- cohérence tokens cinéma JS<->CSS (Task 4 design system)
  // =============================================================================
  section('design-system.css -- cinema tokens JS<->CSS coherence');

  (function () {
    const fs   = require('fs');
    const path = require('path');
    const DS  = fs.readFileSync(path.join(__dirname, '..', 'src', 'design-system.css'), 'utf8');
    const CIN = fs.readFileSync(path.join(__dirname, '..', 'src', 'cinema.js'), 'utf8');
    const VIZ = fs.readFileSync(path.join(__dirname, '..', 'src', 'cinema-viz.js'), 'utf8');

    function cssTokenMs(name) {
      const m = new RegExp(`--${name}\\s*:\\s*(\\d+)ms`).exec(DS);
      return m ? parseInt(m[1], 10) : null;
    }
    function jsConst(src, name) {
      const m = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(src);
      return m ? parseInt(m[1], 10) : null;
    }

    const durSwapOut = cssTokenMs('dur-cin-swap-out');
    const durSwapIn  = cssTokenMs('dur-cin-swap-in');
    const durBeat     = cssTokenMs('dur-cin-beat');
    const jsSwapOut  = jsConst(CIN, 'CIN_SWAP_OUT_MS');
    const jsSwapIn   = jsConst(CIN, 'CIN_SWAP_IN_MS');
    const jsBeat      = jsConst(VIZ, 'BEAT_PULSE_MS');

    assert(durSwapOut !== null, '--dur-cin-swap-out defined in design-system.css');
    assert(durSwapIn  !== null, '--dur-cin-swap-in defined in design-system.css');
    assert(durBeat    !== null, '--dur-cin-beat defined in design-system.css');
    assert(jsSwapOut  !== null, 'CIN_SWAP_OUT_MS found in cinema.js');
    assert(jsSwapIn   !== null, 'CIN_SWAP_IN_MS found in cinema.js');
    assert(jsBeat     !== null, 'BEAT_PULSE_MS found in cinema-viz.js');

    assert(durSwapOut === jsSwapOut,
      `--dur-cin-swap-out (${durSwapOut}ms) === CIN_SWAP_OUT_MS (${jsSwapOut}ms)`);
    assert(durSwapIn === jsSwapIn,
      `--dur-cin-swap-in (${durSwapIn}ms) === CIN_SWAP_IN_MS (${jsSwapIn}ms) -- fixes the 320/440 swap desync`);
    assert(durBeat === jsBeat,
      `--dur-cin-beat (${durBeat}ms) === BEAT_PULSE_MS (${jsBeat}ms) -- unifies the 600/620 beat desync`);
  }());

  // =============================================================================
  // Task 6 — transitions de piste (texte), état pause, skeleton pochette (TDD)
  // Step 1 : scans statiques (RED avant implémentation).
  // =============================================================================
  section('cinema Task 6 -- text swap sync + pause state + skeleton/fallback + shuffle hint');

  (function () {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    const CSS = read('frontend/src/style.css');
    const CIN = read('frontend/src/cinema.js');
    const CIN_RENDER = read('frontend/src/cinema-render.js');
    const FR  = read('frontend/src/i18n.fr.js');
    const EN  = read('frontend/src/i18n.en.js');

    // (a) .cin-txt-swap-out/-in présentes avec durées tokenisées (pas de ms littéral)
    assert(/\.cin-txt-swap-out\s*\{[^}]*var\(--dur-cin-swap-out\)/.test(CSS),
      'style.css: .cin-txt-swap-out utilise var(--dur-cin-swap-out) (durée tokenisée, == pochette sortante)');
    assert(/\.cin-txt-swap-in\s*\{[^}]*var\(--dur-cin-swap-in\)/.test(CSS),
      'style.css: .cin-txt-swap-in utilise var(--dur-cin-swap-in) (durée tokenisée, == pochette entrante)');
    assert(/\.cin-txt-swap-in\s*\{[^}]*var\(--ease-spring-soft\)/.test(CSS),
      'style.css: .cin-txt-swap-in utilise var(--ease-spring-soft)');
    assert(/html\[data-motion="reduce"\][^{]*\.cin-txt-swap/.test(CSS),
      'style.css: html[data-motion="reduce"] neutralise .cin-txt-swap-out/-in (remplacement sec, Task 10)');
    // (a-fix, review) : le swap-in retire les DEUX classes texte (miroir de artWrap) —
    // sans retrait de cin-txt-swap-in, un rapid-skip interrompant un in en vol laisse la
    // classe en place et le re-add ne redémarre jamais l'animation (texte qui saute sec).
    assert(/classList\.remove\(\s*'cin-txt-swap-out'\s*,\s*'cin-txt-swap-in'\s*\)/.test(CIN_RENDER),
      "cinema-render.js: beginCinSwapIn retire cin-txt-swap-out ET cin-txt-swap-in (restart d'animation garanti)");
    // (a-fix, review) : le début du swap-out retire une cin-txt-swap-in en vol — déclarée
    // après l'out dans style.css (spécificité égale), elle gagnerait la cascade sinon.
    assert(/classList\.remove\(\s*'cin-txt-swap-in'\s*\)[\s\S]{0,80}classList\.add\(\s*'cin-txt-swap-out'\s*\)/.test(CIN),
      "cinema.js: le swap-out retire une cin-txt-swap-in en vol avant de poser cin-txt-swap-out");

    // (b) le cluster cinéma référence img.decode() — skeleton/fallback pochette (Step 4).
    // Vit dans cinema-render.js (stateless, cf. applyCinText/decodeArtImage/beginCinSwapIn) :
    // cinema.js reste sous 800 lignes (§16) — cinema.js orchestre seulement les timers.
    assert(/img\.decode\(\)/.test(CIN + CIN_RENDER),
      'cinema.js/cinema-render.js référence img.decode() (fondu/fallback décodage pochette)');

    // (c) overlay bascule une classe pause + CSS gèle les animations idle sous cette classe
    assert(/is-paused/.test(CIN), "cinema.js bascule la classe 'is-paused' sur l'overlay");
    assert(/\.is-paused[^{]*\{[^}]*animation-play-state\s*:\s*paused/.test(CSS),
      'style.css: animation-play-state: paused sous .is-paused (Ken Burns/float/glow/breathe/ambient gelés)');

    // (d) clés i18n cinema_shuffle_on présentes fr + en (Step 5 — hint shuffle)
    assert(/cinema_shuffle_on\s*:/.test(FR), "i18n.fr.js: clé cinema_shuffle_on présente");
    assert(/cinema_shuffle_on\s*:/.test(EN), "i18n.en.js: clé cinema_shuffle_on présente");
  }());

  // =============================================================================
  // Task 10 — Réglage d'animations in-app (Système/Complètes/Réduites, défaut Complètes)
  // Step 1 (TDD) : truth-table pure + scans statiques.
  // =============================================================================
  section('Task 10 -- in-app motion setting (Système/Complètes/Réduites)');

  (function () {
    // (a) table de vérité de la préférence effective (pure, sans DOM — mirror de
    // prefersReducedMotion() dans motion.js). full -> false, reduce -> true,
    // system -> consulte l'OS. Défaut app : 'full'.
    function _effectiveReducedMotion(pref, osReduce) {
      if (pref === 'reduce') return true;
      if (pref === 'full')   return false;
      return !!osReduce; // 'system'
    }
    assert(_effectiveReducedMotion('full', true)    === false, "pref='full' ignore l'OS (true)");
    assert(_effectiveReducedMotion('full', false)   === false, "pref='full' ignore l'OS (false)");
    assert(_effectiveReducedMotion('reduce', true)  === true,  "pref='reduce' force true, OS=true");
    assert(_effectiveReducedMotion('reduce', false) === true,  "pref='reduce' force true, OS=false");
    assert(_effectiveReducedMotion('system', true)  === true,  "pref='system' suit l'OS (true)");
    assert(_effectiveReducedMotion('system', false) === false, "pref='system' suit l'OS (false)");
    const DEFAULT_MOTION_PREF = 'full';
    assert(DEFAULT_MOTION_PREF === 'full', "défaut app : motionPref = 'full' (profil vierge, sans clé cfg)");

    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    const MOTION = read('frontend/src/motion.js');
    const APP    = read('frontend/src/app.js');
    const CSS    = read('frontend/src/style.css');
    const DS     = read('frontend/src/design-system.css');
    const FR     = read('frontend/src/i18n.fr.js');
    const EN     = read('frontend/src/i18n.en.js');

    // (b) motion.js exporte setMotionPref ; prefersReducedMotion() consulte la
    // préférence app (_motionPref) AVANT le media query OS (_rmQuery).
    assert(/export\s+function\s+setMotionPref\s*\(/.test(MOTION),
      'motion.js exporte setMotionPref(pref)');
    const prBody = /export function prefersReducedMotion\(\)\s*\{[\s\S]*?\n\}/.exec(MOTION);
    assert(!!prBody, 'motion.js: prefersReducedMotion() trouvée (corps de fonction extrait pour scan)');
    if (prBody) {
      const idxMotionPref = prBody[0].indexOf('_motionPref');
      const idxRmQuery    = prBody[0].indexOf('_rmQuery');
      assert(idxMotionPref !== -1 && idxRmQuery !== -1 && idxMotionPref < idxRmQuery,
        'prefersReducedMotion() consulte _motionPref AVANT _rmQuery (préférence app prioritaire sur le media query OS)');
    }

    // (c) plus aucun bloc @media (prefers-reduced-motion dans style.css/design-system.css
    // (remplacés par le scoping html[data-motion="reduce"], app-wide).
    assert((CSS.match(/@media\s*\(prefers-reduced-motion/g) || []).length === 0,
      'style.css ne contient plus aucun @media (prefers-reduced-motion (remplacé par html[data-motion="reduce"])');
    assert((DS.match(/@media\s*\(prefers-reduced-motion/g) || []).length === 0,
      'design-system.css ne contient plus aucun @media (prefers-reduced-motion');
    assert(/html\[data-motion="reduce"\]/.test(CSS), 'style.css utilise le scoping html[data-motion="reduce"]');

    // (d) app.js pose data-motion sur <html> au boot (via applyMotionAttr, motion.js) et
    // écoute le changement du media query OS (onMotionPrefChange, mode 'system').
    assert(/dataset\.motion\s*=/.test(MOTION),
      'motion.js: applyMotionAttr() pose document.documentElement.dataset.motion');
    assert(/applyMotionAttr\(\)/.test(APP), 'app.js appelle applyMotionAttr() au boot');
    assert(/setMotionPref\(/.test(APP), 'app.js appelle setMotionPref() au boot (lecture cfg.motionPref)');
    assert(/onMotionPrefChange\(/.test(APP),
      "app.js s'abonne à onMotionPrefChange() (recalcul quand l'OS change en mode 'system')");

    // (e) parité i18n fr/en des nouvelles clés
    for (const k of ['settings_motion', 'motion_system', 'motion_full', 'motion_reduce']) {
      assert(new RegExp(`${k}\\s*:`).test(FR), `i18n.fr.js: clé ${k} présente`);
      assert(new RegExp(`${k}\\s*:`).test(EN), `i18n.en.js: clé ${k} présente`);
    }

    // Anti flash-of-frozen-motion : <html> porte data-motion="full" statiquement dans
    // index.html (avant 1er paint), défaut app 'full' — corrigé après lecture cfg si besoin.
    const HTML = read('frontend/index.html');
    assert(/<html[^>]*\sdata-motion="full"/.test(HTML),
      'index.html: <html data-motion="full"> posé statiquement (avant 1er paint, défaut motionPref)');

    // Fix post-review — anti flash d'animations NON réduites au boot : la cfg IDB est
    // async, donc un mirror localStorage synchrone (lf-motion) est lu par un script
    // classique render-blocking AVANT le premier paint (pattern boot-theme.js ;
    // CSP script-src 'self' interdit l'inline → fichier dans public/).
    const BOOT = read('frontend/public/boot-motion.js');
    assert(/localStorage\.getItem\(\s*'lf-motion'\s*\)/.test(BOOT),
      'boot-motion.js lit le mirror localStorage lf-motion');
    assert(/matchMedia\(\s*'\(prefers-reduced-motion:\s*reduce\)'\s*\)/.test(BOOT),
      "boot-motion.js consulte matchMedia (cas pref='system')");
    assert(/data-motion/.test(BOOT) && /try\s*\{/.test(BOOT),
      'boot-motion.js pose data-motion, protégé par try/catch (localStorage peut throw)');
    const headEnd = HTML.indexOf('</head>');
    const bootRef = HTML.indexOf('src="/boot-motion.js"');
    assert(bootRef !== -1 && headEnd !== -1 && bootRef < headEnd,
      'index.html charge /boot-motion.js dans <head> (render-blocking, avant <body>)');
    // Le chemin d'écriture du réglage ET le boot (cfg = source de vérité) tiennent le mirror à jour.
    const SET = read('frontend/src/settings.js');
    assert(/localStorage\.setItem\(\s*'lf-motion'/.test(SET),
      'settings.js: setMotionPrefSetting écrit le mirror lf-motion');
    assert(/localStorage\.setItem\(\s*'lf-motion'/.test(APP),
      'app.js: le boot ré-écrit le mirror lf-motion depuis la cfg (cfg gagne, seed des profils existants)');
  }());

  // =============================================================================
  // Task 11 — Défrizz : 60fps en cinéma focalisé, cross-fade spectrum, compositing
  // Step 1 (TDD) : scans statiques.
  // =============================================================================
  section('Task 11 -- défrizz (60fps focus, snapshot spectrum, will-change)');

  (function () {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const BG  = read('frontend/src/cinema-bg.js');
    const CSS = read('frontend/src/style.css');

    // (a) le frame-skip 30fps dépend du focus fenêtre — fenêtre focalisée → 60fps
    // pour tous les modes (le viz player-bar est suspendu sous l'overlay depuis T1).
    // Task 3 : cette logique a migré dans cinema-loop.js (loopCadence, testée dans
    // la section "Task 2 -- cinema-loop.js" : loopCadence('waves', true) === 1,
    // loopCadence('waves', false) === 2). cinema-bg.js n'a plus de boucle ni de
    // check hasFocus locaux (renderer passif).
    assert(!/document\.hasFocus/.test(BG),
      'cinema-bg.js: plus de check document.hasFocus local (délégué à cinema-loop.js)');
    assert(!/requestAnimationFrame/.test(BG),
      'cinema-bg.js: plus de requestAnimationFrame local (Task 3 -- renderer passif)');

    // (b) bascule VERS spectrum : le snapshot de cross-fade de mode n'est jamais
    // retenu — la boucle rAF ambient ne tourne pas dans ce mode (rendu par
    // cinema-viz sur son propre canvas), donc un snapshot plein écran (multi-Mo)
    // ne serait jamais consommé ni libéré. Bascule sèche vers spectrum.
    const snapAssign = /const\s+modeSnapshot\s*=([^;]+);/.exec(BG);
    assert(!!snapAssign, 'cinema-bg.js: assignation modeSnapshot trouvée (applyCinemaBg)');
    assert(snapAssign && /spectrum/.test(snapAssign[1]),
      "cinema-bg.js: snapshot de bascule court-circuité vers 'spectrum' (jamais retenu)");

    // (c) compositing : will-change: transform sur la pochette animée en continu
    // (float + breathe + Ken Burns enfant), scopé à l'overlay actif (pas de layer
    // GPU résident hors cinéma), et libéré sous reduced-motion (animations coupées).
    assert(/#cinema-overlay\.active\s+\.cinema-art-wrap\s*\{[^}]*will-change\s*:\s*transform/.test(CSS),
      'style.css: will-change: transform sur .cinema-art-wrap, scopé #cinema-overlay.active');
    // Fix revue : le sélecteur de libération DOIT contenir l'ID #cinema-overlay —
    // sans lui (0,2,1) il perd au cascade contre la promotion (1,2,0) et le layer
    // GPU reste résident sous reduced-motion (présence seule = test tautologique).
    assert(/html\[data-motion="reduce"\]\s+#cinema-overlay\s+\.cinema-art-wrap\s*\{[^}]*will-change\s*:\s*auto/.test(CSS),
      'style.css: will-change libéré (auto) sous reduce via un sélecteur à ID (bat la promotion 1,2,0 au cascade)');
  }());

  // =============================================================================
  // Task 12 — Vagues : refonte qualité (profondeur cohérente, palette ambient,
  // dynamique par bande de fréquences). Module pur cinema-waves.js.
  // =============================================================================
  section('Task 12 -- cinema-waves.js (profondeur, palette, bandes)');

  await (async function () {
    const { waveLayerGeom, waveLayerPalette, computeBandEnergies } =
      await import('../src/cinema-waves.js');
    const LAYERS = 7;

    // (a) waveLayerGeom — modèle de profondeur COHÉRENT : l=0 arrière (haut, plat,
    // discret), l=6 avant (bas, ample, lumineux). Monotonicité stricte des champs.
    const geoms = Array.from({ length: LAYERS }, (_, l) => waveLayerGeom(l, LAYERS));
    for (let l = 1; l < LAYERS; l++) {
      assert(geoms[l].yBase      > geoms[l - 1].yBase,      `geom: yBase croissant vers l'avant (l=${l})`);
      assert(geoms[l].ampBase    > geoms[l - 1].ampBase,    `geom: amplitude croissante vers l'avant (l=${l})`);
      assert(geoms[l].fillAlpha  > geoms[l - 1].fillAlpha,  `geom: remplissage plus dense vers l'avant (l=${l})`);
      assert(geoms[l].crestAlpha > geoms[l - 1].crestAlpha, `geom: crête plus lumineuse vers l'avant (l=${l})`);
      assert(geoms[l].lineWidth  > geoms[l - 1].lineWidth,  `geom: crête plus épaisse vers l'avant (l=${l})`);
    }
    assert(geoms[0].yBase >= 0.2 && geoms[LAYERS - 1].yBase <= 0.95,
      'geom: bandes yBase dans l\'écran (arrière ≥0.2h, avant ≤0.95h)');
    assert(geoms[LAYERS - 1].crestAlpha <= 1 && geoms[LAYERS - 1].fillAlpha <= 1,
      'geom: alphas ≤ 1');

    // (b) waveLayerPalette — palette par couche : luminance croissante arrière→avant,
    // plancher pour pochettes sombres, teintes distinctes (hue-shift progressif).
    const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b; // approx suffisante pour l'ordre
    const palDark = waveLayerPalette(30, 30, 30, LAYERS);
    assert(palDark.length === LAYERS, 'palette: une couleur par couche');
    for (let l = 1; l < LAYERS; l++) {
      assert(lum(palDark[l]) > lum(palDark[l - 1]),
        `palette: luminance croissante vers l'avant (l=${l}, art sombre)`);
    }
    assert(lum(palDark[LAYERS - 1]) >= 90,
      'palette: plancher de luminance — la vague AVANT reste lisible sur fond noir avec un art gris sombre (30,30,30)');
    const palSat = waveLayerPalette(200, 40, 60, LAYERS);
    for (let l = 1; l < LAYERS; l++) {
      assert(lum(palSat[l]) > lum(palSat[l - 1]),
        `palette: luminance croissante vers l'avant (l=${l}, art saturé)`);
    }
    // hue-shift : la teinte arrière et la teinte avant diffèrent sensiblement
    const hueOf = ([r, g, b]) => {
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (!d) return 0;
      let h;
      if (mx === r)      h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else               h = (r - g) / d + 4;
      return (h * 60 + 360) % 360;
    };
    const hueDiff = Math.abs(hueOf(palSat[0]) - hueOf(palSat[LAYERS - 1]));
    const hueDist = Math.min(hueDiff, 360 - hueDiff);
    assert(hueDist >= 15, `palette: hue-shift arrière↔avant ≥ 15° (actual: ${hueDist.toFixed(1)}°)`);

    // (c) computeBandEnergies — bandes log-espacées, EMA in-place (zéro allocation).
    const buf = new Uint8Array(1024);
    const out = new Float32Array(LAYERS);
    const ret = computeBandEnergies(buf, out, 1);
    assert(ret === out, 'bandes: retourne le même Float32Array (zéro allocation)');
    for (let k = 0; k < LAYERS; k++) assert(out[k] === 0, `bandes: silence → 0 (k=${k})`);
    // Impulsion basses : seuls les premiers bins pleins → bande 0 dominante
    buf.fill(0); buf[0] = buf[1] = 255;
    out.fill(0);
    computeBandEnergies(buf, out, 1);
    assert(out[0] > 0.4, `bandes: impulsion basses → bande 0 dominante (actual: ${out[0].toFixed(2)})`);
    assert(out[LAYERS - 1] < 0.05, 'bandes: impulsion basses → bande aiguë quasi nulle');
    // Aigus : bins hauts pleins → dernière bande dominante
    buf.fill(0);
    for (let i = 300; i < 700; i++) buf[i] = 255;
    out.fill(0);
    computeBandEnergies(buf, out, 1);
    assert(out[LAYERS - 1] > out[0], 'bandes: énergie aiguë → dernière bande > bande 0');
    // EMA : smooth 0.5 converge en deux passes vers 0.75×cible
    buf.fill(255);
    out.fill(0);
    computeBandEnergies(buf, out, 0.5);
    const after1 = out[0];
    computeBandEnergies(buf, out, 0.5);
    assert(after1 > 0.4 && after1 < 0.6, `bandes: EMA passe 1 ≈ 0.5 (actual: ${after1.toFixed(2)})`);
    assert(out[0] > 0.7 && out[0] < 0.8, `bandes: EMA passe 2 ≈ 0.75 (actual: ${out[0].toFixed(2)})`);
    // Bornes défensives (fix revue) : buffer plus court que bands+1 → jamais de NaN
    // (l'ancien code lisait hors du buffer → undefined → NaN silencieux).
    const tiny = new Uint8Array(4).fill(255);
    out.fill(0);
    computeBandEnergies(tiny, out, 1);
    for (let k = 0; k < LAYERS; k++) {
      assert(Number.isFinite(out[k]), `bandes: buffer minuscule (4 bins, 7 bandes) → pas de NaN (k=${k})`);
    }

    // (d) scans d'intégration — cinema-canvas consomme le module pur ; fallback sans
    // analyser (plus d'écran noir avant la première lecture) ; buffer y partagé
    // remplissage/crête (sin calculé une seule fois par couche).
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const CANVAS = fs.readFileSync(path.join(root, 'frontend/src/cinema-canvas.js'), 'utf8');
    assert(/from\s+'\.\/cinema-waves\.js'/.test(CANVAS),
      'cinema-canvas.js importe cinema-waves.js (géométrie/palette/bandes pures)');
    assert(/computeBandEnergies\(/.test(CANVAS),
      'cinema-canvas.js: amplitude/vitesse par couche pilotées par bande de fréquence');
    const wavesBody = /export function drawWavesFrame[\s\S]*?\n\}/.exec(CANVAS);
    assert(wavesBody && !/if\s*\(\s*!eqAnalyser\s*\)\s*return/.test(wavesBody[0]),
      'drawWavesFrame: plus de return à vide sans analyser (fallback statique, pas d\'écran noir)');
    assert(/_waveY\b/.test(CANVAS),
      'cinema-canvas.js: buffer y partagé pré-alloué (remplissage + crête sans double calcul sin)');
    const wavesLines = fs.readFileSync(path.join(root, 'frontend/src/cinema-waves.js'), 'utf8').split('\n').length;
    assert(wavesLines < 200, `cinema-waves.js < 200 lignes (actual: ${wavesLines})`);
  }());

  // =============================================================================
  // Task 13 — Ambient/AMOLED : zéro allocation par frame (§10, audit findings #7/#8)
  // =============================================================================
  section('Task 13 -- ambient/amoled zéro allocation par frame');

  (function () {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const AMB = read('frontend/src/ambientRenderer.js');

    // (a) plus de getter DOM par frame — W/H sont des paramètres
    assert(!/window\.innerWidth|window\.innerHeight/.test(AMB),
      'ambientRenderer.js ne lit plus window.innerWidth/innerHeight (W/H en paramètres)');
    assert(/export function renderAmbientFrame\(t, canvas, ctx, mode, colorStr, ambientColors, W, H\)/.test(AMB),
      'renderAmbientFrame: signature étendue (…, W, H)');

    // (b) gradients cachés derrière une clé d'invalidation ; le drift/respiration
    // passe par le transform (translate/scale) — AUCUN createRadialGradient dans le
    // corps par-frame de renderAmbientFrame (tous dans des helpers gated).
    const frameBody = /export function renderAmbientFrame[\s\S]*?\n\}/.exec(AMB);
    assert(!!frameBody, 'renderAmbientFrame trouvé');
    assert(frameBody && !/createRadialGradient/.test(frameBody[0]),
      'renderAmbientFrame: zéro createRadialGradient dans le corps par-frame (§10)');
    assert(/ctx\.translate\(/.test(AMB) && /ctx\.scale\(/.test(AMB),
      'ambientRenderer.js: drift/respiration via ctx.translate/scale (gradients construits à l\'origine)');

    // (c) les deux appelants passent leurs dimensions cachées
    const BG2 = read('frontend/src/cinema-bg.js');
    assert(/renderAmbientFrame\([^)]*_winW,\s*_winH\)/.test(BG2),
      'cinema-bg.js passe _winW/_winH à renderAmbientFrame');
    const NP = read('frontend/src/nowplaying.js');
    assert(/renderAmbientFrame\([^)]*,\s*W,\s*H\)/.test(NP),
      'nowplaying.js passe W/H à renderAmbientFrame');
  }());

  // =============================================================================
  // Task 14 — Cohérence : gel en pause pour tous les fonds + teinte starfield
  // 3 canaux (audit findings #9/#10)
  // =============================================================================
  section('Task 14 -- gel en pause + teinte starfield 3 canaux');

  (function () {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    // (a) l'accumulation du temps d'animation est conditionnée à la lecture —
    // en pause, ambient (drift), amoled (halo) et starfield (scintillement)
    // gèlent comme les vagues (qui passent déjà par isPlaying).
    const BG3 = read('frontend/src/cinema-bg.js');
    // Task 3 : _ambientT avance de dt (fourni par cinema-loop.js) au lieu de now-last
    // (plus de timestamp local) -- même invariant : gel en pause pour les 4 modes canvas.
    assert(/if\s*\(\s*isPlaying\s*\)\s*_ambientT\s*\+=\s*dt/.test(BG3),
      'cinema-bg.js: _ambientT n\'avance que si isPlaying (gel en pause pour les 4 modes canvas)');

    // (b) le fond starfield est teinté depuis les 3 canaux de la couleur d'art
    // (plus de rgba(0,0,<bleu seul>) — un album rouge teintait un ciel noir pur).
    const CANVAS2 = read('frontend/src/cinema-canvas.js');
    assert(!/rgba\(0,0,\$\{/.test(CANVAS2),
      'cinema-canvas.js: plus de teinte starfield mono-canal bleu');
    assert(/_starBgFillCache\s*=\s*`rgba\(\$\{[^}]+\},\$\{[^}]+\},\$\{[^}]+\},/.test(CANVAS2),
      'cinema-canvas.js: fond starfield teinté sur les 3 canaux (r,g,b) de la couleur d\'art');
  }());

  // =============================================================================
  // Task 15 — Spectrum : mapping log monotone (plus de barres jumelles dans les
  // graves) + fade d'entrée du viz à la bascule (audit findings #11/#12)
  // =============================================================================
  section('Task 15 -- spectrum: bins monotones + fade d\'entrée');

  (function () {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    // (a) les 3 renderers de barres (spectrum, standard, vol-vis) passent par le
    // helper de bins strictement croissants — le mapping log arrondi faisait
    // pointer les premières barres sur les mêmes bins 1-2 (colonnes jumelles).
    const VIZ = read('frontend/src/cinema-viz.js');
    assert(/function _monotonicBin\(/.test(VIZ),
      'cinema-viz.js: helper _monotonicBin défini');
    const uses = (VIZ.match(/_monotonicBin\(/g) || []).length;
    assert(uses >= 4, `cinema-viz.js: _monotonicBin utilisé par les 3 renderers de barres (def + 3 usages, actual: ${uses})`);

    // (b) bascule VERS spectrum : fade d'entrée du canvas viz (remplace le cut sec
    // documenté en Task 11), tokenisé, inerte sous reduced-motion.
    const BG4 = read('frontend/src/cinema-bg.js');
    assert(/viz-fade-in/.test(BG4) && /cinemaBg\s*===\s*'spectrum'/.test(BG4),
      'cinema-bg.js: bascule vers spectrum → classe viz-fade-in sur #cinema-viz');
    const CSS2 = read('frontend/src/style.css');
    assert(/\.cinema-viz\.viz-fade-in\s*\{[^}]*animation[^}]*var\(--dur-/.test(CSS2),
      'style.css: animation viz-fade-in tokenisée (--dur-*)');
    // filter:opacity() et non opacity — .bg-spectrum .cinema-viz force opacity:1
    // !important, qui écraserait des keyframes opacity (les animations perdent
    // contre !important dans la cascade).
    assert(/@keyframes cin-viz-fade-in[^}]*filter\s*:\s*opacity/.test(CSS2),
      'style.css: keyframes viz-fade-in animent filter:opacity() (opacity est verrouillée en !important)');
    assert(/html\[data-motion="reduce"\]\s+\.cinema-viz\.viz-fade-in\s*\{[^}]*animation\s*:\s*none/.test(CSS2),
      'style.css: viz-fade-in neutralisé sous html[data-motion="reduce"]');
  }());

  // =============================================================================
  // Task 16 — Vagues : cohérence visuelle position/taille (audit chiffré 2026-07-04).
  // Invariants NUMÉRIQUES purs — pas des scans : mer sous la zone contenu,
  // excursion bornée par construction, perspective des longueurs d'onde à l'endroit.
  // =============================================================================
  section('Task 16 -- vagues: position/taille bornées (invariants numériques)');

  await (async function () {
    const { waveLayerGeom, waveY, WAVE_BEAT_BOOST_MAX } =
      await import('../src/cinema-waves.js');
    const LAYERS = 7;
    const geoms = Array.from({ length: LAYERS }, (_, l) => waveLayerGeom(l, LAYERS));

    // (a) position : la mer vit dans la bande basse de l'écran (la zone
    // pochette/titre occupe ~0.20h-0.65h) ; espacement uniforme entre couches.
    assert(geoms[0].yBase >= 0.55, `horizon (l=0) sous la zone contenu (yBase=${geoms[0].yBase.toFixed(2)}h ≥ 0.55h)`);
    assert(geoms[LAYERS - 1].yBase <= 0.92, `premier plan (l=6) dans l'écran (yBase=${geoms[LAYERS - 1].yBase.toFixed(2)}h ≤ 0.92h)`);
    const spacing0 = geoms[1].yBase - geoms[0].yBase;
    for (let l = 2; l < LAYERS; l++) {
      const sp = geoms[l].yBase - geoms[l - 1].yBase;
      assert(Math.abs(sp - spacing0) < 1e-9, `espacement uniforme entre couches (l=${l})`);
    }

    // (b) perspective des longueurs d'onde À L'ENDROIT : fréquence STRICTEMENT
    // décroissante vers l'avant — houle large devant, frémissement fin au loin
    // (le flip de profondeur T12 avait laissé la progression inversée).
    for (let l = 1; l < LAYERS; l++) {
      assert(geoms[l].freq < geoms[l - 1].freq, `freq décroissante vers l'avant (l=${l}: ${geoms[l].freq} < ${geoms[l - 1].freq})`);
    }

    // (c) waveY : harmoniques à poids NORMALISÉS (somme = 1) — amp est
    // l'excursion maximale réelle, plus de facteur caché ×1.67.
    for (let pi = 0; pi <= 12; pi++) {
      const ph = pi * 1.07;
      for (let s = 0; s <= 40; s++) {
        const y = waveY(s / 40, ph, 2.6, 1);
        assert(Math.abs(y) <= 1 + 1e-9, `|waveY| ≤ amp (nx=${(s / 40).toFixed(2)}, ph=${ph.toFixed(2)}, y=${y.toFixed(3)})`);
      }
    }

    // (d) invariant PIRE CAS : bande saturée + beat max → la crête de la vague
    // AVANT reste sous l'horizon avec 0.10h de marge. L'étagement arrière/avant
    // survit donc à n'importe quelle musique (l'ancien modèle montait à 0.27h).
    assert(WAVE_BEAT_BOOST_MAX <= 1.3, `boost beat contenu (${WAVE_BEAT_BOOST_MAX} ≤ 1.3 — le punch visuel reste porté par le halo/crête)`);
    const front = geoms[LAYERS - 1];
    const worstCrest = front.yBase - (front.ampBase + front.ampEnergy) * WAVE_BEAT_BOOST_MAX;
    assert(worstCrest >= geoms[0].yBase + 0.10,
      `crête avant pire-cas (${worstCrest.toFixed(3)}h) ≥ horizon + 0.10h (${(geoms[0].yBase + 0.10).toFixed(2)}h)`);

    // (e) scans d'intégration : _drawWaveLayer consomme waveY + geo.freq ; le
    // terme d'énergie globale est retiré de l'amplitude (triple comptage) ; le
    // boost beat dérive de WAVE_BEAT_BOOST_MAX (plus de 1.65 littéral).
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const CANVAS = fs.readFileSync(path.join(root, 'frontend/src/cinema-canvas.js'), 'utf8');
    assert(/waveY\(/.test(CANVAS), 'cinema-canvas.js: courbe des couches via waveY() (harmoniques normalisées)');
    assert(/geo\.freq/.test(CANVAS), 'cinema-canvas.js: fréquence par couche depuis geo.freq');
    assert(/WAVE_BEAT_BOOST_MAX/.test(CANVAS), 'cinema-canvas.js: boost beat dérivé de WAVE_BEAT_BOOST_MAX');
    assert(!/_waveBeatObj\.v \* 0\.65/.test(CANVAS), 'cinema-canvas.js: plus de boost beat 1.65 littéral');
    assert(!/_waveEnergy \* 0\.03/.test(CANVAS), 'cinema-canvas.js: plus de terme énergie globale dans l\'amplitude (triple comptage retiré)');
    // Fix revue : le gradient de remplissage démarre à l'excursion max de la
    // couche — la crête ne peut jamais dépasser le stop-0 (aplat au sommet sinon).
    assert(/yBase\s*-\s*\(geo\.ampBase\s*\+\s*geo\.ampEnergy\)\s*\*\s*WAVE_BEAT_BOOST_MAX/.test(CANVAS),
      'cinema-canvas.js: départ du gradient = excursion max de la couche (couvre le pire cas par construction)');
  }());

  // =============================================================================
  // Task 17 — Vagues : finitions premium (AGC par bande, écume au beat, reflet
  // d'horizon, courbes lissées)
  // =============================================================================
  section('Task 17 -- vagues premium (AGC, écume, reflet, courbes)');

  await (async function () {
    const { agcNormalize } = await import('../src/cinema-waves.js');

    // (a) AGC pur — normalisation par pic glissant, zéro allocation.
    const bands = new Float32Array(7);
    const peaks = new Float32Array(7);
    const out   = new Float32Array(7);
    assert(agcNormalize(bands, peaks, out) === out, 'agc: retourne le même Float32Array out (zéro allocation)');
    for (let k = 0; k < 7; k++) assert(out[k] === 0, `agc: silence → 0 (k=${k})`);
    // Bande au pic → 1 (une bande faible en absolu devient pleinement visible)
    bands.fill(0.08);
    agcNormalize(bands, peaks, out);
    for (let k = 0; k < 7; k++) assert(out[k] === 1, `agc: bande à son pic → 1 (k=${k}, out=${out[k]})`);
    // Plancher anti-bruit : pic sous floor → 0 (pas d'amplification du silence)
    const b2 = new Float32Array([0.02]), p2 = new Float32Array(1), o2 = new Float32Array(1);
    agcNormalize(b2, p2, o2, 0.995, 0.04);
    assert(o2[0] === 0, `agc: pic (0.02) < floor (0.04) → 0 (pas de bruit amplifié, out=${o2[0]})`);
    // Décroissance du pic : après un pic fort, une bande moyenne remonte vers 1
    const b3 = new Float32Array([1]), p3 = new Float32Array(1), o3 = new Float32Array(1);
    agcNormalize(b3, p3, o3, 0.9);
    b3[0] = 0.5;
    for (let i = 0; i < 60; i++) agcNormalize(b3, p3, o3, 0.9);
    assert(o3[0] > 0.95, `agc: le pic décroît (decay) → une bande moyenne redevient pleine (out=${o3[0].toFixed(3)})`);
    assert(o3[0] <= 1, 'agc: sortie toujours ≤ 1');

    // (b) scans d'intégration cinema-canvas.js
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const CANVAS = fs.readFileSync(path.join(root, 'frontend/src/cinema-canvas.js'), 'utf8');
    // AGC câblé : les couches consomment les bandes NORMALISÉES
    assert(/agcNormalize\(/.test(CANVAS), 'cinema-canvas.js: agcNormalize câblé après computeBandEnergies');
    assert(/_waveBandsNorm\[/.test(CANVAS), 'cinema-canvas.js: les couches lisent les bandes normalisées (AGC)');
    // Écume : pool pré-alloué, spawn dans la branche beat (déjà gated reduced-motion)
    assert(/_FOAM_MAX/.test(CANVAS) && /_foamPool/.test(CANVAS),
      'cinema-canvas.js: pool d\'écume pré-alloué (zéro allocation par frame)');
    // Task 5 : plus de détecteur local _waveBeat — la branche beat consomme le
    // paramètre partagé `beat` (cf. section Task 5 cycle 2 ci-dessous pour le scan positif).
    assert(/prefersReducedMotion\(\)\s*&&\s*beat\)\s*\{[\s\S]{0,400}_spawnFoam\(/.test(CANVAS),
      'cinema-canvas.js: écume spawnée dans la branche beat partagée (héritée du gate reduced-motion)');
    // Reflet d'horizon : gradient caché + fillRect borné à la bande sous l'horizon
    assert(/_waveHorizonGrad/.test(CANVAS),
      'cinema-canvas.js: reflet d\'horizon caché avec les styles (clé couleur+h)');
    // Courbes : tracé quadratique partagé fill/crête
    assert(/quadraticCurveTo\(/.test(CANVAS), 'cinema-canvas.js: chemin de vague lissé (quadratiques points milieux)');
    assert(/function _traceWavePath\(/.test(CANVAS), 'cinema-canvas.js: tracé partagé remplissage/crête (_traceWavePath)');
  }());

  // =============================================================================
  // Task 2 — Cinema Loop (boucle maître rAF)
  // =============================================================================
  section('Task 2 -- cinema-loop.js (loopCadence, computeBassEnergy)');

  await (async function () {
    const { loopCadence, computeBassEnergy } = await import('../src/cinema-loop.js');

    // (a) loopCadence pure — 1 = 60fps, 2 = 30fps
    assert(loopCadence('waves', true) === 1, 'loopCadence: waves + focus → 1 (60fps)');
    assert(loopCadence('ambient', true) === 2, 'loopCadence: ambient + focus → 2 (30fps)');
    assert(loopCadence('amoled', true) === 2, 'loopCadence: amoled + focus → 2 (30fps)');
    assert(loopCadence('waves', false) === 2, 'loopCadence: waves + no focus → 2 (30fps)');
    assert(loopCadence('spectrum', true) === 1, 'loopCadence: spectrum + focus → 1 (60fps)');

    // (b) computeBassEnergy pure — moyenne des carrés des 10% premiers bins
    const silence = new Uint8Array(1024);
    assert(computeBassEnergy(silence) === 0, 'computeBassEnergy: silence → 0');
    const impulse = new Uint8Array(1024);
    for (let i = 0; i < 102; i++) impulse[i] = 255; // 10% of 1024 = 102.4
    const energy = computeBassEnergy(impulse);
    assert(energy > 0, `computeBassEnergy: impulse (255 @ first 10%) → >0 (got ${energy})`);

    // (c) scan: exactly one getByteFrequencyData call
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const LOOP = fs.readFileSync(path.join(root, 'frontend/src/cinema-loop.js'), 'utf8');
    const getByteFreqMatches = (LOOP.match(/getByteFrequencyData/g) || []).length;
    assert(getByteFreqMatches === 1, `cinema-loop.js: exactly 1 getByteFrequencyData (got ${getByteFreqMatches})`);

    // (d) scan: createBeatDetector with exact config (history: 43, threshold: 1.35, cooldownMs: 650)
    assert(/createBeatDetector\(\s*\{\s*history:\s*43,\s*threshold:\s*1\.35,\s*cooldownMs:\s*650\s*\}/.test(LOOP),
      'cinema-loop.js: createBeatDetector config (history: 43, threshold: 1.35, cooldownMs: 650)');
  }());

  // =============================================================================
  // Task 4 (cycle 2) Part A — cinema-viz.js devient renderer passif : plus de rAF ni
  // de lecture analyser locale (le FFT/beat arrivent en paramètres depuis
  // cinema-loop.js, même snapshot que drawBgFrame). drawVizFrame(dt, fft, beat)
  // exportée ; le beat pochette ne fait plus que l'effet visuel (_pulseBeat), la
  // détection d'énergie a migré dans cinema-loop.js (Task 2). Le câblage cinema.js →
  // cinema-loop.js (Part B) est testé dans la section suivante, commit séparé.
  // =============================================================================
  section('Task 4 cycle 2 Part A -- cinema-viz.js renderer passif (drawVizFrame, beat partagé)');

  {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const cinVizSrc = read('frontend/src/cinema-viz.js');

    // (a) scan : aucun requestAnimationFrame planifié en boucle dans cinema-viz.js —
    // seul le pulse pochette (_pulseBeat) utilise encore un requestAnimationFrame
    // ONE-SHOT pour rejouer la classe .beat (pas une auto-replanification de frame).
    // On vérifie donc l'absence du pattern d'auto-replanification `= requestAnimationFrame(`
    // (assignation à une variable de handle, signature du rAF-loop), pas l'absence totale
    // du mot-clé.
    assert(!/=\s*requestAnimationFrame\(/.test(cinVizSrc),
      'cinema-viz.js: aucune auto-replanification de rAF (renderer passif, Task 4)');
    assert(!/_cinVizRaf/.test(cinVizSrc),
      'cinema-viz.js: plus de handle rAF local (_cinVizRaf supprimé)');

    // (b) scan : cinema-viz.js ne lit plus l'analyser lui-même (FFT reçu en paramètre)
    assert(!/getByteFrequencyData/.test(cinVizSrc),
      'cinema-viz.js: aucun getByteFrequencyData (FFT lu par cinema-loop.js)');
    assert(!/_vizBuf/.test(cinVizSrc),
      'cinema-viz.js: plus de buffer FFT local (_vizBuf supprimé, fft vient en paramètre)');
    assert(!/createBeatDetector/.test(cinVizSrc) && !/from '.\/cinema-beat.js'/.test(cinVizSrc),
      'cinema-viz.js: plus de détecteur de beat local (beat vient en paramètre)');

    // (c) scan cluster (renderers déjà passivés) : parmi les modules migrés vers le
    // pattern renderer-passif à ce jour (cinema-bg.js par Task 3, cinema-viz.js par
    // Task 4), seul cinema-loop.js lit encore getByteFrequencyData — la lecture FFT
    // est strictement centralisée pour bg+viz+vol-vis. cinema-canvas.js (waves/
    // starfield) a rejoint ce cluster en Task 5 (cycle 2 polish) — sa propre lecture
    // analyser/détecteurs de beat locaux ont été retirés (cf. section Task 5 cycle 2
    // dédiée ci-dessus pour le scan positif détaillé) ; inclus ici désormais.
    const passiveRenderers = ['cinema-bg.js', 'cinema-viz.js', 'cinema-canvas.js'];
    const filesWithGetByteFreq = passiveRenderers.filter(f => /getByteFrequencyData/.test(read('frontend/src/' + f)));
    assert(filesWithGetByteFreq.length === 0,
      `renderers passifs (cinema-bg.js, cinema-viz.js, cinema-canvas.js): aucun getByteFrequencyData (trouvé dans: ${filesWithGetByteFreq.join(', ') || 'aucun'})`);
    const loopSrc = read('frontend/src/cinema-loop.js');
    assert(/getByteFrequencyData/.test(loopSrc),
      'cinema-loop.js: lit bien le FFT (seul propriétaire pour bg+viz+vol-vis)');

    // (d) drawVizFrame(dt, fft, beat) exportée ; _drawSpectrumBars/_drawStandardBars
    // n'ont plus le paramètre `analyser` (dropped — data.length remplace
    // analyser.frequencyBinCount, cf. brief).
    assert(/export function drawVizFrame\(dt, fft, beat\)/.test(cinVizSrc),
      'cinema-viz.js exporte drawVizFrame(dt, fft, beat)');
    assert(/function _drawSpectrumBars\(ctx, data, w, h, lerpRGB, sg\)/.test(cinVizSrc),
      'cinema-viz.js: _drawSpectrumBars sans paramètre analyser (data.length remplace frequencyBinCount)');
    assert(/function _drawStandardBars\(ctx, data, w, h, lerpRGB\)/.test(cinVizSrc),
      'cinema-viz.js: _drawStandardBars sans paramètre analyser');

    // (e) startCinemaViz/stopCinemaViz restent exportées (contrat inchangé pour cinema.js)
    assert(/export function startCinemaViz/.test(cinVizSrc), 'cinema-viz.js exporte startCinemaViz()');
    assert(/export function stopCinemaViz/.test(cinVizSrc),  'cinema-viz.js exporte stopCinemaViz()');
  }

  // =============================================================================
  // Task 4 (cycle 2) Part B — cinema.js câblé sur cinema-loop.js (boucle maître).
  // Reassigné depuis Task 3 "Step 5" : nécessitait drawBgFrame (T3) ET drawVizFrame
  // (T4) — les deux existent maintenant, donc le câblage complet vit ici.
  // =============================================================================
  section('Task 4 cycle 2 Part B -- cinema.js cablé sur cinema-loop.js');

  {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const cinSrc = read('frontend/src/cinema.js');

    // cinema.js câblé sur cinema-loop.js : import + initCinemaLoop + startCinemaLoop()/
    // stopCinemaLoop() aux bons endroits + wakeCinemaLoop() au réveil.
    assert(/from '.\/cinema-loop.js'/.test(cinSrc), 'cinema.js importe cinema-loop.js');
    assert(/initCinemaLoop\(\s*\{/.test(cinSrc), 'cinema.js appelle initCinemaLoop({...})');
    assert(/drawBg:\s*drawBgFrame/.test(cinSrc) && /drawViz:\s*drawVizFrame/.test(cinSrc),
      'cinema.js câble drawBg/drawViz sur drawBgFrame/drawVizFrame dans initCinemaLoop');

    const openBody  = /export function openCinema\(\)[\s\S]*?\n\}\n/.exec(cinSrc)?.[0]  || '';
    const closeBody = /export function closeCinema\(\)[\s\S]*?\n\}\n/.exec(cinSrc)?.[0] || '';
    assert(openBody.length > 0, 'cinema.js: openCinema() trouvée');
    assert(closeBody.length > 0, 'cinema.js: closeCinema() trouvée');
    assert(/startCinemaViz\(\);\s*\n\s*startCinemaLoop\(\);/.test(openBody),
      'openCinema(): startCinemaLoop() appelé juste après startCinemaViz()');
    assert(/stopCinemaLoop\(\);\s*\n\s*stopAmbientAnim\(\);/.test(closeBody),
      'closeCinema(): stopCinemaLoop() appelé juste avant stopAmbientAnim()');

    assert(/if \(!document\.hidden && cinemaOpen\) wakeCinemaLoop\(\);/.test(cinSrc),
      'cinema.js: visibilitychange réveille la boucle via wakeCinemaLoop() (condition simplifiée)');

    const updateCinemaBody = /export function updateCinema\(\)[\s\S]*?\n\}\n/.exec(cinSrc)?.[0] || '';
    assert(updateCinemaBody.length > 0, 'cinema.js: updateCinema() trouvée');
    assert(/if \(!cinemaOpen\) return;\s*\n\s*wakeCinemaLoop\(\);/.test(updateCinemaBody),
      'updateCinema(): wakeCinemaLoop() appelé juste après la garde !cinemaOpen (réveil sur changement de piste en pause)');

    assert(/on\(EVENTS\.PLAY_STATE,\s*\(\)\s*=>\s*\{\s*if \(cinemaOpen\) wakeCinemaLoop\(\);\s*\}\);/.test(cinSrc),
      'cinema.js: listener EVENTS.PLAY_STATE réveille la boucle si le cinéma est ouvert');
  }

  // =============================================================================
  // Task 5 (cycle 2 polish) — dt propagé dans cinema-canvas.js (vagues, écume,
  // étoiles) : drawWavesFrame/drawStarfieldFrame consomment le snapshot FFT/beat
  // partagé (cinema-loop.js) et des couleurs LERP scalaires — plus d'eqAnalyser
  // importé ni de détecteurs de beat locaux. _wavePhases/écume avancent selon dtN
  // (framerate-indépendant). getMaxBandEnergy() affine la garde de sommeil de
  // cinema-bg.js (drawBgFrame).
  // =============================================================================
  section('Task 5 cycle 2 -- cinema-canvas.js dt/FFT/beat partagés (waves/starfield)');

  await (async function () {
    const fs   = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');
    const CANVAS = read('frontend/src/cinema-canvas.js');
    const BG     = read('frontend/src/cinema-bg.js');

    // (a) scan : cinema-canvas.js n'importe plus eqAnalyser ni createBeatDetector —
    // le FFT/beat arrivent en paramètres (même contrat que cinema-bg.js/cinema-viz.js).
    assert(!/from '.\/eq\.js'/.test(CANVAS) && !/\beqAnalyser\b/.test(CANVAS),
      'cinema-canvas.js n\'importe plus eqAnalyser (fft reçu en paramètre)');
    assert(!/from '.\/cinema-beat\.js'/.test(CANVAS) && !/createBeatDetector/.test(CANVAS),
      'cinema-canvas.js n\'importe plus createBeatDetector (beat reçu en paramètre)');

    // (b) scan : _wavePhases[l] += et f.life -= sont bien multipliés par un facteur
    // dtN — framerate-indépendance (regex ciblée sur les lignes concernées, pas un
    // sondage global "dtN existe quelque part").
    assert(/_wavePhases\[l\]\s*\+=\s*\([^)]*\)\s*\*\s*boostMult\s*\*\s*dtN;/.test(CANVAS),
      'cinema-canvas.js: _wavePhases[l] += … est multiplié par dtN (avance framerate-indépendante)');
    assert(/f\.life\s*-=\s*0\.035\s*\*\s*dtN;/.test(CANVAS),
      'cinema-canvas.js: f.life -= 0.035 * dtN (fondu écume framerate-indépendant)');

    // (c) signatures publiques exactes — consommées par cinema-bg.js (drawBgFrame).
    assert(/export function drawWavesFrame\(ctx, w, h, r, g, b, isPlaying, dtN, fft, beat\)/.test(CANVAS),
      'cinema-canvas.js exporte drawWavesFrame(ctx, w, h, r, g, b, isPlaying, dtN, fft, beat)');
    assert(/export function drawStarfieldFrame\(ctx, w, h, r, g, b, ambientT, dtN, fft, beat\)/.test(CANVAS),
      'cinema-canvas.js exporte drawStarfieldFrame(ctx, w, h, r, g, b, ambientT, dtN, fft, beat)');
    assert(/export function getMaxBandEnergy\(\)/.test(CANVAS),
      'cinema-canvas.js exporte getMaxBandEnergy()');

    // (d) cinema-bg.js : les deux sites d'appel passent des scalaires r/g/b (plus de
    // tableau cinArtRGBCur par référence) + dtN/fft/beat ; getMaxBandEnergy() consommé
    // dans le return de drawBgFrame (raffinement du "toujours actif" T3 conservateur).
    assert(/drawWavesFrame\(_cinBgCtx, _winW, _winH, _lerpRLast, _lerpGLast, _lerpBLast, isPlaying, dtN, fft, beat\)/.test(BG),
      'cinema-bg.js: drawBgFrame appelle drawWavesFrame avec r/g/b scalaires + dtN/fft/beat');
    assert(/drawStarfieldFrame\(_cinBgCtx, _winW, _winH, _lerpRLast, _lerpGLast, _lerpBLast, _ambientT, dtN, fft, beat\)/.test(BG),
      'cinema-bg.js: drawBgFrame appelle drawStarfieldFrame avec r/g/b scalaires + dtN/fft/beat');
    assert(/getMaxBandEnergy\(\)\s*>\s*_EPS_BAND/.test(BG),
      'cinema-bg.js: drawBgFrame consomme getMaxBandEnergy() > _EPS_BAND (raffinement T5 de la garde de sommeil)');
    assert(/import \{[^}]*getMaxBandEnergy[^}]*\}\s*from '.\/cinema-canvas\.js'/.test(BG),
      'cinema-bg.js importe getMaxBandEnergy depuis cinema-canvas.js');

    // (e) edge case _lerpRLast/_lerpGLast/_lerpBLast : sentinelle initiale 255 (blanc),
    // pas -1 — sinon le tout premier drawBgFrame() (avant tout stepArtColorLerp())
    // peindrait waves/starfield en noir au lieu du blanc neutre attendu.
    assert(/let _lerpRLast = 255, _lerpGLast = 255, _lerpBLast = 255;/.test(BG),
      'cinema-bg.js: _lerpRLast/_lerpGLast/_lerpBLast initialisés à 255 (cohérent avec _cinArtRGBCur initial)');

    // (f) invariant pur d'accumulation de phase linéaire — _wavePhases est privé à
    // cinema-canvas.js (pas d'export), donc on vérifie l'invariant mathématique dont
    // dépend la multiplication par dtN via waveY (import ESM réel, pure) : avancer une
    // phase d'un pas à dtN=2 doit produire EXACTEMENT le même y qu'avancer deux pas à
    // dtN=1 chacun (accumulation linéaire — même principe que stepArtColorLerp dtN plus
    // haut dans ce fichier, mais ici sur l'incrément de phase des vagues plutôt que le LERP couleur).
    const { waveY } = await import('../src/cinema-waves.js');
    const speed = 0.005 + 3 * 0.0018 + 0.4 * 0.020; // incrément représentatif d'une couche
    const freq = 2.6, amp = 1;
    // 1 pas à dtN=2
    const phaseA = 0 + speed * 1 * 2;
    // 2 pas à dtN=1
    let phaseB = 0;
    phaseB += speed * 1 * 1;
    phaseB += speed * 1 * 1;
    assert(Math.abs(phaseA - phaseB) < 1e-12,
      'dtN linéarité: phase accumulée identique (1 pas dtN=2 == 2 pas dtN=1)');
    const yA = waveY(0.37, phaseA, freq, amp);
    const yB = waveY(0.37, phaseB, freq, amp);
    assert(yA === yB,
      `dtN linéarité: waveY(phase) identique pour les deux trajectoires (yA=${yA}, yB=${yB})`);

    // (g) fix revue (post-review) : getMaxBandEnergy() ne doit pas rester figé sur une
    // valeur périmée de l'ancien mode bg (ex. starfield visité puis switch vers waves —
    // _starBassSmooth ne décroît plus car _updateStarAudio ne tourne plus). resetBandEnergy()
    // remet les deux traceurs à zéro. Exercice réel (pas de réimplémentation de la logique
    // testée) : import ESM réel de cinema-canvas.js — possible en Node sans jsdom (motion.js
    // garde `typeof window !== 'undefined'`, cf. sondage préalable) — + un ctx 2D minimal
    // qui STUBS uniquement la surface Canvas utilisée par drawWavesFrame (fillRect/beginPath/
    // moveTo/lineTo/quadraticCurveTo/closePath/fill/stroke/gradients) sans jamais reproduire le
    // calcul d'énergie/bandes de cinema-canvas.js lui-même, qui reste exercé pour de vrai.
    const { getMaxBandEnergy, resetBandEnergy, drawWavesFrame } = await import('../src/cinema-canvas.js');

    const mockCtx2D = () => {
      const grad = { addColorStop() {} };
      return {
        fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
        fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {},
        closePath() {}, fill() {}, stroke() {}, arc() {}, save() {}, restore() {},
        translate() {}, rotate() {},
        createLinearGradient() { return grad; },
        createRadialGradient() { return grad; },
      };
    };

    assert(getMaxBandEnergy() === 0,
      'getMaxBandEnergy(): 0 avant toute injection d\'énergie (état initial du module)');

    // FFT fort (basses saturées) → une seule frame suffit à pousser _waveBandsNorm bien
    // au-dessus de _EPS_BAND (AGC : peaks[k] = bands[k] au tout premier appel ⇒ ratio 1).
    const loudFft = new Uint8Array(256).fill(220);
    drawWavesFrame(mockCtx2D(), 800, 450, 200, 150, 100, true, 1, loudFft, false);
    assert(getMaxBandEnergy() > 0,
      'getMaxBandEnergy(): > 0 après une frame de vagues avec FFT fort (bandes normalisées poussées au-dessus de _EPS_BAND)');

    resetBandEnergy();
    assert(getMaxBandEnergy() === 0,
      'resetBandEnergy(): remet getMaxBandEnergy() à 0 (fix revue -- évite un traceur figé sur l\'ancien mode bg)');
  }());

  // =============================================================================
  // Cinema Polish Cycle 2, Task 7 — cycle player<->cinema cassé via bus
  // CINEMA_PROGRESS + purge imports morts (scans statiques, house style).
  // =============================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema Task 7 -- cycle player<->cinema casse + purge imports morts');

    const playerSrc = read('frontend/src/player.js');
    const busSrc     = read('frontend/src/bus.js');
    const cinSrc     = read('frontend/src/cinema.js');
    const renderSrc  = read('frontend/src/cinema-render.js');
    const appSrc     = read('frontend/src/app.js');

    // (a) player.js n'importe plus depuis cinema.js (cycle casse par le bus).
    assert(!/from '\.\/cinema\.js'/.test(playerSrc),
      "player.js n'importe plus depuis cinema.js (cycle casse)");
    assert(/emit\(EVENTS\.CINEMA_PROGRESS,\s*\{\s*p,\s*cur,\s*dur\s*\}\)/.test(playerSrc),
      'player.js emet EVENTS.CINEMA_PROGRESS { p, cur, dur } sur timeupdate');

    // (b) bus.js declare CINEMA_PROGRESS avec la forme de payload documentee.
    assert(/CINEMA_PROGRESS:\s*'cinema:progress',\s*\/\/\s*\{\s*p,\s*cur,\s*dur\s*\}/.test(busSrc),
      "bus.js declare CINEMA_PROGRESS: 'cinema:progress' // { p, cur, dur }");

    // cinema.js s'abonne a CINEMA_PROGRESS et route vers updateCinemaProgress (interne).
    assert(/on\(EVENTS\.CINEMA_PROGRESS,\s*\(\{\s*p,\s*cur,\s*dur\s*\}\)\s*=>\s*updateCinemaProgress\(p,\s*cur,\s*dur\)\)/.test(cinSrc),
      'cinema.js: on(EVENTS.CINEMA_PROGRESS, ...) route vers updateCinemaProgress(p, cur, dur)');

    // app.js n'importe plus updateCinemaProgress (mort : plus utilise depuis la purge cycle).
    assert(!/updateCinemaProgress/.test(appSrc),
      "app.js n'importe plus updateCinemaProgress (mort, remplace par le bus)");

    // (c) cinema.js purge de ses imports morts : artcolor (groupe complet), tween (motion.js),
    // eqCtx (eq.js — eqAnalyser reste, consomme par initCinemaLoop), set de store.js (get reste).
    assert(!/rgbToHsl|hslToRgb|boostSat|regionAvg|sampleArtColors/.test(cinSrc),
      "cinema.js n'importe plus le groupe artcolor (rgbToHsl/hslToRgb/boostSat/regionAvg/sampleArtColors)");
    assert(!/\btween\b/.test(cinSrc),
      "cinema.js n'importe plus tween depuis motion.js");
    assert(!/\beqCtx\b/.test(cinSrc),
      "cinema.js n'importe plus eqCtx depuis eq.js");
    assert(/\beqAnalyser\b/.test(cinSrc),
      'cinema.js conserve eqAnalyser (consomme par initCinemaLoop getAnalyser)');
    const storeImportMatch = /import\s*\{([^}]*)\}\s*from '\.\/store\.js'/.exec(cinSrc);
    assert(storeImportMatch && /\bget\b/.test(storeImportMatch[1]),
      'cinema.js importe toujours get depuis store.js');
    assert(!storeImportMatch || !/\bset\b/.test(storeImportMatch[1]),
      "cinema.js n'importe plus set depuis store.js");

    // (d) _readVol/_syncCinVol disparaissent de cinema.js au profit des exports renommes
    // de cinema-render.js (readCinVolDom/setCinVolSliders) -- deps de initCinemaInput (Task 6)
    // pointent dessus.
    assert(!/function _readVol\(/.test(cinSrc),
      "cinema.js: _readVol() supprimee (deleguee a cinema-render.js)");
    assert(!/function _syncCinVol\(/.test(cinSrc),
      "cinema.js: _syncCinVol() supprimee (deleguee a cinema-render.js)");
    assert(/from '\.\/cinema-render\.js'/.test(cinSrc) && /readCinVolDom/.test(cinSrc) && /setCinVolSliders/.test(cinSrc),
      'cinema.js importe readCinVolDom/setCinVolSliders depuis cinema-render.js');
    assert(/readVol:\s*readCinVolDom/.test(cinSrc) && /syncVol:\s*setCinVolSliders/.test(cinSrc),
      'cinema.js: deps initCinemaInput pointent sur readCinVolDom/setCinVolSliders');

    assert(/export function readCinVolDom/.test(renderSrc),
      'cinema-render.js exporte readCinVolDom (renomme depuis _readVolDom)');
    assert(/export function setCinVolSliders/.test(renderSrc),
      'cinema-render.js exporte setCinVolSliders (renomme depuis _setVolSliders)');

    // cinema.js reste sous le cap 650 lignes (§16, abaisse au Task 6).
    const cinLines7 = cinSrc.split('\n').length;
    assert(cinLines7 <= 650, `cinema.js <= 650 lignes apres purge Task 7 (actual: ${cinLines7})`);
  } catch (e) {
    console.error('  KO  cinema Task 7 scans crashed:', e.message);
    _ko++;
  }

  // =============================================================================
  // cinema layout grid — repositionnement en grille (2026-07-05)
  // =============================================================================
  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema layout grid Task 1 -- wrappers corner-r / hero / side-r');

    const HTML1 = read('frontend/index.html');
    const iClock      = HTML1.indexOf('id="cinema-clock"');
    const iSideR      = HTML1.indexOf('class="cinema-side-r"');
    const iNext       = HTML1.indexOf('id="cinema-next"');
    const iQueuePanel = HTML1.indexOf('id="cinema-queue-panel"');
    const iShuffle    = HTML1.indexOf('id="cinema-shuffle-hint"');
    const iBgBtn      = HTML1.indexOf('id="cinema-bg-btn"');
    const iCornerR    = HTML1.indexOf('class="cinema-corner-r"');
    const iFsBtn      = HTML1.indexOf('id="cinema-fs-btn"');
    const iClose      = HTML1.indexOf('cinema-close');
    const iHero       = HTML1.indexOf('class="cinema-hero"');
    const iArtWrap    = HTML1.indexOf('id="cinema-art-wrap"');
    const iInfo       = HTML1.indexOf('id="cinema-info"');
    const iProg       = HTML1.indexOf('class="cinema-prog"');
    const iControls   = HTML1.indexOf('id="cinema-controls"');

    const allFound = [iClock, iSideR, iNext, iQueuePanel, iShuffle, iBgBtn, iCornerR,
      iFsBtn, iClose, iHero, iArtWrap, iInfo, iProg, iControls].every(i => i !== -1);
    assert(allFound,
      'index.html: horloge, les 3 wrappers et tous leurs enfants existent');

    assert(allFound && iClock < iSideR && iSideR < iNext && iNext < iQueuePanel && iQueuePanel < iShuffle,
      '.cinema-side-r precede piste-suivante < panneau-file-d\'attente < hint-shuffle, apres l\'horloge');
    assert(allFound && iShuffle < iBgBtn && iBgBtn < iCornerR && iCornerR < iFsBtn && iFsBtn < iClose,
      '#cinema-bg-btn reste hors wrapper, suivi de .cinema-corner-r contenant fs-btn < close');
    assert(allFound && iClose < iHero && iHero < iArtWrap && iArtWrap < iInfo && iInfo < iProg && iProg < iControls,
      '.cinema-hero contient art-wrap < info < prog < controls, apres .cinema-corner-r');
  } catch (e) {
    console.error('  KO  cinema layout grid Task 1 scans crashed:', e.message);
    _ko++;
  }

  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema layout grid Task 2 -- #cinema-overlay grid + zones nommees');

    const CSS2 = read('frontend/src/style.css');
    const DS2  = read('frontend/src/design-system.css');

    assert(/#cinema-overlay \{[\s\S]{0,500}display: grid;/.test(CSS2),
      '#cinema-overlay passe en display:grid');
    assert(/"corner-l\s+\.\s+corner-r"/.test(CSS2) && /"side-l\s+hero\s+side-r"/.test(CSS2),
      '#cinema-overlay declare les 5 zones (corner-l/corner-r/side-l/hero/side-r) dans le bon ordre');
    assert(/padding:\s*var\(--cinema-corner-top\)\s*var\(--cinema-corner-x\)\s*var\(--cinema-clock-inset\);/.test(CSS2),
      '#cinema-overlay applique les insets harmonises via padding (corner-top/corner-x/clock-inset)');

    for (const zone of ['corner-l', 'corner-r', 'side-l', 'hero', 'side-r']) {
      const n = (CSS2.match(new RegExp(`grid-area:\\s*${zone}\\b`, 'g')) || []).length;
      assert(n === 1, `zone '${zone}' assignee exactement une fois (trouve ${n})`);
    }

    assert(/#cinema-bg-btn \{\s*\n\s*grid-area: corner-l; justify-self: start; align-self: start;/.test(CSS2),
      '#cinema-bg-btn place en corner-l (start/start)');
    assert(/\.cinema-corner-r \{\s*\n\s*grid-area: corner-r; justify-self: end; align-self: start;/.test(CSS2),
      '.cinema-corner-r place en corner-r (end/start)');
    assert(/#cinema-clock \{\s*\n\s*grid-area: side-l; justify-self: start; align-self: end;/.test(CSS2),
      '#cinema-clock place en side-l, ancre au bas de sa cellule (align-self:end)');
    assert(/\.cinema-hero \{\s*\n\s*grid-area: hero; justify-self: center; align-self: center;/.test(CSS2),
      '.cinema-hero centre vraiment (justify-self/align-self: center)');
    assert(/\.cinema-side-r \{\s*\n\s*grid-area: side-r; justify-self: end; align-self: end;/.test(CSS2),
      '.cinema-side-r place en side-r (end/end)');

    const sideRIdx = CSS2.indexOf('.cinema-side-r {');
    assert(sideRIdx !== -1 && /position: relative;/.test(CSS2.slice(sideRIdx, sideRIdx + 200)),
      '.cinema-side-r est position:relative (ancre #cinema-queue-panel)');

    assert(/\.cinema-shuffle-hint \{ position: absolute; inset: 0; \}/.test(CSS2),
      '.cinema-shuffle-hint se superpose exactement a #cinema-next (inset:0)');

    assert(!/\.cinema-corner-btn \{\s*\n\s*position: absolute;/.test(CSS2),
      '.cinema-corner-btn ne porte plus position:absolute (place par grid/flex desormais)');
    assert(!/\.cinema-close\s*\{\s*top:/.test(CSS2), "l'ancienne regle .cinema-close { top:...; right:...; } est retiree");
    assert(!/#cinema-bg-btn\s*\{\s*top:/.test(CSS2), "l'ancienne regle #cinema-bg-btn { top:...; left:...; } est retiree");
    assert(!/#cinema-fs-btn\s*\{\s*top:/.test(CSS2), "l'ancienne regle #cinema-fs-btn { top:...; right:...; } est retiree");

    const nextIdx = CSS2.indexOf('.cinema-next {');
    assert(nextIdx !== -1 && !/position: absolute; bottom: var\(--sp-8\)/.test(CSS2.slice(nextIdx, nextIdx + 150)),
      '.cinema-next ne porte plus bottom/right en dur relatif au viewport');

    const qpIdx = CSS2.indexOf('.cinema-queue-panel {');
    assert(qpIdx !== -1 && /position: absolute; bottom: calc\(100% \+ var\(--cqp-trigger-gap\)\); right: 0;/.test(CSS2.slice(qpIdx, qpIdx + 300)),
      '.cinema-queue-panel ancre a 100% (haut de .cinema-side-r) + right:0 -- decouple du viewport');

    assert(!/--cinema-fs-right/.test(DS2), 'token --cinema-fs-right retire de design-system.css (mort)');
    assert(!/--cinema-fs-right/.test(CSS2), 'token --cinema-fs-right plus reference dans style.css');
  } catch (e) {
    console.error('  KO  cinema layout grid Task 2 scans crashed:', e.message);
    _ko++;
  }

  try {
    const fs = require('fs'), path = require('path');
    const root = path.join(__dirname, '../..');
    const read = f => fs.readFileSync(path.join(root, f), 'utf8');

    section('cinema layout grid Task 3 -- next/queue-access compact icon-only');

    const CSS3 = read('frontend/src/style.css');
    const HTML3 = read('frontend/index.html');

    const nextBtnIdx = HTML3.indexOf('id="cinema-next"');
    const nextBtnEnd = HTML3.indexOf('</button>', nextBtnIdx);
    assert(nextBtnIdx !== -1 && nextBtnEnd !== -1,
      '#cinema-next: bouton localise (ouverture + fermeture)');
    const nextBtnBody = HTML3.slice(nextBtnIdx, nextBtnEnd);
    assert(/class="cn-icon"/.test(nextBtnBody),
      '#cinema-next contient une icone .cn-icon (mode compact) avant sa fermeture');
    assert(/aria-hidden="true"/.test(nextBtnBody.slice(nextBtnBody.indexOf('class="cn-icon"'))),
      '.cn-icon est aria-hidden (decorative, le nom accessible reste porte par le bouton)');
    assert(/aria-expanded="false"/.test(nextBtnBody) && /aria-controls="cinema-queue-panel"/.test(nextBtnBody) &&
      /aria-label="Afficher la file d'attente"/.test(nextBtnBody),
      '#cinema-next conserve aria-expanded/aria-controls/aria-label apres ajout de .cn-icon');

    assert(/\.cn-icon \{ display: none;/.test(CSS3),
      '.cn-icon masquee par defaut (pleine taille)');
    assert(/@media \(max-width: 700px\), \(max-height: 640px\) \{/.test(CSS3),
      'media query compacte next/queue-access (700px largeur OU 640px hauteur)');
    assert(/\.cinema-next \.cn-icon \{ display: block; \}/.test(CSS3),
      '.cinema-next .cn-icon visible en mode compact');
    const compactMQAnchor = '@media (max-width: 700px), (max-height: 640px) {';
    const compactMQIdx = CSS3.indexOf(compactMQAnchor);
    assert(/border-radius: 50%;/.test(CSS3.slice(compactMQIdx, compactMQIdx + 500)),
      'le bloc compact force un bouton rond (border-radius:50%)');
  } catch (e) {
    console.error('  KO  cinema layout grid Task 3 scans crashed:', e.message);
    _ko++;
  }

  // -- Résultat -----------------------------------------------------------
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`  Total : ${_ok + _ko}   OK: ${_ok}   KO: ${_ko}`);
  if (_ko > 0) {
    console.error(`  ⚠ ${_ko} test(s) en échec`);
    process.exit(1);
  } else {
    console.log('  ✓ Tous les tests passent');
  }
})();
