import { defineConfig } from '@playwright/test';

// Visual-regression harness for libreflow's responsive overhaul (Task 1).
// Drives a LOCAL Vite dev server only — no external network (CLAUDE.md §15).
// Port 1420 confirmed against src-tauri/tauri.conf.json (build.devUrl) and
// vite.config.js (server.port, strictPort).
export default defineConfig({
  testDir: '.',
  snapshotDir: './__snapshots__',
  // `npm run vite` honours vite.config.js → http://localhost:1420 (strictPort).
  webServer: {
    command: 'npm run vite',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 60000,
  },
  use: { baseURL: 'http://localhost:1420' },
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
