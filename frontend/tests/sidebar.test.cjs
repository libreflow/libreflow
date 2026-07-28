// frontend/tests/sidebar.test.cjs
// Garde-fous statiques issus de l'audit sidebar 2026-07-01.
// Couvre : bus VIEW_REQUEST, section Récentes, focus-ring, sb-stats,
// watch-indicator, aria-current, accessibilité clavier des menus/lignes/dossiers.
'use strict';

const assert = require('assert');
const { readRepoFile } = require('./_a11y.cjs');

async function run() {
  let pass = 0, fail = 0;
  const t = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`); }
  };

  console.log('\n── sidebar — audit 2026-07-01 guardrails ──');

  const stripCssComments = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const PL   = readRepoFile('frontend/src/playlists.js');
  const APP  = readRepoFile('frontend/src/app.js');
  const SS   = stripCssComments(readRepoFile('frontend/src/style.css'));
  // style-polish.css fusionné dans style.css (audit 2026-07-27) — SP conservé
  // comme alias pour les assertions existantes.
  const SP   = SS;
  const HTML = readRepoFile('frontend/index.html');
  const RAD  = readRepoFile('frontend/src/radio.js');
  const REN  = readRepoFile('frontend/src/renderer.js');
  const GRID = readRepoFile('frontend/src/renderer-grids.js');
  const LIB  = readRepoFile('frontend/src/library.js');

  // --- C1 : chaque émission VIEW_REQUEST doit avoir un abonné (app.js) --------
  await t('EVENTS.VIEW_REQUEST has a subscriber (bus navigation not dead)', () => {
    assert.ok(/on\(\s*EVENTS\.VIEW_REQUEST/.test(APP),
      'app.js doit s\'abonner à EVENTS.VIEW_REQUEST (sinon 14 émissions sont des no-op silencieux)');
  });

  // --- REWORK-1 (2026-07-02) : la section « Récentes » sidebar est supprimée ---
  // Décision produit : elle réordonnait la sidebar à chaque ouverture (instabilité
  // spatiale) et collisionnait avec l'item nav « Récents ». Remplacée par un tri
  // « Récentes » sur la grille playlists. Ni section, ni dédup fantôme résiduelle.
  await t('sidebar Recent playlists section fully removed (no ghost dedup)', () => {
    assert.ok(!/pl_section_recent/.test(PL),
      'la section Récentes sidebar ne doit plus être rendue');
    assert.ok(!/shownRecentIds/.test(PL),
      'la dédup shownRecentIds ne doit pas survivre à la section (playlists invisibles sinon)');
  });

  // --- REWORK-2 : en-tête de section PLAYLISTS avec + et accès grille ----------
  await t('sidebar has a PLAYLISTS section header with new-playlist + grid actions', () => {
    assert.ok(!/id="ni-playlists"/.test(HTML),
      "l'item nav #ni-playlists (doublon de la liste juste en dessous) doit être remplacé par un en-tête de section");
    const m = /<div class="sb-lib-header sb-pl-header">[\s\S]{0,2000}?<div id="pl-list-nav"/.exec(HTML);
    assert.ok(m, 'en-tête .sb-lib-header.sb-pl-header attendu juste au-dessus de #pl-list-nav');
    assert.ok(/data-action="new-playlist"/.test(m[0]), "l'en-tête doit porter le bouton + (new-playlist)");
    assert.ok(/data-action="set-view" data-view="playlists"/.test(m[0]), "l'en-tête doit porter l'accès à la vue grille");
    assert.ok(/sb-nav-btn/.test(m[0]), 'le bouton grille doit porter sb-nav-btn (clear/marquage aria-current par _svMarkNav)');
  });
  await t('scan button icon is a folder+ (disambiguated from playlist +)', () => {
    const m = /data-action="open-folder"[\s\S]{0,700}?<\/button>/.exec(HTML);
    assert.ok(m, 'bouton scan (data-action="open-folder") introuvable');
    assert.ok(/M22 19a2 2 0 0 1-2 2H4/.test(m[0]),
      'le bouton scan doit utiliser l\'icône dossier+ (comme le welcome screen), pas un simple +');
  });

  // --- REWORK-3 : tri « Récentes » sur la grille playlists ----------------------
  await t('playlists grid supports plGridSort (manual/az/recent)', () => {
    assert.ok(/plGridSort/.test(GRID), 'renderPlaylistsGrid doit appliquer plGridSort');
    assert.ok(/recentPls/.test(GRID), 'le tri recent doit s\'appuyer sur recentPls');
    const CFGS = readRepoFile('frontend/src/cfgsave.js');
    assert.ok(/plGridSort/.test(CFGS), 'plGridSort doit être persisté par cfgsave.js');
    const APPJS = readRepoFile('frontend/src/app.js');
    assert.ok(/plGridSort/.test(APPJS), 'plGridSort doit être restauré au boot (app.js)');
  });

  // --- REWORK-4 : actions ▶/⋯ en overlay, compteur cédant la place au survol ----
  await t('row actions live in a .pl-actions overlay (name gets the width back)', () => {
    assert.ok(/class="pl-actions"/.test(PL), 'les boutons ▶/⋯ doivent être groupés dans .pl-actions');
    const m = /\.ni-pl \.pl-actions\s*\{[^}]*\}/.exec(SS);
    assert.ok(m, 'règle .ni-pl .pl-actions introuvable');
    assert.ok(/position\s*:\s*absolute/.test(m[0]) && /opacity\s*:\s*0/.test(m[0]) && /pointer-events\s*:\s*none/.test(m[0]),
      '.pl-actions doit être un overlay absolu invisible et non cliquable au repos');
    assert.ok(/\.ni-pl:hover \.pl-actions|\.ni-pl:focus-within \.pl-actions/.test(SS),
      '.pl-actions doit se révéler au survol ET au focus clavier (:focus-within)');
  });

  // --- C6 : le token shorthand --focus-ring ne doit jamais servir de couleur --
  await t('no box-shadow built from --focus-ring outline shorthand', () => {
    for (const [name, css] of [['style.css', SS], ['style-polish.css', SP]]) {
      const m = /box-shadow\s*:[^;}]*var\(--focus-ring\)/.exec(css);
      assert.ok(!m,
        `${name}: box-shadow avec var(--focus-ring) (= "2px solid …") → déclaration invalide, anneau de focus absent : ${m && m[0]}`);
    }
  });

  // --- REWORK-5 (2026-07-02) : le footer sidebar est SUPPRIMÉ -------------------
  // Décision produit : l'état de surveillance vit dans Paramètres > Bibliothèque,
  // les métriques dans la vue Statistiques (menu ⋯). Aucun voyant résiduel, et
  // aucun code mort en cascade (updateStats/updateSidebarCounts + CSS + i18n).
  await t('sidebar footer removed (no watch indicator, no stats chips)', () => {
    assert.ok(!/id="watch-indicator"/.test(HTML), '#watch-indicator doit disparaître de index.html');
    assert.ok(!/id="sb-stats"/.test(HTML), '#sb-stats doit disparaître de index.html');
    assert.ok(!/watch-indicator|sb-stats|watch-dot/.test(SS),
      'CSS .watch-indicator / .sb-stats* / .watch-dot doit être purgé');
  });
  await t('updateStats machinery fully removed (function + 7 call sites)', () => {
    const APPJS = readRepoFile('frontend/src/app.js');
    for (const [file, src] of [
      ['renderer.js', REN], ['app.js', APPJS],
      ['ctxmenu.js', readRepoFile('frontend/src/ctxmenu.js')],
      ['dupes.js',   readRepoFile('frontend/src/dupes.js')],
      ['dropin.js',  readRepoFile('frontend/src/dropin.js')],
      ['backup.js',  readRepoFile('frontend/src/backup.js')],
      ['library.js', LIB],
    ]) {
      assert.ok(!/updateStats|scheduleStatsUpdate/.test(src),
        `${file} référence encore updateStats/scheduleStatsUpdate (code mort après suppression du footer)`);
    }
  });
  await t('nav count pills removed (updateSidebarCounts + .ni-count CSS)', () => {
    assert.ok(!/updateSidebarCounts/.test(REN) && !/updateSidebarCounts/.test(readRepoFile('frontend/src/app.js')),
      'updateSidebarCounts doit disparaître (renderer.js + wiring app.js)');
    assert.ok(!/\.ni-count/.test(SS), 'règles CSS .ni-count à purger');
    assert.ok(!/ni-count/.test(REN), 'renderer.js ne doit plus fabriquer de badge .ni-count');
  });

  // --- QUALITÉ-1 (2026-07-02) : sidebar redimensionnable et accessible ---------
  await t('sidebar has an accessible resize handle (#sb-resize)', () => {
    const m = /<[^>]*id="sb-resize"[^>]*>/.exec(HTML);
    assert.ok(m, 'poignée #sb-resize introuvable dans index.html');
    assert.ok(/role="separator"/.test(m[0]), 'la poignée doit être role="separator"');
    assert.ok(/aria-orientation="vertical"/.test(m[0]), 'aria-orientation="vertical" requis');
    assert.ok(/tabindex="0"/.test(m[0]), 'la poignée doit être focalisable (opérable au clavier, SC 2.1.1)');
    assert.ok(/aria-valuemin/.test(m[0]) && /aria-valuemax/.test(m[0]),
      'la poignée doit exposer aria-valuemin/max (valeur courante posée par sbresize.js)');
  });
  await t('sbresize.js implements pointer + keyboard + reset + persistence', () => {
    const SR = readRepoFile('frontend/src/sbresize.js');
    assert.ok(/setPointerCapture/.test(SR), 'drag via Pointer Events avec capture');
    assert.ok(/ArrowLeft/.test(SR) && /ArrowRight/.test(SR), 'flèches ←/→ requises (SC 2.1.1)');
    assert.ok(/Home/.test(SR) && /End/.test(SR), 'Home/End = min/max');
    assert.ok(/dblclick/.test(SR), 'double-clic = réinitialisation à la largeur par défaut');
    assert.ok(/aria-valuenow/.test(SR), 'aria-valuenow tenu à jour');
    assert.ok(/saveCfg/.test(SR), 'largeur persistée (debounce cfg)');
    const CFGS = readRepoFile('frontend/src/cfgsave.js');
    assert.ok(/sbWidth/.test(CFGS), 'sbWidth doit être persisté par cfgsave.js');
    const APPJS = readRepoFile('frontend/src/app.js');
    assert.ok(/initSbResize/.test(APPJS), 'sbresize initialisé au boot par app.js (§6)');
  });
  await t('resize handle disabled below the compact breakpoint', () => {
    assert.ok(/#sb-resize\s*\{\s*display:\s*none/.test(SS.replace(/[\s\S]*@media \(max-width: 719px\)/, ''))
      || /max-width: 719px[\s\S]{0,4000}#sb-resize[^{]*\{[^}]*display:\s*none/.test(readRepoFile('frontend/src/style.css')),
      'la poignée doit être masquée en mode compact (<720px, largeur pilotée par --sb-sm)');
  });

  // (QUALITÉ-2 : tests footer actionnable retirés — footer supprimé, REWORK-5.
  //  Le handler open-watch-settings disparaît aussi de handlers.js.)
  await t('open-watch-settings handler removed with the footer', () => {
    const HD = readRepoFile('frontend/src/handlers.js');
    assert.ok(!/open-watch-settings/.test(HD),
      'handler open-watch-settings orphelin (plus aucun déclencheur DOM)');
  });

  // (H8 : test .watch-indicator !important retiré — le footer n'existe plus, REWORK-5)

  // --- H9/M1 : aria-current émis par le template de ligne playlist -------------
  await t('_plNavItemHTML emits aria-current on the active playlist row', () => {
    assert.ok(/aria-current/.test(PL),
      'playlists.js ne pose jamais aria-current — chaque renderPlNav() désynchronise .on et aria-current (invariant §2.9)');
  });

  // --- C3 : menu contextuel playlist navigable au clavier ----------------------
  await t('pl ctx menu items expose role="menuitem" (keyboard operable)', () => {
    assert.ok(/showPlCtxMenu[\s\S]{0,3000}role="menuitem"/.test(PL),
      '#pl-ctx-menu : items sans role="menuitem"/tabindex — rename/delete/reorder impossibles au clavier (SC 2.1.1, 2.5.7)');
  });

  // --- C4 : en-tête de dossier focusable + état exposé --------------------------
  await t('folder header is keyboard-focusable and exposes aria-expanded', () => {
    const m = /class="pl-folder-h"[\s\S]{0,400}?>/.exec(PL);
    assert.ok(m, 'template .pl-folder-h introuvable dans playlists.js');
    assert.ok(/tabindex/.test(m[0]) && /aria-expanded/.test(m[0]),
      '.pl-folder-h est un div click-only : un dossier replié devient inaccessible au clavier (SC 2.1.1)');
  });

  // --- C5 : ▶ / ⋯ de ligne = vrais contrôles nommés ----------------------------
  await t('.pl-play / .pl-more are real named controls (not bare spans)', () => {
    const play = /<(\w+)[^>]*class="pl-play"[^>]*>/.exec(PL);
    const more = /<(\w+)[^>]*class="pl-more"[^>]*>/.exec(PL);
    assert.ok(play && more, 'templates .pl-play/.pl-more introuvables');
    for (const [lbl, m] of [['pl-play', play], ['pl-more', more]]) {
      const isNative = m[1] === 'button';
      const hasRole  = /role="button"/.test(m[0]) && /tabindex/.test(m[0]);
      assert.ok(isNative || hasRole, `.${lbl} doit être un <button> (ou role=button+tabindex) — invisible pour AT sinon`);
      assert.ok(/aria-label/.test(m[0]), `.${lbl} doit porter un aria-label`);
    }
  });
  await t('.pl-play / .pl-more meet the 24px target floor (SC 2.5.8)', () => {
    for (const sel of ['\\.pl-play', '\\.pl-more']) {
      const m = new RegExp(`\\.ni-pl ${sel}\\s*\\{[^}]*\\}`).exec(SS);
      assert.ok(m, `règle .ni-pl ${sel} introuvable`);
      assert.ok(/min-width\s*:\s*var\(--target-min\)/.test(m[0]) && /min-height\s*:\s*var\(--target-min\)/.test(m[0]),
        `${sel} doit déclarer min-width/min-height: var(--target-min)`);
    }
  });

  // --- M2 : la carte grille playlists redirige l'état actif vers la sidebar ----
  await t('playlist grid card routes active state to sidebar (data-ni-id)', () => {
    const m = /data-action="set-view" data-view="playlist"[^>]*/.exec(GRID);
    assert.ok(m, 'carte playlist introuvable dans renderer-grids.js');
    assert.ok(/data-ni-id/.test(m[0]),
      'la carte grille doit porter data-ni-id (sinon aria-current atterrit sur la carte cachée)');
  });

  // --- M5 : radio.js pointe la ligne de LA playlist, pas #ni-playlists ----------
  await t('radio "voir la playlist" targets ni-pl-<id> (not ni-playlists)', () => {
    assert.ok(!/VIEW_REQUEST,\s*\{\s*view:\s*'playlist',\s*btn:\s*document\.getElementById\('ni-playlists'\)/.test(RAD),
      "radio.js désigne #ni-playlists comme bouton actif d'une vue 'playlist' → double marquage sidebar");
  });

  // (M4 : test updateStats retiré — fonction supprimée avec le footer, REWORK-5)

  // --- M8/M6 : compteur pollue le nom accessible de la ligne --------------------
  await t('.pl-count is aria-hidden (row accessible name = playlist name)', () => {
    assert.ok(/class="pl-count"[^>]*aria-hidden="true"|aria-hidden="true"[^>]*class="pl-count"/.test(PL),
      'le compteur .pl-count entre dans le name-from-content de la ligne (SR : « Chill 42 … »)');
  });

  // --- M-CSS : plus de fill:currentColor sur les icônes stroke de .ni -----------
  await t('.ni svg does not force fill:currentColor on stroke icons', () => {
    const re = /\.ni svg\s*\{[^}]*\}/g;
    let m, found = 0;
    while ((m = re.exec(SS))) {
      found++;
      assert.ok(!/fill\s*:\s*currentColor/.test(m[0]),
        '.ni svg { fill:currentColor } écrase fill="none" des icônes stroke (cœur Favoris rempli, hack inline sur #ni-recent)');
    }
    assert.ok(found > 0, 'règle .ni svg introuvable');
  });
  await t('no inline style="fill:none" hack left in sidebar HTML', () => {
    const sb = HTML.slice(HTML.indexOf('<!-- SIDEBAR -->'), HTML.indexOf('<!-- MAIN -->'));
    assert.ok(!/style="fill:none"/.test(sb), 'hack inline style="fill:none" encore présent sur une icône .ni');
  });

  // --- M-CSS : ambre via token, pas de littéral rgba(245,158,11) sidebar --------
  await t('smart-playlist amber uses var(--amber-rgb) token', () => {
    const blocks = [/\.ni-pl\.smart \.pl-icon\s*\{[^}]*\}/, /\.ctx-item\.smart:hover\s*\{[^}]*\}/];
    for (const re of blocks) {
      const m = re.exec(SS);
      if (m) assert.ok(!/245,\s*158,\s*11/.test(m[0]),
        `${m[0].slice(0, 40)}… : ambre codé en dur — utiliser rgba(var(--amber-rgb), …)`);
    }
  });

  // --- M-CSS : plus de sélecteur composé id+classe sur la sidebar (§13) ---------
  await t('no #app.np-full id+class compound selector (CLAUDE.md §13)', () => {
    assert.ok(!/#app\.np-full/.test(SS),
      '#app.np-full mélange id et classe sur le même élément — interdit §13');
  });

  // --- M-CSS : CSS mort de la sidebar purgé --------------------------------------
  await t('dead sidebar CSS removed (.sb-foot*, #ni-radio, .pl-nav-item…)', () => {
    for (const dead of ['\\.sb-foot', '#ni-radio', '\\.ni-radio-live', '#ni-stats', '\\.sb-search']) {
      const m = new RegExp(`${dead}[^{,]*\\{`).exec(SS);
      assert.ok(!m, `sélecteur mort « ${dead.replace(/\\\\/g, '')} » encore présent dans style.css`);
    }
  });
  await t('.pl-nav-empty empty state is actually used by renderPlNav', () => {
    assert.ok(/pl-nav-empty/.test(PL),
      'renderPlNav inline un div stylé à la main alors que .pl-nav-empty* (style.css) existe et n\'est référencé nulle part');
  });

  // --- LOW : i18n — plus de français codé en dur -----------------------------------
  // (L1/L2 : tests watch-label + chip chargement retirés — footer supprimé, REWORK-5)
  await t('library.js no longer injects into the removed #sb-stats', () => {
    assert.ok(!/sb-stats|sb_stats_loading/.test(LIB),
      'library.js écrit encore dans #sb-stats — élément supprimé (REWORK-5)');
  });

  // --- LOW : événement mort retiré ---------------------------------------------------
  await t('dead EVENTS.PLAYLIST_CHANGED emit removed', () => {
    assert.ok(!/emit\(EVENTS\.PLAYLIST_CHANGED/.test(PL),
      'PLAYLIST_CHANGED émis sans aucun abonné — code mort (notify("playlists") fait le vrai travail)');
  });

  if (fail) { console.log(`\nSIDEBAR FAIL: ${fail}/${pass + fail}`); process.exitCode = 1; }
  else console.log(`\nSIDEBAR OK: ${pass}/${pass}`);
  return { pass, fail };
}

module.exports = { run };
if (require.main === module) run();
