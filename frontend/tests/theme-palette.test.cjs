// frontend/tests/theme-palette.test.cjs
// Vérifie que la palette dark + light respecte les cibles 2026 (élévation respirée,
// AA WCAG sur les couples critiques).
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { contrastRatio } = require('./_wcag.cjs');

const DS = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');
const STYLE = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');
const STYLE_JS_SETTINGS = fs.readFileSync(path.join(__dirname, '../src/settings.js'), 'utf8');

// Cible : palette dark à 5 paliers, ΔRGB total >= 35 entre --bg et --bg5.
const DARK_TARGET = {
  '--bg-base'      : '#030303',
  '--bg-surface'   : '#121214',
  '--bg-elevated'  : '#1C1C20',
  '--bg-raised'    : '#1C1C20',
};

function extractRoot(css) {
  const m = /:root\s*\{([^}]*)\}/g;
  const out = {};
  let block;
  while ((block = m.exec(css))) {
    const body = block[1];
    const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let row;
    while ((row = re.exec(body))) {
      out['--' + row[1].trim()] = row[2].trim();
    }
  }
  return out;
}

function extractLightOverride(css) {
  const m = /html\[data-mode="light"\]\s*\{([^}]*)\}/g;
  const out = {};
  let block;
  while ((block = m.exec(css))) {
    const body = block[1];
    const re = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let row;
    while ((row = re.exec(body))) {
      out['--' + row[1].trim()] = row[2].trim();
    }
  }
  return out;
}

/**
 * Résout une chaîne d'alias `--token: var(--other-token)` jusqu'à un hex.
 * Retourne undefined si la chaîne ne se termine pas sur une valeur résoluble.
 * Si le token n'existe pas dans `primary`, retombe sur `fallback`.
 */
function resolveVar(primary, fallback, token, depth = 0) {
  if (depth > 10) return undefined;  // anti-boucle
  const val = (primary && primary[token] !== undefined) ? primary[token] : (fallback && fallback[token]);
  if (val === undefined || val === null) return undefined;
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]+))?\s*\)$/i.exec(val.trim());
  if (m) {
    const inner = resolveVar(primary, fallback, m[1], depth + 1);
    if (inner !== undefined) return inner;
    return m[2] ? m[2].trim() : undefined;   // fallback dans var(..., fallback)
  }
  return val.trim();
}

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── theme-palette — dark + light + WCAG ──');

  const root = extractRoot(DS);
  const lightRoot = extractLightOverride(DS);

  for (const [tok, expected] of Object.entries(DARK_TARGET)) {
    await t(`dark ${tok} = ${expected}`, () => {
      assert.strictEqual((root[tok] || '').toUpperCase(), expected.toUpperCase());
    });
  }

  await t('light override re-declares --bg', () => {
    assert.ok(lightRoot['--bg'], `--bg should be redeclared under html[data-mode="light"]`);
  });

  await t('dark --t on --bg passes AA (4.5:1)', () => {
    const fg = resolveVar(root, null, '--t');
    const bg = resolveVar(root, null, '--bg');
    assert.ok(fg && bg, `cannot resolve --t (${fg}) or --bg (${bg}) to hex in dark`);
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `--t on --bg = ${ratio.toFixed(2)}:1 (need 4.5)`);
  });

  await t('dark --t3 on --bg passes AA (4.5:1)', () => {
    const fg = resolveVar(root, null, '--t3');
    const bg = resolveVar(root, null, '--bg');
    assert.ok(fg && bg, `cannot resolve --t3 (${fg}) or --bg (${bg}) to hex in dark`);
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `--t3 on --bg = ${ratio.toFixed(2)}:1 (need 4.5)`);
  });

  await t('light --t on --bg passes AA (4.5:1)', () => {
    const fg = resolveVar(lightRoot, root, '--t');
    const bg = resolveVar(lightRoot, root, '--bg');
    assert.ok(fg && bg, `cannot resolve light --t (${fg}) or --bg (${bg}) to hex`);
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `light --t on light --bg = ${ratio.toFixed(2)}:1`);
  });

  await t('welcome description (uses --t3) passes AA in light', () => {
    const fg = resolveVar(lightRoot, root, '--t3');
    const bg = resolveVar(lightRoot, root, '--bg');
    assert.ok(fg && bg, `cannot resolve light --t3 (${fg}) or --bg (${bg})`);
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= 4.5, `light --t3 = ${ratio.toFixed(2)}:1 (need 4.5)`);
  });

  await t('cyan accent on dark bg-surface passes AA (4.5:1)', () => {
    const ratio = contrastRatio('#22d3ee', '#121214');
    assert.ok(ratio >= 4.5, `cyan on bg-surface = ${ratio.toFixed(2)}:1`);
  });

  await t('green accent on dark bg-surface passes AA (4.5:1)', () => {
    const ratio = contrastRatio('#34d399', '#121214');
    assert.ok(ratio >= 4.5, `green on bg-surface = ${ratio.toFixed(2)}:1`);
  });

  function deltaRGB(a, b) {
    const ah = parseInt(a.replace('#',''), 16);
    const bh = parseInt(b.replace('#',''), 16);
    const ar = (ah>>16)&255, ag = (ah>>8)&255, ab = ah&255;
    const br = (bh>>16)&255, bg = (bh>>8)&255, bb = bh&255;
    return Math.abs(ar-br) + Math.abs(ag-bg) + Math.abs(ab-bb);
  }
  const pairs = [
    ['--bg-base', '--bg-surface'],
    ['--bg-surface','--bg-elevated'],
  ];
  for (const [a, b] of pairs) {
    await t(`dark elevation ${a} -> ${b} has ΔRGB >= 8`, () => {
      assert.ok(root[a], `missing ${a}`);
      assert.ok(root[b], `missing ${b}`);
      const d = deltaRGB(root[a], root[b]);
      assert.ok(d >= 8, `${a}→${b} ΔRGB = ${d} (need 8)`);
    });
  }

  // --bg-raised == --bg-elevated by design (2026-07): a real 4th tonal step would
  // push accent-as-text below AA (4.5:1) on Vantablack — see CLAUDE.md §2.9.
  await t('dark --bg-raised equals --bg-elevated (AA budget exhausted, see CLAUDE.md §2.9)', () => {
    assert.strictEqual((root['--bg-raised'] || '').toUpperCase(), (root['--bg-elevated'] || '').toUpperCase());
  });

  // ── AAA SC 1.4.6 Contrast Enhanced — texte normal >=7:1 sur --bg ──────────
  const AAA_TOKENS = [['--t', 'primary'], ['--t2', 'secondary'], ['--t3', 'muted']];
  for (const [tok, label] of AAA_TOKENS) {
    await t(`dark ${tok} (${label}) on --bg passes AAA (7:1)`, () => {
      const fg = resolveVar(root, null, tok);
      const bg = resolveVar(root, null, '--bg');
      assert.ok(fg && bg, `cannot resolve dark ${tok}/${bg}`);
      const r = contrastRatio(fg, bg);
      assert.ok(r >= 7.0, `dark ${tok} = ${r.toFixed(2)}:1 (need 7.0)`);
    });
    await t(`light ${tok} (${label}) on --bg passes AAA (7:1)`, () => {
      const fg = resolveVar(lightRoot, root, tok);
      const bg = resolveVar(lightRoot, root, '--bg');
      assert.ok(fg && bg, `cannot resolve light ${tok}/${bg}`);
      const r = contrastRatio(fg, bg);
      assert.ok(r >= 7.0, `light ${tok} = ${r.toFixed(2)}:1 (need 7.0)`);
    });
  }

  // --- Scoped AA exception (tonal elevation, 2026-07, CLAUDE.md §2.9) ---
  // --text-muted only guarantees AAA (7:1) on --bg-base/--bg-surface. On the
  // lightest tiers (--bg-elevated, --bg-raised) it must still clear AA (4.5:1).
  await t('dark --t3 (muted) on --bg-raised passes AA (4.5:1)', () => {
    const fg = resolveVar(root, null, '--t3');
    const bg = resolveVar(root, null, '--bg-raised');
    assert.ok(fg && bg, `cannot resolve --t3 (${fg}) or --bg-raised (${bg})`);
    const r = contrastRatio(fg, bg);
    assert.ok(r >= 4.5, `--t3 on --bg-raised = ${r.toFixed(2)}:1 (need 4.5)`);
  });

  await t('dark accent (indigo default #8B6BFF) on --bg-raised passes AA (4.5:1)', () => {
    const bg = resolveVar(root, null, '--bg-raised');
    assert.ok(bg, `cannot resolve --bg-raised`);
    const r = contrastRatio('#8B6BFF', bg);
    assert.ok(r >= 4.5, `accent on --bg-raised = ${r.toFixed(2)}:1 (need 4.5)`);
  });

  // --- SC 1.4.11 All [data-theme] accent swatches >= 4.5:1 on --bg-surface (GAP-T01) ---
  // design-system.css declares [data-theme="..."] { --g:#hex }. Each --g must pass AA (4.5:1) on dark bg-surface.
  const BG_SURFACE_DARK = '#121214';
  const accentRe = /\[data-theme="[^"]+"\]\s*\{[^}]*--g\s*:\s*(#[0-9a-fA-F]{6})/g;
  let am2;
  while ((am2 = accentRe.exec(DS)) !== null) {
    const hex = am2[1];
    await t(`accent ${hex} >= 4.5:1 on dark --bg-surface (GAP-T01 SC 1.4.11)`, () => {
      const r = contrastRatio(hex, BG_SURFACE_DARK);
      assert.ok(r >= 4.5, `accent ${hex} on ${BG_SURFACE_DARK}: ${r.toFixed(2)}:1 (need 4.5)`);
    });
  }

  // --- Settings > Appearance theme swatches must paint their own accent color ---
  // Each swatch carries data-theme="X" which locally overrides --g via the
  // [data-theme] map above; .theme-swatch must consume it as `background`,
  // otherwise every swatch renders as a blank/white circle (regression 2026-07-01,
  // commit 8e70a175 dropped `background: var(--g)` during an a11y-branch merge).
  await t('.theme-swatch paints background: var(--g)', () => {
    const m = /\.theme-swatch\s+\{([^}]*)\}/.exec(STYLE);
    assert.ok(m, '.theme-swatch base rule not found in style.css');
    assert.ok(/background\s*:\s*var\(--g\)/.test(m[1]), `.theme-swatch has no background: var(--g) — swatches will render blank/white. Rule: ${m[1]}`);
  });

  // --- Each [data-theme] block's --g hex must match its own --g-rgb triplet ---
  // Regression 2026-07-08: settings.js used to inline-override --g-rgb from a
  // hardcoded THEME_RGB table that drifted from this map for green/blue/cyan,
  // so every rgba(var(--g-rgb),…) glow/hover/shadow (~90 usages) rendered a
  // mismatched hue vs. the solid var(--g) accent. Fix removed the JS override
  // entirely — this test guards design-system.css's own internal consistency,
  // the single source of truth both --g and --g-rgb must now come from.
  function hexToRgbTriplet(hex) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `${r},${g},${b}`;
  }
  const themeBlockRe = /\[data-theme="([^"]+)"\]\s*\{([^}]*)\}/g;
  let tbm;
  while ((tbm = themeBlockRe.exec(DS)) !== null) {
    const [, themeName, body] = tbm;
    const gHex = /--g\s*:\s*(#[0-9a-fA-F]{6})/.exec(body);
    const gRgb = /--g-rgb\s*:\s*([\d]+,\s*[\d]+,\s*[\d]+)/.exec(body);
    await t(`[data-theme="${themeName}"] --g-rgb matches its own --g hex`, () => {
      assert.ok(gHex, `[data-theme="${themeName}"] has no --g hex`);
      assert.ok(gRgb, `[data-theme="${themeName}"] has no --g-rgb`);
      const expected = hexToRgbTriplet(gHex[1]);
      const actual = gRgb[1].replace(/\s+/g, '');
      assert.strictEqual(actual, expected, `--g:${gHex[1]} implies --g-rgb:${expected}, but found ${actual}`);
    });
  }

  // --- _applyThemeVars() must not duplicate --g-rgb from a hardcoded JS table ---
  // design-system.css's [data-theme] map (tested above) is the single source of
  // truth for the per-theme --g-rgb; _applyThemeVars() (setTheme/applyTheme's
  // shared helper) must let it cascade rather than overriding it inline — that's
  // exactly how the THEME_RGB drift bug happened. NB: applyArtColor()/
  // clearArtColor() legitimately DO set/remove --g-rgb inline elsewhere in this
  // file (dynamic accent extracted from album art has no CSS rule to derive it
  // from) — this check is scoped to _applyThemeVars() only, not the whole file.
  await t('_applyThemeVars() does not inline-override --g-rgb', () => {
    const fn = /function _applyThemeVars\([\s\S]*?\n\}/.exec(STYLE_JS_SETTINGS);
    assert.ok(fn, '_applyThemeVars() body not found in settings.js');
    assert.ok(!/setProperty\(\s*'--g-rgb'/.test(fn[0]),
      '_applyThemeVars() sets --g-rgb via inline style — reintroduces the THEME_RGB drift class of bug');
    assert.ok(!/(?:const|let|var)\s+THEME_RGB\b/.test(STYLE_JS_SETTINGS),
      'settings.js reintroduces a THEME_RGB-style hardcoded rgb table (drift risk vs design-system.css)');
  });

  if (fail) { console.log(`\nTHEME-PALETTE FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTHEME-PALETTE OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
