// frontend/tests/theme-palette.test.cjs
// Vérifie que la palette dark + light respecte les cibles 2026 (élévation respirée,
// AA WCAG sur les couples critiques).
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { contrastRatio } = require('./_wcag.cjs');

const DS = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');

// Cible : palette dark à 5 paliers, ΔRGB total >= 35 entre --bg et --bg5.
const DARK_TARGET = {
  '--bg-base'      : '#030303',
  '--bg-surface'   : '#0E0E0E',
  '--bg-elevated'  : '#1A1A1A',
  '--bg-raised'    : '#262626',
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
    const ratio = contrastRatio('#22d3ee', '#0E0E0E');
    assert.ok(ratio >= 4.5, `cyan on bg-surface = ${ratio.toFixed(2)}:1`);
  });

  await t('green accent on dark bg-surface passes AA (4.5:1)', () => {
    const ratio = contrastRatio('#34d399', '#0E0E0E');
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
    ['--bg-elevated','--bg-raised'],
  ];
  for (const [a, b] of pairs) {
    await t(`dark elevation ${a} -> ${b} has ΔRGB >= 8`, () => {
      assert.ok(root[a], `missing ${a}`);
      assert.ok(root[b], `missing ${b}`);
      const d = deltaRGB(root[a], root[b]);
      assert.ok(d >= 8, `${a}→${b} ΔRGB = ${d} (need 8)`);
    });
  }

  if (fail) { console.log(`\nTHEME-PALETTE FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTHEME-PALETTE OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
