// frontend/tests/theme-light-coverage.test.cjs
// Pour chaque surface critique listée, vérifie qu'au moins une règle
// `html[data-mode="light"] <selector>` existe dans style.css.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SS = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');

// DOM verification notes (B3.1):
//   - `#cinema`          → no id="cinema" in index.html; replaced with `#cinema-overlay` (line 1218)
//   - `#cinema-overlay`  → confirmed in index.html line 1218
//   - `#cd-modal-bg`     → confirmed in index.html line 408
//   - `#cd-modal`        → confirmed in index.html line 409
//   - `#organize-modal-bg` → confirmed in index.html line 379
//   - `#organize-modal`  → confirmed in index.html line 380
//   - `#usb-modal-bg`    → confirmed in index.html line 392
//   - `#usb-modal`       → confirmed in index.html line 393
//   - `.miniplayer-shelf` → no such class; real mini-player overlay is `#mp-ov` (index.html line 1397)
//   - `.tooltip`         → no such CSS class; real tooltip class is `.vol-tip` (index.html line 325, style.css line 2923)
//   - `.cn-next`         → no such CSS selector; real cinema-next panel uses `.cinema-next` (index.html line 1233)

const REQUIRED_LIGHT_SURFACES = [
  ['#cinema-overlay',    'cinema overlay'],
  ['#cd-modal-bg',       'CD audio modal bg'],
  ['#cd-modal',          'CD audio modal'],
  ['#organize-modal-bg', 'organize modal bg'],
  ['#organize-modal',    'organize modal'],
  ['#usb-modal-bg',      'USB import modal bg'],
  ['#usb-modal',         'USB import modal'],
  ['#mp-ov',             'miniplayer overlay (#mp-ov)'],
  ['.vol-tip',           'volume tooltip (.vol-tip)'],
  ['.cinema-next',       'cinema next panel (.cinema-next)'],
  // B3.7 residual sweep
  ['#seek-tip',          'seek-time tooltip (#seek-tip)'],
  ['.ctx-submenu',       'context menu submenu (.ctx-submenu)'],
  ['.spl-rule-row',      'smart playlist rule row (.spl-rule-row)'],
  ['.spl-results',       'smart playlist search results (.spl-results)'],
  ['.prompt-input',      'prompt modal input (.prompt-input)'],
];

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── theme-light-coverage — required overrides ──');

  for (const [sel, label] of REQUIRED_LIGHT_SURFACES) {
    await t(`light override covers ${label} (${sel})`, () => {
      const escSel = sel.replace(/[.#]/g, m => '\\' + m);
      const re = new RegExp(`html\\[data-mode="light"\\][^{]*${escSel}[^{]*\\{`, 'g');
      assert.ok(re.test(SS), `no html[data-mode="light"] rule found targeting ${sel}`);
    });
  }

  if (fail) { console.log(`\nTHEME-LIGHT-COVERAGE FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTHEME-LIGHT-COVERAGE OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
