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
  await wait(9000);
  const panel = find('Vigie — panneau');
  const board = find('Vigie — calque');
  await shot(panel, '1-detection');
  // Sans gestionnaire de fenêtres, le calque plein écran recouvre le panneau
  // (qui n'est alors plus repeint) : on le masque pendant les captures du panneau.
  if (board) board.hide();

  // Onglet Visée + simulateur
  // Sous Xvfb sans compositeur, le calque transparent apparaît noir et masque
  // l'image du jeu : on choisit donc la fiche à la main pour la suite.
  await js(panel, `vigie.select('comte-harebourg')`);
  await wait(400);
  await js(panel, `vigie.setTurn(4); vigie.harebourg({ baseQ: 1, meleeLines: 0 });`);
  await wait(300);
  await js(panel, `[...document.querySelectorAll('#tabs button')].find(b => b.textContent === 'Visée').click();`);
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
  await shot(panel, '2-visee');

  // Onglet Monstres
  await js(panel, `[...document.querySelectorAll('#tabs button')].find(b => b.textContent === 'Monstres').click(); document.getElementById('main').scrollTop = 0;`);
  await wait(500);
  await shot(panel, '3-monstres');

  // Recherche « verglas » -> Missiz Frizz
  await js(panel, `(() => { const i = document.getElementById('search'); i.focus(); i.value = 'verglas'; i.dispatchEvent(new Event('input')); })()`);
  await wait(400);
  await shot(panel, '4-recherche');
  await js(panel, `document.querySelector('#results button').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`);
  await wait(500);
  await js(panel, `vigie.setTurn(5)`);
  await wait(300);
  await shot(panel, '5-frizz-tour5');

  // Réglages
  await js(panel, `document.getElementById('btnSettings').click()`);
  await wait(400);
  await shot(panel, '6-reglages');
  await js(panel, `document.getElementById('settings').scrollTop = 520`);
  await wait(200);
  await shot(panel, '7-reglages-bas');
  await js(panel, `document.getElementById('settings').querySelector('h3 button').click()`);

  // Mode réduit
  await js(panel, `vigie.select('nileza'); `);
  await wait(300);
  await js(panel, `vigie.setTurn(4)`);
  await js(panel, `document.getElementById('btnCompact').click()`);
  await wait(700);
  await shot(panel, '8-compact');
  await js(panel, `document.getElementById('btnCompact').click()`);

  // Calque : visée en jeu sans calibrage puis avec calibrage
  if (board) {
    board.showInactive();
    await wait(1500);
    await js(panel, `vigie.select('comte-harebourg'); vigie.setTurn(2); vigie.harebourg({ baseQ: 3, meleeLines: 0 })`);
    await wait(300);
    // Calibrage simulé (case de 86 px centrée en 800,450), puis deux appuis du
    // raccourci simulés : « toi » à 2 cases à droite, la cible plus loin.
    await js(panel, `vigie.boardDone('calibrate', { x: 800, y: 450, w: 86 })`);
    await wait(300);
    global.__vigieTestAim({ x: 800 + 86 * 1, y: 450 + 4 }, { x: 800 + 86 * 3 + 43, y: 450 - 43 * 1.5 - 3 });
    await wait(800);
    await js(board, `JSON.stringify({ me: S.harebourg.me, target: S.harebourg.target, cal: S.calibration, q: S.harebourg.q, w: innerWidth })`).then((v) => LOG('board', v));
    await shot(board, '9-calque-visee');
    await js(panel, `vigie.boardMode('calibrate')`);
    await wait(500);
    await shot(board, '10-calque-calibrage');
    await js(panel, `vigie.boardMode('ocrzone')`);
    await wait(500);
    await shot(board, '11-calque-zone');
    await js(panel, `vigie.boardMode('idle')`);
  }
  await wait(300);
  app.quit();
});
