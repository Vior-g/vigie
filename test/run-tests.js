/* Tests de Vigie : node test/run-tests.js [--ocr] */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const H = require('../src/core/harebourg');
const T = require('../src/core/turns');
const M = require('../src/core/matcher');
const P = require('../src/core/preprocess');

const FICHES = path.join(__dirname, '..', 'src', 'data', 'bosses');
const bosses = fs.readdirSync(FICHES).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(FICHES, f), 'utf8')));

let pass = 0; let fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

(async () => {
  console.log('Géométrie Harebourg');
  await test('horaire : droite -> bas, bas -> gauche', () => {
    // À droite à l'écran = (a,b) = (1,1) ; en bas = (1,-1) ; à gauche = (-1,-1)
    assert.deepStrictEqual(H.rotate({ a: 1, b: 1 }, 1), { a: 1, b: -1 });
    assert.deepStrictEqual(H.rotate({ a: 1, b: -1 }, 1), { a: -1, b: -1 });
    const o = { x: 0, y: 0 }; const w = 80;
    const right = H.gridToPixel({ a: 1, b: 1 }, o, w);
    const down = H.gridToPixel(H.rotate({ a: 1, b: 1 }, 1), o, w);
    assert.ok(right.x > 0 && Math.abs(right.y) < 1e-9, 'droite');
    assert.ok(Math.abs(down.x) < 1e-9 && down.y > 0, 'bas');
  });
  await test('viser la case donnée fait tomber le sort sur la cible (toutes rotations)', () => {
    for (let q = 0; q < 4; q++) {
      for (let i = 0; i < 200; i++) {
        const me = { a: (i * 7) % 13 - 6, b: (i * 5) % 11 - 5 };
        const target = { a: (i * 3) % 17 - 8, b: (i * 11) % 9 - 4 };
        const aim = H.aimCell(me, target, q);
        assert.deepStrictEqual(H.landingCell(me, aim, q), target);
        assert.strictEqual(H.distance(me, aim), H.distance(me, target), 'la rotation conserve la PO');
      }
    }
  });
  await test('4 quarts de tour = identité, 180° = symétrie', () => {
    assert.deepStrictEqual(H.rotate({ a: 3, b: -2 }, 4), { a: 3, b: -2 });
    assert.deepStrictEqual(H.rotate({ a: 3, b: -2 }, 2), { a: -3, b: 2 });
  });
  await test('coups au CàC : 1/4 de tour anti-horaire chacun, plafonné à 10', () => {
    assert.strictEqual(H.effectiveRotation(1, 1, -1), 0);
    assert.strictEqual(H.effectiveRotation(1, 2, -1), 3);
    assert.strictEqual(H.effectiveRotation(2, 0, -1), 2);
    assert.strictEqual(H.effectiveRotation(1, 14, -1), H.effectiveRotation(1, 10, -1));
    assert.strictEqual(H.effectiveRotation(1, 1, 1), 2);
  });
  await test('pixel -> case : le centre et les bords d\'un losange', () => {
    const o = { x: 500, y: 300 }; const w = 86;
    for (const c of [{ a: 0, b: 0 }, { a: 2, b: -3 }, { a: -4, b: 1 }]) {
      const p = H.gridToPixel(c, o, w);
      assert.deepStrictEqual(H.snap(H.pixelToGrid(p, o, w)), c);
      assert.deepStrictEqual(H.snap(H.pixelToGrid({ x: p.x + w * 0.2, y: p.y + w * 0.05 }, o, w)), c);
    }
  });
  await test('paliers de PV par défaut', () => {
    assert.strictEqual(H.rotationFromHp(100, H.DEFAULT_TIERS), H.ROT.horaire);
    assert.strictEqual(H.rotationFromHp(80, H.DEFAULT_TIERS), H.ROT.antihoraire);
    assert.strictEqual(H.rotationFromHp(50, H.DEFAULT_TIERS), H.ROT.demi);
    assert.strictEqual(H.rotationFromHp(10, H.DEFAULT_TIERS), H.ROT.horaire);
  });

  console.log('Fiches');
  await test('5 boss de Frigost III présents', () => {
    const ids = bosses.map((b) => b.id).sort();
    assert.deepStrictEqual(ids, ['comte-harebourg', 'klime', 'missiz-frizz', 'nileza', 'sylargh']);
  });
  for (const b of bosses) {
    await test(`fiche ${b.id} complète`, () => {
      for (const k of ['nom', 'donjon', 'stats', 'essentiel', 'mecaniques', 'monstres', 'strategie', 'succes', 'acces', 'sources', 'tours']) {
        assert.ok(b[k] && (!Array.isArray(b[k]) || b[k].length), `champ manquant : ${k}`);
      }
      for (const e of ['neutre', 'terre', 'feu', 'eau', 'air']) assert.strictEqual(typeof b.stats.res[e], 'number', `rés. ${e}`);
      assert.strictEqual(b.monstres.length, 5, 'cinq monstres');
      for (const s of b.sources) assert.ok(/^https:\/\//.test(s.url), s.url);
      for (const r of b.tours) assert.ok(r.text && ['info', 'alerte', 'danger'].includes(r.level || 'info'));
    });
  }

  console.log('Règles de tours');
  await test('Missiz : Cristallisation aux tours 2, 5, 8', () => {
    const b = bosses.find((x) => x.id === 'missiz-frizz');
    const turns = [];
    for (let t = 1; t <= 9; t++) if (T.rulesFor(b, t).some((r) => /Cristallisation/.test(r.text))) turns.push(t);
    assert.deepStrictEqual(turns, [2, 5, 8]);
  });
  await test('Harebourg : rappel pair/impair', () => {
    const b = bosses.find((x) => x.id === 'comte-harebourg');
    assert.ok(T.rulesFor(b, 4).some((r) => /Tour pair/.test(r.text)));
    assert.ok(T.rulesFor(b, 3).some((r) => /Tour impair/.test(r.text)));
    assert.ok(!T.rulesFor(b, 3).some((r) => /Tour pair/.test(r.text)));
  });
  await test('Nileza : fenêtre CàC aux tours 3, 6, 9', () => {
    const b = bosses.find((x) => x.id === 'nileza');
    const turns = [];
    for (let t = 1; t <= 9; t++) if (T.rulesFor(b, t).some((r) => /fenêtre/.test(r.text))) turns.push(t);
    assert.deepStrictEqual(turns, [3, 6, 9]);
  });

  console.log('Reconnaissance du texte');
  const index = M.buildIndex(bosses);
  const cases = [
    ['Donjon du Comte Harebourq\n-59, -89', 'comte-harebourg'],
    ['Forgefroide de Missiz Friz', 'missiz-frizz'],
    ['Salons prives de Kllme', 'klime'],
    ['Laboratoire de Nlleza  -59,-74', 'nileza'],
    ['Transporteur de Sylarqh', 'sylargh'],
    ['Tannerie Écarlate\n-63, -93', 'klime'],
    ['Cycloïde (Niv. 200)', 'comte-harebourg'],
    ['Verglasseur', 'missiz-frizz'],
  ];
  for (const [txt, want] of cases) {
    await test(`« ${txt.replace(/\n/g, ' ⏎ ')} » → ${want}`, () => {
      const m = M.match(txt, index);
      assert.ok(m, 'aucune correspondance');
      assert.strictEqual(m.bossId, want);
    });
  }
  for (const txt of ['Village des Éleveurs -16, 1', 'Astrub', 'Sorts 1 2 3 4 5', 'Klim', '']) {
    await test(`« ${txt} » → rien`, () => assert.strictEqual(M.match(txt, index), null));
  }
  await test('recherche manuelle « cyclo » → Cycloïde', () => {
    const r = M.search('cyclo', index);
    assert.ok(r.length && r[0].monstre === 'Cycloïde', JSON.stringify(r[0]));
  });
  await test('recherche manuelle « klime » → Klime en tête', () => {
    assert.strictEqual(M.search('klime', index)[0].bossId, 'klime');
  });

  if (process.argv.includes('--ocr')) {
    console.log('OCR de bout en bout (captures simulées)');
    const { PNG } = require('pngjs');
    const { createWorker, PSM } = require('tesseract.js');
    fs.mkdirSync(path.join(__dirname, '.cache'), { recursive: true });
    const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/fra/package.json')), '4.0.0_best_int');
    const worker = await createWorker('fra', 1, { langPath, cachePath: path.join(__dirname, '.cache'), gzip: true });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
    const region = { x: 0, y: 0, w: 0.34, h: 0.13 };
    const expectations = {
      harebourg: 'comte-harebourg', frizz: 'missiz-frizz', 'klime-entree': 'klime', village: null, 'nileza-small': 'nileza',
    };
    for (const [file, want] of Object.entries(expectations)) {
      await test(`capture ${file}.png → ${want}`, async () => {
        const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, 'fixtures', `${file}.png`)));
        const sub = P.crop(png.data, png.width, png.height, P.regionToRect(region, png.width, png.height));
        const bin = P.binarize(sub, { threshold: 165, scale: 2 });
        const out = new PNG({ width: bin.width, height: bin.height });
        bin.data.copy(out.data);
        const buf = PNG.sync.write(out);
        fs.writeFileSync(path.join(__dirname, '.cache', `${file}-bin.png`), buf);
        const t0 = Date.now();
        const { data } = await worker.recognize(buf);
        const m = M.match(data.text, index);
        console.log(`      OCR (${Date.now() - t0} ms) : ${JSON.stringify(data.text.trim())}`);
        assert.strictEqual(m ? m.bossId : null, want);
      });
    }
    await worker.terminate();
  }

  console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
  process.exit(fail ? 1 : 0);
})();
