/* Task 10 fix (review) — anti flash-of-full-motion au boot.
   Script CLASSIQUE (non-module) chargé en <head> : il bloque le rendu et pose
   data-motion sur <html> AVANT le premier paint. La valeur est un mirror
   localStorage (lf-motion) écrit par settings.js (au changement de réglage) et
   par app.js (au boot, après lecture cfg) ; la source de vérité reste la cfg
   IDB, relue plus tard par app.js (async — donc trop tard pour le premier
   paint) qui corrige l'attribut ET le mirror s'ils divergent.
   CSP : script-src 'self' interdit l'inline, d'où ce fichier dans public/
   (même pattern que boot-theme.js pour data-mode/data-theme).
   Offline §15 : lecture localStorage + matchMedia uniquement, aucun réseau. */
(function () {
  try {
    var p = localStorage.getItem('lf-motion');
    if (p !== 'system' && p !== 'full' && p !== 'reduce') p = 'system'; /* AUDIT-2026-07-27 : défaut = respecter l'OS */
    var reduce = p === 'reduce' ||
      (p === 'system' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    document.documentElement.setAttribute('data-motion', reduce ? 'reduce' : 'full');
  } catch (e) { /* localStorage indisponible — fallback statique data-motion="full" */ }
})();
