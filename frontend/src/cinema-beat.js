// LibreFlow — cinema-beat.js
// Détecteur de beat partagé du mode Cinéma. Factorise la logique dupliquée 3× :
//   - viz pochette   (cinema-viz.js) : fenêtre glissante 43 frames, seuil 1.35, cooldown 650ms
//   - vagues         (cinema-canvas.js) : baseline EMA externe, seuil 1.55, cooldown 650ms
//   - ciel étoilé    (cinema-canvas.js) : baseline EMA externe, seuil 1.55, cooldown 720ms
//
// Logique pure et testable (core.test.cjs reproduit la logique inline, style maison).
// Zéro allocation en régime permanent : le ring buffer est pré-alloué une fois.
//
// Exports :
//   createBeatDetector({ history, threshold, cooldownMs }) → { sample(energy, nowMs, baseline?) }

/**
 * Crée un détecteur de beat.
 *
 * Deux modes selon `history` :
 *   - history > 0 : fenêtre glissante interne (running sum O(1) + warm-up +
 *     correction de dérive flottante). `baseline` est ignoré. Utilisé par la
 *     pochette (viz) où l'énergie est comparée à sa moyenne récente.
 *   - history === 0 : la moyenne de référence est fournie par l'appelant via
 *     `baseline` (typiquement une EMA déjà calculée pour le rendu). Utilisé par
 *     les vagues et le ciel étoilé.
 *
 * Un beat est détecté quand `energy > baseline * threshold` et que le cooldown
 * est écoulé depuis le dernier beat.
 *
 * @param {{ history?: number, threshold: number, cooldownMs: number }} opts
 * @returns {{ sample(energy: number, nowMs: number, baseline?: number): boolean }}
 */
export function createBeatDetector({ history = 0, threshold, cooldownMs }) {
  // Ring buffer pré-alloué (mode fenêtre glissante) — null en mode baseline externe.
  const buf = history > 0 ? new Float32Array(history) : null;
  let idx      = 0;   // nombre de frames vues (index d'écriture)
  let sum      = 0;   // somme courante O(1) — évite reduce() dans la hot path
  let lastBeat = 0;   // performance.now() du dernier beat

  return {
    /**
     * @param {number} energy      énergie instantanée de la frame courante
     * @param {number} nowMs       performance.now()
     * @param {number} [baseline]  moyenne de référence — requise en mode history === 0
     * @returns {boolean} true si un beat est détecté sur cette frame
     */
    sample(energy, nowMs, baseline) {
      let avg;
      if (buf) {
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
        avg = sum / history;
      } else {
        avg = baseline;
      }
      if (energy > avg * threshold && nowMs - lastBeat > cooldownMs) {
        lastBeat = nowMs;
        return true;
      }
      return false;
    },
  };
}
