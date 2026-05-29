// TEMPORARY — style-audit screenshot driver. Safe to delete after the audit.
// Drives the project's installed Chromium (offline) against the running Vite
// server on :1420, seeds 200 synthetic tracks + cfg (mirrors tests/visual/seed.js),
// and captures every major view in dark + light (pc) plus a mobile pass.
import { chromium } from '@playwright/test';
import fs from 'fs';

const OUT = 'docs/superpowers/audits/screens';
fs.mkdirSync(OUT, { recursive: true });

function seedFn({ displayMode }) {
  window.__TAURI__ = {
    core: { invoke: async () => [], convertFileSrc: (p) => p },
    event: { listen: async () => () => {} },
    window: { getCurrentWindow: () => ({ listen: async () => () => {}, onCloseRequested: async () => () => {} }) },
  };
  const reseed = () => {
    const open = indexedDB.open('lp4', 5);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('tracks'))    db.createObjectStore('tracks',    { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cfg'))       db.createObjectStore('cfg');
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('playlog'))   db.createObjectStore('playlog',   { keyPath: 'ts' });
      if (!db.objectStoreNames.contains('imports'))   db.createObjectStore('imports',   { keyPath: 'id' });
    };
    open.onsuccess = () => {
      const db = open.result;
      const txn = db.transaction(['tracks', 'cfg'], 'readwrite');
      const ts = txn.objectStore('tracks');
      const now = Date.now();
      for (let i = 0; i < 200; i++) {
        ts.put({ id: 't' + i, name: 'Titre ' + i, artist: 'Artiste ' + (i % 25), artistFull: 'Artiste ' + (i % 25),
          album: 'Album ' + (i % 40), ext: 'mp3', path: '/m/song' + i + '.mp3', duration: 180 + i,
          dateAdded: now - i * 60000, artColor: null, noArt: true,
          genre: ['Rock', 'Jazz', 'Pop', 'Electro', 'Classique'][i % 5], year: 2000 + (i % 25), track: (i % 12) + 1 });
      }
      txn.objectStore('cfg').put({ view: 'all', sort: 'az', lang: 'fr', theme: 'blue', displayMode, dynColor: true, volume: 1 }, 'state');
    };
  };
  const del = indexedDB.deleteDatabase('lp4');
  del.onsuccess = reseed; del.onerror = reseed; del.onblocked = reseed;
}

async function waitLibrary(page) {
  await page.waitForSelector('#tlist .tr[data-track-id]', { state: 'attached', timeout: 20000 });
  await page.waitForTimeout(700);
  await page.waitForFunction(() => { const l = document.getElementById('toast-shelf'); return !l || l.children.length === 0; }, { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(200);
}

async function setTheme(page, displayMode) {
  await page.evaluate((m) => {
    if (m === 'light') document.documentElement.setAttribute('data-mode', 'light');
    else document.documentElement.removeAttribute('data-mode');
  }, displayMode);
  await page.waitForTimeout(150);
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// view list: [label, selector to click (null=already there), settle ms]
const VIEWS = [
  ['library',   null,           400],
  ['liked',     '#ni-liked',    600],
  ['recent',    '#ni-recent',   600],
  ['playlists', '#ni-playlists',600],
  ['albums',    '#ni-albums',   700],
  ['artists',   '#ni-artists',  700],
  ['radio',     '#ni-radio',    600],
  ['stats',     '#ni-stats',    700],
];

async function runPass({ displayMode, platform, width, height, tag, views }) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', deviceScaleFactor: 1 });
  await ctx.addInitScript(seedFn, { displayMode });
  if (platform === 'mobile') await ctx.addInitScript(() => { try { document.documentElement.setAttribute('data-platform', 'mobile'); } catch (e) {} });
  const page = await ctx.newPage();
  await page.goto('http://localhost:1420/');
  await waitLibrary(page);
  if (platform === 'mobile') { await page.evaluate(() => document.documentElement.setAttribute('data-platform', 'mobile')); await page.waitForTimeout(200); }
  await setTheme(page, displayMode);

  const done = [];
  for (const [label, sel, settle] of views) {
    try {
      if (sel) { await page.click(sel, { timeout: 4000 }); await page.waitForTimeout(settle); }
      await setTheme(page, displayMode);
      done.push(await shot(page, `${tag}-${label}`));
    } catch (e) { done.push(`SKIP ${label}: ${e.message.split('\n')[0]}`); }
  }
  // overlay panels (only on pc to keep it focused)
  if (platform !== 'mobile') {
    for (const [label, sel] of [['queue', '#btn-queue'], ['eq', '#btn-eq'], ['settings', '#tbt-settings']]) {
      try {
        await page.click('#ni-all', { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(200);
        await page.click(sel, { timeout: 4000 });
        await page.waitForTimeout(600);
        await setTheme(page, displayMode);
        done.push(await shot(page, `${tag}-${label}`));
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      } catch (e) { done.push(`SKIP ${label}: ${e.message.split('\n')[0]}`); }
    }
  }
  await ctx.close();
  return done;
}

const browser = await chromium.launch({ headless: true });
const results = {};
results.darkPc  = await runPass({ displayMode: 'dark',  platform: 'pc', width: 1440, height: 900, tag: 'dark-pc',  views: VIEWS });
results.lightPc = await runPass({ displayMode: 'light', platform: 'pc', width: 1440, height: 900, tag: 'light-pc', views: VIEWS });
results.darkMob = await runPass({ displayMode: 'dark',  platform: 'mobile', width: 414, height: 896, tag: 'dark-mob', views: [VIEWS[0], VIEWS[4], VIEWS[5]] });
await browser.close();
console.log(JSON.stringify(results, null, 2));
console.log('\nSCREENS WRITTEN TO', OUT);
