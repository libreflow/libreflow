// LibreFlow — allplayerui.js
// Wrapper combiné : met à jour le mini-player Tauri ET l'overlay in-page
// simultanément. Extrait de app.js (ARCH-1 — casser les dépendances circulaires).
//
// Dépendances :
//   import  : updateMiniPlayer (miniplayer.js)
//   import  : syncMiniOverlay  (minioverlay.js)
//
// Exports publics :
//   _allPlayerUI()

import { updateMiniPlayer } from './miniplayer.js';
import { syncMiniOverlay }  from './minioverlay.js';

/**
 * Met à jour le mini-player Tauri (fenêtre séparée) et l'overlay in-page
 * en un seul appel. À appeler après tout changement d'état du player.
 */
export function _allPlayerUI() { updateMiniPlayer(); syncMiniOverlay(); }
