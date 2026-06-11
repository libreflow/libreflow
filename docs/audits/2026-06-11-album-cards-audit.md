# Audit — uniformité des cards Albums

**Date** : 2026-06-11 · **Agent** : @design-eng · **Périmètre** : `renderer-grids.js` (renderAlbumsGrid, _getAlbumMap, renderDrillHeader), `style.css` (.card-*), dictionnaires i18n. Lecture seule, aucun fix appliqué.

> **✅ FIXES APPLIQUÉS (session « go », même jour)** : AC1-AC8 traités (LOW
> aria-label enrichi et SVG inline non traités — assumé). Détails : `.card-info`
> en colonne flex ; clé `sans_album` réutilisée + fallbacks `multi_artists`/
> `unknown_artist` ; `esc()` sur l'aria-label ; année = min déterministe,
> déplacée dans `.card-ct` (« 2008 · 12 titres ») ; durée affichée si tri
> 'duration' ; drill header + card Artistes 100 % i18n (`n_albums`, `dur_min`,
> `pl_play_all`, `pl_shuffle`) ; compilations visibles chez tous leurs artistes
> (recherche + drill) ; densité ≤480px masque `.card-ct` au lieu de `.card-sub`.
> Guardrails : 13 assertions ajoutées à core.test.cjs. `npm test` 421/421,
> `vite build` vert.

## CRITICAL

### AC1 — Le layout des infos n'est structurellement pas garanti (cause n°1 de la non-uniformité)
`.card-name/.card-sub/.card-ct/.card-year` sont des `<span>` **inline** ; ni `.card` (style.css:1534, pas de `display`) ni `.card-info` (1609) n'établissent de colonne. Conséquences :
- `text-overflow: ellipsis` + `overflow` (1597-1604) **ignorés** sur inline → pas de troncature, débordement clippé en plein glyphe par `.card-info{overflow:hidden}` ;
- `margin-bottom` de `.card-name` et `margin-top` de `.card-ct` ignorés (marges verticales inline) ;
- les 3 spans coulent en flux inline : le nombre de lignes par card **dépend de la longueur du contenu** (nom court + artiste court = champs côte à côte ; nom long = retours entre spans) → cards à hauteur/structure variables ;
- `.card-info { flex:1; min-width:0 }` est inerte (`.card` n'est pas flex) — vestige.
Touche les 3 grilles (Albums, Artistes, Playlists). **Fix** : `.card-info` en `display:flex; flex-direction:column` (ou `display:block` sur les spans) + hauteur réservée pour le sub.

### AC2 — « unknown_album » affiché littéralement
`renderer-grids.js:369` : `a.name || i18n('unknown_album') || '?'` — la clé `unknown_album` n'existe dans **aucun** dictionnaire (seul `unknown_artist` existe, i18n.fr:193/i18n.en:304). `i18n()` retombe sur la clé (i18n.js:41) → les pistes sans tag album produisent une card titrée **`unknown_album`** (non localisé, moche), et toutes agrégées sous une seule card (clé `''`).

### AC3 — Artiste non échappé dans l'aria-label (§13)
`renderer-grids.js:364` : `aria-label="${esc(a.name)}${a.artist ? ' — ' + a.artist : ''}"` — `a.artist` (tag lofty arbitraire) est interpolé **brut** dans l'attribut. Un guillemet dans le tag casse le markup de la card (corruption visuelle) ; violation de la règle « tag fields rendered as text ».

## HIGH — cohérence des données

### AC4 — Artiste de la card = première piste rencontrée
`_getAlbumMap` (l.92) fige `artist` à la création de l'entrée et ne le réconcilie jamais. Compilations/albums multi-artistes : l'artiste affiché est **arbitraire et instable** (dépend de l'ordre de `tracks[]`, donc du scan). Pas de détection « Multi-artistes », pas d'usage du tag album-artist. Pas de fallback « Artiste inconnu » (`hlText('')` → sub vide) alors que `unknown_artist` existe et est utilisé par la playerbar → certaines cards affichent 3 infos, d'autres 2.
Corollaire : la recherche (l.322-325) ne matche que cet artiste unique — une compilation est introuvable par ses autres artistes.

### AC5 — Année : sentinelle 1970 + sélection arbitraire + éjectable
- `t.year !== 1970` (l.97/106) masque l'année des albums **réellement** sortis en 1970 ;
- première année non-1970 rencontrée retenue (arbitraire si multi-années) ;
- l'année vit DANS le span ellipsé du sub : un artiste long l'éjecte (une fois AC1 corrigé) → présence de l'année dépendant de la longueur de l'artiste.

### AC6 — Trois conventions de sous-titre pour la même hiérarchie
- Card Album : `artiste` + `année` séparées par un simple `margin-left` CSS (pas de « · »), compteur sur ligne dédiée `.card-ct` (i18n) ;
- Card Artiste : compteur DANS `.card-sub` avec « · » textuel et « albums » **non-i18n** (l.452) ;
- Card Playlist : compteur dans `.card-sub` ;
- Drill header Album : pluriels/labels **hardcodés FR** (« titre(s) », « min », « Lire tout », « Mélanger », l.181-187) → en locale EN, la grille est en anglais et son drill en français.

## MEDIUM

### AC7 — Tris sur attributs invisibles
`albumSort='duration'` est proposé mais la durée n'apparaît **jamais** sur la card (le drill l'affiche) → ordre inexplicable à l'écran. Idem `year` partiellement (années masquées/absentes/éjectées, cf. AC5).

### AC8 — Densité ≤480px : hiérarchie inversée
`@container content (max-width:480px) { .card-sub{display:none} }` (style.css:1529-1532) : la card Album perd artiste+année mais **garde** le compteur `.card-ct` (info tertiaire) ; la card Artiste perd tout son sous-titre. Asymétrie entre grilles + le moins informatif survit.

## LOW
- `aria-label` de la card omet année/compteur visibles (info SR < info visuelle).
- `${a.year}` interpolé sans esc — non exploitable (Rust `Option<u32>`), à documenter.
- `style="fill:none"` inline dans les SVG d'état vide (discipline §13 light).

## Recommandations (ordre d'attaque)
1. AC1 — colonne flex sur `.card-info` + ellipsis effectifs + hauteur de sub réservée (uniformise immédiatement toutes les cards).
2. AC2+AC4 — clé `unknown_album` (fr+en) ; fallback `unknown_artist` ; agrégation artiste (album-artist lofty si dispo, sinon détection hétérogène → « Multi-artistes »).
3. AC3 — `esc()` sur l'artiste de l'aria-label.
4. AC5 — année = min des années des pistes ; traiter la sentinelle 1970 à l'import, pas à l'affichage ; année hors du span ellipsé (à côté du compteur).
5. AC6 — séparateur « · » unifié + i18n du drill header (clé pluralisée commune).
6. AC7/AC8 — afficher la durée quand le tri 'duration' est actif (ou retirer le tri) ; en densité réduite, masquer `.card-ct` plutôt que `.card-sub`.
