# LibreFlow — Design Spec : Sprint v1.0 "Polish + Ship"

**Date** : 2026-05-04  
**Session** : 172+  
**Approche retenue** : C — Polish + ship  
**Objectif** : Livrer une v1.0 propre en 3 sprints ciblés

---

## Contexte

LibreFlow est un lecteur de musique desktop Tauri 2.0 + Vanilla JS à session 172. L'architecture est stable (app.js refactorisé de 4913 → 1260 LOC, tous les jalons J1-J6, J8-J9 terminés). Les seuls blocants v1.0 sont :
- Dette technique visible (fichiers morts, CSS orphelin)
- Feature C-4 Batch Tag Editing manquante
- Jalon J7 Tests à 0%

---

## Sprint 1 — Nettoyage

### Objectif
Éliminer la dette visible avant les features.

### Actions

| Action | Fichier | Décision |
|--------|---------|----------|
| Supprimer | `frontend/src/genreml.js` | Fichier mort 3 lignes (module ONNX/MAEST retiré) |
| Auditer | `frontend/src/genres.js` | Vérifier imports — supprimer si mort |
| Supprimer | `frontend/src/ipc_opt1_backup.js` | Fichier backup non importé |
| Audit CSS | `frontend/src/style.css` (5739 LOC) | Identifier blocs orphelins post-refactors |

### Critère de sortie
Aucun fichier mort dans `frontend/src/`. Blocs CSS orphelins identifiés et supprimés (ou commentés avec justification explicite si suppression risquée).

---

## Sprint 2 — C-4 Batch Tag Editing

### Objectif
Permettre l'édition des tags de N pistes simultanément.

### Scope fonctionnel
- Sélectionner N tracks via la multi-sélection existante (`selection.js`)
- Ouvrir un modal "Édition groupée" (champs : Artiste, Album, Année, Genre)
- Champ vide = ne pas modifier (non-destructif)
- Champ avec valeur = appliqué à toutes les tracks sélectionnées
- Écriture via `write_tags` (Rust/lofty) en boucle séquentielle côté JS
- Progress bar pendant l'écriture (N traitées / N total)
- Toast de confirmation + message d'erreur si échec partiel

### Hors scope
- Édition de la cover en batch
- Undo global (toast d'erreur suffit)

### Architecture frontend

**Nouveau fichier** : `frontend/src/batchedit.js` (~150 LOC)
```
Exports :
  openBatchEditModal(trackIds[])  — ouvre le modal, charge les valeurs communes
  _writeBatch(trackIds, fields)   — boucle write_tags + progress
```

**Modifications** :
- `handlers.js` : ajout case `'batch-edit'` dans `_handleClick`
- `index.html` : bouton "Éditer tags" dans la barre de sélection flottante `#sel-bar`
- `style.css` : styles modal batch edit (réutilise les tokens `.mbtn`, `.modal-bg` existants)
- `i18n.js` : clés FR + EN (batch_edit_title, batch_edit_artist, batch_edit_album, batch_edit_year, batch_edit_genre, batch_edit_empty_hint, batch_edit_progress, batch_edit_done, batch_edit_error)

**Rust** : aucune nouvelle commande — `write_tags` existant réutilisé track par track.

### Invariants à respecter
- R1 : aucune modification du Web Audio graph
- R2 : après écriture, mettre à jour `tracks[]` + `rebuildTrackIdxMap()` + sync IDB
- R3 : vérifier intégrité JS (exports window.* intacts)

---

## Sprint 3 — J7 Minimal : Tests + QA Checklist

### Objectif
Protection contre les régressions de production sans setup `tauri-driver`.

### Décision tauri-driver
`tauri-driver` est instable sous Windows (session 172). Le risque réel de régression est dans les chemins critiques d'exécution, pas dans la logique métier. On adopte : tests unitaires purs JS (Vitest) sur les modules fonctionnels + QA checklist manuelle.

### Livrable 1 — Vitest smoke tests

**Fichier** : `frontend/src/__tests__/smoke.test.js`

**Suite 1 — search.js**
- Filtrage texte (titre, artiste, album)
- Tri (alpha, année, durée)
- Edge cases : query vide, caractères spéciaux, query sans résultat

**Suite 2 — store.js**
- Mutation state (`setCurrentIdx`, `setTracks`)
- Cohérence `_trackIdxMap` après `rebuildTrackIdxMap()`
- Accès par ID sur une librairie de 1000 tracks simulée

**Suite 3 — utils.js**
- `formatDuration(seconds)` — cas limites (0, négatif, > 1h)
- `validYear(str)` — année valide, epoch 1970, null, chaîne aléatoire
- `debounce(fn, ms)` — timing

**Config** : `vite.config.js` existant étendu avec `test: { environment: 'node' }`. Aucun mock DOM requis (modules purement fonctionnels).

**Critère** : `vitest run` green, 0 test failing.

### Livrable 2 — QA Checklist v1.0

**Fichier** : `docs/QA_CHECKLIST.md`

Checklist manuelle à valider avant chaque tag de release :

- [ ] Boot : IDB ouvert, cfg chargé, tracks affichées < 3s
- [ ] Scan dossier : résultats corrects, tracks ajoutées en IDB, artwork chargé
- [ ] Playback : lecture, pause, next/prev, crossfade, ReplayGain actif
- [ ] Seek : seekbar + waveform canvas synchronisés
- [ ] Write tags unitaire : modification titre → persisté en IDB + relecture correcte
- [ ] Write tags batch : 10 tracks sélectionnées → album modifié sur toutes
- [ ] Playlists : créer, renommer, supprimer, smart playlist
- [ ] Mini-player natif : toujours visible, sync état (titre, play/pause, volume)
- [ ] Responsive : UI correcte à 899px et 719px
- [ ] Auto-updater : vérification update disponible (mode release)

---

## Ordre d'exécution

```
Sprint 1 (nettoyage)  →  Sprint 2 (C-4)  →  Sprint 3 (J7)  →  tag v1.0
```

Chaque sprint est indépendant et peut être réalisé en 1-2 sessions Claude Code.

---

## Risques

| Risque | Mitigation |
|--------|-----------|
| CSS audit long (5739 LOC) | Limiter à la recherche de sélecteurs orphelins évidents, pas de purge totale |
| Vitest config Vite/Tauri incompatibilité | `environment: 'node'` isole les modules purs de tout DOM |
| `write_tags` lent sur batch > 100 tracks | Progress bar + opération en arrière-plan (pas de blocage UI) |
