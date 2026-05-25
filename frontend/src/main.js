// LibreFlow — Entry point (Vite)
// Orchestrateur de boot pur — aucune logique applicative ici.
//
// Ordre de démarrage :
//   1. app.js   — charge la config, la BDD, les tracks, les playlists → boot()
//   2. handlers — enregistre les delegated listeners (data-action, dblclick,
//                 contextmenu, keydown, dragstart) sur document
//
// Tous les modules satellites (player, eq, viz, playlists, …) sont importés
// transitivement depuis app.js et handlers.js — aucun import direct ici.
//
// BRIDGE-1 (session 146) : window-bridge.js supprimé — tous les onclick
// inline ont migré vers data-action/data-* + delegated listeners.

import './app.js';
import { registerHandlers }      from './handlers.js';
import { initNextPreview }       from './playerbar.js';
import { installAutoFocusTrap }  from './modal.js';
import { initSettingsKeynav, initSettingsListeners } from './settings.js';
import { initCtxMenu }           from './ctxmenu.js';
registerHandlers();
initNextPreview();
// A11Y-SERIOUS : focus trap auto-installé sur tous les [role="dialog"] connus.
installAutoFocusTrap();
// UX-Ergo : navigation clavier (ArrowLeft/Right/Home/End) dans la tablist settings.
initSettingsKeynav();
// BUG-AUDIT HIGH : listeners document/window de settings et ctxmenu — désormais
// attachés via AbortController au lieu du niveau module (cumul HMR/test évité).
initSettingsListeners();
initCtxMenu();

// R-1 — handler global géré dans app.js (unhandledrejection) — ne pas
// appeler toast() ici car ce module s'exécute avant le boot app.js
// et toast peut ne pas être disponible.
