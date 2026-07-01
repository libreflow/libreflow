// frontend/tests/e2e/a11y.spec.js
//
// Behavioral a11y E2E suite — complements the static checks in a11y.test.cjs
// by verifying runtime behavior that requires a real browser:
//   • Keyboard focus management in modals (focus trap, focus restore)
//   • aria-expanded toggling on panel buttons
//   • Tab order reachability for player controls
//   • SC 1.3.1 aria-setsize/aria-posinset on virtual track rows
//   • SC 1.3.1 aria-live on the sidebar stats region
//
// Uses the same offline Tauri stub + IDB seed as the visual suite so the full
// library UI renders. No real audio engine — audio tests are smoke only.

import { test, expect } from '@playwright/test';
import { seedScript } from '../visual/seed.js';

// ── Boot guard (same contract as responsive.spec.js) ─────────────────────────
async function waitForRealLibrary(page) {
  await page.waitForSelector('#tlist .tr[data-track-id]', {
    state: 'attached',
    timeout: 20_000,
  });
  await page.waitForTimeout(400);
  // Wait for boot toasts to clear so they don't interfere with focus tests.
  await page
    .waitForFunction(
      () => {
        const layer = document.getElementById('toast-shelf');
        const stack = document.querySelector('lf-toast-stack');
        const stackEmpty = !stack?.shadowRoot ||
          stack.shadowRoot.querySelectorAll('.t-item').length === 0;
        return (!layer || layer.children.length === 0) && stackEmpty;
      },
      { timeout: 6000 },
    )
    .catch(() => {});
  await page.waitForTimeout(200);
}

// ── Helper: open settings via burger menu ─────────────────────────────────────
// #tbt-settings (role="menuitem", tabindex="-1") lives inside #tb-burger-panel
// which is hidden by default. Must click #tbt-burger first to reveal the menu.
// openSettings() moves focus via setTimeout(..., 50) — we wait for it to settle.
async function openSettingsPanel(page) {
  await page.locator('#tbt-burger').click();
  await page.locator('#tb-burger-panel').waitFor({ state: 'visible' });
  await page.locator('#tbt-settings').click();
  await page.locator('#settings-panel').waitFor({ state: 'visible' });
  // Wait for the 50ms setTimeout in openSettings() that moves focus inside the panel.
  await page.waitForFunction(
    () => document.getElementById('settings-box')?.contains(document.activeElement) ?? false,
    { timeout: 2000 },
  );
}

// ── Settings panel — focus trap + focus restore (WCAG SC 2.1.2, SC 3.2.2) ───
test.describe('settings panel — focus management', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.goto('/');
    await waitForRealLibrary(page);
  });

  test('opens and moves focus inside the panel', async ({ page }) => {
    await openSettingsPanel(page);

    const focusedInPanel = await page.evaluate(() => {
      const p = document.getElementById('settings-panel');
      return p?.contains(document.activeElement) ?? false;
    });
    expect(focusedInPanel).toBe(true);
  });

  test('Tab cycles within the panel (focus trap)', async ({ page }) => {
    await openSettingsPanel(page);

    // Tab 20 times — focus must never escape the panel.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const escaped = await page.evaluate(() => {
        const p = document.getElementById('settings-panel');
        return !p?.contains(document.activeElement);
      });
      expect(escaped).toBe(false);
    }
  });

  test('Escape closes the panel and restores focus to the burger button', async ({ page }) => {
    await openSettingsPanel(page);

    await page.keyboard.press('Escape');

    await expect(page.locator('#settings-panel')).not.toBeVisible();
    // _doClose fires after the 160ms GSAP animation. openSettings() stores
    // #tbt-burger as the restore target when opened from the burger panel
    // (WAI-ARIA fallback: menu items live in display:none when the panel closes).
    await page.waitForFunction(
      () => document.activeElement?.id === 'tbt-burger',
      { timeout: 1000 },
    );
  });

  test('close button closes the panel and restores focus to the burger button', async ({ page }) => {
    await openSettingsPanel(page);

    await page.locator('.set-close[data-action="close-settings"]').click();

    await expect(page.locator('#settings-panel')).not.toBeVisible();
    await page.waitForFunction(
      () => document.activeElement?.id === 'tbt-burger',
      { timeout: 1000 },
    );
  });
});

// ── Panel toggle buttons — aria-expanded (WCAG SC 4.1.2) ─────────────────────
test.describe('panel toggles — aria-expanded', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.goto('/');
    await waitForRealLibrary(page);
  });

  test('#btn-eq toggles aria-expanded and reveals the panel', async ({ page }) => {
    const btn = page.locator('#btn-eq');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#eq-panel')).toBeVisible();

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });

  test('#btn-queue toggles aria-expanded and reveals the panel', async ({ page }) => {
    const btn = page.locator('#btn-queue');
    await expect(btn).toHaveAttribute('aria-expanded', 'false');

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#queue-panel')).toBeVisible();

    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
  });
});

// ── Play button — aria-pressed reachable by keyboard (WCAG SC 4.1.2, 2.1.1) ──
test.describe('player controls — aria states', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.goto('/');
    await waitForRealLibrary(page);
  });

  test('#pcplay carries aria-pressed and accepts keyboard focus', async ({ page }) => {
    const playBtn = page.locator('#pcplay');
    await expect(playBtn).toHaveAttribute('aria-pressed', 'false');

    await playBtn.focus();
    const isFocused = await page.evaluate(
      () => document.activeElement?.id === 'pcplay',
    );
    expect(isFocused).toBe(true);
  });
});

// ── Virtual track list — aria-setsize / aria-posinset (WCAG SC 1.3.1) ────────
test.describe('virtual track list — ARIA position announcements', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.goto('/');
    await waitForRealLibrary(page);
  });

  test('track rows expose a positive aria-setsize', async ({ page }) => {
    const firstRow = page.locator('#tlist .tr[data-track-id]').first();
    const setSize = Number(await firstRow.getAttribute('aria-setsize'));
    expect(setSize).toBeGreaterThan(0);
  });

  test('first visible track row has aria-posinset="1"', async ({ page }) => {
    const firstRow = page.locator('#tlist .tr[data-track-id]').first();
    const posInSet = Number(await firstRow.getAttribute('aria-posinset'));
    expect(posInSet).toBe(1);
  });

  test('consecutive visible rows have sequential aria-posinset values', async ({ page }) => {
    const rows = page.locator('#tlist .tr[data-track-id]');
    const count = await rows.count();
    expect(count).toBeGreaterThan(1);

    const pos1 = Number(await rows.nth(0).getAttribute('aria-posinset'));
    const pos2 = Number(await rows.nth(1).getAttribute('aria-posinset'));
    expect(pos2).toBe(pos1 + 1);
  });
});

// ── Sidebar stats aria-live (WCAG SC 1.3.1) ──────────────────────────────────
test.describe('sidebar — aria-live region', () => {
  test('#sb-stats has aria-live="polite" and is non-empty after seed', async ({ page }) => {
    await page.addInitScript(seedScript);
    await page.goto('/');
    await waitForRealLibrary(page);

    const stats = page.locator('#sb-stats');
    await expect(stats).toHaveAttribute('aria-live', 'polite');
    await expect(stats).toHaveAttribute('aria-atomic', 'true');
    const text = await stats.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });
});
