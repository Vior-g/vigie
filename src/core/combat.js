/*
 * Liste des monstres du combat en cours (mode Combat / Songe).
 * Logique pure : le processus principal garde l'état, ces fonctions le
 * font évoluer. Testable sans Electron.
 */
'use strict';

const MAX = 16;

function emptyCombat(songeLevel = 200) {
  return {
    ids: [], levels: {}, pvRead: {}, aberrations: [], at: 0,
    songe: false, songeManual: null, songeLevel,
    reading: false, info: '', text: '', preview: null,
  };
}

/** PV lus dans une infobulle de combat (« 4 200 / 4 200 »). */
function readPv(text) {
  const re = /(\d{1,3}(?:[ .  ]\d{3})*)\s*\/\s*(\d{1,3}(?:[ .  ]\d{3})*)/g;
  const out = [];
  let m;
  while ((m = re.exec(String(text || '')))) {
    const cur = Number(m[1].replace(/\D/g, ''));
    const max = Number(m[2].replace(/\D/g, ''));
    if (max >= 10 && cur <= max) out.push({ cur, max });
  }
  return out;
}

/**
 * Intègre le résultat d'une lecture d'écran.
 * @param {object} c       état actuel
 * @param {object} found   gd.detectMonsters(text) (+ text brut)
 * @param {object} ctx     { gd, songeFiche, now, mergeWindowMs, replace }
 */
function addScan(c, found, ctx) {
  const { gd } = ctx;
  const now = ctx.now || Date.now();
  const merge = !ctx.replace && now - c.at < (ctx.mergeWindowMs || 120000);
  const base = merge ? c : { ...emptyCombat(c.songeLevel), songeManual: c.songeManual, songe: c.songe };
  // Contexte Songe : fiche Songe ouverte, choix manuel, ou niveau lu qui ne
  // correspond à aucune version connue du monstre (mise à l'échelle).
  const off = Object.values(found.offLevel || {});
  let songe = c.songeManual != null ? c.songeManual : (ctx.songeFiche || off.length > 0 || (merge && c.songe));
  let songeLevel = c.songeLevel;
  if (off.length) songeLevel = Math.max(...off);
  else if (songe) {
    // En Songe, un niveau lu (même s'il correspond à une version connue)
    // donne l'étage pour les monstres dont le niveau n'a pas été lu.
    const read = Object.values(found.levels || {}).filter((l) => l >= 100);
    if (read.length) songeLevel = Math.max(...read);
  }
  let ids = (found.ids || []).map(Number);
  const levels = { ...(merge ? c.levels : {}) };
  const pvRead = { ...(merge ? c.pvRead : {}) };
  if (songe) {
    // En Songe : la version normale du bestiaire, mise au niveau de l'étage.
    ids = ids.map((id) => {
      const ref = gd.monsterIdByName(gd.monsters[id] ? gd.monsters[id].n : '');
      const r = ref ? Number(ref) : id;
      if (found.levels && found.levels[id]) levels[r] = found.levels[id];
      return r;
    });
  } else {
    for (const id of ids) if (found.levels && found.levels[id]) levels[id] = found.levels[id];
  }
  // Une seule fiche lue avec des PV : ce sont les siens (survol en combat).
  const maxes = [...new Set(readPv(found.text).map((p) => p.max))];
  if (ids.length === 1 && maxes.length === 1) pvRead[ids[0]] = maxes[0];
  const list = [...ids.filter((id) => !base.ids.includes(id)), ...base.ids].slice(0, MAX);
  return {
    ...base,
    ids: list, levels, pvRead,
    aberrations: [...new Set([...(found.aberrations || []), ...(merge ? c.aberrations : [])])],
    at: now, songe: !!songe, songeLevel,
    focus: ids[0] || null,
  };
}

/** Vues prêtes à afficher + synthèse du groupe. */
function views(c, gd) {
  const out = [];
  for (const id of c.ids) {
    const L = c.songe ? (c.levels[id] || c.songeLevel) : null;
    const v = L ? gd.scaledView(id, L) : gd.monsterView(id);
    if (!v) continue;
    if (!L && c.levels[id]) v.levelRead = c.levels[id];
    if (c.pvRead[id]) v.pvRead = c.pvRead[id];
    out.push(v);
  }
  return { views: out, summary: gd.groupSummary(out) };
}

module.exports = { emptyCombat, addScan, views, readPv, MAX };
