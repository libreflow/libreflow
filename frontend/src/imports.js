// @ts-check
// imports.js — Historique persistant des imports audio (IDB store 'imports').
/** @import { ImportEntry } from './types.js' */

import { dput, dall } from './db.js';

let _idSeq = 0;

/**
 * Enregistre un import dans le store IDB 'imports'.
 * Fire-and-forget — erreurs loguées silencieusement.
 * @param {'drag-drop'|'folder-scan'|'manual'|'usb'} source
 * @param {string[]} paths — chemins des fichiers importés
 */
export async function logImport(source, paths) {
  if (!paths.length) return;
  /** @type {ImportEntry} */
  const entry = {
    id: crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${(++_idSeq).toString(36)}`,
    date: Date.now(),
    source,
    paths,
    count: paths.length,
  };
  await dput('imports', entry).catch(e => console.warn('[imports] logImport failed', e));
}

/**
 * Retourne tous les imports triés du plus récent au plus ancien.
 * @returns {Promise<ImportEntry[]>}
 */
export async function getImports() {
  const all = await dall('imports').catch(() => []);
  return /** @type {ImportEntry[]} */ (all).sort((a, b) => b.date - a.date);
}
