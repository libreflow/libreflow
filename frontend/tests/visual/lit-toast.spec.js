// LibreFlow — Visual test : <lf-toast-stack> (Phase 0 Lit pilot)
//
// Confirms that the Lit Web Component renders correctly once integrated into the
// live app. Exercises the public ui.js#toast() façade in two representative
// cases: an ephemeral info toast and a persistent error toast with a close
// button. Both are snapshot-tested against a Chromium/win32 baseline so any
// future visual regression in the component is caught automatically.
//
// Strategy:
//   1. Seed IndexedDB so the app boots into the library view (not the welcome
//      screen), using the same seedScript helper as responsive.spec.js.
//   2. Wait for the real library + boot toasts to clear (identical guard from
//      the existing test suite) to prevent flakiness from transient boot
//      notifications contaminating the snapshot.
//   3. Trigger a toast via dynamic ESM import of ui.js (works because the
//      playwright webServer runs the Vite dev server, so /src/* paths are live).
//   4. Snapshot the <lf-toast-stack> custom element with animations disabled.

import { test, expect } from '@playwright/test';
import { seedScript } from './seed.js';

// Reuse the same boot-toast guard from responsive.spec.js: blocks until the
// real track list is rendered AND any transient boot toasts have cleared.
async function waitForRealLibrary(page) {
  await page.waitForSelector('#tlist .tr[data-track-id]', {
    state: 'attached',
    timeout: 20000,
  });
  await page.waitForTimeout(400);
  await page
    .waitForFunction(
      () => {
        const layer = document.getElementById('toast-shelf');
        return !layer || layer.children.length === 0;
      },
      { timeout: 5000 },
    )
    .catch(() => {});
  // Also wait for lf-toast-stack to be empty (Lit toast layer)
  await page
    .waitForFunction(
      () => {
        const stack = document.querySelector('lf-toast-stack');
        if (!stack) return true;
        // Lit renders items into the shadow root; an empty stack has no child
        // elements in the shadow DOM.
        const sr = stack.shadowRoot;
        return !sr || sr.querySelectorAll('.t-item').length === 0;
      },
      { timeout: 5000 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
}

test.describe('lf-toast-stack', () => {
  test('lf-toast-stack is registered as a custom element', async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.goto('/');
    await waitForRealLibrary(page);
    const isRegistered = await page.evaluate(() => !!customElements.get('lf-toast-stack'));
    expect(isRegistered).toBe(true);
  });

  test('renders an info toast (snapshot)', async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto('/');
    await waitForRealLibrary(page);

    // Trigger an info toast via the public ui.js façade.
    await page.evaluate(async () => {
      const ui = await import('/src/ui.js');
      ui.toast('Snapshot test info', 'info');
    });

    // Wait for the component to be in the DOM and the slide-in animation to settle.
    await page.waitForSelector('lf-toast-stack', { state: 'attached', timeout: 5000 });
    await page.waitForFunction(
      () => {
        const sr = document.querySelector('lf-toast-stack')?.shadowRoot;
        return sr && sr.querySelectorAll('.t-item').length > 0;
      },
      { timeout: 5000 },
    );
    await page.waitForTimeout(250);

    const stack = page.locator('lf-toast-stack');
    await expect(stack).toHaveScreenshot('lf-toast-info.png', {
      animations: 'disabled',
    });
  });

  test('renders an error toast with close button (snapshot)', async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto('/');
    await waitForRealLibrary(page);

    // Trigger an error toast — type 'error' renders a close button and has
    // 8 000 ms auto-dismiss so it is safely visible during the snapshot.
    await page.evaluate(async () => {
      const ui = await import('/src/ui.js');
      ui.toast('Snapshot test error', 'error');
    });

    await page.waitForSelector('lf-toast-stack', { state: 'attached', timeout: 5000 });
    await page.waitForFunction(
      () => {
        const sr = document.querySelector('lf-toast-stack')?.shadowRoot;
        return sr && sr.querySelectorAll('.t-item').length > 0;
      },
      { timeout: 5000 },
    );
    await page.waitForTimeout(250);

    const stack = page.locator('lf-toast-stack');
    await expect(stack).toHaveScreenshot('lf-toast-error.png', {
      animations: 'disabled',
    });
  });
});
