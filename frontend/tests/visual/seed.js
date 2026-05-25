// Visual-regression seed for libreflow (Task 1 — Playwright harness).
//
// Injected via page.addInitScript() BEFORE any app script runs. It does two
// things so the real library UI renders instead of the welcome screen (#vw):
//
//   (a) Stubs window.__TAURI__ — app.js boot() is gated by waitForTauri(),
//       which polls for `window.__TAURI__?.core?.invoke`. Without the stub the
//       app waits ~5s then boots degraded. The stub is fully offline: invoke()
//       returns [] and convertFileSrc() echoes the path.
//
//   (b) Seeds IndexedDB `lp4` v5 (schema from frontend/src/db.js):
//         tracks    keyPath 'id'
//         cfg       NO keyPath  (records stored under explicit key 'state')
//         playlists keyPath 'id'
//         playlog   keyPath 'ts'
//         imports   keyPath 'id'
//       boot() shows the welcome screen unless a `cfg` record exists AND the
//       `tracks` store is non-empty — so BOTH stores must be seeded.
//
// The IDB name/version/keyPaths MUST stay in sync with frontend/src/db.js.

export function seedScript() {
  // ── (a) Offline Tauri stub ────────────────────────────────────────────────
  window.__TAURI__ = {
    core: {
      invoke: async () => [],
      convertFileSrc: (p) => p,
    },
    event: { listen: async () => () => {} },
    window: {
      getCurrentWindow: () => ({
        listen: async () => () => {},
        onCloseRequested: async () => () => {},
      }),
    },
  };

  // ── (b) Seed IndexedDB `lp4` v5 ───────────────────────────────────────────
  // Delete first so each run starts from a deterministic state.
  const reseed = () => {
    const open = indexedDB.open('lp4', 5);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('tracks'))    db.createObjectStore('tracks',    { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cfg'))       db.createObjectStore('cfg');               // no keyPath
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('playlog'))   db.createObjectStore('playlog',   { keyPath: 'ts' });
      if (!db.objectStoreNames.contains('imports'))   db.createObjectStore('imports',   { keyPath: 'id' });
    };
    open.onsuccess = () => {
      const db = open.result;
      const txn = db.transaction(['tracks', 'cfg'], 'readwrite');

      // 200 synthetic tracks. Fields match the boot() mapper in app.js
      // (id, name, artist, artistFull, album, ext, path, duration, dateAdded,
      //  artColor, genre, year, track).
      // noArt=true is REQUIRED: boot() schedules a 3s artwork-retry for tracks
      // with metaDone && !art && !noArt && path, which shows a 120s `loading`
      // toast that would leak into screenshots. noArt=true (artwork confirmed
      // absent) excludes seeded tracks from that retry list.
      const tracksStore = txn.objectStore('tracks');
      const now = Date.now();
      for (let i = 0; i < 200; i++) {
        tracksStore.put({
          id:         't' + i,
          name:       'Titre ' + i,
          artist:     'Artiste ' + (i % 25),
          artistFull: 'Artiste ' + (i % 25),
          album:      'Album ' + (i % 40),
          ext:        'mp3',
          path:       '/m/song' + i + '.mp3',
          duration:   180 + i,
          dateAdded:  now - i * 60000,
          artColor:   null,
          noArt:      true,
          genre:      ['Rock', 'Jazz', 'Pop', 'Electro', 'Classique'][i % 5],
          year:       2000 + (i % 25),
          track:      (i % 12) + 1,
        });
      }

      // Minimal cfg — boot() takes the library branch only when a cfg record
      // exists. view 'all' renders the flat track list (#tlist) in #vlib.
      txn.objectStore('cfg').put({
        view:        'all',
        sort:        'az',
        lang:        'fr',
        theme:       'blue',
        displayMode: 'dark',
        dynColor:    true,
        volume:      1,
      }, 'state');
    };
  };

  const del = indexedDB.deleteDatabase('lp4');
  del.onsuccess = reseed;
  del.onerror   = reseed;
  del.onblocked = reseed;
}
