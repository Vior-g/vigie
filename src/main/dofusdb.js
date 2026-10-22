'use strict';
/*
 * Statistiques des monstres depuis l'API publique DofusDB, avec cache disque
 * (7 jours). Si l'API ne répond pas, les fiches gardent leurs valeurs
 * intégrées et les monstres s'affichent sans résistances.
 */
const fs = require('fs');
const path = require('path');

const API = 'https://api.dofusdb.fr/monsters';
const TTL = 7 * 24 * 3600 * 1000;

function summarize(m) {
  const grades = m.grades || [];
  const last = grades[grades.length - 1] || {};
  const first = grades[0] || {};
  return {
    id: m.id,
    nom: m.name && m.name.fr,
    image: m.img,
    isBoss: !!m.isBoss,
    niveau: [first.level, last.level],
    pv: [first.lifePoints, last.lifePoints],
    pa: last.actionPoints,
    pm: last.movementPoints,
    res: {
      neutre: last.reductionNeutral,
      terre: last.reductionEarth,
      feu: last.reductionFire,
      eau: last.reductionWater,
      air: last.reductionAir,
    },
    esquivePA: last.paLostDodge,
    esquivePM: last.mpLostDodge,
  };
}

class DofusDb {
  constructor(dir) {
    this.file = path.join(dir, 'dofusdb-cache.json');
    this.cache = {};
    this.pending = new Map();
    try { this.cache = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { this.cache = {}; }
  }

  save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.cache), 'utf8'); } catch (e) { /* ignoré */ }
  }

  async monster(name) {
    const key = name.toLowerCase();
    const hit = this.cache[key];
    if (hit && Date.now() - hit.t < TTL) return hit.v;
    if (this.pending.has(key)) return this.pending.get(key);
    const p = (async () => {
      try {
        const url = `${API}?name.fr=${encodeURIComponent(name)}&lang=fr`;
        const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const m = (json.data || [])[0];
        const v = m ? summarize(m) : null;
        this.cache[key] = { t: Date.now(), v };
        this.save();
        return v;
      } catch (e) {
        return hit ? hit.v : null; // valeur périmée plutôt que rien
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, p);
    return p;
  }

  async many(names) {
    const out = {};
    await Promise.all(names.map(async (n) => { out[n] = await this.monster(n); }));
    return out;
  }
}

module.exports = { DofusDb, summarize };
