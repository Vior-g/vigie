'use strict';
/*
 * Capture d'écran de la zone utile. On capture l'écran (pas la fenêtre du
 * jeu, que les captures DirectX rendent parfois noire), puis on découpe le
 * rectangle de la fenêtre Dofus. Les fenêtres de Vigie sont exclues des
 * captures grâce à setContentProtection.
 */
const { desktopCapturer, screen } = require('electron');

/**
 * @param {{x,y,w,h}|null} physRect rectangle client de la fenêtre Dofus, en
 *   pixels physiques (null = tout l'écran principal).
 * @returns {Promise<{data:Buffer,width:number,height:number}>} BGRA
 */
async function grab(physRect) {
  const displays = screen.getAllDisplays();
  let display = screen.getPrimaryDisplay();
  if (physRect && process.platform === 'win32') {
    const dip = screen.screenToDipRect(null, {
      x: physRect.x, y: physRect.y, width: physRect.w, height: physRect.h,
    });
    display = screen.getDisplayMatching(dip) || display;
  }
  const scale = display.scaleFactor || 1;
  const size = {
    width: Math.round(display.size.width * scale),
    height: Math.round(display.size.height * scale),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => String(s.display_id) === String(display.id))
    || (displays.length === 1 ? sources[0] : sources[0]);
  if (!src) throw new Error('Aucune source d\'écran disponible');
  const img = src.thumbnail;
  const { width, height } = img.getSize();
  const data = img.toBitmap();

  if (!physRect) return { data, width, height, offset: { x: 0, y: 0 } };

  // Origine physique de l'écran capturé.
  const origin = process.platform === 'win32'
    ? screen.dipToScreenRect(null, display.bounds)
    : { x: display.bounds.x * scale, y: display.bounds.y * scale };
  const rx = (physRect.x - origin.x) * (width / size.width);
  const ry = (physRect.y - origin.y) * (height / size.height);
  const rw = physRect.w * (width / size.width);
  const rh = physRect.h * (height / size.height);
  const { crop } = require('../core/preprocess');
  const out = crop(data, width, height, { x: rx, y: ry, width: rw, height: rh });
  return { ...out, offset: { x: rx, y: ry } };
}

module.exports = { grab };
