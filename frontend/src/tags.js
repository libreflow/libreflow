// LibreFlow — Colour extraction, genre detection
// Pure functions: no DOM side-effects, no app state.
//
// Exports:
//   extractColor(url)         → Promise<'rgb(r,g,b)'>
//   GENRE_ARTISTS             Map: artist_lower → genre string
//   GENRE_KEYWORDS            Keyword → genre rules for title/album matching
//   guessGenre(track)         → genre string | null
// Note: readTags() was removed — tag parsing is done by the Rust lofty backend via IPC.

function extractColor(url) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 8;
      const ctx = c.getContext('2d');
      if (!ctx) { res('#3b82f6'); return; }
      ctx.drawImage(img,0,0,8,8);
      const d = ctx.getImageData(0,0,8,8).data;
      let r=0,g=0,b=0,n=0;
      for (let i=0;i<d.length;i+=4) {
        const br=(d[i]+d[i+1]+d[i+2])/3;
        if(br>25&&br<230){r+=d[i];g+=d[i+1];b+=d[i+2];n++;}
      }
      res(n>0 ? `rgb(${~~(r/n)},${~~(g/n)},${~~(b/n)})` : '#3b82f6');
    };
    img.onerror = () => res('#3b82f6');
    img.src = url;
  });
}

// ══ DÉTECTION DE GENRE INTELLIGENTE ════════════════════════
// Fonctionne 100% localement : artiste → genre connu,
// + règles sur mots-clés titre/album/artiste
// ─────────────────────────────────────────────────────────────

const GENRE_ARTISTS = (()=>{
  // Format compact : "artiste_minuscule:Genre"
  // ~400 artistes couvrant les styles les plus courants
  const raw = [
    // ── Hip-Hop / Rap ──
    'eminem:Hip-Hop','drake:Hip-Hop','kendrick lamar:Hip-Hop','jay-z:Hip-Hop',
    'kanye west:Hip-Hop','lil wayne:Hip-Hop','snoop dogg:Hip-Hop','dr. dre:Hip-Hop',
    'nas:Hip-Hop','biggie:Hip-Hop','notorious b.i.g.:Hip-Hop','tupac:Hip-Hop',
    '2pac:Hip-Hop','nicki minaj:Hip-Hop','cardi b:Hip-Hop','travis scott:Hip-Hop',
    'post malone:Hip-Hop','j. cole:Hip-Hop','chance the rapper:Hip-Hop',
    'a$ap rocky:Hip-Hop','future:Hip-Hop','lil uzi vert:Hip-Hop','21 savage:Hip-Hop',
    'migos:Hip-Hop','wu-tang clan:Hip-Hop','ice cube:Hip-Hop','method man:Hip-Hop',
    'outkast:Hip-Hop','pharrell williams:Hip-Hop','kid cudi:Hip-Hop',
    'mac miller:Hip-Hop','logic:Hip-Hop','tyler the creator:Hip-Hop',
    'childish gambino:Hip-Hop','wiz khalifa:Hip-Hop','meek mill:Hip-Hop',
    'lil baby:Hip-Hop','roddy ricch:Hip-Hop','polo g:Hip-Hop','dababy:Hip-Hop',
    'fetty wap:Hip-Hop','2 chainz:Hip-Hop','rick ross:Hip-Hop','big sean:Hip-Hop',
    'french montana:Hip-Hop','lil durk:Hip-Hop','young thug:Hip-Hop',
    'gunna:Hip-Hop','nle choppa:Hip-Hop','moneybagg yo:Hip-Hop',
    // FR rap
    'booba:Rap Français','nekfeu:Rap Français','sch:Rap Français',
    'lacrim:Rap Français','pnl:Rap Français','kaaris:Rap Français',
    'ninho:Rap Français','alonzo:Rap Français','jul:Rap Français',
    'damso:Rap Français','hamza:Rap Français','freeze corleone:Rap Français',
    'laylow:Rap Français','lomepal:Rap Français','orelsan:Rap Français',
    'bigflo et oli:Rap Français','mc solaar:Rap Français','iam:Rap Français',
    'ntu:Rap Français','gradur:Rap Français','sofiane:Rap Français',
    'rohff:Rap Français','soolking:Rap Français','gims:Rap Français',
    'maes:Rap Français','dinos:Rap Français','kofs:Rap Français',
    'zkr:Rap Français','naps:Rap Français',
    'hugo tsr:Rap Français','medine:Rap Français','vald:Rap Français',
    'stavo:Rap Français','lartiste:Rap Français','oxmo puccino:Rap Français',
    'keny arkana:Rap Français','josman:Rap Français','sadek:Rap Français',
    'soprano:Rap Français','furax barbarossa:Rap Français','alkpote:Rap Français',
    'seth gueko:Rap Français','sinik:Rap Français','maska:Rap Français',
    'hornet la frappe:Rap Français','awa imani:Rap Français',
    'zaho de sagazan:Pop','aya nakamura:Pop','vitaa:Pop','slimane:Pop',
    'louane:Pop','stromae:Pop','angele:Pop','pierre de maere:Pop',
    'wejdene:Pop','christine and the queens:Pop','claudio capeo:Pop',
    // ── Pop ──
    'taylor swift:Pop','ed sheeran:Pop','ariana grande:Pop','billie eilish:Pop',
    'dua lipa:Pop','harry styles:Pop','selena gomez:Pop','justin bieber:Pop',
    'katy perry:Pop','lady gaga:Pop','rihanna:Pop','beyonce:Pop',
    'michael jackson:Pop','madonna:Pop','britney spears:Pop','mariah carey:Pop',
    'whitney houston:Pop','adele:Pop','sam smith:Pop','shawn mendes:Pop',
    'charlie puth:Pop','olivia rodrigo:Pop','doja cat:Pop','lizzo:Pop',
    'camila cabello:Pop','halsey:Pop','lorde:Pop','sia:Pop',
    'meghan trainor:Pop','jason derulo:Pop','charlie xcx:Pop',
    'the weeknd:Pop','miley cyrus:Pop','nick jonas:Pop',
    // ── R&B / Soul ──
    'frank ocean:R&B','sza:R&B','h.e.r.:R&B','jhene aiko:R&B',
    'kehlani:R&B','summer walker:R&B','daniel caesar:R&B',
    'bryson tiller:R&B','ty dolla sign:R&B','tinashe:R&B',
    'usher:R&B','alicia keys:R&B','john legend:R&B','mary j. blige:R&B',
    'r. kelly:R&B','aaliyah:R&B','trey songz:R&B','neyo:R&B',
    'chris brown:R&B','ciara:R&B','janet jackson:R&B','marvin gaye:Soul',
    'stevie wonder:Soul','otis redding:Soul','ray charles:Soul',
    'aretha franklin:Soul','sam cooke:Soul','al green:Soul',
    'james brown:Soul','prince:R&B','erykah badu:R&B','d\'angelo:R&B',
    'maxwell:R&B','musiq soulchild:R&B','lauryn hill:R&B',
    // ── Electronic / Dance ──
    'daft punk:Electronic','deadmau5:Electronic','skrillex:Electronic',
    'diplo:Electronic','calvin harris:Electronic','david guetta:Electronic',
    'tiesto:Electronic','martin garrix:Electronic','avicii:Electronic',
    'zedd:Electronic','marshmello:Electronic','alan walker:Electronic',
    'the chainsmokers:Electronic','disclosure:Electronic','flume:Electronic',
    'four tet:Electronic','aphex twin:Electronic','boards of canada:Electronic',
    'massive attack:Electronic','portishead:Electronic','tricky:Electronic',
    'moby:Electronic','fatboy slim:Electronic','the prodigy:Electronic',
    'chemical brothers:Electronic','underworld:Electronic',
    'caribou:Electronic','james blake:Electronic','moderat:Electronic',
    'bicep:Electronic','john talabot:Electronic','peggy gou:Electronic',
    'gesaffelstein:Electronic','kavinsky:Electronic','justice:Electronic',
    'arca:Electronic','oneohtrix point never:Electronic','burial:Electronic',
    // ── Rock ──
    'led zeppelin:Rock','the rolling stones:Rock','the beatles:Rock',
    'ac/dc:Rock','guns n roses:Rock','metallica:Rock','nirvana:Rock',
    'foo fighters:Rock','red hot chili peppers:Rock','green day:Rock',
    'blink-182:Rock','the strokes:Rock','arctic monkeys:Rock',
    'radiohead:Rock','oasis:Rock','the killers:Rock','muse:Rock',
    'u2:Rock','queen:Rock','kiss:Rock','aerosmith:Rock',
    'bon jovi:Rock','the who:Rock','deep purple:Rock','black sabbath:Rock',
    'ozzy osbourne:Rock','iron maiden:Metal','slayer:Metal',
    'megadeth:Metal','pantera:Metal','system of a down:Metal',
    'linkin park:Rock','thirty seconds to mars:Rock','my chemical romance:Rock',
    'fall out boy:Rock','paramore:Rock','evanescence:Rock',
    'nine inch nails:Rock','marilyn manson:Rock','tool:Metal',
    'alice in chains:Rock','pearl jam:Rock','soundgarden:Rock',
    'audioslave:Rock','rage against the machine:Rock','incubus:Rock',
    'weezer:Rock','the white stripes:Rock','jack white:Rock',
    'tame impala:Rock','the black keys:Rock',
    // ── Jazz ──
    'miles davis:Jazz','john coltrane:Jazz','bill evans:Jazz',
    'thelonious monk:Jazz','charles mingus:Jazz','dave brubeck:Jazz',
    'duke ellington:Jazz','louis armstrong:Jazz','charlie parker:Jazz',
    'dizzy gillespie:Jazz','herbie hancock:Jazz','wayne shorter:Jazz',
    'pat metheny:Jazz','chick corea:Jazz','keith jarrett:Jazz',
    'brad mehldau:Jazz','diana krall:Jazz','norah jones:Jazz',
    'chet baker:Jazz','stan getz:Jazz','wes montgomery:Jazz',
    // ── Classique ──
    'beethoven:Classique','mozart:Classique','bach:Classique',
    'chopin:Classique','brahms:Classique','tchaikovsky:Classique',
    'debussy:Classique','vivaldi:Classique','schubert:Classique',
    'handel:Classique','mahler:Classique','ravel:Classique',
    'stravinsky:Classique','prokofiev:Classique',
    // ── Country ──
    'johnny cash:Country','dolly parton:Country','willie nelson:Country',
    'kenny rogers:Country','garth brooks:Country','shania twain:Country',
    'luke bryan:Country','blake shelton:Country','miranda lambert:Country',
    'carrie underwood:Country','taylor swift:Country','tim mcgraw:Country',
    // ── Reggae ──
    'bob marley:Reggae','peter tosh:Reggae','jimmy cliff:Reggae',
    'burning spear:Reggae','toots and the maytals:Reggae','sizzla:Reggae',
    'damian marley:Reggae','sean paul:Dancehall','vybz kartel:Dancehall',
    // ── Latin ──
    'j balvin:Latin','bad bunny:Latin','maluma:Latin','daddy yankee:Latin',
    'shakira:Latin','marc anthony:Latin','pitbull:Latin','celia cruz:Latin',
    'carlos santana:Latin','gloria estefan:Latin','ricky martin:Latin',
    // ── Funk / Disco ──
    'parliament:Funk','funkadelic:Funk','earth wind & fire:Funk',
    'kool & the gang:Funk','sly & the family stone:Funk',
    'george clinton:Funk','james brown:Funk','tower of power:Funk',
    'donna summer:Disco','bee gees:Disco','abba:Pop',
    // ── Blues ──
    'b.b. king:Blues','muddy waters:Blues','robert johnson:Blues',
    'eric clapton:Blues','buddy guy:Blues','john lee hooker:Blues',
    'howlin wolf:Blues','etta james:Blues','stevie ray vaughan:Blues',
    // ── Indie / Alternative ──
    'vampire weekend:Indie','modest mouse:Indie','the national:Indie',
    'bon iver:Indie','fleet foxes:Indie','sufjan stevens:Indie',
    'neutral milk hotel:Indie','beach house:Indie','iron & wine:Indie',
    'death cab for cutie:Indie','the shins:Indie','belle and sebastian:Indie',
    'lcd soundsystem:Indie','tv on the radio:Indie','animal collective:Indie',
    'grizzly bear:Indie','mgmt:Indie','phoenix:Indie','alt-j:Indie',
    'bastille:Indie','foals:Indie','two door cinema club:Indie',
    'the 1975:Indie','glass animals:Indie','jungle:Indie',
  ];
  const map = new Map();
  for (const entry of raw) {
    const colon = entry.lastIndexOf(':');
    map.set(entry.slice(0, colon), entry.slice(colon + 1));
  }
  return map;
})();

// Mots-clés dans titre/album → genre
const GENRE_KEYWORDS = [
  // Format: [regex, genre, priorité]
  [/\b(rap|freestyle|cypher|punchline|clash|mixtape|trap)\b/i,    'Hip-Hop', 2],
  [/\b(hip.?hop|ghetto|hood|street|thug|gang|squad)\b/i,         'Hip-Hop', 1],
  [/\b(drill|grime|afrobeats?|afrotrap)\b/i,                     'Afro/Drill', 2],
  [/\b(rnb|r&b|soul|groove|motown)\b/i,                          'R&B', 2],
  [/\b(electro|techno|house|trance|edm|dubstep|dnb|drum.?bass)\b/i,'Electronic', 2],
  [/\b(remix|dj |mix|bootleg|mashup|edit)\b/i,                   'Electronic', 1],
  [/\b(rock|punk|metal|grunge|hardcore|thrash|doom|stoner)\b/i,  'Rock', 2],
  [/\b(jazz|bebop|swing|blues|boogie|ragtime)\b/i,               'Jazz', 2],
  [/\b(classical|classique|symphony|sonata|concerto|opus|suite|nocturne|prelude|fugue|waltz|etude)\b/i, 'Classique', 2],
  [/\b(country|bluegrass|western|honky.?tonk|outlaw)\b/i,        'Country', 2],
  [/\b(reggae|dancehall|ska|dub|ragga|yard)\b/i,                 'Reggae', 2],
  [/\b(funk|disco|groove|boogie|soul)\b/i,                       'Funk', 1],
  [/\b(latin|salsa|bachata|merengue|cumbia|reggaeton|bossa|samba|tango)\b/i,'Latin', 2],
  [/\b(gospel|hymn|worship|praise|spiritual|choir)\b/i,          'Gospel', 2],
  [/\b(pop|teen|dance|banger|anthem)\b/i,                        'Pop', 1],
  [/\b(indie|alternative|lo.?fi|bedroom|shoegaze|dream.?pop)\b/i,'Indie', 2],
  [/\b(acoustic|unplugged|live|session)\b/i,                     'Acoustique', 1],
  [/\b(ambient|atmospheric|drone|meditation|relax)\b/i,          'Ambient', 2],
  [/\b(film|movie|soundtrack|ost|score|theme)\b/i,               'Soundtrack', 2],
  [/\b(rave|festival|party|club|dancefloor)\b/i,                 'Electronic', 1],
];

function guessGenre(track) {
  const artist  = (track.artistFull || track.artist || '').toLowerCase().trim();
  const name    = (track.name   || '').toLowerCase();
  const album   = (track.album  || '').toLowerCase();
  const haystack = `${name} ${album}`;

  // 1. Correspondance exacte artiste → genre connu
  if (artist && GENRE_ARTISTS.has(artist)) return GENRE_ARTISTS.get(artist);

  // 2. Correspondance partielle artiste (ex: "Drake feat. Lil Wayne" → "drake")
  const artistFirst = artist.split(' ')[0]; // hoist — évite O(n) splits dans la boucle
  for (const [key, genre] of GENRE_ARTISTS) {
    if (artist.includes(key) || key.includes(artistFirst)) {
      if (artistFirst.length > 3) return genre; // éviter faux positifs sur prénoms courts
    }
  }

  // 3. Mots-clés dans titre/album — score pondéré
  const scores = new Map();
  for (const [re, genre, weight] of GENRE_KEYWORDS) {
    if (re.test(haystack) || re.test(artist)) {
      scores.set(genre, (scores.get(genre) || 0) + weight);
    }
  }
  if (scores.size) {
    return [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  return null;
}

export { extractColor, GENRE_ARTISTS, GENRE_KEYWORDS, guessGenre };
