// Visual-regression matrix for libreflow's responsive overhaul (Task 1).
//
// This is the SAFETY NET every later responsive task verifies against. It
// captures the real library UI (sidebar + virtual track list) across a grid of
// viewport sizes, plus two secondary-panel states. Re-run with
// `npm run test:visual` to detect any visual regression.
//
// The app renders the welcome screen (#vw) unless IndexedDB is seeded — the
// injected seedScript() (seed.js) stubs window.__TAURI__ and seeds `lp4` v5 so
// the real library renders. waitForRealLibrary() blocks until actual track rows
// (#tlist .tr[data-track-id]) exist, so no snapshot can capture a blank page.

import { test, expect } from '@playwright/test';
import { seedScript } from './seed.js';

const WIDTHS  = [600, 720, 900, 1200, 1600];
const HEIGHTS = [400, 600, 800, 1000];

// Wait for the real library to be on-screen: #vlib active AND #tlist populated
// with non-skeleton rows. Skeleton rows are `.tr.tr-skel` and carry no
// data-track-id; real rows are `.tr` with data-track-id (renderer.js thtml()).
//
// Boot fires transient toasts ("200 titres chargés", session restored) lasting
// 2.6–3s (ui.js _TOAST_DUR). They must clear before a screenshot, otherwise the
// baseline is flaky run-to-run. We poll the toast layer until it is empty, with
// a hard cap so a stuck toast can never hang the test.
async function waitForRealLibrary(page) {
  await page.waitForSelector('#tlist .tr[data-track-id]', {
    state: 'attached',
    timeout: 20000,
  });
  // Settle async post-render work (artwork loader, marquee, stats).
  await page.waitForTimeout(400);
  // Wait out boot toasts so they are not captured in the baseline.
  await page
    .waitForFunction(
      () => {
        const layer = document.getElementById('toast-shelf');
        return !layer || layer.children.length === 0;
      },
      { timeout: 5000 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
}

test.describe('responsive viewport matrix', () => {
  for (const w of WIDTHS) {
    for (const h of HEIGHTS) {
      test(`library ${w}x${h}`, async ({ page }) => {
        await page.addInitScript(seedScript);
        await page.setViewportSize({ width: w, height: h });
        await page.goto('/');
        await waitForRealLibrary(page);
        await expect(page).toHaveScreenshot(`lib-${w}x${h}.png`, {
          fullPage: false,
          animations: 'disabled',
        });
      });
    }
  }
});

test.describe('secondary panels at 720x600', () => {
  test('queue panel open', async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.setViewportSize({ width: 720, height: 600 });
    await page.goto('/');
    await waitForRealLibrary(page);
    // #btn-queue → data-action="toggle-queue" → toggleQueue() (handlers.js).
    await page.click('#btn-queue');
    await page.waitForTimeout(500); // panel slide-in transition
    await expect(page).toHaveScreenshot('panel-queue-720x600.png', {
      fullPage: false,
      animations: 'disabled',
    });
  });

  test('eq panel open', async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.setViewportSize({ width: 720, height: 600 });
    await page.goto('/');
    await waitForRealLibrary(page);
    // #btn-eq → data-action="toggle-eq" → toggleEQ() (handlers.js).
    await page.click('#btn-eq');
    await page.waitForTimeout(500); // panel slide-in transition
    await expect(page).toHaveScreenshot('panel-eq-720x600.png', {
      fullPage: false,
      animations: 'disabled',
    });
  });
});
