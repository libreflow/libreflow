// frontend/tests/_a11y.cjs
// Pure helpers pour suites a11y statiques. Aucun npm dep ajouté.
'use strict';

const fs = require('fs');
const path = require('path');

/** Lit le contenu UTF-8 d'un fichier relatif à la racine du repo. */
function readRepoFile(rel) {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

/**
 * Aplatit une couleur rgba `fg` (hex sans alpha) avec alpha `a` (0..1)
 * sur un fond opaque `bg` (hex). Retourne un hex sans alpha.
 */
function flattenAlpha(fgHex, alpha, bgHex) {
  const fg = parseInt(fgHex.replace('#', ''), 16);
  const bg = parseInt(bgHex.replace('#', ''), 16);
  const fr = (fg >> 16) & 255, fG = (fg >> 8) & 255, fb = fg & 255;
  const br = (bg >> 16) & 255, bG = (bg >> 8) & 255, bb = bg & 255;
  const r = Math.round(br * (1 - alpha) + fr * alpha);
  const g = Math.round(bG * (1 - alpha) + fG * alpha);
  const b = Math.round(bb * (1 - alpha) + fb * alpha);
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Cherche toutes les balises d'un élément donné dans un HTML
 * et retourne un tableau d'objets { tag, id, classes, attrs }.
 */
function findElements(html, selectorPredicate) {
  const re = /<([a-z][a-z0-9-]*)\s+([^>]*?)\/?>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1];
    const attrsRaw = m[2];
    const attrs = {};
    const ar = /([a-z-]+)\s*=\s*"([^"]*)"/gi;
    let am;
    while ((am = ar.exec(attrsRaw))) attrs[am[1]] = am[2];
    const id = attrs.id || null;
    const classes = (attrs.class || '').split(/\s+/).filter(Boolean);
    if (selectorPredicate({ tag, id, classes, attrs })) {
      out.push({ tag, id, classes, attrs });
    }
  }
  return out;
}

module.exports = { readRepoFile, flattenAlpha, findElements };
