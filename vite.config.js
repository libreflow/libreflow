import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

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
        ignored: ['**/src-tauri/**']
      }
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
          main: resolve(import.meta.dirname, 'frontend/index.html'),
          mini: resolve(import.meta.dirname, 'frontend/mini.html')
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
              'frontend/src/db.js'
            ]);
            // NOTE PERF-LH : stats, smartplaylist, dupes, orphans, tagedit, m3u et
            // backup sont importés dynamiquement à l'usage — retirés de la liste
            // EXTRAS pour que Rolldown les split en chunks async distincts.
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
              'frontend/src/cdaudio.js',
              'frontend/src/cdaudio_pure.js',
              'frontend/src/settings.js'
            ]);
            for (const f of CORE) if (p.endsWith('/' + f)) return 'libreflow-core';
            for (const f of EXTRAS) if (p.endsWith('/' + f)) return 'libreflow-extras';
          }
        }
      }
    },

    // Oxc transform options (Vite 8 replaced esbuild with Oxc for JS transforms)
    oxc: {
      // Strip console.* and debugger in production builds
      drop: isProd ? ['console', 'debugger'] : []
      // Note: esbuild's `legalComments: 'none'` is not portable to Rolldown.
      // Vite 8 / Rolldown handles license comments via its own pipeline.
    },

    // Optimise dep pre-bundling (dev only — speeds up first page load)
    optimizeDeps: {
      // Nothing to pre-bundle for now (no npm runtime deps), but the entry
      // forces Vite to pre-scan our modules so the first HMR is instant
      entries: ['frontend/src/main.js']
    }
  };
});
