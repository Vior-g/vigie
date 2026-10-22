/*
 * Lecture des noms de monstres à la demande : zone autour du curseur et
 * réglages des passes d'OCR (texte clair puis texte sombre). Partagé par le
 * processus principal et les tests.
 */
'use strict';

const DEFAULT_BOX = { w: 0.46, up: 0.34, down: 0.14 };

/** Rectangle (pixels de l'image) autour du curseur, borné à l'image. */
function cursorRect(local, W, H, box = DEFAULT_BOX) {
  const b = { ...DEFAULT_BOX, ...(box || {}) };
  const inside = local && local.x >= 0 && local.y >= 0 && local.x <= W && local.y <= H;
  if (!inside) return { x: 0, y: 0, width: W, height: H, inside: false };
  let x = local.x - (b.w * W) / 2;
  let y = local.y - b.up * H;
  let width = b.w * W;
  let height = (b.up + b.down) * H;
  if (x < 0) { width += x; x = 0; }
  if (y < 0) { height += y; y = 0; }
  width = Math.max(1, Math.min(W - x, width));
  height = Math.max(1, Math.min(H - y, height));
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), inside: true };
}

/** Passes d'OCR sur la zone du curseur. */
function passes({ threshold = 165, darkThreshold = 95 } = {}) {
  return [
    { name: 'clair', opts: { threshold, scale: 2 } },
    { name: 'sombre', opts: { threshold: darkThreshold, scale: 2, dark: true } },
  ];
}

module.exports = { cursorRect, passes, DEFAULT_BOX };
