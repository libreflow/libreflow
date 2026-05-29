// Guards CLAUDE.md §17: design-system.css is the ONLY token-definition file.
// style.css may keep small responsive :root overrides inside @media
// (e.g. `:root { --pb: 76px; --tb: 32px; }`) but must NOT host the token layer.
'use strict';
const assert = require('assert');
const { readRepoFile } = require('./_a11y.cjs');

// A reappearing token *layer* declares many custom props in one :root block;
// the legitimate responsive overlays declare at most this many.
const MAX_TOKENS_PER_ROOT_BLOCK = 3;

async function run() {
  let pass = 0, fail = 0;
  const t = async (n, fn) => { try { await fn(); pass++; console.log(`  ✓ ${n}`); } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`); } };
  console.log('\n── token source of truth (§17) ──');

  const SS = readRepoFile('frontend/src/style.css');
  const DS = readRepoFile('frontend/src/design-system.css');

  await t('style.css hosts no :root token-definition layer', () => {
    // `:root {` only — `:root[...]` (attribute-scoped) is intentionally excluded.
    const rootBlocks = SS.match(/:root\s*\{[^}]*\}/g) || [];
    const offenders = rootBlocks
      .map(b => ({ b, n: (b.match(/--[\w-]+\s*:/g) || []).length }))
      .filter(x => x.n > MAX_TOKENS_PER_ROOT_BLOCK);
    assert.strictEqual(offenders.length, 0,
      `style.css has a :root block declaring ${offenders.map(o => o.n).join(',')} tokens ` +
      `(> ${MAX_TOKENS_PER_ROOT_BLOCK}) — the token layer belongs in design-system.css`);
  });

  await t('design-system.css defines the canonical scales', () => {
    for (const tok of ['--space-4', '--radius-md', '--text-md', '--accent', '--border-subtle']) {
      assert.ok(new RegExp(`${tok}\\s*:`).test(DS), `missing ${tok} in design-system.css`);
    }
  });

  if (fail) { console.log(`\nTOKEN-SOURCE FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTOKEN-SOURCE OK: ${pass}/${pass}`);
}
module.exports = { run };
if (require.main === module) run();
