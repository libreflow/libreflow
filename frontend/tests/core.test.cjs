/**
 * core.test.cjs -- Tests unitaires modules critiques LibreFlow
 * Execution : node frontend/tests/core.test.cjs
 * Zero dependance externe. Node.js >= 18.
 */
'use strict';

let _pass = 0, _fail = 0;
function assert(cond, label) {
  if (cond) { _pass++; process.stdout.write('  [OK]  ' + label + '\n'); }
  else       { _fail++; process.stdout.write('  [KO]  ' + label + '\n'); }
}
function section(name) {
  console.log('\n-- ' + name + ' ' + '-'.repeat(Math.max(0, 50 - name.length)));
}

// =============================================================================
// 1. STORE
// =============================================================================
section('store.js');

function makeStore() {
  var _state = {}, _subs = new Map();
  function _notify(key, val) {
    var s = _subs.get(key); if (!s) return;
    s.forEach(function(cb) { cb(val); });
  }
  return {
    get: function(key) { return _state[key]; },
    set: function(key, val) { _state[key] = val; _notify(key, val); },
    subscribe: function(key, cb) {
      if (!_subs.has(key)) _subs.set(key, new Set());
      _subs.get(key).add(cb);
      return function() { _subs.get(key) && _subs.get(key).delete(cb); };
    },
    setBatch: function(updates) {
      Object.entries(updates).forEach(function(kv) { _state[kv[0]] = kv[1]; _notify(kv[0], kv[1]); });
    },
  };
}

(function() {
  var store = makeStore();
  assert(store.get('foo') === undefined, 'get() cle inconnue -> undefined');
  store.set('tracks', [1,2,3]);
  assert(store.get('tracks').length === 3, 'set/get array');
  var notified = null;
  var unsub = store.subscribe('curIdx', function(v) { notified = v; });
  store.set('curIdx', 42);
  assert(notified === 42, 'subscriber notifie');
  unsub();
  store.set('curIdx', 99);
  assert(notified === 42, 'unsub stoppe les notifications');
  var seen = {};
  store.subscribe('a', function(v) { seen.a = v; });
  store.subscribe('b', function(v) { seen.b = v; });
  store.setBatch({ a: 1, b: 2 });
  assert(seen.a === 1 && seen.b === 2, 'setBatch notifie toutes les cles');
  var liked = new Set(['id1']);
  store.set('liked', liked);
  liked.add('id2');
  assert(store.get('liked').has('id2'), 'mutation Set visible via get() (meme reference)');
  var fired = false;
  store.subscribe('liked', function() { fired = true; });
  store.set('liked', liked);
  assert(fired, 'set(liked) apres mutation declenche subscriber');
}());

// =============================================================================
// 2. UTILS
// =============================================================================
section('utils.js -- fonctions pures');

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtd(s) {
  if (s == null || isNaN(s)) return '--:--';
  var t = Math.floor(s), h = Math.floor(t/3600), m = Math.floor((t%3600)/60), sec = t%60;
  if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  return m + ':' + String(sec).padStart(2,'0');
}
function normTag(s) {
  if (!s) return '';
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function mainArtist(s) {
  if (!s) return '';
  return s.split(/[,;&\/]|feat\.|ft\./i)[0].trim();
}

(function() {
  assert(esc('<script>') === '&lt;script&gt;', 'esc() balises');
  assert(esc('a & b')    === 'a &amp; b',      'esc() ampersand');
  assert(esc('')         === '',               'esc() vide');
  assert(esc(null)       === '',               'esc() null');
  assert(fmtd(0)    === '0:00',    'fmtd(0)');
  assert(fmtd(65)   === '1:05',    'fmtd(65)');
  assert(fmtd(3661) === '1:01:01', 'fmtd(3661) avec heures');
  assert(fmtd(NaN)  === '--:--',   'fmtd(NaN)');
  assert(fmtd(null) === '--:--',   'fmtd(null)');
  assert(normTag('Ébène') === 'ebene', 'normTag diacritiques');
  assert(normTag('  FOO  ')        === 'foo',    'normTag trim+lowercase');
  assert(normTag(null)             === '',       'normTag null');
  assert(mainArtist('A, B, C')   === 'A', 'mainArtist virgule');
  assert(mainArtist('A feat. B') === 'A', 'mainArtist feat.');
  assert(mainArtist('A & B')     === 'A', 'mainArtist &');
  assert(mainArtist('')          === '',  'mainArtist vide');
}());

// =============================================================================
// 3. SEARCH
// =============================================================================
section('search.js -- filtrage et tri');

function matchQuery(t, q) {
  if (!q) return true;
  function norm(s) { return (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
  var parts = norm(q).split(/\s+/).filter(Boolean);
  var hay = [t.title, t.artist, t.album, t.genre].map(norm).join(' ');
  return parts.every(function(p) { return hay.includes(p); });
}
function sortTracks(tracks, sort) {
  var copy = tracks.slice();
  function cmp(a,b) { return (a||'').localeCompare(b||'', undefined, { sensitivity:'base' }); }
  if (sort==='az')     return copy.sort(function(a,b) { return cmp(a.title, b.title); });
  if (sort==='za')     return copy.sort(function(a,b) { return cmp(b.title, a.title); });
  if (sort==='artist') return copy.sort(function(a,b) { return cmp(a.artist,b.artist)||cmp(a.album,b.album); });
  if (sort==='album')  return copy.sort(function(a,b) { return cmp(a.album, b.album) ||cmp(a.title,b.title); });
  return copy;
}

(function() {
  var tracks = [
    { id:'1', title:'Zebre', artist:'Alpha', album:'Z', genre:'Rock' },
    { id:'2', title:'Apple', artist:'Beta',  album:'A', genre:'Pop'  },
    { id:'3', title:'Mango', artist:'Alpha', album:'M', genre:'Jazz' },
  ];
  assert( matchQuery(tracks[0], ''),           'query vide -> match tout');
  assert( matchQuery(tracks[0], 'zebre'),      'query casse insensible');
  assert( matchQuery(tracks[0], 'alpha'),      'query artiste');
  assert(!matchQuery(tracks[0], 'beta'),       'query non-match');
  assert( matchQuery(tracks[2], 'alpha mango'),'query multi-mots');
  assert(!matchQuery(tracks[0], 'xyz'),        'query aucun resultat');
  var az = sortTracks(tracks, 'az');
  assert(az[0].title==='Apple' && az[2].title==='Zebre', 'tri az');
  var za = sortTracks(tracks, 'za');
  assert(za[0].title==='Zebre', 'tri za');
  var byArtist = sortTracks(tracks, 'artist');
  assert(byArtist[0].artist==='Alpha' && byArtist[2].artist==='Beta', 'tri artist');
  var byAlbum = sortTracks(tracks, 'album');
  assert(byAlbum[0].album==='A', 'tri album');
  assert(tracks[0].title==='Zebre', 'tri ne mute pas le tableau source');
}());

// =============================================================================
// 4. LIKED -- Set<string ID>
// =============================================================================
section('player.js -- liked Set<string ID>');

(function() {
  var liked = new Set();
  var id1 = 'track-uuid-1', id2 = 'track-uuid-2';
  liked.has(id1) ? liked.delete(id1) : liked.add(id1);
  assert(liked.has(id1), 'toggleLike -> ajoute');
  liked.has(id1) ? liked.delete(id1) : liked.add(id1);
  assert(!liked.has(id1), 'toggleLike -> retire');
  liked.add(id1); liked.add(id2);
  liked.delete(id1);
  assert( liked.has(id2),  'delete id1 ne corrompt pas id2');
  assert(!liked.has(id1),  'id1 bien retire');
  liked.add(id1);
  var serialized = Array.from(liked);
  assert(Array.isArray(serialized), 'spread -> Array');
  var restored = new Set(serialized);
  assert(restored.has(id1) && restored.has(id2), 'deserialisation fidelee');
  assert(typeof Array.from(liked)[0] === 'string', 'liked contient des strings (IDs)');
}());

// =============================================================================
// 5. WATCHFOLDER -- deduplication snapshot
// =============================================================================
section('watchfolder.js -- deduplication snapshot');

(function() {
  var snapshot = new Set(['/music/a.mp3', '/music/b.flac']);
  var incoming = ['/music/b.flac', '/music/c.ogg', '/music/d.mp3'];
  var newFiles  = incoming.filter(function(p) { return !snapshot.has(p); });
  assert(newFiles.length === 2,                 '2 nouveaux sur 3 arrivants');
  assert(!newFiles.includes('/music/b.flac'),    'b.flac connu -> exclu');
  assert( newFiles.includes('/music/c.ogg'),     'c.ogg nouveau -> inclus');
  assert( newFiles.includes('/music/d.mp3'),     'd.mp3 nouveau -> inclus');
  newFiles.forEach(function(p) { snapshot.add(p); });
  assert(snapshot.size === 4, 'snapshot mis a jour (4 entrees)');
  var wave2 = incoming.filter(function(p) { return !snapshot.has(p); });
  assert(wave2.length === 0, 'deuxieme vague: rien de nouveau');
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
// 9. QUEUE -- data layer : _buildExplicitQueue / _buildNaturalUpcoming / removeFromQueue
// =============================================================================
section('queue.js -- data layer fonctions pures');

function _buildExplicitQueue_t(queueOverride, trackIdxMap, tracks) {
  if (!queueOverride || !queueOverride.length) return [];
  return queueOverride
    .filter(function(id) { return trackIdxMap.has(id); })
    .map(function(id) { return tracks[trackIdxMap.get(id)]; });
}

function _buildNaturalUpcoming_t(filteredIds, curId, overrideIds, tracks, limit) {
  limit = limit || 50;
  var overSet   = new Set(overrideIds || []);
  var startIdx  = filteredIds.indexOf(curId);
  var result    = [];
  for (var i = startIdx + 1; i < filteredIds.length && result.length < limit; i++) {
    var id = filteredIds[i];
    if (!overSet.has(id)) {
      var t = tracks.find(function(x) { return x.id === id; });
      if (t) result.push(t);
    }
  }
  return result;
}

function removeFromQueue_t(queueOverride, id) {
  if (!queueOverride) return null;
  var next = queueOverride.filter(function(x) { return x !== id; });
  return next.length ? next : null;
}

(function () {
  var tracks = [
    { id: 'a', title: 'AAA' },
    { id: 'b', title: 'BBB' },
    { id: 'c', title: 'CCC' },
    { id: 'd', title: 'DDD' },
  ];
  var idxMap = new Map([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);

  // _buildExplicitQueue
  assert(_buildExplicitQueue_t(null, idxMap, tracks).length === 0,  'explicit: null -> []');
  assert(_buildExplicitQueue_t([],   idxMap, tracks).length === 0,  'explicit: vide -> []');
  var eq = _buildExplicitQueue_t(['c', 'a'], idxMap, tracks);
  assert(eq.length === 2,                                            'explicit: 2 items');
  assert(eq[0].id === 'c' && eq[1].id === 'a',                      'explicit: ordre préservé');
  var eqBad = _buildExplicitQueue_t(['c', 'z', 'a'], idxMap, tracks);
  assert(eqBad.length === 2,                                         'explicit: ID inconnu filtré');

  // _buildNaturalUpcoming
  var fl = ['a', 'b', 'c', 'd'];
  var nu = _buildNaturalUpcoming_t(fl, 'a', [], tracks);
  assert(nu.length === 3,         'natural: 3 tracks après "a"');
  assert(nu[0].id === 'b',        'natural: premier = "b"');
  var nuEx = _buildNaturalUpcoming_t(fl, 'a', ['b', 'c'], tracks);
  assert(nuEx.length === 1,       'natural: exclut override');
  assert(nuEx[0].id === 'd',      'natural: seul "d" reste');
  var nuEnd = _buildNaturalUpcoming_t(fl, 'd', [], tracks);
  assert(nuEnd.length === 0,      'natural: dernière piste -> []');
  var nuLimit = _buildNaturalUpcoming_t(['a','b','c','d'], 'a', [], tracks, 2);
  assert(nuLimit.length === 2,    'natural: limit respecté');

  // removeFromQueue
  assert(removeFromQueue_t(null, 'a') === null,  'remove: null -> null');
  var r1 = removeFromQueue_t(['a', 'b', 'c'], 'b');
  assert(r1.length === 2 && r1[0] === 'a' && r1[1] === 'c', 'remove: retire "b"');
  var r2 = removeFromQueue_t(['a'], 'a');
  assert(r2 === null,                            'remove: dernier item -> null');
  var r3 = removeFromQueue_t(['a', 'b'], 'z');
  assert(r3.length === 2,                        'remove: ID inconnu -> inchangé');
}());

// -- Resultat -----------------------------------------------------------------
console.log('\n' + '-'.repeat(54));
console.log('  Total : ' + (_pass+_fail) + '   OK: ' + _pass + '   KO: ' + _fail);
if (_fail > 0) { process.exit(1); }
