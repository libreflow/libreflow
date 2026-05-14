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
import { registerHandlers } from './handlers.js';
import { initNextPreview }  from './playerbar.js';
registerHandlers();
initNextPreview();

// R-1 — handler global géré dans app.js (unhandledrejection) — ne pas
// appeler toast() ici car ce module s'exécute avant le boot app.js
// et toast peut ne pas être disponible.
