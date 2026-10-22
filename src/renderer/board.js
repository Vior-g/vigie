/* Vigie — calque transparent posé sur la fenêtre du jeu */
'use strict';

const H = window.Harebourg;
const G = window.MiniGrid;
const canvas = document.getElementById('c');
const banner = document.getElementById('banner');
const ctx = canvas.getContext('2d');

let S = null; // état public reçu du processus principal
const cal = { origin: null, w: 60, dragging: false, last: null };
const zone = { start: null, end: null, dragging: false };

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function setBanner(html) {
  if (!html) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.innerHTML = html; // contenu statique écrit ici, jamais issu du jeu
}

function mode() { return (S && S.board && S.board.mode) || 'idle'; }

/** Géométrie de grille : calibrée si possible, sinon estimée autour de « toi ». */
function geometry(me) {
  if (S && S.calibration) return { origin: { x: S.calibration.x, y: S.calibration.y }, w: S.calibration.w, calibrated: true };
  return { origin: me, w: Math.max(30, innerWidth / 16), calibrated: false };
}

function draw() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const m = mode();
  document.body.classList.toggle('interactive', m !== 'idle');
  if (m === 'calibrate') return drawCalibration();
  if (m === 'ocrzone') return drawZone();
  drawAim();
}

// ------------------------------------------------------------------ visée

function drawAim() {
  const h = S && S.harebourg;
  if (!h || !h.me) { setBanner(null); return; }
  const g = geometry(h.me);
  const me = H.snap(H.pixelToGrid(h.me, g.origin, g.w));
  const target = h.target ? H.snap(H.pixelToGrid(h.target, g.origin, g.w)) : null;
  const r = G.drawMarks(ctx, g.origin, g.w, me, target, h.q, S.turn, { labels: true });
  const parts = [`Confusion : <b>${H.ROT_LABEL[h.q]}</b>`, `tour ${S.turn} (${S.turn % 2 ? 'impair' : 'pair'})`];
  if (!g.calibrated) parts.push('grille non calibrée : repère approximatif');
  if (r && r.same) parts.push('pas de déviation : vise directement');
  if (r) {
    const d = H.distance(me, r.aim);
    parts.push(`case à viser à ${d} PO de toi`);
  }
  setBanner(parts.join(' · '));
}

// ------------------------------------------------------------- calibrage

function drawCalibration() {
  setBanner(cal.origin
    ? 'Molette : ajuster la taille des cases (<kbd>Maj</kbd> = fin) · glisser : déplacer · flèches : 1 px · <kbd>Entrée</kbd> : valider · <kbd>Échap</kbd> : annuler'
    : '<b>Calibrage de la grille</b> — clique au <b>centre d\'une case</b> de la map de combat (ta case par exemple).');
  if (!cal.origin) return;
  G.drawGrid(ctx, cal.origin, cal.w, 14, 'rgba(255, 235, 160, 0.55)');
  G.cell(ctx, { a: 0, b: 0 }, cal.origin, cal.w, { stroke: '#5cff8f', width: 3, fill: 'rgba(92,255,143,0.25)' });
  G.label(ctx, `case : ${cal.w.toFixed(1)} px`, cal.origin, '#f0d495', cal.w / 2 + 18);
}

// ---------------------------------------------------------- zone de lecture

function drawZone() {
  setBanner('<b>Zone de lecture</b> — encadre le nom de la map et ses coordonnées (en haut à gauche du jeu). <kbd>Entrée</kbd> : valider · <kbd>Échap</kbd> : annuler');
  if (!zone.start || !zone.end) return;
  const x = Math.min(zone.start.x, zone.end.x); const y = Math.min(zone.start.y, zone.end.y);
  const w = Math.abs(zone.end.x - zone.start.x); const h = Math.abs(zone.end.y - zone.start.y);
  ctx.fillStyle = 'rgba(214, 177, 106, 0.18)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#f0d495';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
}

function zoneFractions() {
  const x = Math.min(zone.start.x, zone.end.x); const y = Math.min(zone.start.y, zone.end.y);
  const w = Math.abs(zone.end.x - zone.start.x); const h = Math.abs(zone.end.y - zone.start.y);
  if (w < 20 || h < 10) return null;
  const r = (v) => Math.round(v * 10000) / 10000;
  return { x: r(x / innerWidth), y: r(y / innerHeight), w: r(w / innerWidth), h: r(h / innerHeight) };
}

// ------------------------------------------------------------- entrées

window.addEventListener('mousedown', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  if (mode() === 'calibrate') {
    if (!cal.origin) { cal.origin = p; cal.w = Math.max(30, innerWidth / 16); }
    cal.dragging = true; cal.last = p;
  } else if (mode() === 'ocrzone') {
    zone.start = p; zone.end = p; zone.dragging = true;
  }
  draw();
});

window.addEventListener('mousemove', (e) => {
  const p = { x: e.clientX, y: e.clientY };
  if (mode() === 'calibrate' && cal.dragging && cal.last) {
    cal.origin = { x: cal.origin.x + p.x - cal.last.x, y: cal.origin.y + p.y - cal.last.y };
    cal.last = p; draw();
  } else if (mode() === 'ocrzone' && zone.dragging) {
    zone.end = p; draw();
  }
});

window.addEventListener('mouseup', () => { cal.dragging = false; zone.dragging = false; });

window.addEventListener('wheel', (e) => {
  if (mode() !== 'calibrate' || !cal.origin) return;
  const step = e.shiftKey ? 0.2 : 1;
  cal.w = Math.max(16, Math.min(260, cal.w + (e.deltaY < 0 ? step : -step)));
  draw();
}, { passive: true });

window.addEventListener('keydown', (e) => {
  const m = mode();
  if (m === 'idle') return;
  if (e.key === 'Escape') { finish(m, null); return; }
  if (e.key === 'Enter') {
    if (m === 'calibrate' && cal.origin) finish(m, { x: Math.round(cal.origin.x * 10) / 10, y: Math.round(cal.origin.y * 10) / 10, w: Math.round(cal.w * 100) / 100 });
    if (m === 'ocrzone' && zone.start) finish(m, zoneFractions());
    return;
  }
  if (m === 'calibrate' && cal.origin) {
    const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (d) { cal.origin = { x: cal.origin.x + d[0], y: cal.origin.y + d[1] }; draw(); }
  }
});

function finish(m, payload) {
  cal.origin = null; zone.start = null; zone.end = null;
  window.vigie.boardDone(m, payload);
}

window.vigie.on('state', (s) => {
  const prev = mode();
  S = s;
  if (prev !== 'calibrate' && mode() === 'calibrate' && S.calibration) {
    // Repartir du calibrage existant pour l'ajuster.
    cal.origin = { x: S.calibration.x, y: S.calibration.y };
    cal.w = S.calibration.w;
  }
  draw();
});
window.addEventListener('resize', resize);
window.vigie.init().then((d) => { S = d.state; resize(); });
