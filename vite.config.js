import { defineConfig }         from 'vite';
import { resolve }              from 'path';
import { rmSync, existsSync }   from 'fs';

// Plugin : exclut les dossiers inutiles de dist/ après build de production.
// Utilisé pour supprimer frontend/public/ort/ (fichiers ONNX Runtime — dead code
// depuis le retrait du module genreml). Ces fichiers doivent aussi être supprimés
// du source tree manuellement (voir CLEANUP.sh / CLEANUP.ps1).
function excludeFromDist(patterns) {
  return {
    name: 'exclude-from-dist',
    apply: 'build',
    closeBundle() {
      for (const pattern of patterns) {
        const target = resolve(__dirname, 'dist', pattern);
        if (existsSync(target)) {
          rmSync(target, { recursive: true, force: true });
          console.log(`[exclude-from-dist] Supprimé : dist/${pattern}`);
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    // Vite serves frontend/ as the web root during dev
    root: 'frontend',

    plugins: [
      // Exclure les fichiers ONNX Runtime du build — feature genreml retirée (dead code)
      // Les binaires source dans frontend/public/ort/ peuvent être supprimés manuellement
      // via CLEANUP.sh (bash) ou CLEANUP.ps1 (PowerShell).
      excludeFromDist(['ort']),
    ],

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
      // This lets esbuild skip ES5 polyfills → smaller, faster bundle
      target: ['chrome105', 'safari15'],

      // esbuild is faster than terser; both achieve equivalent output size
      minify: 'esbuild',

      // Source maps only in dev; strip them from production to keep bundle lean
      sourcemap: !isProd,

      rollupOptions: {
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
          // (cinema ↔ nowplaying, settings ↔ replaygain, etc.) que Rollup ne peut
          // pas résoudre proprement entre chunks séparés.
          manualChunks: {
            'libreflow-core': [
              './frontend/src/ipc.js',
              './frontend/src/cfg.js',
              './frontend/src/db.js',
            ],
            // Modules lourds chargés à la demande après le premier paint :
            // panneaux secondaires (EQ, cinéma, viz, replaygain, nowplaying)
            // + outils (stats, smart-pl, backup, CD, dupes/orphans, tag editor, m3u).
            'libreflow-extras': [
              './frontend/src/eq.js',
              './frontend/src/eqdevice.js',
              './frontend/src/cinema.js',
              './frontend/src/viz.js',
              './frontend/src/replaygain.js',
              './frontend/src/nowplaying.js',
              './frontend/src/stats.js',
              './frontend/src/smartplaylist.js',
              './frontend/src/backup.js',
              './frontend/src/cdaudio.js',
              './frontend/src/cdaudio_pure.js',
              './frontend/src/dupes.js',
              './frontend/src/orphans.js',
              './frontend/src/settings.js',
              './frontend/src/tagedit.js',
              './frontend/src/m3u.js',
            ],
          },
        },
      },
    },

    // esbuild transform options (applied during both dev transforms and prod minify)
    esbuild: {
      // Strip console.* and debugger in production builds
      drop: isProd ? ['console', 'debugger'] : [],
      // Legal comments → keep in a separate file to avoid cluttering the bundle
      legalComments: 'none',
    },

    // Optimise dep pre-bundling (dev only — speeds up first page load)
    optimizeDeps: {
      // Nothing to pre-bundle for now (no npm runtime deps), but the entry
      // forces Vite to pre-scan our modules so the first HMR is instant
      entries: ['frontend/src/main.js'],
    },
  };
});
