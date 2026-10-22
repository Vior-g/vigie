/*
 * Manifeste des données de Vigie : empreinte de chaque fichier de src/data.
 * Sert à la mise à jour des données sans réinstaller (téléchargement depuis
 * GitHub des seuls fichiers modifiés).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 2;

/** Empreinte indépendante des fins de ligne (Windows convertit en CRLF). */
function hashContent(buf) {
  const s = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  return crypto.createHash('sha1').update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 12);
}

/** Fichiers suivis, chemins relatifs à src/data avec des « / ». */
function listDataFiles(dataDir) {
  const out = [];
  if (fs.existsSync(path.join(dataDir, 'songes.json'))) out.push('songes.json');
  for (const sub of ['generated', 'guides']) {
    const dir = path.join(dataDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.json')) out.push(`${sub}/${f}`);
  }
  return out;
}

function computeFiles(dataDir) {
  const files = {};
  for (const rel of listDataFiles(dataDir)) files[rel] = hashContent(fs.readFileSync(path.join(dataDir, rel)));
  return files;
}

function readManifest(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    return m && m.files ? m : null;
  } catch (e) { return null; }
}

function sameFiles(a, b) {
  const ka = Object.keys(a || {}); const kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

module.exports = { SCHEMA, hashContent, listDataFiles, computeFiles, readManifest, sameFiles };
