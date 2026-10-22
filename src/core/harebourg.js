/*
 * Géométrie de la confusion horaire du Comte Harebourg.
 *
 * Repère : la grille isométrique de Dofus. Chaque case est un losange de
 * largeur w et de hauteur h = w / 2. On repère une case par (a, b) :
 *   - a : axe « bas-droite » (vecteur écran (+w/2, +h/2))
 *   - b : axe « haut-droite » (vecteur écran (+w/2, -h/2))
 * Dans ce repère, les losanges deviennent des carrés unitaires : arrondir
 * a et b donne exactement la case sous le curseur.
 *
 * Rotation « horaire » = sens des aiguilles d'une montre à l'écran.
 * On la code en quarts de tour horaires q ∈ {0,1,2,3}.
 */
(function (root) {
  'use strict';

  const ROT = { aucune: 0, horaire: 1, demi: 2, antihoraire: 3 };
  const ROT_LABEL = ['Aucune déviation', '90° horaire', '180°', '90° anti-horaire'];

  function mod4(n) { return ((n % 4) + 4) % 4; }

  /** Rotation de q quarts de tour horaires autour de l'origine. */
  function rotate(cell, q) {
    let { a, b } = cell;
    for (let i = 0; i < mod4(q); i++) {
      const na = b; const nb = -a; // horaire : (a,b) -> (b,-a)
      a = na; b = nb;
    }
    return { a: a + 0, b: b + 0 }; // +0 évite les -0
  }

  /**
   * Rotation effective : base (selon les PV) + 1/4 de tour anti-horaire par
   * ligne de dégâts infligée au corps à corps (max 10 prises en compte).
   * meleeDir = -1 (anti-horaire, valeur des guides) ou +1 si l'on constate
   * l'inverse en jeu.
   */
  function effectiveRotation(baseQ, meleeLines, meleeDir) {
    const n = Math.max(0, Math.min(10, meleeLines | 0));
    const dir = meleeDir === 1 ? 1 : -1;
    return mod4(baseQ + dir * n);
  }

  /**
   * Case à viser pour toucher `target` quand on se trouve sur `me`.
   * Le sort réellement lancé arrive en R(clic - moi) + moi, donc
   * clic = R⁻¹(cible - moi) + moi.
   */
  function aimCell(me, target, q) {
    const d = { a: target.a - me.a, b: target.b - me.b };
    const r = rotate(d, mod4(-q));
    return { a: me.a + r.a, b: me.b + r.b };
  }

  /** Case où tombe le sort si l'on clique directement sur `clicked`. */
  function landingCell(me, clicked, q) {
    const d = { a: clicked.a - me.a, b: clicked.b - me.b };
    const r = rotate(d, q);
    return { a: me.a + r.a, b: me.b + r.b };
  }

  /** Distance en cases (PO) entre deux cases, norme de Manhattan sur la grille. */
  function distance(c1, c2) {
    return Math.abs(c1.a - c2.a) + Math.abs(c1.b - c2.b);
  }

  /** Vrai si deux cases sont alignées (ligne) ou en diagonale à l'écran. */
  function alignment(c1, c2) {
    const da = c1.a - c2.a; const db = c1.b - c2.b;
    if (da === 0 || db === 0) return 'ligne';
    if (Math.abs(da) === Math.abs(db)) return 'diagonale';
    return null;
  }

  // ---- Conversion écran <-> grille -------------------------------------

  /** Pixel -> coordonnées (a, b) non arrondies. */
  function pixelToGrid(p, origin, w) {
    const h = w / 2;
    const dx = p.x - origin.x; const dy = p.y - origin.y;
    return { a: dx / w + dy / h, b: dx / w - dy / h };
  }

  function snap(g) { return { a: Math.round(g.a), b: Math.round(g.b) }; }

  /** Case (a, b) -> centre en pixels. */
  function gridToPixel(c, origin, w) {
    const h = w / 2;
    return { x: origin.x + (c.a + c.b) * w / 2, y: origin.y + (c.a - c.b) * h / 2 };
  }

  /** Les 4 sommets du losange d'une case, pour le dessin. */
  function diamond(c, origin, w) {
    const p = gridToPixel(c, origin, w); const h = w / 2;
    return [
      { x: p.x, y: p.y - h / 2 },
      { x: p.x + w / 2, y: p.y },
      { x: p.x, y: p.y + h / 2 },
      { x: p.x - w / 2, y: p.y },
    ];
  }

  /**
   * Choisit la rotation de base d'après le % de PV et la table de paliers
   * (modifiable dans les réglages). Renvoie null si aucun palier ne colle.
   */
  function rotationFromHp(hpPercent, tiers) {
    const v = Number(hpPercent);
    if (!Number.isFinite(v)) return null;
    for (const t of tiers || []) {
      if (v >= t.min && v <= t.max) return ROT[t.rotation] ?? null;
    }
    return null;
  }

  const DEFAULT_TIERS = [
    { min: 91, max: 100, rotation: 'horaire' },
    { min: 75, max: 90, rotation: 'antihoraire' },
    { min: 46, max: 74, rotation: 'demi' },
    { min: 31, max: 45, rotation: 'antihoraire' },
    { min: 0, max: 30, rotation: 'horaire' },
  ];

  const api = {
    ROT, ROT_LABEL, DEFAULT_TIERS,
    rotate, effectiveRotation, aimCell, landingCell, distance, alignment,
    pixelToGrid, snap, gridToPixel, diamond, rotationFromHp,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Harebourg = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
