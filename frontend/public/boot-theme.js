/* M2 (audit 2026-06-11) — anti flash-of-wrong-theme/mode au boot.
   Script CLASSIQUE (non-module) chargé en <head> : il bloque le rendu et pose
   data-mode/data-theme sur <html> AVANT le premier paint. Les valeurs sont des
   mirrors localStorage (lf-mode/lf-theme) écrits par settings.js (setMode/
   _applyThemeVars, au changement de réglage ET à chaque boot) ; la source de
   vérité reste la cfg IDB, relue plus tard par app.js (async — donc trop tard
   pour le premier paint) qui corrige l'attribut ET le mirror s'ils divergent.
   CSP : script-src 'self' interdit l'inline, d'où ce fichier dans public/
   (même pattern que boot-motion.js pour data-motion).
   Offline §15 : lecture localStorage uniquement, aucun réseau. */
(function () {
  try {
    var mode = localStorage.getItem('lf-mode');
    if (mode !== 'light' && mode !== 'dark') mode = 'dark';
    document.documentElement.setAttribute('data-mode', mode);
  } catch (e) { /* localStorage indisponible — fallback statique (CSS: dark par défaut) */ }
  try {
    var theme = localStorage.getItem('lf-theme');
    var VALID = ['green', 'blue', 'purple', 'red', 'orange', 'pink', 'cyan'];
    if (VALID.indexOf(theme) === -1) theme = 'blue';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) { /* localStorage indisponible — fallback statique (CSS: blue par défaut) */ }
})();
