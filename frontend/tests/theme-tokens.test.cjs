// frontend/tests/theme-tokens.test.cjs
// Vérifie que design-system.css est la source unique pour les tokens canoniques
// et que style.css ne déclare plus les mêmes tokens dans :root.
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const DS = fs.readFileSync(path.join(__dirname, '../src/design-system.css'), 'utf8');
const SS = fs.readFileSync(path.join(__dirname, '../src/style.css'), 'utf8');

// Tokens canoniques qui DOIVENT vivre uniquement dans design-system.css.
const CANONICAL = [
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7',
  '--radius-xs', '--radius-sm', '--radius-md', '--radius-lg', '--radius-pill',
  '--text-xs', '--text-sm', '--text-base', '--text-md', '--text-lg', '--text-xl', '--text-2xl',
  '--motion-fast', '--motion-base', '--motion-slow',
  '--ease-standard', '--ease-spring',
  '--elev-1', '--elev-2', '--elev-3', '--elev-4',
  '--g', '--g-rgb',
  '--bg', '--bg1', '--bg2', '--bg3', '--bg4', '--bg5', '--bg6',
  '--t', '--t2', '--t3', '--t4',
];

// Aliases legacy qui DOIVENT pointer vers un token canonique (pas de valeur littérale).
const ALIAS_TARGETS = {
  '--sp-1':  '--space-1',
  '--sp-2':  '--space-2',
  '--sp-3':  '--space-3',
  '--sp-4':  '--space-4',
  '--r':     '--radius-sm',
  '--r2':    '--radius-md',
  '--dur-fast': '--motion-fast',
  '--dur-mid':  '--motion-base',
  '--dur-slow': '--motion-slow',
};

function declaredInRoot(css, token) {
  // Cherche `--token:` à l'intérieur d'un bloc :root { ... }.
  const re = new RegExp(`:root\\s*\\{[^}]*${token.replace(/-/g, '\\-')}\\s*:`, 'g');
  return re.test(css);
}

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── theme-tokens — design-system source of truth ──');

  for (const tok of CANONICAL) {
    await t(`design-system.css declares ${tok}`, () => {
      assert.ok(declaredInRoot(DS, tok), `missing ${tok}`);
    });
    await t(`style.css :root does NOT declare ${tok}`, () => {
      assert.ok(!declaredInRoot(SS, tok), `duplicate ${tok} in style.css`);
    });
  }

  for (const [alias, target] of Object.entries(ALIAS_TARGETS)) {
    await t(`${alias} aliases ${target}`, () => {
      const re = new RegExp(`${alias.replace(/-/g, '\\-')}\\s*:\\s*var\\(\\s*${target.replace(/-/g, '\\-')}\\s*\\)`, 'g');
      assert.ok(re.test(SS), `${alias} should be var(${target}) in style.css`);
    });
  }

  if (fail) { console.log(`\nTHEME-TOKENS FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nTHEME-TOKENS OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
