// LibreFlow — Tag parsing, colour extraction, genre detection
// Pure functions: no DOM side-effects, no app state.
//
// Exports:
//   readTags(file)            → { title, artist, album, genre, year, track, picture, picMime }
//   extractColor(url)         → Promise<'rgb(r,g,b)'>
//   GENRE_ARTISTS             Map: artist_lower → genre string
//   GENRE_KEYWORDS            Keyword → genre rules for title/album matching
//   guessGenre(track)         → genre string | null

// ══ ID3/FLAC/M4A Parser ═══════════════════════
async function readTags(file) {
  const r = { title:null, artist:null, album:null, genre:null, year:null, track:null, picture:null, picMime:'image/jpeg' };
  try {
    const SIZE  = Math.min(file.size, 12 * 1024 * 1024);
    const buf   = await file.slice(0, SIZE).arrayBuffer();
    const u8    = new Uint8Array(buf);
    const dv    = new DataView(buf);
    const dec8  = s => new TextDecoder('utf-8',   {fatal:false}).decode(s);
    const dec16 = s => new TextDecoder('utf-16le',{fatal:false}).decode(s);
    const decL  = s => new TextDecoder('latin1',  {fatal:false}).decode(s);

    // Read null-terminated string
    function nts(arr, from, enc) {
      let i = from;
      if (enc === 1 || enc === 2) {
        while (i+1 < arr.length && !(arr[i]===0 && arr[i+1]===0)) i+=2;
        return { s: dec16(arr.slice(from, i)).trim(), end: i+2 };
      }
      while (i < arr.length && arr[i] !== 0) i++;
      return { s: dec8(arr.slice(from, i)).trim(), end: i+1 };
    }

    // Decode text frame
    function txf(data) {
      if (!data || !data.length) return '';
      const enc = data[0], d = data.slice(1);
      let t = '';
      if (enc === 1 || enc === 2) {
        let s = 0;
        if (d.length >= 2 && ((d[0]===0xFF&&d[1]===0xFE)||(d[0]===0xFE&&d[1]===0xFF))) s = 2;
        t = dec16(d.slice(s));
      } else if (enc === 3) {
        t = dec8(d);
      } else {
        t = decL(d);
      }
      return t.replace(/\0[\s\S]*$/, '').trim();
    }

    const sig3 = dec8(u8.slice(0,3));

    // ── ID3v2 ──
    if (sig3 === 'ID3') {
      const ver   = u8[3];
      const flags = u8[5];
      const tagSz = ((u8[6]&0x7f)<<21)|((u8[7]&0x7f)<<14)|((u8[8]&0x7f)<<7)|(u8[9]&0x7f);
      let pos = 10;
      if (flags & 0x40) {
        const extSz = ver === 4
          ? ((u8[pos]&0x7f)<<21)|((u8[pos+1]&0x7f)<<14)|((u8[pos+2]&0x7f)<<7)|(u8[pos+3]&0x7f)
          : dv.getUint32(pos);
        pos += extSz;
      }
      const end = Math.min(10 + tagSz, u8.length);

      while (pos + 10 < end) {
        const fid = ver < 3 ? dec8(u8.slice(pos,pos+3)) : dec8(u8.slice(pos,pos+4));
        if (!fid[0] || fid.charCodeAt(0) < 32) break;
        const hSz = ver < 3 ? 6 : 10;
        let fSz;
        if      (ver < 3)  fSz = (u8[pos+3]<<16)|(u8[pos+4]<<8)|u8[pos+5];
        else if (ver === 4) fSz = ((u8[pos+4]&0x7f)<<21)|((u8[pos+5]&0x7f)<<14)|((u8[pos+6]&0x7f)<<7)|(u8[pos+7]&0x7f);
        else               fSz = dv.getUint32(pos+4);
        pos += hSz;
        if (fSz <= 0 || pos + fSz > u8.length) break;
        const fd = u8.slice(pos, pos + fSz);

        if (['TIT2','TT2'].includes(fid))  r.title  = txf(fd) || r.title;
        if (['TPE1','TP1'].includes(fid))  r.artist = txf(fd) || r.artist;
        if (['TALB','TAL'].includes(fid))  r.album  = txf(fd) || r.album;
        if (['TCON','TCO'].includes(fid))  r.genre  = txf(fd) || r.genre;
        // BUG FIX : year et track number jamais parsés
        if (['TDRC','TYER','TYE'].includes(fid) && !r.year) {
          const raw = txf(fd).trim(); const y = parseInt(raw);
          // Exclure l'epoch Unix : "1970-01-..." est un placeholder encodeur, pas une vraie année
          const isEpoch = (y === 1970 && raw.length > 4 && raw.startsWith('1970-01'));
          if (y > 1000 && y < 2200 && !isEpoch) r.year = y;
        }
        if (['TRCK','TRK'].includes(fid) && !r.track) {
          const raw = txf(fd); const n = parseInt(raw); if (n > 0) r.track = n;
        }
        if ((fid==='APIC'||fid==='PIC') && !r.picture) {
          const enc = fd[0]; let i = 1;
          if (fid === 'PIC') {
            const fmt = dec8(fd.slice(1,4)).toLowerCase();
            r.picMime = fmt==='png' ? 'image/png' : 'image/jpeg';
            i = 5; // 1 enc + 3 fmt + 1 pictype
            const desc = nts(fd, i, enc); i = desc.end;
          } else {
            const mime = nts(fd, 1, 0); i = mime.end;
            r.picMime = mime.s.includes('png') ? 'image/png' : mime.s.includes('gif') ? 'image/gif' : 'image/jpeg';
            i++; // pic type
            const desc = nts(fd, i, enc); i = desc.end;
          }
          if (i < fd.length) r.picture = fd.slice(i);
        }
        pos += fSz;
      }
    }

    // ── ID3v1 fallback ──
    if (!r.title && file.size >= 128) {
      const tail = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
      if (tail[0]===84 && tail[1]===65 && tail[2]===71) {
        const rd = (s,e) => decL(tail.slice(s,e)).replace(/\0+$/,'').trim();
        r.title  = rd(3,33)  || r.title;
        r.artist = rd(33,63) || r.artist;
        r.album  = rd(63,93) || r.album;
      }
    }

    // ── FLAC ──
    if (dec8(u8.slice(0,4)) === 'fLaC') {
      let pos = 4;
      while (pos + 4 < u8.length) {
        const last  = !!(u8[pos] & 0x80);
        const btype = u8[pos] & 0x7f;
        const blen  = (u8[pos+1]<<16)|(u8[pos+2]<<8)|u8[pos+3];
        pos += 4;
        if (pos + blen > u8.length) break;

        if (btype === 4) {  // VORBIS_COMMENT
          let vi = pos;
          const vl = u8[vi]|(u8[vi+1]<<8)|(u8[vi+2]<<16)|(u8[vi+3]<<24); vi += 4 + vl;
          const cnt = u8[vi]|(u8[vi+1]<<8)|(u8[vi+2]<<16)|(u8[vi+3]<<24); vi += 4;
          for (let c = 0; c < cnt && vi + 4 <= pos+blen; c++) {
            const cl = u8[vi]|(u8[vi+1]<<8)|(u8[vi+2]<<16)|(u8[vi+3]<<24); vi += 4;
            if (vi + cl > u8.length) break;
            const cm = dec8(u8.slice(vi, vi + cl)); vi += cl;
            const eq = cm.indexOf('='); if (eq < 0) continue;
            const k = cm.slice(0,eq).toUpperCase(), v = cm.slice(eq+1).trim();
            if (k==='TITLE'  && !r.title)  r.title  = v || null;
            if (k==='ARTIST' && !r.artist) r.artist = v || null;
            if (k==='ALBUM'  && !r.album)  r.album  = v || null;
            if (k==='GENRE'  && !r.genre)  r.genre  = v || null;
            // BUG FIX : year et track number FLAC
            if ((k==='DATE'||k==='YEAR') && !r.year) {
              const sv=v.trim(); const y=parseInt(sv);
              const isEpoch=(y===1970 && sv.length>4 && sv.startsWith('1970-01'));
              if(y>1000&&y<2200 && !isEpoch) r.year=y;
            }
            if (k==='TRACKNUMBER' && !r.track) { const n=parseInt(v); if(n>0) r.track=n; }
          }
        } else if (btype === 6 && !r.picture) {  // PICTURE
          // FIX BUG 7: correct FLAC picture block parsing
          let vi = pos;
          vi += 4; // skip picture type (4 bytes)
          const mimeLen = (u8[vi]<<24)|(u8[vi+1]<<16)|(u8[vi+2]<<8)|u8[vi+3]; vi += 4;
          if (vi + mimeLen > u8.length) { pos += blen; if(last)break; continue; }
          const mimeStr = dec8(u8.slice(vi, vi + mimeLen)); vi += mimeLen;
          r.picMime = mimeStr.includes('png') ? 'image/png' : 'image/jpeg';
          const descLen = (u8[vi]<<24)|(u8[vi+1]<<16)|(u8[vi+2]<<8)|u8[vi+3]; vi += 4;
          vi += descLen; // skip description
          vi += 16; // skip width(4) + height(4) + colorDepth(4) + indexedColors(4)
          const dataLen = (u8[vi]<<24)|(u8[vi+1]<<16)|(u8[vi+2]<<8)|u8[vi+3]; vi += 4;
          if (dataLen > 0 && vi + dataLen <= u8.length) r.picture = u8.slice(vi, vi + dataLen);
        }
        pos += blen;
        if (last) break;
      }
    }

    // ── M4A/AAC ──
    const ext = file.name.split('.').pop().toLowerCase();
    if (['m4a','m4b','aac','mp4','alac'].includes(ext)) {
      function parseBox(data, start, end) {
        let off = start;
        while (off + 8 <= end && off < data.length) {
          let sz = (data[off]<<24)|(data[off+1]<<16)|(data[off+2]<<8)|data[off+3];
          const nm = dec8(data.slice(off+4, off+8));
          if (sz < 8) { off += 4; continue; }
          const inner = Math.min(off + sz, data.length);
          if (['moov','udta','ilst'].includes(nm)) parseBox(data, off+8, inner);
          else if (nm === 'meta')                  parseBox(data, off+12, inner);
          else if (['\xa9nam','\xa9ART','\xa9alb','aART','\xa9gen','\xa9day','trkn','covr'].includes(nm)) {
            let di = off + 8;
            while (di + 8 <= inner) {
              const dsz = (data[di]<<24)|(data[di+1]<<16)|(data[di+2]<<8)|data[di+3];
              const dn  = dec8(data.slice(di+4, di+8));
              if (dn === 'data' && dsz > 16) {
                const tf = (data[di+8]<<24)|(data[di+9]<<16)|(data[di+10]<<8)|data[di+11];
                const pl = data.slice(di+16, di+dsz);
                if (nm==='\xa9nam' && !r.title)               r.title  = dec8(pl).trim() || null;
                if ((nm==='\xa9ART'||nm==='aART') && !r.artist) r.artist = dec8(pl).trim() || null;
                if (nm==='\xa9alb' && !r.album)               r.album  = dec8(pl).trim() || null;
                if (nm==='\xa9gen' && !r.genre)               r.genre  = dec8(pl).trim() || null;
                // BUG FIX : year (©day) et track number (trkn) M4A
                if (nm==='\xa9day' && !r.year) {
                  const sv=dec8(pl).trim(); const y=parseInt(sv);
                  const isEpoch=(y===1970 && sv.length>4 && sv.startsWith('1970-01'));
                  if(y>1000&&y<2200 && !isEpoch) r.year=y;
                }
                if (nm==='trkn'   && !r.track && pl.length>=4) { const n=(pl[2]<<8)|pl[3]; if(n>0) r.track=n; }
                if (nm==='covr'   && !r.picture) { r.picMime = tf===14?'image/png':'image/jpeg'; r.picture = pl; }
              }
              if (dsz < 8) break; di += dsz;
            }
          }
          off += sz;
        }
      }
      parseBox(u8, 0, u8.length);
    }
  } catch(e) { console.warn('[readTags]', e); }
  return r;
}

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

export { readTags, extractColor, GENRE_ARTISTS, GENRE_KEYWORDS, guessGenre };
