# LibreFlow — Politique de confidentialité / Privacy Policy

_Last updated: 2026-05-19 — applies to LibreFlow ≥ 1.1.0_

## Version courte

**LibreFlow est une application 100 % offline. Elle ne collecte, ne stocke, ne transmet AUCUNE donnée personnelle à Anthropic, à l'auteur du projet, ou à quelque tiers que ce soit.** L'application n'envoie aucune donnée d'usage, télémétrie, analytics, ou crash report.

Le seul flux réseau sortant possible est la vérification de mises à jour vers `github.com/libreflow/libreflow/releases` (signée minisign, désactivable dans Paramètres → Système).

---

## 1. Données traitées localement

LibreFlow traite uniquement sur votre disque les données suivantes :

| Donnée | Où | Pourquoi |
|---|---|---|
| Chemins absolus de fichiers audio | IndexedDB local (`%APPDATA%/com.libreflow.player`) | Construire la bibliothèque |
| Tags audio (titre, artiste, album, genre, année, durée) | IndexedDB local | Affichage et tri |
| Pochettes (extraites des tags) | IndexedDB local (cache LRU 60 entrées) | Affichage |
| Préférences (thème, EQ, volume, vue active) | IndexedDB local (`cfg`) | Persister la configuration |
| Historique de lecture | IndexedDB local (`playlog`, plafond 2000 entrées) | Vues « récentes », statistiques locales |
| Playlists (manuelles + smart) | IndexedDB local | Vos collections |

**Rien ne quitte votre machine.** Aucun compte utilisateur, aucun identifiant, aucun cookie.

---

## 2. Flux réseau

LibreFlow effectue **un seul** type de connexion sortante : la vérification de mise à jour.

- **Destination** : `https://github.com/libreflow/libreflow/releases/latest/download/latest.json`
- **Hébergeur** : GitHub Inc. (politique de confidentialité GitHub : https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
- **Données transmises** : IP publique, User-Agent du client HTTPS Tauri, version de LibreFlow (dans l'URL implicite). **Aucune donnée d'usage, aucun identifiant.**
- **Authentification** : la réponse `latest.json` et l'archive téléchargée sont signées (minisign Ed25519) — toute altération est rejetée.

### Désactivation
Dans **Paramètres → Système → Mises à jour**, désactivez « Vérifier automatiquement les mises à jour » pour supprimer entièrement ce flux. L'option est persistée localement (`cfg.autoUpdateCheck = false`).

---

## 3. Vos droits

LibreFlow étant 100 % local, la portabilité, l'effacement et la rectification de vos données sont sous votre contrôle direct :

| Droit | Comment l'exercer |
|---|---|
| **Accès** | Vos données sont visibles dans l'application. Export complet via Paramètres → Système → Sauvegarde |
| **Rectification** | Modifier les tags via le clic-droit → « Modifier les tags » |
| **Effacement** | Paramètres → Système → « Vider la bibliothèque » ou supprimer le dossier `%APPDATA%/com.libreflow.player` |
| **Portabilité** | Export `.libreflow` (ZIP de JSON) via Paramètres → Sauvegarde |
| **Opposition au traitement** | Désinstaller LibreFlow + supprimer le dossier de données |

---

## 4. CD audio (extraction)

LibreFlow peut extraire vers FLAC le contenu de CD audio que vous possédez. Aucune information sur le contenu ne quitte la machine : pas de requête à MusicBrainz, AcoustID, freedb, etc. Les tags d'un CD ripped sont remplis localement à partir du nom de fichier généré.

**Avertissement légal** : l'extraction d'un CD audio reste soumise à la législation de votre pays. Au sein de l'Union européenne, la copie privée pour usage personnel est généralement tolérée ; aux USA, le DMCA encadre cette pratique. **Vous êtes responsable du respect des droits d'auteur.**

---

## 5. Sécurité

- LibreFlow tourne dans le webview système (WebView2 sur Windows, WKWebView sur macOS, WebKitGTK sur Linux), avec une CSP stricte (`default-src 'none'`).
- Aucun stockage chiffré côté application (le webview n'a pas accès à un keychain). Vos données restent protégées par les ACL standards de votre OS et de votre profil utilisateur.
- Le binaire de mise à jour est validé par signature minisign Ed25519 avant exécution.

---

## 6. Modifications

Toute modification de cette politique sera reflétée dans le repository public (`PRIVACY.md`) et accompagnée d'une mention dans les notes de version.

---

## 7. Contact

Auteur du projet : voir `LICENSE` à la racine du repository.
Signalement de problème : ouvrir une issue GitHub sur `libreflow/libreflow`.

---

# English version

LibreFlow is a 100% offline desktop music player. It does **not** collect, store, or transmit any personal data to any third party.

**Local data only**: file paths, audio tags, cover art (LRU cache), preferences, play log, playlists — all live in IndexedDB inside your user profile (`%APPDATA%/com.libreflow.player` on Windows; equivalent locations on macOS/Linux).

**Only outbound traffic**: update check to `github.com/libreflow/libreflow/releases` (signed minisign). Disable via Settings → System → "Check for updates automatically".

**Your rights**: full export via Settings → Backup; full erasure via Settings → "Clear library" or deleting the data folder.

**CD ripping**: purely local (no MusicBrainz / AcoustID / freedb lookups). Respecting copyright law in your jurisdiction is your responsibility.
