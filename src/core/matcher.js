/*
 * Reconnaissance tolérante aux erreurs d'OCR, indexée pour des milliers
 * d'entrées (donjons, sous-zones, monstres).
 *  - correspondance exacte par dictionnaire sur des fenêtres de 1 à N mots ;
 *  - correspondance approchée filtrée par trigrammes puis Levenshtein.
 */
'use strict';

function normalize(s) {
  return String(s || '')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'oe').replace(/æ/g, 'ae').replace(/Æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, ' ')
    .replace(/[^a-z0-9-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function similarity(a, b) {
  const m = Math.max(a.length, b.length);
  return m === 0 ? 1 : 1 - levenshtein(a, b) / m;
}

function trigrams(s) {
  const out = new Set();
  const p = ` ${s} `;
  for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  return out;
}

/** Seuil de similarité selon la longueur : les noms courts doivent être exacts. */
function thresholdFor(key) {
  if (key.length < 6) return 1;
  if (key.length < 10) return 0.84;
  return 0.78;
}

class TextIndex {
  constructor() {
    this.entries = [];
    this.exact = new Map();
    this.tri = new Map();
    this.maxWords = 1;
  }

  /** @param {string} label texte tel qu'affiché en jeu ; data : {kind, ref, ...} */
  add(label, data) {
    const key = normalize(label);
    if (!key || key.length < 3) return;
    const e = { key, label, words: key.split(' ').length, ...data };
    const idx = this.entries.push(e) - 1;
    if (!this.exact.has(key)) this.exact.set(key, []);
    this.exact.get(key).push(idx);
    if (e.words > this.maxWords) this.maxWords = e.words;
    if (key.length >= 6) {
      for (const t of trigrams(key)) {
        let l = this.tri.get(t);
        if (!l) { l = []; this.tri.set(t, l); }
        l.push(idx);
      }
    }
  }

  /**
   * Toutes les correspondances trouvées dans le texte, sans chevauchement
   * (la plus longue l'emporte). Retourne [{entry, score, pos}] par position.
   */
  scan(text, { fuzzy = true, kinds = null } = {}) {
    const words = normalize(text).split(' ').filter(Boolean);
    const found = [];
    const allowed = (e) => !kinds || kinds.includes(e.kind);
    for (let i = 0; i < words.length; i++) {
      const maxN = Math.min(this.maxWords + 1, words.length - i);
      for (let n = 1; n <= maxN; n++) {
        const s = words.slice(i, i + n).join(' ');
        const ex = this.exact.get(s);
        if (ex) for (const idx of ex) if (allowed(this.entries[idx])) found.push({ idx, score: 1, pos: i, n });
        if (!fuzzy || s.length < 6) continue;
        const tg = trigrams(s);
        const counts = new Map();
        for (const t of tg) {
          const l = this.tri.get(t);
          if (!l) continue;
          for (const idx of l) counts.set(idx, (counts.get(idx) || 0) + 1);
        }
        const need = Math.max(3, Math.ceil(tg.size * 0.45));
        for (const [idx, c] of counts) {
          if (c < need) continue;
          const e = this.entries[idx];
          if (!allowed(e) || e.key === s) continue;
          if (Math.abs(e.key.length - s.length) > Math.max(2, e.key.length * 0.25)) continue;
          const sc = similarity(s, e.key);
          if (sc >= thresholdFor(e.key)) found.push({ idx, score: sc, pos: i, n });
        }
      }
    }
    // Résolution des chevauchements : le nom le plus long l'emporte, pondéré
    // par la confiance (une lecture exacte bat une lecture approchée du même
    // nom qui déborde sur un mot voisin).
    const weight = (f) => this.entries[f.idx].key.length * f.score;
    found.sort((a, b) => (weight(b) - weight(a)) || (a.n - b.n));
    const used = new Array(words.length).fill(false);
    const out = [];
    for (const f of found) {
      let free = true;
      for (let k = f.pos; k < f.pos + f.n; k++) if (used[k]) { free = false; break; }
      if (!free) continue;
      for (let k = f.pos; k < f.pos + f.n; k++) used[k] = true;
      out.push({ entry: this.entries[f.idx], score: f.score, pos: f.pos, n: f.n });
    }
    return out.sort((a, b) => a.pos - b.pos);
  }

  /** Recherche manuelle (préfixe, contenu, approché). */
  search(query, { limit = 10, kinds = null, rank = null } = {}) {
    const q = normalize(query);
    if (!q) return [];
    const scored = [];
    for (const e of this.entries) {
      if (kinds && !kinds.includes(e.kind)) continue;
      let s = 0;
      if (e.key === q) s = 3;
      else if (e.key.startsWith(q)) s = 2.5;
      else if (e.key.includes(` ${q}`)) s = 2;
      else if (e.key.includes(q)) s = 1.5;
      else if (q.length >= 4) {
        const sim = similarity(q, e.key.slice(0, q.length + 2));
        if (sim >= 0.75) s = sim;
      }
      if (s > 0) scored.push({ e, s: s + (rank ? rank(e) : 0) });
    }
    scored.sort((a, b) => (b.s - a.s) || (a.e.key.length - b.e.key.length));
    const seen = new Set();
    const out = [];
    for (const { e } of scored) {
      const id = `${e.kind}|${e.ref}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }
}

const COORD_RE = /(-?\d{1,3})\s*[,.;]\s*(-?\d{1,3})/g;

/** Coordonnées « x,y » lues dans un texte. */
function coordsIn(text) {
  const raw = String(text || '').replace(/[–—]/g, '-');
  const out = [];
  let m;
  COORD_RE.lastIndex = 0;
  while ((m = COORD_RE.exec(raw))) out.push(`${parseInt(m[1], 10)},${parseInt(m[2], 10)}`);
  return out;
}

module.exports = { normalize, levenshtein, similarity, thresholdFor, TextIndex, coordsIn };
