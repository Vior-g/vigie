/* Tests de Vigie : node test/run-tests.js [--ocr] */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const H = require('../src/core/harebourg');
const T = require('../src/core/turns');
const M = require('../src/core/matcher');
const P = require('../src/core/preprocess');
const S = require('../src/core/monsterscan');
const MF = require('../src/core/manifest');
const { GameData } = require('../src/core/gamedata');
const { DataUpdater, cmpVersion } = require('../src/main/updater');

const DATA = path.join(__dirname, '..', 'src', 'data');
const GUIDES = path.join(DATA, 'guides');

let pass = 0; let fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); } catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

(async () => {
  const gd = new GameData({ dataDir: DATA });
  const fiche = (slug) => [...gd.fiches.values()].find((f) => f.guide && f.guide.slug === slug && f.guideVia === 'donjon');

  console.log('Géométrie Harebourg');
  await test('horaire : droite -> bas, bas -> gauche', () => {
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

  console.log('Guides');
  const files = fs.readdirSync(GUIDES).filter((f) => f.endsWith('.json'));
  await test(`${files.length} guides lisibles et complets`, () => {
    assert.ok(files.length >= 85, `${files.length} guides`);
    for (const f of files) {
      const g = JSON.parse(fs.readFileSync(path.join(GUIDES, f), 'utf8'));
      const where = f.replace('.json', '');
      assert.ok(g.dj && typeof g.dj === 'string', `${where} : dj`);
      assert.ok(Array.isArray(g.essentiel) && g.essentiel.length >= 2, `${where} : essentiel`);
      assert.ok(/^https:\/\//.test(g.src || ''), `${where} : source`);
      for (const r of g.tours || []) assert.ok(r.text && ['info', 'alerte', 'danger'].includes(r.level || 'info'), `${where} : tour`);
      for (const m of g.monstres || []) assert.ok(m.n && m.x && ['haut', 'moyen', 'bas', undefined].includes(m.d), `${where} : monstre ${m.n}`);
      for (const k of ['mecaniques', 'succes']) for (const x of g[k] || []) assert.ok(x.x, `${where} : ${k}`);
    }
  });
  await test('chaque guide est rattaché à un donjon du jeu (sauf exceptions connues)', () => {
    const standalone = [...gd.fiches.values()].filter((f) => f.id.startsWith('g:') && !f.dungeonId).map((f) => f.guide.slug).sort();
    assert.deepStrictEqual(standalone, ['caverne-de-cire-momore', 'malice', 'temple-de-gargandyas']);
  });
  await test('Frigost III : les 5 boss ont leur guide', () => {
    for (const [slug, boss] of [['donjon-du-comte-harebourg', 'Comte Harebourg'], ['forgefroide-de-missiz-frizz', 'Missiz Frizz'],
      ['salons-priveacutes-de-klime', 'Klime'], ['laboratoire-de-nileza', 'Nileza'], ['transporteur-de-sylargh', 'Sylargh']]) {
      const f = fiche(slug);
      assert.ok(f, slug);
      assert.strictEqual(f.nom, boss);
    }
    assert.strictEqual(fiche('donjon-du-comte-harebourg').outil, 'harebourg');
  });
  await test('Minotot et Minotoror ont chacun leur fiche', () => {
    assert.strictEqual(gd.fiches.get('d53').guide.slug, 'minotot');
    assert.strictEqual(gd.fiches.get('d4').guide.slug, 'centre-du-labyrinthe-du-minotoror');
  });
  await test('les expéditions héritent du guide de leur donjon', () => {
    const expe = [...gd.fiches.values()].filter((f) => /^Expédition/.test(f.donjon) && f.nom === 'Comte Harebourg');
    assert.ok(expe.length >= 1);
    for (const f of expe) assert.strictEqual(f.guide.slug, 'donjon-du-comte-harebourg');
  });

  console.log('Règles de tours');
  const turnsWith = (slug, re) => {
    const g = fiche(slug).guide; const out = [];
    for (let t = 1; t <= 9; t++) if (T.rulesFor(g, t).some((r) => re.test(r.text))) out.push(t);
    return out;
  };
  await test('Missiz : Cristallisation aux tours 2, 5, 8', () => {
    assert.deepStrictEqual(turnsWith('forgefroide-de-missiz-frizz', /Cristallisation/), [2, 5, 8]);
  });
  await test('Harebourg : rappel pair/impair', () => {
    assert.deepStrictEqual(turnsWith('donjon-du-comte-harebourg', /Tour pair/), [2, 4, 6, 8]);
    assert.deepStrictEqual(turnsWith('donjon-du-comte-harebourg', /Tour impair/), [1, 3, 5, 7, 9]);
  });
  await test('Nileza : fenêtre pour frapper aux tours 3, 6, 9', () => {
    assert.deepStrictEqual(turnsWith('laboratoire-de-nileza', /fenêtre/), [3, 6, 9]);
  });

  console.log('Données du jeu');
  await test('bestiaire et donjons chargés', () => {
    const st = gd.stats();
    assert.ok(st.dungeons >= 150, `${st.dungeons} donjons`);
    assert.ok(st.monsters >= 4000, `${st.monsters} monstres`);
    assert.ok(st.spells >= 5000, `${st.spells} sorts`);
    assert.ok(st.fichesWithGuide >= 120, `${st.fichesWithGuide} fiches guidées`);
  });
  await test('fiche monstre : stats, résistances, sorts nettoyés', () => {
    const v = gd.monsterView(gd.monsterIdByName('Comte Harebourg'));
    assert.strictEqual(v.nom, 'Comte Harebourg');
    assert.ok(v.boss && v.pa > 0 && v.pm > 0);
    for (const e of ['neutre', 'terre', 'feu', 'eau', 'air']) assert.strictEqual(typeof v.res[e], 'number');
    assert.ok(v.spells.length >= 2);
    for (const sp of v.spells) for (const e of sp.e) assert.ok(!/[<>]/.test(e), `balise restante : ${e}`);
    assert.strictEqual(v.ficheId, 'd71');
  });
  await test('nom de monstre -> version normale du bestiaire (pas l\'expédition)', () => {
    assert.deepStrictEqual(gd.monsters[gd.monsterIdByName('Craqueleur')].lv, [62, 70]);
    assert.ok(gd.monsters[gd.highVariant(gd.monsterIdByName('Craqueleur'))].lv[0] >= 200);
  });
  await test('conseil de guide attaché au monstre', () => {
    const v = gd.monsterView(gd.monsterIdByName('Cycloïde'));
    assert.ok(v.note && v.noteFrom, 'note');
  });
  await test('résumé de groupe : élément conseillé', () => {
    const ids = ['Comte Harebourg', 'Cycloïde'].map((n) => gd.monsterIdByName(n));
    const g = gd.groupSummary(ids);
    assert.ok(g.best.length >= 1 && g.worst);
    for (const v of Object.values(g.avg)) assert.ok(v >= -100 && v <= 100);
  });
  await test('Songes : fiche, 16 Aberrations, avis de recherche reconnus', () => {
    const f = gd.ficheView('songes');
    assert.strictEqual(f.type, 'songe');
    assert.strictEqual(f.songes.aberrations.length, 16);
    const known = f.songes.avis.filter((a) => a.id).length;
    assert.ok(known >= 18, `${known} avis reconnus sur ${f.songes.avis.length}`);
    for (const a of f.songes.aberrations) if (!a.famille) assert.ok(gd.monsterIdByName(a.boss), `boss inconnu : ${a.boss}`);
  });

  console.log('Reconnaissance du lieu');
  const mapCases = [
    ['Donjon du Comte Harebourq\n-59, -89', 'donjon-du-comte-harebourg'],
    ['Forgefroide de Missiz Friz', 'forgefroide-de-missiz-frizz'],
    ['Salons prives de Kllme', 'salons-priveacutes-de-klime'],
    ['Laboratoire de Nlleza  -59,-74', 'laboratoire-de-nileza'],
    ['Transporteur de Sylarqh', 'transporteur-de-sylargh'],
    ['Tannerie Écarlate\n-63, -93', 'salons-priveacutes-de-klime'],
    ['Antre du Kralamoure Geant', 'antre-du-kralamoure-geacuteant'],
    ['Salle du Minotot', 'minotot'],
  ];
  for (const [txt, want] of mapCases) {
    await test(`« ${txt.replace(/\n/g, ' ⏎ ')} » → ${want}`, () => {
      const m = gd.detectMap(txt);
      assert.ok(m, 'aucune correspondance');
      const f = gd.fiches.get(m.ficheId);
      assert.strictEqual(f.guide && f.guide.slug, want);
    });
  }
  await test('« Songes Infinis » / « Contrées oniriques » → mode Songe', () => {
    assert.strictEqual(gd.detectMap('Songes Infinis').ficheId, 'songes');
    assert.strictEqual(gd.detectMap('Contrées oniriques\n12, 3').ficheId, 'songes');
  });
  for (const txt of ['Village des Éleveurs -16, 1', 'Astrub', 'Sorts 1 2 3 4 5', 'Klim', 'Incarnam', '']) {
    await test(`« ${txt} » → rien`, () => assert.strictEqual(gd.detectMap(txt), null));
  }

  console.log('Lecture des monstres');
  await test('infobulle de groupe : noms, niveaux et bonne version', () => {
    const r = gd.detectMonsters('Niveau 302\nCraqueleur (62)\nCycloide (210)\nBouftou Royal (30)\nCraqueleur (205)');
    const names = r.ids.map((id) => `${gd.monsters[id].n} ${gd.monsters[id].lv[0]}`);
    assert.deepStrictEqual(names, ['Craqueleur 62', 'Cycloïde 200', 'Bouftou Royal 30', 'Craqueleur 200']);
  });
  await test('PV « 4 200 / 4 200 » pas pris pour un niveau', () => {
    const r = gd.detectMonsters('Strigide 4 200 / 4 200');
    assert.strictEqual(r.ids.length, 1);
    assert.deepStrictEqual(r.levels, {});
  });
  await test('Aberration lue sur l\'icône', () => {
    const r = gd.detectMonsters('Aberration de Solar');
    assert.deepStrictEqual(r.aberrations, ['Solar']);
  });
  await test('texte d\'interface sans monstre → rien', () => {
    const r = gd.detectMonsters('Sorts Inventaire Caractéristiques Guilde Alliance Prêt Passer le tour');
    assert.deepStrictEqual(r.ids, []);
  });
  await test('zone autour du curseur bornée à l\'image', () => {
    const r = S.cursorRect({ x: 10, y: 10 }, 1000, 800);
    assert.ok(r.inside && r.x === 0 && r.y === 0 && r.width > 0 && r.height > 0);
    const out = S.cursorRect({ x: -5, y: 10 }, 1000, 800);
    assert.ok(!out.inside && out.width === 1000);
  });

  console.log('Recherche');
  await test('« cyclo » → Cycloïde (monstre)', () => {
    const r = gd.search('cyclo');
    assert.strictEqual(r[0].label, 'Cycloïde');
    assert.strictEqual(r[0].kind, 'monstre');
  });
  await test('« klime » → fiche de Klime en tête', () => assert.strictEqual(gd.search('klime')[0].ref, 'd68'));
  await test('« songe » → Songes Infinis', () => assert.strictEqual(gd.search('songe')[0].ref, 'songes'));

  console.log('Mises à jour');
  await test('manifeste des données à jour (sinon : node scripts/build-manifest.mjs)', () => {
    const m = MF.readManifest(DATA);
    assert.ok(m && m.schema === MF.SCHEMA, 'manifeste absent');
    assert.ok(MF.sameFiles(m.files, MF.computeFiles(DATA)), 'manifeste périmé');
  });
  await test('empreinte indépendante des fins de ligne', () => {
    assert.strictEqual(MF.hashContent('{"a":1}\r\n'), MF.hashContent('{"a":1}\n'));
  });
  await test('comparaison de versions', () => {
    assert.ok(cmpVersion('v0.2.1', '0.2.0') > 0);
    assert.ok(cmpVersion('0.10.0', '0.9.9') > 0);
    assert.strictEqual(cmpVersion('v1.0.0', '1.0.0'), 0);
  });
  await test('téléchargement des seuls fichiers modifiés, vérifiés', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigie-upd-'));
    const bundled = path.join(tmp, 'bundled'); const cache = path.join(tmp, 'cache');
    fs.mkdirSync(path.join(bundled, 'guides'), { recursive: true });
    const g1 = '{"dj":"Donjon A","boss":"A","essentiel":["x","y"]}\n';
    fs.writeFileSync(path.join(bundled, 'guides', 'a.json'), g1);
    fs.writeFileSync(path.join(bundled, 'songes.json'), '{"nom":"S"}\n');
    const bm = { schema: MF.SCHEMA, stamp: '2026-01-01T00:00:00Z', files: MF.computeFiles(bundled) };
    fs.writeFileSync(path.join(bundled, 'manifest.json'), JSON.stringify(bm));
    const g2 = '{"dj":"Donjon A","boss":"A","essentiel":["x","y","z"]}\n';
    let remote = { schema: MF.SCHEMA, stamp: '2026-02-01T00:00:00Z', files: { ...bm.files, 'guides/a.json': MF.hashContent(g2) } };
    const served = { 'manifest.json': () => JSON.stringify(remote), 'guides/a.json': () => g2, 'songes.json': () => '{"nom":"S"}\n' };
    const calls = [];
    const fetchFn = async (url) => {
      const rel = url.replace('https://x/', '');
      calls.push(rel);
      return served[rel] ? { ok: true, status: 200, text: async () => served[rel]() } : { ok: false, status: 404, text: async () => '' };
    };
    const up = new DataUpdater({ bundledDir: bundled, cacheDir: cache, fetchFn, rawBase: 'https://x/' });
    assert.strictEqual(up.activeOverlay(), null);
    const r = await up.check();
    assert.ok(r.updated && r.changed === 1, JSON.stringify(r));
    assert.deepStrictEqual(calls, ['manifest.json', 'guides/a.json']);
    assert.strictEqual(up.activeOverlay(), cache);
    const g = new GameData({ dataDir: bundled, overlayDir: up.activeOverlay() });
    assert.strictEqual(g.guides.get('a').essentiel.length, 3);
    const again = await up.check();
    assert.ok(!again.updated);
    // Fichier corrompu : rien n'est remplacé.
    remote = { ...remote, stamp: '2026-03-01T00:00:00Z', files: { ...remote.files, 'guides/a.json': 'ffffffffffff' } };
    await assert.rejects(up.check(), /empreinte/);
    assert.strictEqual(MF.readManifest(cache).stamp, '2026-02-01T00:00:00Z');
    // Une nouvelle version de l'appli (données livrées plus récentes) l'emporte.
    fs.writeFileSync(path.join(bundled, 'manifest.json'), JSON.stringify({ ...bm, stamp: '2026-04-01T00:00:00Z' }));
    assert.strictEqual(up.activeOverlay(), null);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  if (process.argv.includes('--ocr')) {
    console.log('OCR de bout en bout (captures simulées)');
    const { PNG } = require('pngjs');
    const { createWorker, PSM } = require('tesseract.js');
    fs.mkdirSync(path.join(__dirname, '.cache'), { recursive: true });
    const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/fra/package.json')), '4.0.0_best_int');
    const worker = await createWorker('fra', 1, { langPath, cachePath: path.join(__dirname, '.cache'), gzip: true });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
    const read = async (img, opts, name) => {
      const bin = P.binarize(img, opts);
      const out = new PNG({ width: bin.width, height: bin.height });
      bin.data.copy(out.data);
      const buf = PNG.sync.write(out);
      fs.writeFileSync(path.join(__dirname, '.cache', `${name}-bin.png`), buf);
      const { data } = await worker.recognize(buf);
      return data.text;
    };
    const load = (file) => PNG.sync.read(fs.readFileSync(path.join(__dirname, 'fixtures', `${file}.png`)));
    const region = { x: 0, y: 0, w: 0.34, h: 0.13 };
    const expectations = {
      harebourg: 'donjon-du-comte-harebourg', frizz: 'forgefroide-de-missiz-frizz', 'klime-entree': 'salons-priveacutes-de-klime', village: null, 'nileza-small': 'laboratoire-de-nileza',
    };
    for (const [file, want] of Object.entries(expectations)) {
      await test(`capture ${file}.png → ${want}`, async () => {
        const png = load(file);
        const sub = P.crop(png.data, png.width, png.height, P.regionToRect(region, png.width, png.height));
        const t0 = Date.now();
        const text = await read(sub, { threshold: 165, scale: 2 }, file);
        const m = gd.detectMap(text);
        console.log(`      OCR (${Date.now() - t0} ms) : ${JSON.stringify(text.trim())}`);
        const got = m ? gd.fiches.get(m.ficheId) : null;
        assert.strictEqual(got ? (got.guide && got.guide.slug) : null, want);
      });
    }
    const scan = async (file, cursor) => {
      const png = load(file);
      const rect = S.cursorRect(cursor, png.width, png.height);
      const around = P.crop(png.data, png.width, png.height, rect);
      const texts = [];
      for (const p of S.passes()) texts.push(await read(around, p.opts, `${file}-${p.name}`));
      console.log(`      OCR : ${JSON.stringify(texts.join(' | ').replace(/\s+/g, ' ').trim())}`);
      return gd.detectMonsters(texts.join('\n'));
    };
    await test('infobulle de groupe (texte clair) → 4 monstres, bonnes versions', async () => {
      const r = await scan('groupe-songe', { x: 800, y: 450 });
      const names = r.ids.map((id) => `${gd.monsters[id].n} ${gd.monsters[id].lv[0]}`).sort();
      assert.deepStrictEqual(names, ['Bouftou Royal 30', 'Craqueleur 62', 'Cycloïde 200', 'Granduk 200']);
    });
    await test('infobulle claire (texte sombre) → Strigide', async () => {
      const r = await scan('monstre-clair', { x: 790, y: 420 });
      assert.deepStrictEqual(r.ids.map((id) => gd.monsters[id].n), ['Strigide']);
    });
    await worker.terminate();
  }

  console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
  process.exit(fail ? 1 : 0);
})();
