/*
 * Test du paquet construit, isolé du dossier du projet.
 *   node test/smoke-packaged.js <dossier de l'appli empaquetée>
 * Le dossier doit être COPIÉ hors du projet avant le test : sinon Node
 * retrouve les modules manquants dans le node_modules du projet et le test
 * passe à tort.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { PNG } = require('pngjs');
const P = require('../src/core/preprocess');

const appDir = path.resolve(process.argv[2] || '');
const projectDir = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(appDir, 'package.json'))) {
  console.error(`Dossier d'appli invalide : ${appDir}`);
  process.exit(2);
}
if (appDir.startsWith(projectDir + path.sep)) {
  console.error('Copie le paquet hors du projet avant ce test (sinon il ne prouve rien).');
  process.exit(2);
}

(async () => {
  const appRequire = createRequire(path.join(appDir, 'package.json'));
  const { createWorker, PSM } = appRequire('tesseract.js');
  const langPath = path.join(path.dirname(appRequire.resolve('@tesseract.js-data/fra/package.json')), '4.0.0_best_int');
  const cachePath = fs.mkdtempSync(path.join(require('os').tmpdir(), 'vigie-smoke-'));
  let failed = null;
  const worker = await createWorker('fra', 1, {
    langPath, cachePath, gzip: true, errorHandler: (e) => { failed = e; },
  }).catch((e) => { failed = failed || e; return null; });
  if (!worker) {
    console.error(`ÉCHEC : le moteur OCR du paquet ne démarre pas\n  ${failed}`);
    process.exit(1);
  }
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, 'fixtures', 'harebourg.png')));
  const sub = P.crop(png.data, png.width, png.height, P.regionToRect({ x: 0, y: 0, w: 0.34, h: 0.13 }, png.width, png.height));
  const bin = P.binarize(sub, { threshold: 165, scale: 2 });
  const out = new PNG({ width: bin.width, height: bin.height });
  bin.data.copy(out.data);
  const { data } = await worker.recognize(PNG.sync.write(out));
  await worker.terminate();
  if (!/Harebourg/.test(data.text)) {
    console.error(`ÉCHEC : texte lu inattendu : ${JSON.stringify(data.text)}`);
    process.exit(1);
  }
  console.log(`OK : le paquet lit « ${data.text.trim().split('\n')[0]} »`);
})();
