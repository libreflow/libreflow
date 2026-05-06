# LibreFlow — QA Checklist v1.0

Remplir manuellement avant chaque tag de release. Cocher chaque item après vérification.

---

## Boot & Initialisation

- [ ] L'application démarre sans erreur console (F12 → Console)
- [ ] La bibliothèque s'affiche en < 3s sur une collection de 1000+ titres
- [ ] Le thème et la langue sont restaurés depuis la session précédente
- [ ] Le titre de la fenêtre affiche "LibreFlow"

## Scan & Bibliothèque

- [ ] Scanner un dossier ajoute correctement les pistes en IDB
- [ ] Les pochettes d'album se chargent après le rendu initial (async)
- [ ] Les pistes sans tags affichent un placeholder propre (pas de crash)
- [ ] Le scan d'un dossier vide affiche un toast d'info (pas d'erreur silencieuse)
- [ ] Les fichiers déjà scannés ne sont pas dupliqués lors d'un re-scan

## Lecture audio

- [ ] Lecture, pause, piste suivante/précédente fonctionnent
- [ ] Le crossfade enchaîne deux pistes sans glitch audio
- [ ] ReplayGain : activer/désactiver ne crée pas de reset du volume
- [ ] La seekbar (+ waveform canvas) se synchronise correctement avec la progression
- [ ] Le mode repeat (off/all/one) fonctionne correctement
- [ ] Le shuffle mélange sans répétition immédiate

## Tags

- [ ] Double-clic sur une piste ouvre l'éditeur de tags inline
- [ ] Modifier titre/artiste/album/année/genre → sauvegardé en IDB + visible au re-démarrage
- [ ] Multi-sélection de N pistes → bouton "Éditer les tags" visible dans la barre de sélection
- [ ] Batch tag edit : champ renseigné → appliqué à toutes les pistes sélectionnées
- [ ] Batch tag edit : champ vide → champ non modifié sur les pistes (non-destructif)
- [ ] Batch tag edit : pochette → mise à jour visible immédiatement

## Playlists

- [ ] Créer / renommer / supprimer une playlist
- [ ] Smart playlist : critères sauvegardés et résultats corrects
- [ ] Import/export M3U fonctionnel

## Mini-player natif

- [ ] Ouvrir le mini-player : fenêtre toujours au premier plan
- [ ] Titre, artiste, pochette synchronisés avec la piste en cours
- [ ] Boutons play/pause/next dans le mini-player fonctionnent
- [ ] Fermer le mini-player depuis la fenêtre principale fonctionne

## Interface

- [ ] Mode light/dark bascule sans artefact visuel
- [ ] Les thèmes de couleur s'appliquent correctement
- [ ] Responsive à 899px : sidebar réduite, grille adaptée
- [ ] Responsive à 719px : sidebar icon-only, contrôles masqués
- [ ] Mode cinéma : ambient canvas + Ken Burns actifs, touches Échap ferment

## Performances

- [ ] Virtual scroll fluide sur 5000+ pistes (pas de freeze au scroll)
- [ ] Recherche réactive < 100ms sur 5000+ pistes
- [ ] Aucune fuite mémoire apparente après 30 min d'écoute (Task Manager stable)

## Distribution (build release uniquement)

- [ ] `npm run build` se termine sans erreur
- [ ] L'installateur NSIS s'exécute correctement (Windows)
- [ ] L'auto-updater détecte une mise à jour disponible (si applicable)
- [ ] L'application fonctionne offline (aucune requête réseau externe)

---

*Validé par :* _______________  
*Date :* _______________  
*Version :* _______________
