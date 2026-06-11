/* M2 (audit bugs visuels 2026-06-11) — anti flash-of-wrong-theme.
   Script CLASSIQUE (non-module) chargé en <head> : il bloque le rendu et pose
   data-mode / data-theme AVANT le premier paint. Les valeurs sont des mirrors
   localStorage écrits par settings.js ; la source de vérité reste la cfg IDB,
   lue plus tard par app.js (async — donc trop tard pour le premier paint).
   CSP : script-src 'self' interdit l'inline, d'où ce fichier dans public/.
   Offline §15 : aucune requête réseau, lecture localStorage uniquement. */
(function () {
  try {
    var m = localStorage.getItem('lf-mode');
    if (m === 'light' || m === 'dark') document.documentElement.setAttribute('data-mode', m);
    var t = localStorage.getItem('lf-theme');
    if (t && /^[a-z][a-z0-9-]{0,23}$/.test(t)) document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* localStorage indisponible — premier paint aux défauts dark/indigo */ }
})();
