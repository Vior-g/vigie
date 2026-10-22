/*
 * Signature des modules embarqués (node_modules de l'appli) : permet de ne
 * télécharger que le code de Vigie quand les dépendances n'ont pas changé.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version || '?'; } catch (e) { return null; }
}

/** Liste triée « nom@version » des paquets d'un dossier node_modules. */
function listPackages(nodeModules) {
  const out = [];
  if (!fs.existsSync(nodeModules)) return out;
  for (const name of fs.readdirSync(nodeModules)) {
    if (name.startsWith('.')) continue;
    const p = path.join(nodeModules, name);
    if (name.startsWith('@')) {
      for (const sub of fs.readdirSync(p)) {
        const v = readVersion(path.join(p, sub));
        if (v) out.push(`${name}/${sub}@${v}`);
      }
    } else {
      const v = readVersion(p);
      if (v) out.push(`${name}@${v}`);
    }
  }
  return out.sort();
}

function depsSignature(nodeModules) {
  return crypto.createHash('sha1').update(listPackages(nodeModules).join('\n')).digest('hex').slice(0, 16);
}

module.exports = { listPackages, depsSignature };
