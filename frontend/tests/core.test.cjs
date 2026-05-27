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
  const TLIST_ZOOM_LEVELS = ['compact', 'normal', 'comfortable'];
  function _nextZoomLevel(current, dir) {
    const idx = TLIST_ZOOM_LEVELS.indexOf(current);
    if (idx === -1) return 'normal';
    if (dir === 'in')  return TLIST_ZOOM_LEVELS[Math.min(idx + 1, TLIST_ZOOM_LEVELS.length - 1)];
    if (dir === 'out') return TLIST_ZOOM_LEVELS[Math.max(idx - 1, 0)];
    return current;
  }

  assert(_nextZoomLevel('compact',     'in')  === 'normal',      'zoomIn depuis compact → normal');
  assert(_nextZoomLevel('comfortable', 'in')  === 'comfortable', 'zoomIn depuis comfortable → reste comfortable');
  assert(_nextZoomLevel('comfortable', 'out') === 'normal',      'zoomOut depuis comfortable → normal');
  assert(_nextZoomLevel('compact',     'out') === 'compact',     'zoomOut depuis compact → reste compact');
  assert(_nextZoomLevel('normal',      'out') === 'compact',     'zoomReset depuis normal → compact via zoomOut');
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

// -- Résultat -----------------------------------------------------------
console.log('\n═══════════════════════════════════════════════════════════');
console.log(`  Total : ${_ok + _ko}   OK: ${_ok}   KO: ${_ko}`);
if (_ko > 0) {
  console.error(`  ⚠ ${_ko} test(s) en échec`);
  process.exit(1);
} else {
  console.log('  ✓ Tous les tests passent');
}
