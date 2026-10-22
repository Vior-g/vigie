#!/usr/bin/env node
/*
 * Construit la base de données de Vigie depuis l'API publique DofusDB.
 *   node scripts/build-data.mjs
 * Sorties (src/data/generated/) :
 *   dungeons.json  — tous les donjons : niveau, zone, sous-zones, boss, monstres
 *   monsters.json  — tout le bestiaire : stats du grade max, résistances, sorts
 *   spells.json    — sorts des monstres, effets rendus en texte lisible
 *   subareas.json  — noms des sous-zones (détection) et zones
 *   meta.json      — date, compteurs, source
 * data-probe/ reçoit quelques réponses brutes pour contrôler les formats.
 *
 * Tourne dans GitHub Actions (workflow data.yml) : requêtes séquencées,
 * relances en cas d'erreur, User-Agent explicite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.dofusdb.fr';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'data', 'generated');
const PROBE = path.join(ROOT, 'data-probe');
const PAGE = 50;
const CONCURRENCY = 4;
const UA = 'Vigie/0.2 (overlay Dofus perso ; github.com/Vior-g/vigie)';

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PROBE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let requests = 0;

async function get(pathAndQuery) {
  const url = `${API}${pathAndQuery}`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      requests++;
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { fatal: true });
      return await res.json();
    } catch (e) {
      if (e.fatal || attempt === 6) throw e;
      await sleep(800 * attempt * attempt);
    }
  }
  return null;
}

function qs(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) for (const x of v) parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(x)}`);
    else parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

/** Exécute des tâches avec un parallélisme limité. */
async function pool(items, fn, n = CONCURRENCY) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

/** Récupère toute une collection paginée. */
async function all(endpoint, params = {}, label = endpoint) {
  const first = await get(`/${endpoint}?${qs({ ...params, $limit: PAGE, $skip: 0 })}`);
  const total = first.total ?? first.data.length;
  const skips = [];
  for (let s = PAGE; s < total; s += PAGE) skips.push(s);
  const rest = await pool(skips, (s) => get(`/${endpoint}?${qs({ ...params, $limit: PAGE, $skip: s })}`));
  const data = first.data.concat(...rest.map((r) => r.data));
  console.log(`${label} : ${data.length}/${total}`);
  return data;
}

/** Récupère des objets par identifiants (lots de 50). */
async function byIds(endpoint, ids, params = {}) {
  const uniq = [...new Set(ids.filter((x) => x != null))];
  const chunks = [];
  for (let i = 0; i < uniq.length; i += PAGE) chunks.push(uniq.slice(i, i + PAGE));
  const res = await pool(chunks, (c) => get(`/${endpoint}?${qs({ ...params, 'id[$in]': c, $limit: PAGE })}`));
  const data = res.flatMap((r) => r.data);
  console.log(`${endpoint} (par id) : ${data.length}/${uniq.length}`);
  return data;
}

const fr = (o) => (o && typeof o === 'object' ? (o.fr ?? o.en ?? '') : (o ?? ''));
const probe = (name, v) => fs.writeFileSync(path.join(PROBE, `${name}.json`), JSON.stringify(v, null, 1));

// ------------------------------------------------------------- Effets

const ELEMENTS = ['neutre', 'terre', 'feu', 'eau', 'air'];

const SHAPES = {
  80: null, // P : une case
  67: (p) => `cercle de ${p}`,
  88: (p) => `croix de ${p}`,
  76: (p) => `ligne de ${p}`,
  84: (p) => `ligne perpendiculaire de ${p}`,
  79: (p) => `anneau de ${p}`,
  71: (p) => `carré de ${p}`,
  86: (p) => `cône de ${p}`,
  85: (p) => `demi-cercle de ${p}`,
  68: (p) => `damier de ${p}`,
  81: (p) => `croix creuse de ${p}`,
  35: (p) => `croix diagonale de ${p}`,
  43: (p) => `étoile de ${p}`,
  45: (p) => `ligne diagonale de ${p}`,
  47: (p) => `ligne diagonale de ${p}`,
  65: () => 'tout le terrain',
  97: () => 'tout le terrain',
};

function zoneText(z) {
  if (!z) return '';
  const shape = typeof z.shape === 'string' ? z.shape.charCodeAt(0) : z.shape;
  const f = SHAPES[shape];
  if (!f) return '';
  const p = z.param1 ?? z.size ?? 0;
  if (shape !== 65 && shape !== 97 && !(p > 0)) return '';
  if (p >= 40) return shape === 84 || shape === 76 ? 'toute la ligne' : 'tout le terrain';
  return f(p);
}

/**
 * Rend un modèle de description d'effet Dofus.
 * #1 = diceNum, #2 = diceSide, #3 = value ; {~1~2 à } n'apparaît que si
 * les paramètres cités sont non nuls ; {~ps} = pluriel.
 */
function renderTemplate(tpl, p1, p2, p3, names) {
  if (!tpl) return '';
  const params = { 1: p1, 2: p2, 3: p3 };
  let s = tpl.replace(/\{\{~([^}]*)\}\}|\{~([^}]*)\}/g, (_m, a, b) => {
    const inner = a ?? b;
    const conds = [];
    let rest = inner;
    let m;
    while ((m = /^(\d|p|z|s|m|f|n)(.*)$/.exec(rest))) {
      conds.push(m[1]);
      rest = m[2];
      if (rest.startsWith('~')) rest = rest.slice(1); else break;
    }
    for (const c of conds) {
      if (/\d/.test(c) && !params[c]) return '';
      if (c === 'p' && !(Math.max(p1 || 0, p2 || 0) > 1)) return '';
      if (c === 'z' && (p1 || p2)) return '';
    }
    return rest;
  });
  s = s.replace(/#([123])/g, (_m, d) => {
    const v = params[d];
    if (names && names[d]) return names[d];
    if (v == null || (d === '2' && !v)) return '';
    return String(v);
  });
  return s.replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').trim();
}

/** Les descriptions de sorts de monstres sont souvent vides ou des notes internes. */
function usefulDescription(d) {
  const t = String(d || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (t.length < 30 || /^\(.*\)$/.test(t)) return undefined;
  return t;
}

/** Déclencheurs d'effets (sorts passifs, renvois…). 'I' = immédiat. */
function triggerText(t) {
  if (!t || t === 'I') return '';
  const parts = String(t).split('|');
  const label = (x) => {
    if (x === 'TB') return 'en début de tour';
    if (x === 'TE') return 'en fin de tour';
    if (/^D/.test(x)) return 'quand il subit des dégâts';
    if (/^M/.test(x)) return 'quand il se déplace';
    if (x === 'X') return 'à sa mort';
    return '';
  };
  const l = [...new Set(parts.map(label).filter(Boolean))];
  return l.length ? l.join(' / ') : 'sous condition';
}

// ------------------------------------------------------------- Principal

async function main() {
  const t0 = Date.now();

  // Zones et sous-zones
  const areas = await all('areas', { '$select': ['id', 'name', 'superAreaId'] });
  const areaName = new Map(areas.map((a) => [a.id, fr(a.name)]));
  const subareasRaw = await all('subareas', {});
  probe('subarea-sample', subareasRaw.slice(0, 2).map((s) => ({ ...s, mapIds: (s.mapIds || []).slice(0, 3) })));
  const subareas = {};
  for (const s of subareasRaw) {
    subareas[s.id] = {
      n: fr(s.name),
      a: s.areaId,
      z: areaName.get(s.areaId) || '',
      l: s.level || 0,
      m: Array.isArray(s.monsters) ? s.monsters : undefined,
    };
  }

  // Donjons
  const dungeonsRaw = await all('dungeons', {});
  probe('dungeon-sample', dungeonsRaw.slice(0, 2));
  const someMaps = [];
  for (const d of dungeonsRaw) {
    for (const m of [d.entranceMapId, d.exitMapId, ...(d.mapIds || [])]) if (m) someMaps.push(m);
  }
  const positions = await byIds('map-positions', someMaps, { '$select': ['id', 'posX', 'posY', 'subAreaId'] });
  const posById = new Map(positions.map((p) => [p.id, p]));

  // Bestiaire complet
  const monstersRaw = await all('monsters', {});
  probe('monster-sample', monstersRaw.filter((m) => m.isBoss).slice(0, 2));
  const races = await all('monster-races', {}).catch(() => []);
  const raceName = new Map(races.map((r) => [r.id, fr(r.name)]));

  // Sorts des monstres : niveau de sort correspondant au grade max
  const spellIds = new Set();
  for (const m of monstersRaw) for (const s of m.spells || []) spellIds.add(s);
  const spellsRaw = await byIds('spells', [...spellIds]);
  probe('spell-sample', spellsRaw.slice(0, 3));
  const spellById = new Map(spellsRaw.map((s) => [s.id, s]));
  const wantedLevels = new Set();
  const levelFor = (spell, grade) => {
    const lv = spell && spell.spellLevels;
    if (!Array.isArray(lv) || !lv.length) return null;
    return lv[Math.min(grade, lv.length) - 1];
  };
  for (const m of monstersRaw) {
    const grade = (m.grades || []).length || 1;
    for (const s of m.spells || []) {
      const id = levelFor(spellById.get(s), grade);
      if (id) wantedLevels.add(id);
    }
  }
  const levelsRaw = await byIds('spell-levels', [...wantedLevels]);
  probe('spell-level-sample', levelsRaw.slice(0, 3));
  const levelById = new Map(levelsRaw.map((l) => [l.id, l]));

  // Catalogue des effets et des états
  const effectsRaw = await all('effects', {});
  probe('effect-sample', effectsRaw.filter((e) => [96, 97, 98, 99, 100, 101, 116, 127, 5, 181, 950].includes(e.id)));
  const effectById = new Map(effectsRaw.map((e) => [e.id, e]));
  const states = await all('spell-states', { '$select': ['id', 'name'] }).catch(() => []);
  probe('state-sample', states.slice(0, 5));
  const stateName = new Map(states.map((s) => [s.id, fr(s.name)]));
  const monsterName = new Map(monstersRaw.map((m) => [m.id, fr(m.name)]));

  function effectText(e) {
    const def = effectById.get(e.effectId);
    if (!def) return null;
    // On se fie à la visibilité de l'effet dans le sort (le catalogue masque
    // aussi les retraits PA/PM, poussées, invocations et états).
    if (e.visibleInTooltip === false || e.forClientOnly) return null;
    const tpl = fr(def.description);
    if (!tpl || /^#1$/.test(tpl.trim())) return null;
    const names = {};
    if (/invoque|invocation/i.test(tpl)) names[1] = monsterName.get(e.diceNum) || null;
    if (/état/i.test(tpl)) names[3] = stateName.get(e.value) || null;
    if (/lance le sort|sort #1/i.test(tpl) && spellById.get(e.diceNum)) names[1] = fr(spellById.get(e.diceNum).name);
    let txt = renderTemplate(tpl, e.diceNum, e.diceSide, e.value, names);
    // Balises d'icônes du client (<sprite name="PA">…) et identifiants de sorts.
    txt = txt.replace(/<sprite[^>]*>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    txt = txt.replace(/^(\d{3,6}) :/, (m, id) => (spellById.get(Number(id)) ? `${fr(spellById.get(Number(id)).name)} :` : m));
    if (!txt || /#\d/.test(txt) || /^\d{3,6} :/.test(txt)) return null;
    const zone = zoneText(e.zoneDescr || e.rawZone);
    const dur = e.duration > 0 ? `${e.duration} tour${e.duration > 1 ? 's' : ''}` : '';
    const extra = [zone, dur].filter(Boolean).join(', ');
    if (extra) txt += ` (${extra})`;
    const trig = triggerText(e.triggers);
    if (trig) txt = `${trig} : ${txt}`;
    return txt;
  }

  const spells = {};
  for (const l of levelsRaw) {
    const s = spellById.get(l.spellId);
    if (!s) continue;
    const effects = [];
    for (const e of l.effects || []) {
      const t = effectText(e);
      if (t && !effects.includes(t)) effects.push(t);
    }
    spells[l.id] = {
      n: fr(s.name),
      d: usefulDescription(fr(s.description)),
      pa: l.apCost,
      po: [l.minRange ?? 0, l.range ?? 0],
      mod: l.rangeCanBeBoosted ? 1 : undefined,
      lig: l.castInLine ? 1 : undefined,
      dia: l.castInDiagonal ? 1 : undefined,
      ldv: l.castTestLos === false ? 0 : undefined,
      tour: l.maxCastPerTurn || undefined,
      cib: l.maxCastPerTarget || undefined,
      cd: l.minCastInterval || undefined,
      ini: l.initialCooldown || undefined,
      e: effects.length ? effects : undefined,
    };
  }

  // Monstres
  const monsters = {};
  for (const m of monstersRaw) {
    const g = m.grades || [];
    if (!g.length) continue;
    const first = g[0];
    const last = g[g.length - 1];
    const name = fr(m.name);
    if (!name || /^\[|^test/i.test(name)) continue;
    const spellRefs = [];
    for (const s of m.spells || []) {
      const id = levelFor(spellById.get(s), g.length);
      if (id && spells[id]) spellRefs.push(id);
    }
    // Mise à l'échelle (Songes : le niveau des monstres suit l'étage) :
    // grade de référence et ratio de PV par rapport à un monstre « standard ».
    const ref = g[Math.min(Math.max(1, m.scaleGradeRef || g.length), g.length) - 1];
    const ratio = (id) => {
      for (const x of Array.isArray(m.characRatios) ? m.characRatios : []) {
        if (Array.isArray(x) && x[0] === id) return x[1];
        if (x && typeof x === 'object' && !Array.isArray(x) && (x.key === id || x.id === id)) return x.value ?? x.ratio;
      }
      return undefined;
    };
    const rpv = ratio(0);
    monsters[m.id] = {
      n: name,
      sc: typeof rpv === 'number' && rpv > 0 ? [ref.level, ref.lifePoints, Math.round(rpv * 10000) / 10000] : undefined,
      lv: [first.level, last.level],
      pv: [first.lifePoints, last.lifePoints],
      pa: last.actionPoints,
      pm: last.movementPoints,
      r: [last.reductionNeutral, last.reductionEarth, last.reductionFire, last.reductionWater, last.reductionAir],
      ea: last.paLostDodge,
      em: last.mpLostDodge,
      b: m.isBoss ? 1 : undefined,
      mb: m.isMiniBoss ? 1 : undefined,
      q: m.isQuestMonster ? 1 : undefined,
      race: raceName.get(m.race) || undefined,
      img: m.img || undefined,
      s: spellRefs.length ? spellRefs : undefined,
      sub: Array.isArray(m.subareas) && m.subareas.length ? m.subareas : undefined,
      push: m.canBePushed === false ? 0 : undefined,
      tacle: m.canTackle === false ? 0 : undefined,
      swap: m.canSwitchPos === false ? 0 : undefined,
    };
  }

  // Monstres par sous-zone (deux sources possibles selon l'API)
  const bySub = new Map();
  const link = (sub, mid) => {
    if (!monsters[mid]) return;
    if (!bySub.has(sub)) bySub.set(sub, new Set());
    bySub.get(sub).add(mid);
  };
  for (const [mid, m] of Object.entries(monsters)) for (const s of m.sub || []) link(s, Number(mid));
  for (const [sid, s] of Object.entries(subareas)) for (const mid of s.m || []) link(Number(sid), mid);
  for (const s of Object.values(subareas)) delete s.m;

  const dungeons = [];
  for (const d of dungeonsRaw) {
    const subs = new Set();
    for (const mid of [d.entranceMapId, ...(d.mapIds || [])]) {
      const p = posById.get(mid);
      if (p && p.subAreaId) subs.add(p.subAreaId);
    }
    const mons = new Set();
    for (const s of subs) for (const mid of bySub.get(s) || []) mons.add(mid);
    const list = [...mons].map((id) => ({ id, m: monsters[id] }));
    const bosses = list.filter((x) => x.m.b).map((x) => x.id);
    const entry = posById.get(d.entranceMapId);
    const subNames = [...subs].map((s) => subareas[s] && subareas[s].n).filter(Boolean);
    dungeons.push({
      id: d.id,
      n: fr(d.name),
      lv: d.optimalPlayerLevel || 0,
      z: [...subs].map((s) => subareas[s] && subareas[s].z).find(Boolean) || '',
      sub: [...subs],
      subn: [...new Set(subNames)],
      pos: entry ? [entry.posX, entry.posY] : undefined,
      boss: bosses,
      mon: list.filter((x) => !x.m.b).map((x) => x.id),
    });
  }
  dungeons.sort((a, b) => a.lv - b.lv || a.n.localeCompare(b.n, 'fr'));

  const write = (name, v) => {
    const file = path.join(OUT, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(v));
    console.log(`${name}.json : ${(fs.statSync(file).size / 1e6).toFixed(2)} Mo`);
  };
  write('dungeons', dungeons);
  write('monsters', monsters);
  write('spells', spells);
  write('subareas', subareas);
  const meta = {
    generatedAt: new Date().toISOString(),
    source: 'https://api.dofusdb.fr',
    counts: {
      dungeons: dungeons.length,
      monsters: Object.keys(monsters).length,
      spells: Object.keys(spells).length,
      subareas: Object.keys(subareas).length,
      dungeonsWithoutBoss: dungeons.filter((d) => !d.boss.length).map((d) => d.n),
    },
    requests,
    seconds: Math.round((Date.now() - t0) / 1000),
  };
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
  console.log(JSON.stringify(meta, null, 1));
}

export { renderTemplate, zoneText, triggerText, usefulDescription };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
