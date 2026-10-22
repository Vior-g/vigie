/*
 * Préparation d'une capture pour l'OCR.
 * Entrée : tampon 4 canaux (RGBA ou BGRA, peu importe : on n'utilise que
 * des opérations symétriques sur les canaux couleur).
 * Sortie : image en niveaux de gris, texte clair -> noir sur fond blanc,
 * agrandie (Tesseract lit mieux du texte sombre et assez grand).
 */
'use strict';

function crop(buf, width, height, rect) {
  const x0 = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(width - x0, Math.round(rect.width)));
  const h = Math.max(1, Math.min(height - y0, Math.round(rect.height)));
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * width + x0) * 4;
    buf.copy(out, y * w * 4, src, src + w * 4);
  }
  return { data: out, width: w, height: h };
}

/**
 * Binarisation : un pixel est « texte » si son canal le plus faible dépasse
 * le seuil (texte blanc / crème du jeu), ce qui ignore les fonds colorés vifs.
 * Mise à l'échelle par plus proche voisin.
 */
function binarize(img, { threshold = 165, scale = 2, invert = true } = {}) {
  const W = img.width * scale; const H = img.height * scale;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < W; x++) {
      const sx = Math.floor(x / scale);
      const i = (sy * img.width + sx) * 4;
      const lo = Math.min(img.data[i], img.data[i + 1], img.data[i + 2]);
      const isText = lo >= threshold;
      const v = (isText === invert) ? 0 : 255;
      const o = (y * W + x) * 4;
      out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

/** Zone relative (fractions 0..1) -> rectangle en pixels. */
function regionToRect(region, width, height) {
  return {
    x: region.x * width,
    y: region.y * height,
    width: region.w * width,
    height: region.h * height,
  };
}

module.exports = { crop, binarize, regionToRect };
