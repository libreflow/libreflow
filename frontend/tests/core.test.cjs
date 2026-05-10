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

// -- Résultat -----------------------------------------------------------
console.log('\n═══════════════════════════════════════════════════════════');
console.log(`  Total : ${_ok + _ko}   OK: ${_ok}   KO: ${_ko}`);
if (_ko > 0) {
  console.error(`  ⚠ ${_ko} test(s) en échec`);
  process.exit(1);
} else {
  console.log('  ✓ Tous les tests passent');
}
