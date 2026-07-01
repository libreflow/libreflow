import { defineConfig } from '@playwright/test';

// Behavioral E2E harness for libreflow — keyboard navigation, focus management,
// and ARIA live-region tests that static analysis (a11y.test.cjs) cannot cover.
// Same offline constraints as the visual harness: local Vite dev server only,
// no external network (CLAUDE.md §15). Port 1420 matches vite.config.js.
export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  retries: 1,
  use: {
    baseURL: 'http://localhost:1420',
    actionTimeout: 8000,
    navigationTimeout: 30000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run vite',
    url: 'http://localhost:1420',
    reuseExistingServer: true,
    timeout: 60000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
