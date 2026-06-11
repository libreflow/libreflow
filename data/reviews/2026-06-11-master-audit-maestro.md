# Audit Maestro — 2026-06-11 (master)

Audit multi-agents (code-reviewer frontend, code-reviewer Rust, security-engineer, debugger)
+ corrections. Baseline avant correction : npm test 429/429, cargo test 9/9 (verts —
aucun bug couvert par les suites).

## Corrigé

| # | Sév. | Bug | Fichier(s) |
|---|------|-----|-----------|
| 1 | HIGH | `prevent-default` `Flags::all()` bloque **Shift+Tab** en release (navigation clavier inverse morte, WCAG 2.1.1) | `main.rs` — `Flags::all().difference(FOCUS_MOVE)` |
| 2 | HIGH | `organize_files` run réel écrase une destination occupée (`fs::rename` remplace, `fs::copy` tronque) — perte de données silencieuse | `commands.rs` — check `to.exists()` + rollback all-or-nothing |
| 3 | HIGH | `Duration::from_secs_f64` panique sur f64 fini mais énorme via IPC → thread SMTC mort pour la session | `smtc.rs` — `try_from_secs_f64` (position + duration) |
| 4 | HIGH | 47 `eprintln!` invisibles en release (`windows_subsystem="windows"`, plugin log câblé mais inutilisé) | 8 modules — migration `log::warn!`/`log::error!` (macro `dlog` debug-only conservé) |
| 5 | MED | 6 commandes sync bloquantes sur le thread principal (gel UI ; `list_drives` **pollée** sondait le TOC CD par IOCTL) | `commands.rs`, `cdaudio.rs` — wrappers `async` + `spawn_blocking` (`open_folder`, `open_folder_at`, `export_backup`, `import_backup`, `list_drives`, `cd_read_toc`) |
| 6 | MED | Erreurs du watcher invisibles (watch mort silencieux après éjection volume/NAS) | `watch.rs` émet `watch-error` → `watchfolder.js` toast + `_watchActive=false` ; clés i18n `t_watch_error` fr/en |
| 7 | MED | `organize_files` : `create_dir_all` avant le contrôle S-02 ; `canonicalize(from)` en échec sautait le contrôle silencieusement | `commands.rs` — contrôle ancêtre existant avant mkdir ; échec canonicalisation = refus |
| 8 | LOW | `write_cover` : gif/bmp/tiff acceptés sans validation magic-bytes (`_ => true`) | `commands.rs` — signatures ajoutées, défaut `false` |
| 9 | LOW | URI pochette SMTC non percent-encodée (espace/`#` dans %TEMP% casse la vignette) | `smtc.rs` |
| 10 | LOW | Fallback `\|\| 36` dupliquant une hauteur CFG (§10) | `keynav.js:186` |

Validation post-fix : `cargo test` 9/9 ✅ · `cargo check --release` ✅ · `npm test` 439/439 ✅

## Non corrigé — décisions ouvertes

- **M-2** `commands.rs` `is_safe_dir` : la garde UNC (`\\`) est du code mort pour les chemins
  canonicalisés (`\\?\UNC\…` passe) — politique réseau incohérente avec son commentaire.
  Décision d'intention requise : supporter le NAS (supprimer la garde + corriger le
  commentaire) ou le refuser (rejeter aussi `\\?\UNC\`).
- **L-2** `read_tags` : le timeout 8 s fuit le thread `spawn_blocking` (NAS mort = thread
  bloqué dans le pool). Trade-off documenté, à commenter dans le code.
- **L-5** capability `opener:allow-reveal-item-in-dir` scopée `"**"` — pourrait être
  restreinte aux racines de bibliothèque (impact faible : reveal-only).
- **LOW-2/LOW-3 frontend** : `app.js:780` accède à `__TAURI__.window` hors `ipc.js`
  (façade incomplète) ; store IDB `imports` absent du CLAUDE.md §8 (doc drift).
- **Artefacts à supprimer manuellement** (suppression refusée par le classifieur de
  permissions) : `_patch_app.js` (codemod déjà appliqué — `app.js:1087`) et
  `src-tauri/data/` (un fichier de review vide égaré — devait aller dans `data/reviews/`).

## Verts (déclarés CLEAN par les audits)

Invariants §2 frontend (10/10 dont tracks[]→rebuild, volume, IPC via ipc.js, ordre
radioRefillQueue, innerHTML esc()) · CSP stricte deny-by-default · garantie offline
(0 appel réseau runtime) · opener reveal-only · clipboard write-only · validation
d'entrées commandes Rust · lofty caps · ordre d'init des 7 plugins (single-instance 1er) ·
zip-bomb backup · concurrence (mutex/poison/cancel-registry).

## Note de session

L'arbre de travail a bougé pendant l'audit (session parallèle : `smtc.rs`,
clipboard-manager, +10 tests core) — les fixes ci-dessus cohabitent avec ce travail
non commité. Ne pas commit en bloc sans trier.
