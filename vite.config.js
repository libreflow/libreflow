import { defineConfig }         from 'vite';
import { resolve }              from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';
  // Vite 8 native config loader (ESM, no CJS interop) doesn't polyfill __dirname —
  // import.meta.dirname is the standard replacement (Node 20.11+, matches CLAUDE.md's Node 20 target).
  const __dirname = import.meta.dirname;

  return {
    // Vite serves frontend/ as the web root during dev
    root: 'frontend',

    // Dev server: Tauri opens http://localhost:1420 in the WebView
    server: {
      port: 1420,
      strictPort: true,
      host: 'localhost',
      hmr: { host: 'localhost' },
      watch: {
        // Don't watch Rust files — let Tauri CLI handle those
        ignored: ['**/src-tauri/**'],
      },
    },

    build: {
      // Output → dist/ (Tauri production build reads from here)
      outDir: '../dist',
      emptyOutDir: true,

      // Target modern Chromium/WebKit — what Tauri's WebView ships
      // This lets Oxc skip ES5 polyfills → smaller, faster bundle
      target: ['chrome105', 'safari15'],

      // Oxc minifier (Vite 8 default) — significantly faster than terser/esbuild
      // with comparable compression. esbuild minifier deprecated in Vite 8.
      minify: 'oxc',

      // Source maps only in dev; strip them from production to keep bundle lean
      sourcemap: !isProd,

      rolldownOptions: {
        // Multi-page: main window + mini player window
        input: {
          main: resolve(__dirname, 'frontend/index.html'),
          mini: resolve(__dirname, 'frontend/mini.html'),
        },

        output: {
          // Stable file names → better CDN / WebView caching in future
          // (Tauri uses file:// so hashes are fine, but humans can read logs)
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',

          // Manual chunk splitting — sépare les modules lourds qui ne sont
          // pas requis au premier paint (boot perceived ↓ ~150 ms sur cold load).
          // Un seul chunk "extras" (et non plusieurs) pour éviter les chunks
          // circulaires : ces modules ont entre eux des dépendances bidirectionnelles
          // (cinema ↔ nowplaying, settings ↔ replaygain, etc.) que Rolldown ne peut
          // pas résoudre proprement entre chunks séparés.
          // Vite 8 / Rolldown impose la forme fonction (l'ancienne forme objet de
          // Rollup n'est plus supportée).
          //
          // DETTE CONNUE (2026-09-01, audit perf via context7) : la forme fonction de
          // manualChunks est dépréciée par Vite 8/Rolldown au profit de
          // `codeSplitting.groups` (voir migration guide officiel). Non migré ici
          // délibérément : la doc Rolldown consultée via context7 ne montre que des
          // exemples `groups[].test` sur un SEUL pattern de nom de fichier simple
          // (ex: /\/static\.js$/) — jamais un cas avec plusieurs modules sources
          // arbitraires comme ici (18 fichiers répartis en 2 chunks nommés). La
          // sémantique exacte de `test` (chemin du module source, comme l'`id` reçu
          // ici, vs. nom du chunk de sortie déjà généré) n'a pas pu être confirmée.
          // Migrer à l'aveugle risquerait de casser silencieusement ce regroupement
          // (gain de ~150ms de boot perceived + résolution de dépendances circulaires
          // entre cinema/nowplaying/settings/replaygain). `manualChunks` fonction reste
          // pleinement supporté ("accepted for backward compatibility" par Vite lui-même)
          // — pas de warning émis en pratique sur ce projet à ce jour. À ré-évaluer
          // quand la doc Rolldown documentera un exemple multi-module explicite, ou
          // si Vite retire effectivement le support (pas encore le cas en 8.2.x).
          manualChunks(id) {
            const p = id.replace(/\\/g, '/');
            // Isole GSAP (core + Flip + CustomEase) dans son propre chunk.
            // Sépare le coût animation du libreflow-extras budget, permet au
            // browser de paralléliser le download avec le code app, et tient
            // un bucket "gsap" lisible dans perf-budgets.json.
            if (p.includes('/node_modules/gsap/')) return 'gsap';
            const CORE = new Set([
              'frontend/src/ipc.js',
              'frontend/src/cfg.js',
              'frontend/src/db.js',
            ]);
            // Modules lourds chargés à la demande après le premier paint :
            // panneaux secondaires (EQ, cinéma, viz, replaygain, nowplaying)
            // + outils (stats, smart-pl, backup, CD, dupes/orphans, tag editor, m3u).
            const EXTRAS = new Set([
              'frontend/src/eq.js',
              'frontend/src/eqdevice.js',
              'frontend/src/cinema.js',
              'frontend/src/viz.js',
              'frontend/src/replaygain.js',
              'frontend/src/nowplaying.js',
              'frontend/src/stats.js',
              'frontend/src/smartplaylist.js',
              'frontend/src/backup.js',
              'frontend/src/cdaudio.js',
              'frontend/src/cdaudio_pure.js',
              'frontend/src/dupes.js',
              'frontend/src/orphans.js',
              'frontend/src/settings.js',
              'frontend/src/tagedit.js',
              'frontend/src/m3u.js',
            ]);
            for (const f of CORE) if (p.endsWith('/' + f)) return 'libreflow-core';
            for (const f of EXTRAS) if (p.endsWith('/' + f)) return 'libreflow-extras';
          },
        },
      },
    },

    // Oxc transform options (Vite 8 replaced esbuild with Oxc for JS transforms)
    oxc: {
      // Strip console.* and debugger in production builds
      drop: isProd ? ['console', 'debugger'] : [],
      // Note: esbuild's `legalComments: 'none'` is not portable to Rolldown.
      // Vite 8 / Rolldown handles license comments via its own pipeline.
    },

    // Optimise dep pre-bundling (dev only — speeds up first page load)
    optimizeDeps: {
      // Nothing to pre-bundle for now (no npm runtime deps), but the entry
      // forces Vite to pre-scan our modules so the first HMR is instant
      entries: ['frontend/src/main.js'],
    },
  };
});
