'use strict';
/*
 * Mises à jour sans réinstaller :
 *  - données (bestiaire, donjons, guides) : seuls les fichiers modifiés sur
 *    GitHub sont téléchargés dans le dossier de l'utilisateur ;
 *  - nouvelle version du logiciel : simple avis dans le panneau.
 * Rien n'est envoyé : uniquement des lectures de fichiers publics GitHub.
 */
const fs = require('fs');
const path = require('path');
const { SCHEMA, hashContent, readManifest } = require('../core/manifest');

const REPO = 'Vior-g/vigie';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/src/data/`;
const RELEASES = `https://api.github.com/repos/${REPO}/releases/latest`;

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

class DataUpdater {
  /**
   * @param {object} o
   * @param {string} o.bundledDir données livrées avec l'appli
   * @param {string} o.cacheDir   données téléchargées
   * @param {(url:string)=>Promise<{ok:boolean,status:number,text:()=>Promise<string>}>} o.fetchFn
   */
  constructor({ bundledDir, cacheDir, fetchFn, rawBase = RAW_BASE, timeoutMs = 15000 }) {
    this.bundledDir = bundledDir;
    this.cacheDir = cacheDir;
    this.fetchFn = fetchFn;
    this.rawBase = rawBase;
    this.timeoutMs = timeoutMs;
  }

  bundled() { return readManifest(this.bundledDir) || { schema: SCHEMA, stamp: '', files: {} }; }

  /** Dossier de données téléchargées à utiliser, ou null s'il est périmé. */
  activeOverlay() {
    const c = readManifest(this.cacheDir);
    if (!c || c.schema !== SCHEMA) return null;
    return c.stamp > this.bundled().stamp ? this.cacheDir : null;
  }

  stamp() {
    const o = this.activeOverlay();
    return o ? readManifest(o).stamp : this.bundled().stamp;
  }

  async get(url) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    try {
      const r = await this.fetchFn(url, ctl ? { signal: ctl.signal } : undefined);
      if (!r.ok) throw new Error(`HTTP ${r.status} sur ${url}`);
      return await r.text();
    } finally {
      if (t) clearTimeout(t);
    }
  }

  /** @returns {Promise<{updated:boolean, changed?:number, stamp?:string, reason?:string}>} */
  async check() {
    const remote = JSON.parse(await this.get(`${this.rawBase}manifest.json`));
    if (!remote || remote.schema !== SCHEMA || !remote.files) return { updated: false, reason: 'format' };
    const bundled = this.bundled();
    const active = this.activeOverlay();
    const current = active ? readManifest(active) : bundled;
    if (!(remote.stamp > current.stamp)) return { updated: false, reason: 'à jour' };

    const staging = `${this.cacheDir}.next`;
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    let downloaded = 0;
    for (const [rel, h] of Object.entries(remote.files)) {
      if (!/^[a-z0-9_-]+(\/[a-z0-9_.-]+)?\.json$/i.test(rel) || rel.includes('..')) continue;
      if (bundled.files[rel] === h) continue; // identique à la version livrée
      const dest = path.join(staging, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const prev = active ? path.join(active, rel) : null;
      if (prev && current.files[rel] === h && fs.existsSync(prev)) {
        fs.copyFileSync(prev, dest);
        continue;
      }
      const text = await this.get(`${this.rawBase}${rel}`);
      if (hashContent(text) !== h) throw new Error(`empreinte inattendue pour ${rel}`);
      JSON.parse(text); // fichier lisible
      fs.writeFileSync(dest, text);
      downloaded++;
    }
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(remote));
    const old = `${this.cacheDir}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    if (fs.existsSync(this.cacheDir)) fs.renameSync(this.cacheDir, old);
    fs.renameSync(staging, this.cacheDir);
    fs.rmSync(old, { recursive: true, force: true });
    return { updated: true, changed: downloaded, stamp: remote.stamp };
  }

  /** Dernière version publiée, si plus récente que `current`. */
  async latestRelease(current) {
    const r = JSON.parse(await this.get(RELEASES));
    if (!r || !r.tag_name || r.draft || r.prerelease) return null;
    return cmpVersion(r.tag_name, current) > 0 ? { version: r.tag_name.replace(/^v/, ''), url: r.html_url } : null;
  }
}

module.exports = { DataUpdater, cmpVersion, RAW_BASE };
