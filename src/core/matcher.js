/*
 * Reconnaissance tolérante aux erreurs d'OCR : retrouve un donjon, un boss
 * ou un monstre connu dans un texte lu à l'écran.
 */
'use strict';

function normalize(s) {
  return String(s || '')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'oe').replace(/æ/g, 'ae')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
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

/** Meilleure similarité entre `key` et une fenêtre de mots du texte. */
function bestWindowScore(textWords, key) {
  const keyWords = key.split(' ');
  const k = keyWords.length;
  let best = 0;
  for (let size = Math.max(1, k - 1); size <= k + 1; size++) {
    for (let i = 0; i + size <= textWords.length; i++) {
      const s = similarity(textWords.slice(i, i + size).join(' '), key);
      if (s > best) best = s;
      if (best === 1) return 1;
    }
  }
  return best;
}

function thresholdFor(key) {
  if (key.length < 6) return 1; // mots courts : correspondance exacte
  if (key.length < 10) return 0.84;
  return 0.78;
}

const KIND_PRIORITY = { donjon: 3, boss: 2, entree: 2, monstre: 1 };

/**
 * Construit l'index à partir des fiches.
 * Chaque fiche apporte : nom du donjon, nom du boss, alias, monstres,
 * coordonnées d'entrée.
 */
function buildIndex(bosses) {
  const entries = [];
  const coords = new Map();
  for (const b of bosses) {
    const add = (label, kind, extra) => {
      const key = normalize(label);
      if (key) entries.push({ key, kind, bossId: b.id, label, ...extra });
    };
    if (b.donjon) add(b.donjon, 'donjon');
    if (b.nom) add(b.nom, 'boss');
    for (const al of (b.detection && b.detection.alias) || []) add(al, 'donjon');
    for (const m of b.monstres || []) add(m.nom, 'monstre', { monstre: m.nom });
    for (const c of (b.detection && b.detection.coords) || []) coords.set(c.replace(/\s/g, ''), b.id);
  }
  return { entries, coords };
}

const COORD_RE = /(-?\d{1,3})\s*[,.;]\s*(-?\d{1,3})/g;

function match(text, index) {
  const norm = normalize(text);
  const words = norm.split(' ').filter(Boolean);
  const hits = [];
  for (const e of index.entries) {
    const score = norm.includes(e.key) ? 1 : bestWindowScore(words, e.key);
    if (score >= thresholdFor(e.key)) hits.push({ ...e, score });
  }
  // Coordonnées d'entrée de donjon (ex. « -59,-89 »)
  const raw = String(text || '').replace(/[–—]/g, '-');
  let m;
  COORD_RE.lastIndex = 0;
  while ((m = COORD_RE.exec(raw))) {
    const k = `${parseInt(m[1], 10)},${parseInt(m[2], 10)}`;
    if (index.coords.has(k)) {
      hits.push({ key: k, kind: 'entree', bossId: index.coords.get(k), label: `[${k}]`, score: 1 });
    }
  }
  if (!hits.length) return null;
  hits.sort((x, y) => (y.score - x.score)
    || (KIND_PRIORITY[y.kind] - KIND_PRIORITY[x.kind])
    || (y.key.length - x.key.length));
  return hits[0];
}

/** Recherche manuelle : renvoie les entrées triées par pertinence. */
function search(query, index, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const seen = new Set();
  const out = [];
  const scored = index.entries.map((e) => {
    let score;
    if (e.key.startsWith(q)) score = 2;
    else if (e.key.includes(q)) score = 1.5;
    else score = bestWindowScore(e.key.split(' '), q);
    return { ...e, score };
  }).filter((e) => e.score >= 0.6)
    .sort((x, y) => (y.score - x.score) || (KIND_PRIORITY[y.kind] - KIND_PRIORITY[x.kind]));
  for (const e of scored) {
    const id = `${e.bossId}|${e.monstre || ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { normalize, levenshtein, similarity, buildIndex, match, search };
