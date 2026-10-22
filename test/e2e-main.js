/*
 * Visite guidée automatique pour vérifier l'interface (sous Xvfb) :
 *   electron test/e2e-main.js --no-sandbox
 * Prend des captures du panneau et du calque dans VIGIE_SHOTS.
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const OUT = process.env.VIGIE_SHOTS || path.join(__dirname, '.cache', 'shots');
fs.mkdirSync(OUT, { recursive: true });
app.setPath('userData', path.join(OUT, 'userdata'));

require('../src/main/main.js');

const LOG = (...a) => fs.appendFileSync(path.join(OUT, 'log.txt'), a.join(' ') + '\n');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (t) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith(t));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  LOG('capture', name);
}

const js = (win, code) => { LOG('js>', code.slice(0, 60).replace(/\s+/g, ' ')); return Promise.race([win.webContents.executeJavaScript(code), wait(4000).then(() => LOG('  (délai dépassé)'))]); };

process.on('unhandledRejection', (e) => { LOG('ERREUR', e && e.stack); app.quit(); });
app.whenReady().then(async () => {
  await wait(8000);
  const panel = find('Vigie — panneau');
  const board = find('Vigie — calque');
  // Sans gestionnaire de fenêtres, le calque plein écran recouvre le panneau
  // (qui n'est alors plus repeint) : on le masque pendant les captures du panneau.
  if (board) board.hide();
  await js(panel, `vigie.select(null)`);
  await wait(300);
  await shot(panel, '01-accueil');

  const tab = (label) => js(panel, `[...document.querySelectorAll('#tabs button')].find(b => b.textContent === '${label}').click(); document.getElementById('main').scrollTop = 0;`);

  // Fiche Harebourg (guide + outil de visée)
  await js(panel, `vigie.select('d71')`);
  await wait(600);
  await js(panel, `vigie.setTurn(4); vigie.harebourg({ baseQ: 1, meleeLines: 0 });`);
  await wait(300);
  await shot(panel, '02-harebourg');
  await tab('Visée');
  await wait(400);
  await js(panel, `(() => {
    const c = document.getElementById('miniCanvas'); const r = c.getBoundingClientRect();
    const H = window.Harebourg; const o = { x: r.width / 2, y: r.height / 2 };
    const p1 = H.gridToPixel({ a: 0, b: 0 }, o, 30); const p2 = H.gridToPixel({ a: 3, b: 3 }, o, 30);
    c.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: r.left + p1.x, clientY: r.top + p1.y, bubbles: true }));
    c.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: r.left + p2.x, clientY: r.top + p2.y, bubbles: true }));
    document.getElementById('main').scrollTop = 330;
  })()`);
  await wait(300);
  await shot(panel, '03-visee');
  await tab('Mécaniques');
  await wait(400);
  await shot(panel, '04-mecaniques');
  await tab('Monstres');
  await wait(600);
  await shot(panel, '05-monstres');

  // Recherche dans tout le bestiaire
  await js(panel, `(() => { const i = document.getElementById('search'); i.focus(); i.value = 'kralam'; i.dispatchEvent(new Event('input')); })()`);
  await wait(500);
  await shot(panel, '06-recherche');
  await js(panel, `document.querySelector('#results button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await wait(700);
  await shot(panel, '07-kralamoure');

  // Donjon sans guide : synthèse automatique
  await js(panel, `vigie.search('Cour du Bouftou Royal').then(r => vigie.select(r[0].ref))`);
  await wait(700);
  await shot(panel, '08-sans-guide');

  // Songes
  await js(panel, `vigie.select('songes')`);
  await wait(700);
  await shot(panel, '09-songes');
  await tab('Aberrations');
  await wait(300);
  await shot(panel, '10-aberrations');

  // Lecture simulée d'un groupe en Songe
  const ids = global.__vigieTestMonsters('Groupe de monstres\nCraqueleur (210)\nBouftou Royal\nCycloïde\nAberration de Solar\nSolar');
  LOG('combat ids', JSON.stringify(ids));
  await wait(900);
  await shot(panel, '11-combat');
  await js(panel, `[...document.querySelectorAll('.card .card-actions button')].find(b => b.textContent.startsWith('Sorts')).click()`);
  await wait(300);
  await js(panel, `document.getElementById('main').scrollTop = 260`);
  await wait(200);
  await shot(panel, '12-combat-sorts');

  // Réglages
  await js(panel, `document.getElementById('btnSettings').click()`);
  await wait(400);
  await shot(panel, '13-reglages');
  await js(panel, `document.getElementById('settings').scrollTop = 560`);
  await wait(200);
  await shot(panel, '14-reglages-bas');
  await js(panel, `document.getElementById('settings').querySelector('h3 button').click()`);

  // Mode réduit en combat
  await js(panel, `document.getElementById('btnCompact').click()`);
  await wait(700);
  await shot(panel, '15-compact');
  await js(panel, `document.getElementById('btnCompact').click()`);

  // Calque : visée en jeu
  if (board) {
    board.showInactive();
    await wait(1200);
    await js(panel, `vigie.select('d71'); vigie.setTurn(2); vigie.harebourg({ baseQ: 3, meleeLines: 0 })`);
    await wait(300);
    await js(panel, `vigie.boardDone('calibrate', { x: 800, y: 450, w: 86 })`);
    await wait(300);
    global.__vigieTestAim({ x: 800 + 86 * 1, y: 450 + 4 }, { x: 800 + 86 * 3 + 43, y: 450 - 43 * 1.5 - 3 });
    await wait(800);
    await shot(board, '16-calque-visee');
  }
  await wait(300);
  app.quit();
});
