/*
 * Données de Vigie : bestiaire et donjons générés (DofusDB), guides de
 * mécaniques, Songes. Construit les fiches et les index de reconnaissance.
 * Sans dépendance à Electron (testable avec Node).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { normalize, similarity, TextIndex, coordsIn } = require('./matcher');

const ELEMENTS = ['neutre', 'terre', 'feu', 'eau', 'air'];

/*
 * Courbe de PV du jeu : PV(niveau) = ratio × 0,9966 × niveau^1,6256.
 * Ajustée sur les données (grade de référence et ratio de PV de chaque
 * monstre) : écart < 3 % sur 33 niveaux de 1 à 212. Sert à estimer les PV
 * d'un monstre mis au niveau de l'étage dans les Songes.
 */
const SCALE_EXP = 1.6256;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

function readDir(dir) {
  const out = [];
  if (!dir || !fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const g = readJson(path.join(dir, f), null);
    if (g) out.push({ slug: f.replace(/\.json$/, ''), g });
  }
  return out;
}

/** Accepte l'ancien format de fiche (clés longues) et le format guide. */
function normalizeGuide(g, slug) {
  if (!g) return null;
  if (g.donjon && !g.dj) {
    return normalizeGuide({
      dj: g.donjon, boss: g.nom, maj: g.maj,
      essentiel: g.essentiel,
      mecaniques: (g.mecaniques || []).map((m) => ({ t: m.titre, x: m.texte })),
      sorts: (g.sortsBoss || []).map((s) => ({ n: s.nom, x: s.texte })),
      monstres: (g.monstres || []).map((m) => ({ n: m.nom, d: m.danger, x: m.texte })),
      strategie: g.strategie, pieges: g.pieges, tours: g.tours,
      succes: (g.succes || []).map((s) => ({ n: s.nom, x: s.texte })),
      acces: g.acces, src: g.sources && g.sources[0] && g.sources[0].url,
      alias: g.detection && g.detection.alias, outil: g.outil, dungeonId: g.dungeonId,
    }, slug);
  }
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  return {
    slug,
    dj: g.dj || '',
    boss: g.boss || '',
    maj: g.maj || null,
    essentiel: arr(g.essentiel),
    mecaniques: arr(g.mecaniques).filter((m) => m.t || m.x),
    sorts: arr(g.sorts),
    monstres: arr(g.monstres),
    strategie: arr(g.strategie),
    pieges: arr(g.pieges),
    tours: arr(g.tours).map((t) => ({ ...t, every: t.every || 1 })),
    succes: arr(g.succes),
    acces: arr(g.acces),
    note: g.note || null,
    src: g.src || null,
    alias: arr(g.alias),
    outil: g.outil || null,
    dungeonId: g.dungeonId || null,
  };
}

/** Effets de sorts : retire les balises du client et les espaces superflus. */
function cleanText(t) {
  return String(t || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').replace(/\s+([,.:)])/g, '$1').trim();
}

function cleanSpell(sp) {
  return { ...sp, d: sp.d ? cleanText(sp.d) : sp.d, e: (sp.e || []).map(cleanText).filter(Boolean) };
}

class GameData {
  /**
   * @param {object} o
   * @param {string} o.dataDir données fournies avec l'appli (src/data)
   * @param {string} [o.overlayDir] données plus récentes téléchargées
   * @param {string} [o.userDir] guides perso de l'utilisateur
   */
  constructor({ dataDir, overlayDir = null, userDir = null }) {
    this.dataDir = dataDir;
    this.overlayDir = overlayDir;
    this.userDir = userDir;
    this.load();
  }

  file(rel) {
    if (this.overlayDir) {
      const p = path.join(this.overlayDir, rel);
      if (fs.existsSync(p)) return p;
    }
    return path.join(this.dataDir, rel);
  }

  load() {
    this.dungeons = readJson(this.file('generated/dungeons.json'), []);
    this.monsters = readJson(this.file('generated/monsters.json'), {});
    this.spells = readJson(this.file('generated/spells.json'), {});
    this.subareas = readJson(this.file('generated/subareas.json'), {});
    this.meta = readJson(this.file('generated/meta.json'), {});
    this.songes = readJson(this.file('songes.json'), null);
    const guides = new Map();
    for (const { slug, g } of readDir(path.join(this.dataDir, 'guides'))) guides.set(slug, { ...normalizeGuide(g, slug), perso: false });
    if (this.overlayDir) for (const { slug, g } of readDir(path.join(this.overlayDir, 'guides'))) guides.set(slug, { ...normalizeGuide(g, slug), perso: false });
    for (const { slug, g } of readDir(this.userDir)) guides.set(slug, { ...normalizeGuide(g, slug), perso: true });
    this.guides = guides;
    this.buildMonsterNames();
    this.buildFiches();
    this.buildIndexes();
  }

  // ------------------------------------------------------------ monstres

  /** Un nom → le monstre « de référence » (hors copies de quête). */
  buildMonsterNames() {
    const byName = new Map();
    const inDungeon = new Set();
    const expe = (n) => /^expedition/.test(normalize(n));
    for (const d of this.dungeons) {
      if (expe(d.n)) continue;
      for (const id of [...(d.boss || []), ...(d.mon || [])]) inDungeon.add(String(id));
    }
    const realSub = (m) => (m.sub || []).some((x) => this.subareas[x] && !expe(this.subareas[x].n));
    // Plusieurs monstres portent le même nom (versions de quête, de défi,
    // d'événement…) : on garde la version « normale » du bestiaire.
    const rank = (id, m) => {
      let r = (m.q ? 0 : 100) + (inDungeon.has(id) ? 30 : 0) + (realSub(m) ? 15 : 0) + (m.s && m.s.length ? 20 : 0) + (m.b ? 5 : 0);
      const lv = m.lv ? m.lv[1] || 0 : 0;
      if (lv > 300) r -= 60;
      if (m.r && Math.min(...m.r) >= 200) r -= 60;
      return r + Math.min(lv, 300) / 1000;
    };
    for (const [id, m] of Object.entries(this.monsters)) {
      const k = normalize(m.n);
      const cur = byName.get(k);
      if (!cur || rank(id, m) > rank(cur, this.monsters[cur])) byName.set(k, id);
    }
    this.monsterByName = byName;
    // Variantes du même nom (expéditions niv. 200+, utiles en Songe).
    this.variants = new Map();
    for (const [id, m] of Object.entries(this.monsters)) {
      if (m.q || !(m.s && m.s.length)) continue;
      // Les invocations de classe (Tofu d'Osamodas…) et les copies niv. 1
      // du tutoriel ne sont pas des versions du monstre.
      if (/^invocations de classe/.test(normalize(m.race || ''))) continue;
      if ((m.lv[1] || 0) <= 6 && String(this.monsterByName.get(normalize(m.n))) !== String(id)) continue;
      const k = normalize(m.n);
      if (!this.variants.has(k)) this.variants.set(k, []);
      this.variants.get(k).push(Number(id));
    }
    for (const l of this.variants.values()) l.sort((a, b) => (this.monsters[a].lv[1] || 0) - (this.monsters[b].lv[1] || 0));
    this.aberrations = new Map();
    for (const a of (this.songes && this.songes.aberrations) || []) this.aberrations.set(normalize(a.boss), a);
    // Conseils des guides sur chaque monstre (utile en Songe, où les monstres
    // de tout le jeu se mélangent).
    this.monsterNotes = new Map();
    for (const g of this.guides.values()) {
      for (const m of g.monstres || []) {
        const k = normalize(m.n);
        if (!k || !m.x) continue;
        const cur = this.monsterNotes.get(k);
        if (!cur || (m.d === 'haut' && cur.d !== 'haut')) this.monsterNotes.set(k, { x: m.x, d: m.d || 'moyen', from: g.dj });
      }
    }
  }

  monsterIdByName(name) {
    return this.monsterByName.get(normalize(name)) || null;
  }

  /** Version de plus haut niveau d'un monstre (Songes : niveaux 200+). */
  highVariant(id) {
    const m = this.monsters[id];
    if (!m) return Number(id);
    const l = this.variants.get(normalize(m.n)) || [];
    const top = l[l.length - 1];
    return top && (this.monsters[top].lv[1] || 0) > (m.lv[1] || 0) ? top : Number(id);
  }

  /** Vue complète d'un monstre pour l'interface. */
  monsterView(id) {
    const m = this.monsters[id];
    if (!m) return null;
    const res = {};
    ELEMENTS.forEach((e, i) => { res[e] = m.r ? m.r[i] : null; });
    const spells = (m.s || []).map((sid) => this.spells[sid]).filter(Boolean).map(cleanSpell);
    const flags = [];
    if (m.push === 0) flags.push('Non poussable');
    if (m.tacle === 0) flags.push('Ne tacle pas');
    if (m.swap === 0) flags.push('Pas d\'échange de place');
    const ab = this.aberrations.get(normalize(m.n));
    const note = this.monsterNotes.get(normalize(m.n)) || null;
    return {
      id: Number(id), nom: m.n, niveau: m.lv, pv: m.pv, pa: m.pa, pm: m.pm, res,
      esquivePA: m.ea, esquivePM: m.em, boss: !!m.b, miniBoss: !!m.mb, race: m.race || '',
      image: m.img || null, flags, spells,
      ficheId: this.bossFiche.get(Number(id)) || null,
      aberration: ab ? ab.x : null,
      note: note ? note.x : null, danger: note ? note.d : null, noteFrom: note ? note.from : null,
      variants: (this.variants.get(normalize(m.n)) || []).map((v) => ({
        id: v, lv: this.monsters[v].lv,
        expe: (this.monsters[v].sub || []).length > 0 && (this.monsters[v].sub || []).every((x) => this.subareas[x] && /^expedition/.test(normalize(this.subareas[x].n))),
      })),
    };
  }

  /** PV estimés d'un monstre au niveau L (Songes : le niveau suit l'étage). */
  pvAtLevel(id, L) {
    const m = this.monsters[id];
    if (!m || !L) return null;
    const [lref, pref] = m.sc ? [m.sc[0], m.sc[1]] : [m.lv[1], (m.pv || [])[1]];
    if (!lref || !pref || pref <= 1) return null;
    return Math.round((pref * (L / lref) ** SCALE_EXP) / 10) * 10;
  }

  /**
   * Vue d'un monstre mis au niveau L (Songe) : PV estimés avec la courbe de
   * mise à l'échelle du jeu ; résistances, PA, PM et sorts inchangés.
   */
  scaledView(id, L) {
    const v = this.monsterView(id);
    if (!v || !L) return v;
    const pv = this.pvAtLevel(id, L);
    return {
      ...v, niveau: [L, L], pv: pv ? [pv, pv] : v.pv,
      scaled: { level: L, baseLevel: v.niveau, basePv: v.pv, estimated: !!pv },
    };
  }

  /**
   * Synthèse d'un groupe : résistance moyenne par élément (pondérée par les
   * PV) et éléments conseillés. Accepte des identifiants ou des vues.
   */
  groupSummary(items) {
    const views = items.map((x) => (typeof x === 'object' ? x : this.monsterView(x))).filter((v) => v && v.res && v.res.neutre != null);
    if (!views.length) return null;
    const tot = {}; let wsum = 0;
    for (const e of ELEMENTS) tot[e] = 0;
    for (const v of views) {
      const w = Math.max(1, (v.pv && v.pv[1]) || 1);
      wsum += w;
      for (const e of ELEMENTS) tot[e] += Math.max(-100, Math.min(100, v.res[e] || 0)) * w;
    }
    const avg = {};
    for (const e of ELEMENTS) avg[e] = Math.round(tot[e] / wsum);
    const sorted = [...ELEMENTS].sort((a, b) => avg[a] - avg[b]);
    return { avg, best: sorted.filter((e) => avg[e] <= avg[sorted[0]] + 3), worst: sorted[sorted.length - 1], count: views.length };
  }

  // -------------------------------------------------------------- fiches

  buildFiches() {
    this.fiches = new Map();
    this.bossFiche = new Map();
    const isExpe = (d) => /^expedition/.test(normalize(d.n));
    const byName = new Map();
    const bySub = new Map();
    for (const d of this.dungeons) {
      byName.set(normalize(d.n), d);
      for (const s of d.subn || []) if (!bySub.has(normalize(s))) bySub.set(normalize(s), d);
    }
    const bossNamed = (d, name) => (d.boss || []).some((id) => this.monsters[id] && normalize(this.monsters[id].n) === normalize(name));

    // 1) Donjon visé par chaque guide : id explicite, nom exact, sous-zone,
    //    nom approché, puis boss.
    const target = new Map(); // slug -> dungeon
    for (const g of this.guides.values()) {
      const k = normalize(g.dj);
      let d = g.dungeonId ? this.dungeons.find((x) => x.id === g.dungeonId) : null;
      if (!d) d = byName.get(k) || null;
      if (!d) d = bySub.get(k) || null;
      if (!d) {
        let best = null; let bs = 0;
        for (const x of this.dungeons) {
          if (isExpe(x)) continue;
          const sc = similarity(k, normalize(x.n));
          if (sc > bs) { bs = sc; best = x; }
        }
        if (bs >= 0.86) d = best;
      }
      if (!d && g.boss) d = this.dungeons.find((x) => !isExpe(x) && bossNamed(x, g.boss)) || null;
      if (d) target.set(g.slug, d);
    }
    // 2) Un donjon peut recevoir plusieurs guides (deux boss dans la même
    //    instance) : le guide principal est celui du boss qui donne son nom au
    //    donjon, les autres deviennent des fiches secondaires.
    const primary = new Map(); // dungeonId -> guide
    const secondary = [];
    const groups = new Map();
    for (const [slug, d] of target) {
      if (!groups.has(d.id)) groups.set(d.id, []);
      groups.get(d.id).push(this.guides.get(slug));
    }
    for (const [did, gs] of groups) {
      const d = this.dungeons.find((x) => x.id === did);
      let main = gs[0];
      if (gs.length > 1) {
        const nb = this.mainBoss(d, null);
        const nbName = nb ? normalize(this.monsters[nb].n) : '';
        main = gs.find((g) => normalize(g.dj) === normalize(d.n))
          || gs.find((g) => normalize(g.boss) === nbName)
          || gs[0];
      }
      primary.set(did, main);
      for (const g of gs) if (g !== main) secondary.push({ g, d });
    }
    const used = new Set([...target.keys()]);

    const add = (fiche) => {
      this.fiches.set(fiche.id, fiche);
      if (fiche.bossId && (fiche.guideVia === 'donjon' || !this.bossFiche.has(fiche.bossId))) this.bossFiche.set(fiche.bossId, fiche.id);
    };

    // 3) Fiches des donjons guidés, puis rattachement par boss (expéditions).
    const guideByBossName = new Map();
    for (const g of this.guides.values()) if (g.boss) guideByBossName.set(normalize(g.boss), g);
    const makeDungeonFiche = (d, g, via) => {
      const main = this.mainBoss(d, g);
      return {
        id: `d${d.id}`, type: 'donjon', dungeonId: d.id,
        donjon: d.n, zone: d.z || '', niveau: d.lv || 0, pos: d.pos || null,
        bossId: main ? Number(main) : null,
        nom: main ? this.monsters[main].n : d.n,
        bossIds: (d.boss || []).map(Number),
        monsterIds: (d.mon || []).map(Number),
        guide: g, guideVia: g ? via : null,
        outil: g && g.outil ? g.outil : null,
        subn: d.subn || [],
      };
    };
    for (const d of this.dungeons) {
      const g = primary.get(d.id);
      if (!g) continue;
      const f = makeDungeonFiche(d, g, 'donjon');
      add(f);
      if (f.bossId) guideByBossName.set(normalize(f.nom), g);
    }
    for (const d of this.dungeons) {
      if (primary.has(d.id)) continue;
      const main = this.mainBoss(d, null);
      const g = main ? guideByBossName.get(normalize(this.monsters[main].n)) || null : null;
      add(makeDungeonFiche(d, g, 'boss'));
    }
    // 4) Fiches secondaires (second boss d'une instance) et guides sans donjon.
    for (const { g, d } of secondary) {
      const bid = (d.boss || []).find((id) => this.monsters[id] && normalize(this.monsters[id].n) === normalize(g.boss)) || this.monsterIdByName(g.boss);
      add({
        id: `g:${g.slug}`, type: 'donjon', dungeonId: d.id, donjon: g.dj, zone: d.z || '', niveau: d.lv || 0, pos: null,
        bossId: bid ? Number(bid) : null, nom: bid ? this.monsters[bid].n : g.boss,
        bossIds: bid ? [Number(bid)] : [], monsterIds: (d.mon || []).map(Number),
        guide: g, guideVia: 'donjon', outil: g.outil,
        subn: (d.subn || []).filter((s) => similarity(normalize(s), normalize(g.dj)) >= 0.8),
      });
    }
    for (const g of this.guides.values()) {
      if (used.has(g.slug)) continue;
      const bid = g.boss ? this.monsterIdByName(g.boss) : null;
      add({
        id: `g:${g.slug}`, type: 'donjon', dungeonId: null, donjon: g.dj, zone: '', niveau: bid ? (this.monsters[bid].lv || [0])[0] : 0,
        pos: null, bossId: bid ? Number(bid) : null, nom: bid ? this.monsters[bid].n : (g.boss || g.dj),
        bossIds: bid ? [Number(bid)] : [], monsterIds: [],
        guide: g, guideVia: 'donjon', outil: g.outil, subn: [],
      });
    }
    // 5) Songes.
    if (this.songes) {
      this.fiches.set('songes', { id: 'songes', type: 'songe', nom: this.songes.nom, donjon: 'Rêve du Monde des Douze', zone: '', niveau: 200, songes: this.songes });
    }
  }

  /** Boss principal d'un donjon (celui du guide, sinon celui qui donne son nom). */
  mainBoss(d, g) {
    const bosses = (d.boss || []).filter((id) => this.monsters[id]);
    if (g && g.boss) {
      const k = normalize(g.boss);
      const hit = bosses.find((id) => normalize(this.monsters[id].n) === k);
      if (hit) return hit;
    }
    const dn = normalize(d.n);
    const named = bosses.filter((id) => dn.includes(normalize(this.monsters[id].n)));
    if (named.length) return named.sort((a, b) => normalize(this.monsters[b].n).length - normalize(this.monsters[a].n).length)[0];
    if (!bosses.length) return null;
    return bosses.sort((a, b) => (this.monsters[b].lv[1] || 0) - (this.monsters[a].lv[1] || 0))[0];
  }

  /** Fiche prête à afficher (boss et monstres résolus). */
  ficheView(id) {
    const f = this.fiches.get(id);
    if (!f) return null;
    if (f.type === 'songe') {
      const avis = (f.songes.avis || []).map((n) => ({ nom: n, id: this.monsterIdByName(n) ? Number(this.monsterIdByName(n)) : null }));
      return { ...f, songes: { ...f.songes, avis } };
    }
    const notes = new Map();
    for (const m of (f.guide && f.guide.monstres) || []) notes.set(normalize(m.n), m);
    const withNote = (v) => {
      if (!v) return v;
      const n = notes.get(normalize(v.nom));
      return n ? { ...v, note: n.x, danger: n.d || 'moyen' } : v;
    };
    const ordered = [f.bossId, ...f.bossIds.filter((b) => b !== f.bossId)].filter(Boolean);
    const bosses = ordered.map((b) => this.monsterView(b)).filter(Boolean);
    const monsters = f.monsterIds.map((m) => withNote(this.monsterView(m))).filter(Boolean)
      .sort((a, b) => ((b.danger === 'haut') - (a.danger === 'haut')) || ((b.note ? 1 : 0) - (a.note ? 1 : 0)) || a.nom.localeCompare(b.nom, 'fr'));
    // Notes du guide sur des monstres absents des données (invocations…).
    const known = new Set(monsters.map((m) => normalize(m.nom)));
    const extra = ((f.guide && f.guide.monstres) || []).filter((m) => !known.has(normalize(m.n)) && normalize(m.n) !== normalize(f.nom))
      .map((m) => ({ nom: m.n, note: m.x, danger: m.d || 'moyen', id: this.monsterIdByName(m.n) ? Number(this.monsterIdByName(m.n)) : null }));
    return { ...f, bosses, monsters, extraNotes: extra };
  }

  // ------------------------------------------------------------- index

  buildIndexes() {
    // Détection de la map (lecture continue du coin haut-gauche).
    const map = new TextIndex();
    const subCount = new Map();
    for (const d of this.dungeons) for (const s of new Set((d.subn || []).map(normalize))) subCount.set(s, (subCount.get(s) || 0) + 1);
    for (const f of this.fiches.values()) {
      if (f.type === 'songe') {
        for (const n of f.songes.detection || []) map.add(n, { kind: 'songe', ref: f.id });
        continue;
      }
      map.add(f.donjon, { kind: 'donjon', ref: f.id, prio: 3 });
      for (const s of f.subn || []) {
        if (f.id.startsWith('g:')) { map.add(s, { kind: 'donjon', ref: f.id, prio: 3 }); continue; }
        if (subCount.get(normalize(s)) === 1 && similarity(normalize(s), normalize(f.donjon)) < 0.8 && ![...this.fiches.values()].some((o) => o.id.startsWith('g:') && o.dungeonId === f.dungeonId && (o.subn || []).includes(s))) map.add(s, { kind: 'zone', ref: f.id, prio: 2 });
        else if (similarity(normalize(s), normalize(f.donjon)) >= 0.8) map.add(s, { kind: 'donjon', ref: f.id, prio: 3 });
      }
      for (const a of (f.guide && f.guide.alias) || []) map.add(a, { kind: 'donjon', ref: f.id, prio: 3 });
    }
    this.mapIndex = map;
    const coords = new Map();
    const dupes = new Set();
    for (const f of this.fiches.values()) {
      if (!f.pos || /expedition/i.test(normalize(f.donjon))) continue;
      const k = `${f.pos[0]},${f.pos[1]}`;
      if (coords.has(k)) dupes.add(k); else coords.set(k, f.id);
    }
    for (const k of dupes) coords.delete(k);
    this.coordIndex = coords;

    // Noms de monstres (lecture à la demande en combat / en Songe).
    const mons = new TextIndex();
    for (const [k, id] of this.monsterByName) mons.add(this.monsters[id].n, { kind: 'monstre', ref: Number(id), norm: k });
    for (const a of (this.songes && this.songes.aberrations) || []) mons.add(`Aberration de ${a.boss}`, { kind: 'aberration', ref: a.boss });
    this.monsterIndex = mons;

    // Recherche manuelle : donjons + monstres.
    const search = new TextIndex();
    for (const f of this.fiches.values()) {
      if (f.type === 'songe') { search.add(f.nom, { kind: 'songe', ref: f.id, sub: 'Mode Songe' }); continue; }
      const sub = `${f.niveau ? `niv. ${f.niveau}` : ''}${f.guide ? ' · guide' : ''}`;
      search.add(f.donjon, { kind: 'donjon', ref: f.id, sub, hasGuide: !!f.guide });
      if (f.nom && f.nom !== f.donjon) search.add(f.nom, { kind: 'boss', ref: f.id, sub: f.donjon, hasGuide: !!f.guide });
    }
    for (const [, id] of this.monsterByName) {
      const m = this.monsters[id];
      if (m.q) continue;
      search.add(m.n, { kind: 'monstre', ref: Number(id), sub: `niv. ${m.lv[0] === m.lv[1] ? m.lv[0] : `${m.lv[0]}-${m.lv[1]}`}${m.b ? ' · boss' : ''}` });
    }
    this.searchIndex = search;
  }

  /** Lecture du coin haut-gauche : donjon, zone, Songe ou coordonnées. */
  detectMap(text) {
    const hits = this.mapIndex.scan(text);
    const prio = { songe: 4, donjon: 3, zone: 2 };
    hits.sort((a, b) => (b.score - a.score) || ((prio[b.entry.kind] || 0) - (prio[a.entry.kind] || 0)) || (b.entry.key.length - a.entry.key.length));
    if (hits.length) return { ficheId: hits[0].entry.ref, label: hits[0].entry.label, kind: hits[0].entry.kind, score: hits[0].score };
    for (const c of coordsIn(text)) {
      if (this.coordIndex.has(c)) return { ficheId: this.coordIndex.get(c), label: `[${c}]`, kind: 'entree', score: 1 };
    }
    return null;
  }

  /** Variante d'un monstre correspondant au niveau lu (ou la plus proche). */
  variantForLevel(id, level) {
    const m = this.monsters[id];
    if (!m || !level) return null;
    const l = this.variants.get(normalize(m.n)) || [Number(id)];
    let best = null; let bd = Infinity;
    for (const v of l) {
      const [a, b] = this.monsters[v].lv || [0, 0];
      const d = level < a ? a - level : level > b ? level - b : 0;
      if (d < bd) { bd = d; best = v; }
    }
    // Un nombre trop éloigné de tous les niveaux connus n'est pas un niveau
    // d'une version existante (en Songe, le niveau suit l'étage).
    return bd <= 20 ? best : null;
  }

  /**
   * Lecture à la demande : monstres et Aberrations présents dans un texte.
   * Un nombre juste après un nom (« Craqueleur (210) ») est pris comme niveau
   * pour choisir la bonne version du monstre.
   */
  detectMonsters(text) {
    const hits = this.monsterIndex.scan(text);
    const words = normalize(text).split(' ').filter(Boolean);
    const ids = [];
    const aberrations = [];
    const levels = {};
    const offLevel = {};
    for (const h of hits) {
      if (h.entry.kind === 'aberration') { if (!aberrations.includes(h.entry.ref)) aberrations.push(h.entry.ref); continue; }
      let level = null;
      for (let k = h.pos + (h.n || 1); k < Math.min(words.length, h.pos + (h.n || 1) + 3); k++) {
        if (/^\d{1,3}$/.test(words[k])) {
          // « 4 200 » : nombre à séparateur de milliers (PV), pas un niveau.
          const v = Number(words[k]);
          if (v >= 1 && v <= 400 && !/^\d{3}$/.test(words[k + 1] || '')) level = v;
          break;
        }
        if (!/^(niv|niveau|lvl|lv|n)$/.test(words[k])) break;
      }
      const byLevel = level ? this.variantForLevel(h.entry.ref, level) : null;
      const id = byLevel || Number(h.entry.ref);
      if (!ids.includes(id)) ids.push(id);
      if (byLevel) levels[id] = level;
      // Niveau lu qui ne correspond à aucune version connue : monstre mis à
      // l'échelle (Songe).
      else if (level && level >= 100) { levels[id] = level; offLevel[id] = level; }
    }
    return { ids, aberrations, levels, offLevel };
  }

  search(q, limit = 12) {
    const kindRank = { songe: 0.3, boss: 0.25, donjon: 0.2, monstre: 0 };
    return this.searchIndex.search(q, { limit, rank: (e) => (kindRank[e.kind] || 0) + (e.hasGuide ? 0.1 : 0) })
      .map((e) => ({ kind: e.kind, ref: e.ref, label: e.label, sub: e.sub || '' }));
  }

  stats() {
    let withGuide = 0;
    for (const f of this.fiches.values()) if (f.guide) withGuide++;
    return {
      dungeons: this.dungeons.length, monsters: Object.keys(this.monsters).length,
      spells: Object.keys(this.spells).length, guides: this.guides.size, fichesWithGuide: withGuide,
      generatedAt: this.meta.generatedAt || null,
    };
  }
}

module.exports = { GameData, normalizeGuide, cleanText, ELEMENTS, SCALE_EXP };
