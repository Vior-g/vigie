// Régénère src/data/manifest.json (empreintes des données).
// La date (stamp) ne change que si un fichier a changé.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { SCHEMA, computeFiles, readManifest, sameFiles } = require('../src/core/manifest.js');
const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');

const files = computeFiles(dataDir);
const old = readManifest(dataDir);
if (old && old.schema === SCHEMA && sameFiles(old.files, files)) {
  console.log('Manifeste à jour.');
} else {
  const m = { schema: SCHEMA, stamp: new Date().toISOString(), files };
  fs.writeFileSync(path.join(dataDir, 'manifest.json'), `${JSON.stringify(m, null, 1)}\n`);
  console.log(`Manifeste régénéré (${Object.keys(files).length} fichiers).`);
}
