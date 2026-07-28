// LibreFlow — cinema-beat.js
// Détecteur de beat partagé du mode Cinéma. Un seul appelant en production :
// cinema-loop.js calcule un beat unique par frame (fenêtre glissante sur l'énergie
// basses) et le distribue en paramètre aux renderers passifs (cinema-bg.js,
// cinema-viz.js, cinema-canvas.js) — ils ne détectent plus le beat eux-mêmes.
//
// Logique pure et testable (core.test.cjs reproduit la logique inline, style maison).
// Zéro allocation en régime permanent : le ring buffer est pré-alloué une fois.
//
// Exports :
//   createBeatDetector({ history, threshold, cooldownMs }) → { sample(energy, nowMs) }

/**
 * Crée un détecteur de beat à fenêtre glissante interne (running sum O(1) +
 * warm-up + correction de dérive flottante).
 *
 * Un beat est détecté quand `energy > moyenne(history) * threshold` et que le
 * cooldown est écoulé depuis le dernier beat.
 *
 * @param {{ history: number, threshold: number, cooldownMs: number }} opts
 * @returns {{ sample(energy: number, nowMs: number): boolean }}
 */
export function createBeatDetector({ history, threshold, cooldownMs }) {
  // Ring buffer pré-alloué — zéro allocation en régime permanent.
  const buf = new Float32Array(history);
  let idx      = 0;   // nombre de frames vues (index d'écriture)
  let sum      = 0;   // somme courante O(1) — évite reduce() dans la hot path
  let lastBeat = 0;   // performance.now() du dernier beat

  return {
    /**
     * @param {number} energy énergie instantanée de la frame courante
     * @param {number} nowMs  performance.now()
     * @returns {boolean} true si un beat est détecté sur cette frame
     */
    sample(energy, nowMs) {
      // Running sum O(1) — slot calculé une seule fois
      const slot = idx % history;
      sum -= buf[slot];
      buf[slot] = energy;
      sum += energy;
      idx++;
      // Warm-up : tant que le buffer n'est pas plein, avg ≈ 0 → faux beats permanents.
      if (idx < history) return false;
      // Correction de dérive flottante : recompute exact tous les `history` frames.
      // Les additions/soustractions fp dérivent sur de longues sessions.
      if (idx % history === 0) {
        sum = 0;
        for (let i = 0; i < history; i++) sum += buf[i];
      }
      const avg = sum / history;
      if (energy > avg * threshold && nowMs - lastBeat > cooldownMs) {
        lastBeat = nowMs;
        return true;
      }
      return false;
    },
  };
}
