// frontend/tests/a11y.test.cjs
// Static a11y guardrails. Reflète les findings du maestro a11y audit 2026-05-29.
'use strict';

const assert = require('assert');
const { readRepoFile, flattenAlpha } = require('./_a11y.cjs');
const { contrastRatio } = require('./_wcag.cjs');

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── a11y — WCAG 2.1 AA static checks ──');

  const DS  = readRepoFile('frontend/src/design-system.css');
  const SS  = readRepoFile('frontend/src/style.css');
  const HTML = readRepoFile('frontend/index.html');

  // --- SC 1.4.11 Non-text Contrast (borders >= 3:1 on Vantablack) -------
  function extractBorderAlpha(css, tokenName) {
    const re = new RegExp(`--${tokenName}\\s*:\\s*rgba\\(255,\\s*255,\\s*255,\\s*([0-9.]+)\\s*\\)`);
    const m = re.exec(css);
    if (!m) throw new Error(`token --${tokenName} not found as rgba(255,255,255,A)`);
    return parseFloat(m[1]);
  }

  await t('border-subtle has >=3:1 on --bg-base', () => {
    const a = extractBorderAlpha(DS, 'border-subtle');
    const flat = flattenAlpha('#ffffff', a, '#030303');
    const r = contrastRatio(flat, '#030303');
    assert.ok(r >= 3.0, `border-subtle alpha ${a} -> ${r.toFixed(2)}:1 (need 3.0)`);
  });
  await t('border-default has >=3:1 on --bg-base', () => {
    const a = extractBorderAlpha(DS, 'border-default');
    const flat = flattenAlpha('#ffffff', a, '#030303');
    const r = contrastRatio(flat, '#030303');
    assert.ok(r >= 3.0, `border-default alpha ${a} -> ${r.toFixed(2)}:1 (need 3.0)`);
  });

  // --- SC 1.4.11 Action buttons at rest >= 3:1 ---------------------------
  await t('.tlk rest uses var(--t3) (not --t4)', () => {
    const m = /\.tlk\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, '.tlk base rule not found');
    assert.ok(/color\s*:\s*var\(\s*--t3\s*\)/.test(m[0]),
      '.tlk base rule should set color: var(--t3) for AA contrast at opacity 0.45');
  });
  await t('.tlk rest opacity >= 0.45', () => {
    const m = /\.tlk\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, '.tlk base rule not found');
    const o = /opacity\s*:\s*([0-9.]+)/.exec(m[0]);
    assert.ok(o, '.tlk should declare opacity');
    assert.ok(parseFloat(o[1]) >= 0.45, `.tlk opacity ${o[1]} too low`);
  });

  // --- SC 1.4.1 Use of Color — liked state must have a non-color cue ----
  await t('.tlk.on declares a non-color cue', () => {
    const m = /\.tlk\.on\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, '.tlk.on rule not found');
    const cssText = m[0];
    const hasCue = /background(-color)?\s*:/i.test(cssText)
      || /transform\s*:/i.test(cssText)
      || /mask(-image)?\s*:/i.test(cssText)
      || /filter\s*:.*drop-shadow/i.test(cssText);
    assert.ok(hasCue,
      '.tlk.on relies on color only — add a non-color cue (background, transform, or filled-icon swap)');
  });

  // --- SC 4.1.2 Cinema overlay must have role=dialog + aria-modal -------
  await t('#cinema-overlay has role="dialog"', () => {
    const re = /id="cinema-overlay"[^>]*role="dialog"|role="dialog"[^>]*id="cinema-overlay"/;
    assert.ok(re.test(HTML), '#cinema-overlay missing role="dialog"');
  });
  await t('#cinema-overlay has aria-modal="true"', () => {
    const re = /id="cinema-overlay"[^>]*aria-modal="true"|aria-modal="true"[^>]*id="cinema-overlay"/;
    assert.ok(re.test(HTML), '#cinema-overlay missing aria-modal="true"');
  });
  await t('#cinema-overlay has aria-label', () => {
    const re = /id="cinema-overlay"[^>]*aria-label="/;
    assert.ok(re.test(HTML), '#cinema-overlay missing aria-label');
  });

  // --- SC 4.1.2 EQ band sliders need aria-orientation -------------------
  await t('eq.js sets aria-orientation on band sliders', () => {
    const eqJs = readRepoFile('frontend/src/eq.js');
    assert.ok(/aria-orientation/.test(eqJs),
      'eq.js does not set aria-orientation on band sliders');
  });

  // --- SC 4.1.2 / 2.1.1 : div|span avec data-action doivent être opérables ---
  // Tout élément générique cliquable doit exposer un role + tabindex pour le
  // clavier et les technologies d'assistance. Exception : les backdrops purement
  // décoratifs marqués aria-hidden="true" (fermeture via Escape + bouton dédié).
  await t('non-button data-action elements have role + tabindex', () => {
    const re = /<(div|span)\s+([^>]*?data-action="[^"]+"[^>]*?)>/gi;
    let m; const offenders = [];
    while ((m = re.exec(HTML))) {
      const attrs = m[2];
      if (/aria-hidden="true"/.test(attrs)) continue;
      const hasRole = /role="(button|link|menuitem|tab|switch|checkbox|option)"/i.test(attrs);
      const hasTab  = /tabindex="(0|-1)"/.test(attrs);
      if (!hasRole || !hasTab) offenders.push(m[0].slice(0, 90));
    }
    assert.ok(offenders.length === 0,
      `data-action sans role/tabindex : ${offenders.length}\n   ${offenders.slice(0, 3).join('\n   ')}`);
  });

  // --- SC 1.3.1 : liste virtualisée annonce la position (X sur Y) -------------
  await t('renderer.js emits aria-setsize/aria-posinset on track rows', () => {
    const rj = readRepoFile('frontend/src/renderer.js');
    assert.ok(/aria-setsize="\$\{setSize\}"/.test(rj),
      'thtml() doit poser aria-setsize sur les lignes de piste');
    assert.ok(/aria-posinset="\$\{fi \+ 1\}"/.test(rj),
      'thtml() doit poser aria-posinset (fi+1) sur les lignes de piste');
  });

  if (fail) { console.log(`\nA11Y FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nA11Y OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
