/*
 * Dessin des repères de visée (partagé entre le mini-simulateur du panneau
 * et le calque posé sur le jeu).
 */
(function (root) {
  'use strict';
  const H = root.Harebourg;

  const COLORS = {
    grid: 'rgba(255,255,255,0.10)',
    me: '#55c7ff',
    target: '#ff5d5d',
    aim: '#5cff8f',
    landing: '#ffae42',
    teleport: '#c48bff',
  };

  function path(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  function cell(ctx, c, origin, w, { stroke, fill, dash, width = 2 }) {
    const pts = H.diamond(c, origin, w);
    path(ctx, pts);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) {
      ctx.setLineDash(dash || []);
      ctx.lineWidth = width;
      ctx.strokeStyle = stroke;
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function label(ctx, text, p, color, dy = 0) {
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    const m = ctx.measureText(text);
    const x = p.x - m.width / 2; const y = p.y + dy;
    ctx.fillStyle = 'rgba(10,8,12,0.85)';
    ctx.fillRect(x - 5, y - 12, m.width + 10, 17);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y + 1);
  }

  /** Calcule les repères à partir de toi / la cible / la rotation / le tour. */
  function compute(me, target, q, turn) {
    if (!me || !target) return null;
    const aim = H.aimCell(me, target, q);
    const landing = H.landingCell(me, target, q);
    const even = turn % 2 === 0;
    // Tour pair : le Comte est renvoyé de l'autre côté de toi.
    // Tour impair : c'est toi qui passes de l'autre côté du Comte.
    const teleport = even
      ? { a: 2 * me.a - target.a, b: 2 * me.b - target.b }
      : { a: 2 * target.a - me.a, b: 2 * target.b - me.b };
    return { aim, landing, teleport, even, same: aim.a === target.a && aim.b === target.b };
  }

  /**
   * Dessine les repères. `opts.labels` : afficher les étiquettes.
   * `opts.teleport` : afficher la case d'arrivée de la téléportation.
   */
  function drawMarks(ctx, origin, w, me, target, q, turn, opts = {}) {
    if (me) cell(ctx, me, origin, w, { stroke: COLORS.me, fill: 'rgba(85,199,255,0.18)', width: 2.5 });
    if (!target) {
      if (me && opts.labels) label(ctx, 'TOI — survole la cible puis refais le raccourci', H.gridToPixel(me, origin, w), COLORS.me, -w / 2);
      return null;
    }
    const r = compute(me, target, q, turn);
    cell(ctx, target, origin, w, { stroke: COLORS.target, fill: 'rgba(255,93,93,0.18)', width: 2.5 });
    if (!r.same) cell(ctx, r.landing, origin, w, { stroke: COLORS.landing, dash: [5, 4], width: 2 });
    if (opts.teleport !== false) cell(ctx, r.teleport, origin, w, { stroke: COLORS.teleport, dash: [2, 3], width: 2 });
    cell(ctx, r.aim, origin, w, { stroke: COLORS.aim, fill: 'rgba(92,255,143,0.35)', width: 3.5 });
    if (opts.labels) {
      const pAim = H.gridToPixel(r.aim, origin, w);
      label(ctx, `VISE ICI · ${H.ROT_LABEL[q]}`, pAim, COLORS.aim, -w / 2 - 4);
      label(ctx, 'TOI', H.gridToPixel(me, origin, w), COLORS.me, w / 2 + 14);
      label(ctx, 'CIBLE', H.gridToPixel(target, origin, w), COLORS.target, w / 2 + 14);
      if (opts.teleport !== false) {
        label(ctx, r.even ? 'le Comte arrive ici' : 'tu arrives ici', H.gridToPixel(r.teleport, origin, w), COLORS.teleport, w / 2 + 14);
      }
    }
    return r;
  }

  function drawGrid(ctx, origin, w, radius, color) {
    for (let a = -radius; a <= radius; a++) {
      for (let b = -radius; b <= radius; b++) {
        cell(ctx, { a, b }, origin, w, { stroke: color || COLORS.grid, width: 1 });
      }
    }
  }

  root.MiniGrid = { COLORS, cell, label, compute, drawMarks, drawGrid };
})(typeof globalThis !== 'undefined' ? globalThis : this);
