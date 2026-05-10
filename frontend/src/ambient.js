function _linearize(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function _luminance(r, g, b) {
  return 0.2126 * _linearize(r) + 0.7152 * _linearize(g) + 0.0722 * _linearize(b);
}

function _parseArtColor() {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--art-color').trim();
  // Handles: "rgb(R, G, B)", "rgba(R,G,B,A)", bare "R G B", "R, G, B"
  const m = raw.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return null;
  return { r: parseInt(m[1]), g: parseInt(m[2]), b: parseInt(m[3]) };
}

export function getArtLuminance() {
  const c = _parseArtColor();
  if (!c) return 0; // fallback: treat as dark
  return _luminance(c.r, c.g, c.b);
}

export function updateAmbient(el = document.documentElement) {
  const lum = getArtLuminance();
  const isLight = lum >= 0.35;
  el.classList.toggle('art-light', isLight);
  el.classList.toggle('art-dark',  !isLight);
}
