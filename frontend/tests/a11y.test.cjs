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
  // Regression guard (token-unification §17 / A11Y-03): the AA border values in
  // §2ter must NOT be re-aliased back to the sub-AA var(--border-1/2/3). This
  // override previously lived in style.css and silently defeated A11Y-03 at runtime.
  await t('--border-* not re-aliased to sub-AA var(--border-1/2/3)', () => {
    const reOverride = /--border-(subtle|default|strong)\s*:\s*var\(\s*--border-[123]\s*\)/;
    assert.ok(!reOverride.test(DS) && !reOverride.test(SS),
      're-alias of --border-* to sub-AA --border-1/2/3 detected — remove it (design-system.css §2ter owns these)');
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

  // --- WCAG 2.2 SC 2.5.8 Target Size (>=24px) sur les boutons icône inline ----
  await t('icon buttons declare >=24px target size (SC 2.5.8)', () => {
    const tm = /--target-min\s*:\s*(\d+)px/.exec(DS);   // §17: token defs live in design-system.css
    assert.ok(tm && parseInt(tm[1], 10) >= 24,
      `--target-min doit être >=24px (trouvé ${tm ? tm[1] : 'aucun'})`);
    for (const sel of ['\\.tlk', '\\.tr-add-btn', '\\.tr-edit-btn']) {
      const m = new RegExp(`${sel}\\s*\\{[^}]*\\}`).exec(SS);
      assert.ok(m, `règle de base ${sel} introuvable`);
      assert.ok(/min-width\s*:\s*var\(--target-min\)/.test(m[0])
        && /min-height\s*:\s*var\(--target-min\)/.test(m[0]),
        `${sel} doit déclarer min-width/min-height: var(--target-min)`);
    }
  });

  // --- WCAG 2.2 SC 2.4.11 Focus Not Obscured — scroll-padding sous l'en-tête collant ---
  await t('#tlist reserves sticky-header height via scroll-padding (SC 2.4.11)', () => {
    const m = /#content-area #tlist\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, 'règle #content-area #tlist introuvable');
    assert.ok(/scroll-padding-top\s*:/.test(m[0]),
      "#tlist doit déclarer scroll-padding-top (focus jamais masqué sous .grp-lbl/.tr-grp collants)");
  });

  // --- WCAG 2.2 SC 2.4.13 Focus Appearance (AAA) ----------------------------
  await t('focus ring is >=2px solid (SC 2.4.13)', () => {
    const m = /--focus-ring\s*:\s*(\d+)px\s+solid/.exec(DS);   // §17: token defs live in design-system.css
    assert.ok(m && parseInt(m[1], 10) >= 2, `--focus-ring doit être >=2px solid (trouvé ${m ? m[1] : 'aucun'})`);
  });
  await t('focus-ring-contrast token defined in both themes (SC 2.4.13)', () => {
    // §17: both the dark base and the light override now live in design-system.css.
    const occ = (DS.match(/--focus-ring-contrast\s*:/g) || []).length;
    assert.ok(occ >= 2, `--focus-ring-contrast doit être défini pour les deux thèmes dans design-system.css (trouvé ${occ})`);
  });
  await t('icon buttons show a focus ring on :focus-visible (SC 2.4.13)', () => {
    for (const sel of ['\\.tlk', '\\.tr-add-btn', '\\.tr-edit-btn']) {
      const m = new RegExp(`${sel}:focus-visible\\s*\\{[^}]*\\}`).exec(SS);
      assert.ok(m, `règle ${sel}:focus-visible introuvable`);
      assert.ok(/box-shadow\s*:[^;}]*var\(--g\)/.test(m[0]),
        `${sel}:focus-visible doit déclarer un anneau box-shadow (var(--g))`);
    }
  });

  // --- SC 1.4.3/1.4.6 : le texte de contenu n'utilise pas --t4 (~1.5:1) ------
  // --t4 est réservé aux icônes/placeholders/séparateurs (exemptés de contraste).
  await t('content text selectors avoid --t4 (use --t3)', () => {
    for (const sel of ['\\.grp-artist', '\\.eq-val--flat', '\\.vh-count', '\\.tr-grp', '\\.pl-folder-empty']) {
      const m = new RegExp(`${sel}\\s*\\{[^}]*\\}`).exec(SS);
      assert.ok(m, `règle ${sel} introuvable`);
      assert.ok(!/var\(--t4\)/.test(m[0]), `${sel} ne doit pas utiliser --t4 (~1.5:1) pour du texte`);
    }
  });

  // --- WCAG SC 2.3.1 Three Flashes (Level A) — garde-fou anti-stroboscope ----
  // Le seul effet synchronisé à la musique (cinema-beat-pulse) doit rester sous
  // 3 flashs/s : BEAT_COOLDOWN >= 334 ms. (Audit : le visualizer lisse + clear
  // chaque frame, prefers-reduced-motion coupe toutes les boucles — pas de flash.)
  await t('cinema beat cooldown keeps flashes <=3/sec (SC 2.3.1)', () => {
    // BEAT_COOLDOWN moved to cinema-viz.js after cinema split — check both files
    const cj  = readRepoFile('frontend/src/cinema.js');
    const cvj = (() => { try { return readRepoFile('frontend/src/cinema-viz.js'); } catch { return ''; } })();
    const m = /BEAT_COOLDOWN\s*=\s*(\d+)/.exec(cvj) || /BEAT_COOLDOWN\s*=\s*(\d+)/.exec(cj);
    assert.ok(m, 'BEAT_COOLDOWN introuvable dans cinema.js ni cinema-viz.js');
    assert.ok(parseInt(m[1], 10) >= 334,
      `BEAT_COOLDOWN ${m[1]}ms < 334ms → risque de >3 flashs/s (SC 2.3.1)`);
  });
  await t('global prefers-reduced-motion kill-switch present (SC 2.3.3)', () => {
    assert.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)[^}]*\{[^}]*\*[^}]*\{[^}]*animation-duration/s.test(SS)
      || /prefers-reduced-motion:\s*reduce/.test(SS),
      'style.css doit couper les animations sous prefers-reduced-motion');
  });

  // --- WCAG 2.4.13 Focus Appearance (AAA) — cinema focus ring token unification
  // (Task 4 design-system): the dark-cinema focus ring box-shadow was duplicated
  // literally 4x (.cinema-corner-btn, .cbtn, .cinema-pbar, .cinema-vol-slider).
  // It must now resolve through a single --cin-focus-ring token.
  function extractCinemaSection(css) {
    const start = css.indexOf('#cinema-overlay {');
    const end   = css.indexOf('/* ═══ PANNEAUX OVERLAY', start);
    if (start === -1 || end === -1) throw new Error('cinema CSS section boundaries not found in style.css');
    return css.slice(start, end);
  }
  await t('cinema focus ring uses a single --cin-focus-ring token, not a repeated literal (SC 2.4.13)', () => {
    const cinemaCss = extractCinemaSection(SS);
    const literalRing = /box-shadow:\s*0 0 0 2px rgba\(255,255,255,\.8\),\s*0 0 0 4px rgba\(0,0,0,\.25\)/g;
    const literalOcc = (cinemaCss.match(literalRing) || []).length;
    assert.strictEqual(literalOcc, 0,
      `cinema focus ring literal repeated ${literalOcc}x in style.css cinema section — should use var(--cin-focus-ring)`);

    assert.ok(/--cin-focus-ring\s*:\s*0 0 0 2px rgba\(255,255,255,\.8\),\s*0 0 0 4px rgba\(0,0,0,\.25\)/.test(DS),
      '--cin-focus-ring not defined in design-system.css with the expected dual-tone value');

    const tokenUsage = (cinemaCss.match(/box-shadow:\s*var\(--cin-focus-ring\)/g) || []).length;
    assert.ok(tokenUsage >= 4,
      `expected >=4 usages of var(--cin-focus-ring) in the cinema CSS section, found ${tokenUsage}`);
  });

  // --- SC 1.3.1 Info & Relationships — landmarks de navigation/recherche -----
  await t('document declares main + search + navigation landmarks (SC 1.3.1)', () => {
    assert.ok(/role="main"/.test(HTML),       'landmark role="main" manquant');
    assert.ok(/role="search"/.test(HTML),     'landmark role="search" manquant (boîte de recherche)');
    assert.ok(/<nav[^>]*aria-label=/.test(HTML), '<nav> de navigation doit porter un aria-label');
  });
  await t('no nested duplicate navigation landmark on #sb (SC 1.3.1)', () => {
    const m = /<div id="sb"([^>]*)>/.exec(HTML);
    assert.ok(m, '#sb introuvable');
    assert.ok(!/role="navigation"/.test(m[1]),
      '#sb ne doit pas être role="navigation" (le <nav class="sb-nav"> est le landmark) — évite un double nav imbriqué');
  });

  // --- WCAG SC 2.2.2 Pause/Stop/Hide — le titre défilant peut être stoppé -----
  await t('scrolling marquee title can be paused (SC 2.2.2)', () => {
    assert.ok(/\.mq\.mq-on\s*\{\s*animation-play-state:\s*paused/.test(SS),
      'le titre défilant (.mq.mq-on) doit passer en animation-play-state: paused au survol/focus');
  });

  // --- SC 4.1.2 / 3.3.2 : tout contrôle de formulaire a un nom accessible ------
  // Les <select>/<input> dont le libellé visible est un <div>/<span> (pas un
  // <label for>) doivent porter aria-label OU data-i18n-aria OU aria-labelledby.
  function openTagById(html, id) {
    const m = new RegExp(`<[^>]*\\bid="${id}"[^>]*>`).exec(html);
    return m ? m[0] : null;
  }
  function hasAccessibleName(tag) {
    return /\saria-label="[^"]+"/.test(tag)
        || /\sdata-i18n-aria="[^"]+"/.test(tag)
        || /\saria-labelledby="[^"]+"/.test(tag);
  }
  for (const id of [
    'cf-slider',          // A11Y-H1 : curseur de fondu enchaîné
    'smart-size', 'smart-pl-name',                    // A11Y-H2 : panneau similarité
    'spl-combinator', 'spl-rules-size', 'spl-rules-name', // A11Y-H2 : panneau règles
  ]) {
    await t(`#${id} declares an accessible name (SC 4.1.2/3.3.2)`, () => {
      const tag = openTagById(HTML, id);
      assert.ok(tag, `#${id} introuvable dans index.html`);
      assert.ok(hasAccessibleName(tag),
        `#${id} doit porter aria-label / data-i18n-aria / aria-labelledby (libellé .spl-section-lbl/.set-row-label non associé)`);
    });
  }

  // --- SC 1.3.1 / 4.1.2 : les onglets de la modale playlist exposent le motif tab ---
  await t('playlist modal tabs use the tab pattern (SC 1.3.1/4.1.2)', () => {
    assert.ok(/class="pl-modal-tabs"[^>]*role="tablist"/.test(HTML),
      '.pl-modal-tabs doit être role="tablist"');
    for (const id of ['pl-tab-manual', 'pl-tab-smart']) {
      const tag = openTagById(HTML, id);
      assert.ok(tag, `#${id} introuvable`);
      assert.ok(/\srole="tab"/.test(tag), `#${id} doit être role="tab"`);
      assert.ok(/\saria-selected="(true|false)"/.test(tag), `#${id} doit déclarer aria-selected`);
      assert.ok(/\saria-controls="pl-panel-(manual|smart)"/.test(tag), `#${id} doit pointer aria-controls vers son panneau`);
    }
  });
  await t('switchPlTab keeps aria-selected in sync (SC 4.1.2)', () => {
    const sp = readRepoFile('frontend/src/smartplaylist.js');
    assert.ok(/setAttribute\(\s*'aria-selected'/.test(sp),
      "switchPlTab() doit mettre à jour aria-selected sur les onglets (sinon l'état devient obsolète)");
  });

  // --- SC 1.4.1 Use of Color — bascule shuffle/repeat a un indice non-coloré ----
  await t('.pc.on declares a non-color cue (SC 1.4.1)', () => {
    const m = /\.pc\.on\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, '.pc.on rule not found');
    const hasCue = /background(-color)?\s*:/i.test(m[0])
      || /font-weight\s*:/i.test(m[0])
      || /box-shadow\s*:/i.test(m[0])
      || /text-decoration\s*:/i.test(m[0]);
    assert.ok(hasCue,
      '.pc.on (shuffle/repeat actif) ne doit pas reposer sur la couleur seule — ajouter un fond/poids/anneau');
  });

  // --- SC 4.1.2 Dupes panel must expose dialog role + modal (GAP-01) ---------
  await t('#dupes-panel has role="dialog" (SC 4.1.2)', () => {
    const re = /id="dupes-panel"[^>]*role="dialog"|role="dialog"[^>]*id="dupes-panel"/;
    assert.ok(re.test(HTML), '#dupes-panel missing role="dialog"');
  });
  await t('#dupes-panel has aria-modal="true" (SC 4.1.2)', () => {
    const re = /id="dupes-panel"[^>]*aria-modal="true"|aria-modal="true"[^>]*id="dupes-panel"/;
    assert.ok(re.test(HTML), '#dupes-panel missing aria-modal="true"');
  });
  await t('#dupes-panel has aria-labelledby (SC 4.1.2)', () => {
    const re = /id="dupes-panel"[^>]*aria-labelledby="|aria-labelledby="[^"]*"[^>]*id="dupes-panel"/;
    assert.ok(re.test(HTML), '#dupes-panel missing aria-labelledby');
  });

  // --- SC 4.1.2 Cinema progress bar must expose slider role (GAP-04) ----------
  await t('#cinema-pbar has role="slider" (SC 4.1.2)', () => {
    const re = /id="cinema-pbar"[^>]*role="slider"|role="slider"[^>]*id="cinema-pbar"/;
    assert.ok(re.test(HTML), '#cinema-pbar missing role="slider"');
  });
  await t('#cinema-pbar has aria-valuenow/min/max (SC 4.1.2)', () => {
    const re = /id="cinema-pbar"[^>]*aria-valuenow="|aria-valuenow="[^"]*"[^>]*id="cinema-pbar"/;
    assert.ok(re.test(HTML), '#cinema-pbar missing aria-valuenow');
  });

  // --- SC 4.1.2 Cover preview button must have an accessible name (GAP-07) ----
  await t('#bte-cover-preview has aria-label or aria-labelledby (SC 4.1.2)', () => {
    const re = /id="bte-cover-preview"[^>]*(aria-label="|aria-labelledby=")/;
    assert.ok(re.test(HTML), '#bte-cover-preview (role=button) missing aria-label or aria-labelledby');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Task 2 — cinema overhaul a11y : aria-pressed, aria-live, reduced-motion
  // canvas, auto-hide clavier (audit 2026-07-02).
  // ═══════════════════════════════════════════════════════════════════════

  // --- A1/A2 : shuffle/repeat/like exposent aria-pressed (pattern #cinema-radio) ---
  await t('#cinema-shuf/#cinema-rep/#cinema-lk declare aria-pressed (A1/A2)', () => {
    for (const id of ['cinema-shuf', 'cinema-rep', 'cinema-lk']) {
      const tag = openTagById(HTML, id);
      assert.ok(tag, `#${id} introuvable dans index.html`);
      assert.ok(/\saria-pressed="(true|false)"/.test(tag), `#${id} doit déclarer aria-pressed`);
    }
  });

  await t('cinema.js syncs aria-pressed for shuffle/repeat/like (A1/A2)', () => {
    const cj = readRepoFile('frontend/src/cinema.js');
    for (const id of ['cinema-shuf', 'cinema-rep', 'cinema-lk']) {
      const idx = cj.indexOf(`'${id}'`);
      assert.ok(idx !== -1, `getElementById('${id}') introuvable dans cinema.js`);
      const windowText = cj.slice(idx, idx + 400);
      assert.ok(/setAttribute\(\s*'aria-pressed'/.test(windowText),
        `cinema.js doit appeler setAttribute('aria-pressed', …) près de '${id}' (imiter #cinema-radio:543)`);
    }
  });

  // --- A7 : région aria-live pour l'annonce de changement de piste ---------
  await t('#cinema-announce aria-live="polite" region exists in cinema overlay (A7)', () => {
    const tag = openTagById(HTML, 'cinema-announce');
    assert.ok(tag, '#cinema-announce introuvable dans index.html');
    assert.ok(/aria-live="polite"/.test(tag), '#cinema-announce doit être aria-live="polite"');
    assert.ok(/class="[^"]*\bsr-only\b/.test(tag), '#cinema-announce doit utiliser la classe .sr-only existante');
  });

  await t('updateCinema announces track change via #cinema-announce (A7)', () => {
    const cj = readRepoFile('frontend/src/cinema.js');
    // L'écriture textContent sur #cinema-announce doit être GATÉE par _trackChanged —
    // le regex exige `if (_trackChanged) { … getElementById('cinema-announce') … textContent = … }`
    // dans un même bloc. Échoue si l'annonce est câblée inconditionnellement.
    const gated = /if\s*\(\s*_trackChanged\s*\)\s*\{[^{}]*getElementById\(\s*'cinema-announce'\s*\)[^{}]*textContent\s*=/;
    assert.ok(gated.test(cj),
      "l'écriture #cinema-announce.textContent doit être conditionnée par _trackChanged (pas d'annonce par tick)");
    // Garde inverse : updateCinemaProgress (chemin 60fps) ne doit jamais toucher cinema-announce.
    const prog = /export function updateCinemaProgress\([\s\S]*?\n\}/.exec(cj);
    assert.ok(prog, 'updateCinemaProgress introuvable');
    assert.ok(!/cinema-announce/.test(prog[0]),
      'updateCinemaProgress (60fps) ne doit pas écrire dans #cinema-announce');
  });

  // --- A4/A5 : canvas cinéma respectent prefers-reduced-motion -------------
  await t('cinema-bg.js/cinema-viz.js/cinema-canvas.js reference prefersReducedMotion (A4/A5)', () => {
    for (const rel of ['frontend/src/cinema-bg.js', 'frontend/src/cinema-viz.js', 'frontend/src/cinema-canvas.js']) {
      const src = readRepoFile(rel);
      assert.ok(/prefersReducedMotion/.test(src), `${rel} doit référencer prefersReducedMotion (motion.js)`);
    }
  });

  await t('.cinema-bg animation neutralized under reduced motion (A4)', () => {
    const re = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.cinema-art-wrap\s*\{[^}]*\}\s*\.cinema-bg\s*\{[^}]*animation\s*:\s*none[^}]*\}\s*\}/;
    assert.ok(re.test(SS),
      'le bloc reduced-motion cinéma existant doit être étendu pour neutraliser .cinema-bg (breathe 8s)');
  });

  // --- A9 : l'auto-hide des contrôles respecte le focus clavier -------------
  // Le check doit distinguer focus CLAVIER (:focus-visible) du focus résiduel de clic
  // souris (activeElement reste posé sur un <button> cliqué sous Chromium/WebView2) —
  // sinon les contrôles sont épinglés en permanence pour les utilisateurs souris.
  await t('cinema.js auto-hide defers only for keyboard focus (:focus-visible) (A9)', () => {
    const cj = readRepoFile('frontend/src/cinema.js');
    const m = /function _hideControls\(\)\s*\{[\s\S]*?\n\}/.exec(cj);
    assert.ok(m, '_hideControls() introuvable dans cinema.js');
    assert.ok(/_isKeyboardFocusInOverlay/.test(m[0]),
      '_hideControls() doit passer par le check focus clavier avant de masquer (A9)');
    const h = /function _isKeyboardFocusInOverlay\([\s\S]*?\n\}/.exec(cj);
    assert.ok(h, '_isKeyboardFocusInOverlay() introuvable dans cinema.js');
    assert.ok(/activeElement/.test(h[0]),
      'le check A9 doit lire document.activeElement');
    assert.ok(/:focus-visible/.test(h[0]),
      "le check A9 doit exiger :focus-visible — sans ça, un clic souris sur un bouton épingle les contrôles pour toujours");
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Task 7 — mute cliquable (#cinema-vol-icon) + cohésion chromatique --cin-rgb-ui
  // ═══════════════════════════════════════════════════════════════════════

  // --- Mute cinéma : vrai <button>, nom accessible + état toggle (SC 4.1.2) ---
  await t('#cinema-vol-icon is a <button> with data-action, aria-label and aria-pressed (Task 7)', () => {
    const tag = openTagById(HTML, 'cinema-vol-icon');
    assert.ok(tag, '#cinema-vol-icon introuvable dans index.html');
    assert.ok(/^<button\b/.test(tag), '#cinema-vol-icon doit être un <button> (mute cliquable)');
    assert.ok(/data-action="cinema-mute"/.test(tag), '#cinema-vol-icon doit porter data-action="cinema-mute"');
    assert.ok(/\saria-label="[^"]+"/.test(tag) && /data-i18n-aria="[^"]+"/.test(tag),
      '#cinema-vol-icon doit porter aria-label + data-i18n-aria (libellé i18n)');
    assert.ok(/\saria-pressed="(true|false)"/.test(tag), '#cinema-vol-icon doit déclarer aria-pressed');
  });

  await t('syncCinVolumeUI syncs aria-pressed/aria-label on mute state (Task 7)', () => {
    const cr = readRepoFile('frontend/src/cinema-render.js');
    const m = /export function syncCinVolumeUI\([\s\S]*?\n\}/.exec(cr);
    assert.ok(m, 'syncCinVolumeUI introuvable dans cinema-render.js');
    assert.ok(/setAttribute\(\s*'aria-pressed'/.test(m[0]),
      'syncCinVolumeUI doit synchroniser aria-pressed sur #cinema-vol-icon');
    assert.ok(/setAttribute\(\s*'aria-label'/.test(m[0]),
      'syncCinVolumeUI doit basculer aria-label (mute/unmute) sur #cinema-vol-icon');
  });

  // --- SC 2.5.8 : cible >=24px sur le bouton mute (plancher --target-min) ---
  await t('.cinema-vol-icon-btn declares >=24px target size (SC 2.5.8, Task 7)', () => {
    const m = /\.cinema-vol-icon-btn\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, 'règle .cinema-vol-icon-btn introuvable dans style.css');
    assert.ok(/min-width\s*:\s*var\(--target-min\)/.test(m[0])
      && /min-height\s*:\s*var\(--target-min\)/.test(m[0]),
      '.cinema-vol-icon-btn doit déclarer min-width/min-height: var(--target-min)');
  });

  // --- SC 2.4.13 : le focus ring cinéma reste le token dual-tone (jamais teinté) ---
  await t('cinema focus rings stay on --cin-focus-ring, never tinted by --cin-rgb-ui (Task 7)', () => {
    const focusRules = SS.match(/[^{}]*:focus-visible[^{}]*\{[^}]*\}/g) || [];
    const offenders = focusRules.filter(r => /cin-rgb/.test(r));
    assert.ok(offenders.length === 0,
      `focus ring teinté par --cin-rgb(-ui) détecté (AAA 2.4.13 exige la stabilité) :\n   ${offenders.slice(0, 2).join('\n   ')}`);
    assert.ok(/\.cinema-vol-icon-btn:focus-visible\s*\{[^}]*var\(--cin-focus-ring\)/.test(SS),
      '.cinema-vol-icon-btn:focus-visible doit utiliser var(--cin-focus-ring)');
  });

  // --- Cohésion chromatique : seule --cin-rgb-ui (garde-fou 4.5:1) teinte l'UI ---
  await t('UI tint uses contrast-guarded --cin-rgb-ui, raw --cin-rgb reserved to backgrounds (Task 7)', () => {
    const cr = readRepoFile('frontend/src/cinema-render.js');
    assert.ok(/setProperty\(\s*'--cin-rgb-ui'/.test(cr),
      'renderCinColor doit poser --cin-rgb-ui (ensureContrastOnDark) à côté de --cin-rgb');
    assert.ok(/ensureContrastOnDark/.test(cr),
      'cinema-render.js doit dériver --cin-rgb-ui via ensureContrastOnDark');
    // color: teinté doit passer par --cin-rgb-ui, jamais la brute --cin-rgb
    const colorRules = SS.match(/(?:^|;|\{)\s*color\s*:[^;}]*var\(--cin-rgb\s*[,)]/gm) || [];
    assert.ok(colorRules.length === 0,
      `du texte utilise la --cin-rgb brute (non garantie 4.5:1) : ${colorRules.slice(0, 2).join(' | ')}`);
  });

  // --- Task 7 fix (review) : le chemin volume mini-player rafraîchit l'état mute cinéma ---
  // _allPlayerUI() ne touche que mini-player/overlay ; chaque handler volume-* du canal
  // mini-cmd doit donc appeler syncCinVolumeUI (état muet dérivé du volume réel) — sinon
  // aria-pressed/icône X du bouton mute cinéma restent périmés (SC 4.1.2 state desync).
  await t('mini-cmd volume handlers refresh cinema mute state via syncCinVolumeUI (Task 7)', () => {
    const aj = readRepoFile('frontend/src/app.js');
    for (const cmd of ['volume-down', 'volume-up', 'volume-set']) {
      const line = aj.split('\n').find(l => l.includes(`cmd === '${cmd}'`));
      assert.ok(line, `handler mini-cmd '${cmd}' introuvable dans app.js`);
      assert.ok(/syncCinVolumeUI\(/.test(line),
        `le handler mini-cmd '${cmd}' doit appeler syncCinVolumeUI (cinéma ouvert) — _allPlayerUI() n'atteint pas le cinéma`);
    }
  });

  if (fail) { console.log(`\nA11Y FAIL: ${fail}/${pass + fail}`); process.exit(1); }
  console.log(`\nA11Y OK: ${pass}/${pass}`);
}

module.exports = { run };
if (require.main === module) run();
