// Prépare les fichiers de mise à jour d'une Release :
//   node scripts/release-meta.mjs <dossier de l'appli empaquetée> <sortie>
// Écrit vigie-update.json (version, Electron, signature des modules) et
// release-notes.md (section de CHANGELOG.md pour cette version).
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);
const { depsSignature, listPackages } = require('../src/core/depsig.js');
const [appDir, outDir] = process.argv.slice(2);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const electron = JSON.parse(fs.readFileSync('node_modules/electron/package.json', 'utf8')).version;
const nm = path.join(appDir, 'node_modules');
const meta = {
  version: pkg.version,
  electron,
  deps: depsSignature(nm),
  packages: listPackages(nm),
  assets: { app: 'vigie-app.zip', modules: 'vigie-modules.zip', full: 'Vigie-win-x64.zip' },
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'vigie-update.json'), `${JSON.stringify(meta, null, 1)}\n`);

let notes = '';
try {
  const log = fs.readFileSync('CHANGELOG.md', 'utf8');
  const re = new RegExp(`^## ${pkg.version.replace(/\./g, '\\.')}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm');
  const m = log.match(re);
  if (m) notes = m[1].trim();
} catch (e) { /* pas de journal */ }
fs.writeFileSync(path.join(outDir, 'release-notes.md'), `${notes || `Vigie ${pkg.version}`}\n`);
console.log(`Electron ${electron}, modules ${meta.deps} (${meta.packages.length} paquets), notes : ${notes ? 'oui' : 'non'}`);
