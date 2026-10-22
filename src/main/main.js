'use strict';
/*
 * Vigie — overlay d'aide aux combats de boss pour Dofus 3.
 * Lecture seule : capture d'écran + OCR local. Aucune lecture mémoire,
 * aucune interception réseau, aucun clic ni touche envoyé au jeu.
 */
const {
  app, BrowserWindow, globalShortcut, ipcMain, screen, Tray, Menu, nativeImage, shell,
} = require('electron');
const path = require('path');
const fs = require('fs');

const { Settings } = require('./settings');
const { WinWatch } = require('./winwatch');
const { Ocr } = require('./ocr');
const { DataUpdater } = require('./updater');
const capture = require('./capture');
const { GameData } = require('../core/gamedata');
const { crop, binarize, regionToRect } = require('../core/preprocess');
const { cursorRect, passes: scanPasses } = require('../core/monsterscan');
const Harebourg = require('../core/harebourg');

if (!app.requestSingleInstanceLock()) { app.quit(); }

// Un overlay ne doit jamais planter en plein combat : une erreur imprévue est
// affichée dans la barre d'état du panneau au lieu d'une fenêtre d'erreur.
function reportFatal(e) {
  const msg = String(e && e.message ? e.message : e).split('\n')[0];
  console.error('[vigie] erreur non interceptée', e);
  try {
    state.detection.error = msg;
    broadcast();
  } catch (_) { /* fenêtres pas encore prêtes */ }
}
process.on('uncaughtException', reportFatal);
process.on('unhandledRejection', reportFatal);

const ROOT = path.join(__dirname, '..');
const VERSION = (() => { try { return require('../../package.json').version; } catch (e) { return app.getVersion(); } })();
const DATA_DIR = path.join(ROOT, 'data');
let USER_DIR; let USER_FICHES; let DATA_CACHE;

let settings; let winwatch; let ocr; let updater;
let gd = null; // GameData
let panel = null; let board = null; let tray = null;

const state = {
  ficheId: null,
  source: null, // 'auto' | 'manuel'
  pinned: false,
  lastAutoId: null,
  view: 'fiche', // 'fiche' | 'combat'
  combat: {
    ids: [], aberrations: [], at: 0, reading: false, info: '', text: '', preview: null,
  },
  focusMonster: null,
  turn: 1,
  detection: {
    enabled: true, text: '', preview: null, match: null, time: 0, error: null,
    dofusVisible: false, dofusTitle: '',
  },
  harebourg: { baseQ: 1, hp: null, meleeLines: 0, me: null, target: null, at: 0 },
  board: { mode: 'idle' },
  panelHidden: false,
  dataRev: 0,
  update: null, // { version, url } si une nouvelle version existe
  dataInfo: '',
};

let dofusWin = null; // dernière fenêtre Dofus connue (pixels physiques)
const perWindow = new Map(); // hwnd -> ficheId détecté

// ---------------------------------------------------------------- Données

function loadData() {
  const t0 = Date.now();
  gd = new GameData({ dataDir: DATA_DIR, overlayDir: updater ? updater.activeOverlay() : null, userDir: USER_FICHES });
  state.dataRev++;
  if (state.ficheId && !gd.fiches.has(state.ficheId)) state.ficheId = null;
  console.log(`[vigie] données chargées en ${Date.now() - t0} ms`, gd.stats());
}

async function checkUpdates() {
  if (!updater) return;
  try {
    const r = await updater.check();
    if (r.updated) {
      loadData();
      state.dataInfo = `Données mises à jour (${r.changed} fichier${r.changed > 1 ? 's' : ''})`;
      broadcast();
    }
  } catch (e) {
    console.warn('[vigie] mise à jour des données impossible :', e.message);
  }
  try {
    const rel = await updater.latestRelease(VERSION);
    if (rel) { state.update = rel; broadcast(); }
  } catch (e) {
    console.warn('[vigie] vérification de version impossible :', e.message);
  }
}

function pushRecent(id) {
  if (!id) return;
  const recent = [id, ...(settings.get().recent || []).filter((r) => r !== id)].slice(0, 8);
  settings.set({ recent });
}

// ------------------------------------------------------------ Diffusion

function publicState() {
  const s = settings.get();
  return {
    ficheId: state.ficheId,
    source: state.source,
    pinned: state.pinned,
    view: state.view,
    combat: state.combat,
    focusMonster: state.focusMonster,
    songe: state.ficheId === 'songes',
    turn: state.turn,
    detection: { ...state.detection, enabled: s.detection.enabled },
    harebourg: { ...state.harebourg, q: currentQ() },
    board: state.board,
    sizeKey: sizeKey(),
    calibration: s.harebourg.calibration[sizeKey()] || null,
    platform: process.platform,
    dataRev: state.dataRev,
    update: state.update,
    dataInfo: state.dataInfo,
    recent: s.recent || [],
  };
}

function broadcast() {
  const ps = publicState();
  for (const w of [panel, board]) {
    if (w && !w.isDestroyed()) w.webContents.send('vigie:state', ps);
  }
}

function currentQ() {
  const s = settings.get();
  return Harebourg.effectiveRotation(state.harebourg.baseQ, state.harebourg.meleeLines, s.harebourg.meleeDir);
}

function setFiche(id, source) {
  const changed = id !== state.ficheId;
  state.ficheId = id;
  state.source = source;
  state.pinned = source === 'manuel';
  if (changed) {
    state.turn = 1;
    state.harebourg.meleeLines = 0;
    state.harebourg.me = null;
    state.harebourg.target = null;
    state.view = 'fiche';
    pushRecent(id);
  }
  broadcast();
}

// ------------------------------------------------------------ Combat

/** Ajoute des monstres à la liste du combat (ou la remplace si elle est ancienne). */
function addCombat(ids, { aberrations = [], replace = false } = {}) {
  const c = state.combat;
  const merge = !replace && Date.now() - c.at < (settings.get().combat.mergeWindowMs || 120000);
  const base = merge ? c.ids : [];
  const ab = merge ? c.aberrations : [];
  const list = [...ids.filter((id) => !base.includes(id)), ...base].slice(0, 16);
  state.combat = { ...c, ids: list, aberrations: [...new Set([...aberrations, ...ab])], at: Date.now() };
  state.view = 'combat';
  state.focusMonster = ids[0] || null;
}

function removeCombat(id) {
  state.combat = { ...state.combat, ids: state.combat.ids.filter((x) => x !== id) };
  broadcast();
}

function clearCombat() {
  state.combat = { ...state.combat, ids: [], aberrations: [], at: 0, info: '' };
  state.focusMonster = null;
  broadcast();
}

// -------------------------------------------------------------- Fenêtres

function sizeKey() {
  if (dofusWin) return `${dofusWin.w}x${dofusWin.h}`;
  const d = screen.getPrimaryDisplay();
  return `${d.size.width}x${d.size.height}`;
}

function dofusDipRect() {
  if (!dofusWin || process.platform !== 'win32') {
    return screen.getPrimaryDisplay().bounds;
  }
  return screen.screenToDipRect(null, { x: dofusWin.x, y: dofusWin.y, width: dofusWin.w, height: dofusWin.h });
}

function createPanel() {
  const s = settings.get();
  const wa = screen.getPrimaryDisplay().workArea;
  const b = s.panel.bounds || { width: 390, height: 640, x: wa.x + wa.width - 410, y: wa.y + 80 };
  panel = new BrowserWindow({
    ...b,
    minWidth: 300,
    minHeight: 180,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Vigie — panneau',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  panel.setAlwaysOnTop(true, 'screen-saver', 2);
  panel.setContentProtection(!!s.contentProtection);
  panel.setOpacity(s.panel.opacity || 1);
  panel.loadFile(path.join(ROOT, 'renderer', 'panel.html'));
  panel.once('ready-to-show', () => panel.showInactive());
  let t;
  const saveBounds = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!panel || panel.isDestroyed()) return;
      const nb = panel.getBounds();
      // Le mode réduit ne doit pas écraser la hauteur normale enregistrée.
      if (nb.height < 260) nb.height = (settings.get().panel.bounds || {}).height || 640;
      settings.set({ panel: { bounds: nb } });
    }, 400);
  };
  panel.on('move', saveBounds);
  panel.on('resize', saveBounds);
  panel.on('closed', () => { panel = null; });
  panel.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createBoard() {
  const s = settings.get();
  board = new BrowserWindow({
    ...dofusDipRect(),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    title: 'Vigie — calque',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  board.setAlwaysOnTop(true, 'screen-saver', 1);
  board.setIgnoreMouseEvents(true);
  board.setContentProtection(!!s.contentProtection);
  board.loadFile(path.join(ROOT, 'renderer', 'board.html'));
  board.once('ready-to-show', () => board.showInactive());
  board.on('closed', () => { board = null; });
}

function placeBoard() {
  if (!board || board.isDestroyed()) return;
  const r = dofusDipRect();
  const cur = board.getBounds();
  if (cur.x !== r.x || cur.y !== r.y || cur.width !== r.width || cur.height !== r.height) {
    board.setBounds(r);
  }
}

function setBoardMode(mode) {
  state.board = { mode };
  if (board && !board.isDestroyed()) {
    const interactive = mode === 'calibrate' || mode === 'ocrzone';
    board.setIgnoreMouseEvents(!interactive);
    board.setFocusable(interactive);
    if (interactive) { board.showInactive(); board.focus(); } else { board.blur(); }
  }
  broadcast();
}

function showOverlay() {
  if (panel && !state.panelHidden && !panel.isVisible()) panel.showInactive();
  if (board && !board.isVisible()) board.showInactive();
}

function hideOverlay() {
  if (state.board.mode !== 'idle') return; // ne pas masquer pendant un réglage
  if (panel && panel.isVisible()) panel.hide();
  if (board && board.isVisible()) board.hide();
}

// ------------------------------------------------------- Fenêtre active

function isDofus(info) {
  const re = new RegExp(settings.get().detection.processPattern || '^dofus', 'i');
  return re.test(info.process || '');
}

function onForeground(info) {
  if (!info) return;
  const mine = info.pid === process.pid || /^Vigie/.test(info.title || '');
  if (isDofus(info) && !info.minimized && info.w > 0) {
    const switched = !dofusWin || dofusWin.hwnd !== info.hwnd;
    dofusWin = info;
    state.detection.dofusVisible = true;
    state.detection.dofusTitle = info.title;
    placeBoard();
    showOverlay();
    if (switched) {
      const known = perWindow.get(info.hwnd);
      if (known && !state.pinned && known !== state.ficheId && gd.fiches.has(known)) setFiche(known, 'auto');
      else broadcast();
    }
  } else if (!mine) {
    state.detection.dofusVisible = false;
    // On ne masque qu'une fois Dofus vu au moins une fois : au premier
    // lancement, le panneau reste visible même si le jeu n'est pas ouvert.
    if (settings.get().panel.autoHide && dofusWin) hideOverlay();
    broadcast();
  }
}

// -------------------------------------------------------------- Détection

let scanning = false;

async function scanOnce() {
  if (scanning) return;
  const s = settings.get();
  if (process.platform === 'win32' && !state.detection.dofusVisible) return;
  scanning = true;
  try {
    const frame = await capture.grab(process.platform === 'win32' ? dofusWin : null);
    const region = s.detection.fullWindow ? { x: 0, y: 0, w: 1, h: 1 } : s.detection.region;
    const sub = crop(frame.data, frame.width, frame.height, regionToRect(region, frame.width, frame.height));
    const bin = binarize(sub, { threshold: s.detection.threshold, scale: s.detection.fullWindow ? 1 : s.detection.scale });
    const png = nativeImage.createFromBitmap(bin.data, { width: bin.width, height: bin.height }).toPNG();
    const text = await ocr.recognize(png);
    if (text === null) return;
    const prevImg = nativeImage.createFromBuffer(png);
    const pw = Math.min(360, bin.width);
    const m = gd.detectMap(text);
    state.detection = {
      ...state.detection,
      text: text.trim(),
      preview: prevImg.resize({ width: pw }).toDataURL(),
      match: m ? { ficheId: m.ficheId, label: m.label, kind: m.kind, score: Math.round(m.score * 100) } : null,
      time: Date.now(),
      error: null,
    };
    if (m) {
      if (dofusWin) perWindow.set(dofusWin.hwnd, m.ficheId);
      const newPlace = m.ficheId !== state.lastAutoId;
      state.lastAutoId = m.ficheId;
      if ((!state.pinned || newPlace) && (m.ficheId !== state.ficheId || state.source !== 'auto')) {
        setFiche(m.ficheId, 'auto');
        return;
      }
    }
    broadcast();
  } catch (e) {
    state.detection.error = String(e && e.message ? e.message : e);
    broadcast();
  } finally {
    scanning = false;
  }
}

/** Image -> texte (PNG) avec la binarisation demandée. */
async function readImage(img, opts) {
  const bin = binarize(img, opts);
  const png = nativeImage.createFromBitmap(bin.data, { width: bin.width, height: bin.height }).toPNG();
  const text = await ocr.recognize(png, { wait: true });
  return { text: text || '', png, width: bin.width };
}

/**
 * Lecture à la demande des noms de monstres (raccourci) : zone autour du
 * curseur (infobulle d'un groupe, d'un monstre ou de la timeline), en texte
 * clair puis sombre ; si rien n'est trouvé, toute la fenêtre.
 */
async function scanMonsters() {
  if (state.combat.reading) return;
  const s = settings.get();
  state.combat = { ...state.combat, reading: true, info: 'Lecture des monstres…' };
  broadcast();
  try {
    const frame = await capture.grab(process.platform === 'win32' ? dofusWin : null);
    const cur = screen.getCursorScreenPoint();
    let local;
    if (process.platform === 'win32' && dofusWin) {
      const phys = screen.dipToScreenPoint(cur);
      local = { x: (phys.x - dofusWin.x) * (frame.width / dofusWin.w), y: (phys.y - dofusWin.y) * (frame.height / dofusWin.h) };
    } else {
      const d = screen.getPrimaryDisplay();
      local = { x: (cur.x - d.bounds.x) * (frame.width / d.bounds.width), y: (cur.y - d.bounds.y) * (frame.height / d.bounds.height) };
    }
    const W = frame.width; const H = frame.height;
    const rect = cursorRect(local, W, H, s.combat.cursorBox);
    const around = crop(frame.data, W, H, rect);

    const texts = [];
    let preview = null;
    let found = { ids: [], aberrations: [] };
    for (const p of scanPasses({ threshold: s.detection.threshold, darkThreshold: s.combat.darkThreshold })) {
      const r = await readImage(around, p.opts);
      texts.push(r.text);
      if (!preview) preview = nativeImage.createFromBuffer(r.png).resize({ width: Math.min(360, r.width) }).toDataURL();
      found = gd.detectMonsters(texts.join('\n'));
    }
    if (!found.ids.length && !found.aberrations.length && rect.inside && s.combat.fullWindowFallback !== false) {
      const r = await readImage({ data: frame.data, width: W, height: H }, { threshold: s.detection.threshold, scale: 1 });
      texts.push(r.text);
      found = gd.detectMonsters(texts.join('\n'));
    }
    let ids = found.ids.map(Number);
    // En Songe, les monstres ont un niveau élevé : sans niveau lu, on montre
    // leur version 200+.
    if (state.ficheId === 'songes' || s.combat.preferHighLevel) ids = ids.map((id) => (found.levels[id] ? id : gd.highVariant(id)));
    const n = ids.length;
    if (n || found.aberrations.length) {
      addCombat(ids, { aberrations: found.aberrations });
      const parts = [];
      if (n) parts.push(`${n} monstre${n > 1 ? 's' : ''} reconnu${n > 1 ? 's' : ''}`);
      if (found.aberrations.length) parts.push(`Aberration : ${found.aberrations.join(', ')}`);
      state.combat.info = parts.join(' · ');
    } else {
      state.combat.info = 'Aucun nom de monstre lu : survole le groupe (ou un monstre de la timeline) puis réessaie.';
    }
    state.combat = { ...state.combat, text: texts.join('\n---\n').trim(), preview };
  } catch (e) {
    state.combat = { ...state.combat, info: `Erreur de lecture : ${String(e && e.message ? e.message : e)}` };
  } finally {
    state.combat = { ...state.combat, reading: false };
    broadcast();
  }
}

function scanLoop() {
  const s = settings.get();
  const next = () => setTimeout(scanLoop, Math.max(700, s.detection.intervalMs || 2000));
  if (!s.detection.enabled) { next(); return; }
  scanOnce().finally(next);
}

// -------------------------------------------------------------- Harebourg

/** Place « toi » puis « la cible » à la position du curseur (sans clic). */
function aimAtCursor() {
  if (!board) return;
  const p = screen.getCursorScreenPoint();
  const b = board.getBounds();
  const local = { x: p.x - b.x, y: p.y - b.y };
  if (local.x < 0 || local.y < 0 || local.x > b.width || local.y > b.height) return;
  const h = state.harebourg;
  if (!h.me || h.target) {
    h.me = local; h.target = null;
  } else {
    h.target = local;
  }
  h.at = Date.now();
  broadcast();
}

if (process.env.VIGIE_TEST) {
  global.__vigieTestAim = (me, target) => {
    Object.assign(state.harebourg, { me, target, at: Date.now() });
    broadcast();
  };
  // Simule une lecture de noms de monstres (texte OCR fourni).
  global.__vigieTestMonsters = (text) => {
    const found = gd.detectMonsters(text);
    let ids = found.ids.map(Number);
    if (state.ficheId === 'songes') ids = ids.map((id) => (found.levels[id] ? id : gd.highVariant(id)));
    addCombat(ids, { aberrations: found.aberrations });
    state.combat.info = `${ids.length} monstres reconnus`;
    broadcast();
    return ids;
  };
}

function clearAim() {
  state.harebourg.me = null;
  state.harebourg.target = null;
  broadcast();
}

// -------------------------------------------------------------- Raccourcis

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const hk = settings.get().hotkeys;
  const failed = [];
  const reg = (acc, fn) => {
    if (!acc) return;
    try { if (!globalShortcut.register(acc, fn)) failed.push(acc); } catch (e) { failed.push(acc); }
  };
  reg(hk.togglePanel, () => {
    if (!panel) return;
    state.panelHidden = panel.isVisible();
    if (state.panelHidden) panel.hide(); else panel.showInactive();
  });
  reg(hk.search, () => {
    if (!panel) return;
    state.panelHidden = false;
    panel.show(); panel.focus();
    panel.webContents.send('vigie:focus-search');
  });
  reg(hk.harebourgAim, aimAtCursor);
  reg(hk.harebourgClear, clearAim);
  reg(hk.nextTurn, () => setTurn(state.turn + 1));
  reg(hk.prevTurn, () => setTurn(state.turn - 1));
  reg(hk.resetTurn, () => setTurn(1));
  reg(hk.forceScan, () => { scanOnce(); });
  reg(hk.scanMonsters, () => { scanMonsters(); });
  reg(hk.clearMonsters, clearCombat);
  if (failed.length) console.warn('[vigie] raccourcis indisponibles :', failed.join(', '));
  state.hotkeysFailed = failed;
}

function setTurn(n) {
  state.turn = Math.max(1, Math.min(99, n | 0));
  state.harebourg.meleeLines = 0;
  broadcast();
}

// -------------------------------------------------------------- IPC

function registerIpc() {
  ipcMain.handle('vigie:init', () => ({
    settings: settings.get(),
    state: publicState(),
    stats: gd.stats(),
    hotkeysFailed: state.hotkeysFailed || [],
    defaults: { tiers: Harebourg.DEFAULT_TIERS },
    version: VERSION,
  }));
  ipcMain.handle('vigie:fiche', (_e, id) => gd.ficheView(id));
  ipcMain.handle('vigie:fiche-label', (_e, ids) => (ids || []).slice(0, 20).map((id) => {
    const f = gd.fiches.get(id);
    return f ? { id, nom: f.nom, donjon: f.donjon, niveau: f.niveau, guide: !!f.guide, type: f.type } : null;
  }).filter(Boolean));
  ipcMain.handle('vigie:monsters', (_e, ids) => (ids || []).slice(0, 40).map((id) => gd.monsterView(id)).filter(Boolean));
  ipcMain.handle('vigie:group', (_e, ids) => gd.groupSummary(ids || []));
  ipcMain.handle('vigie:select', (_e, id) => {
    if (id === null) {
      state.pinned = false; state.source = state.ficheId ? 'auto' : null; broadcast(); return;
    }
    if (gd.fiches.has(id)) { state.view = 'fiche'; setFiche(id, 'manuel'); }
  });
  ipcMain.handle('vigie:view', (_e, v) => { state.view = v === 'combat' ? 'combat' : 'fiche'; broadcast(); });
  ipcMain.handle('vigie:combat-add', (_e, id, opts) => {
    if (!gd.monsters[id]) return;
    addCombat([Number(id)], { replace: !!(opts && opts.replace) });
    broadcast();
  });
  ipcMain.handle('vigie:combat-swap', (_e, from, to) => {
    state.combat = { ...state.combat, ids: state.combat.ids.map((x) => (x === from ? Number(to) : x)) };
    if (state.focusMonster === from) state.focusMonster = Number(to);
    broadcast();
  });
  ipcMain.handle('vigie:combat-remove', (_e, id) => removeCombat(id));
  ipcMain.handle('vigie:combat-clear', () => clearCombat());
  ipcMain.handle('vigie:combat-scan', () => scanMonsters());
  ipcMain.handle('vigie:search', (_e, q) => gd.search(q, 14));
  ipcMain.handle('vigie:turn', (_e, n) => setTurn(n));
  ipcMain.handle('vigie:scan', () => scanOnce());
  ipcMain.handle('vigie:harebourg', (_e, patch) => {
    const h = state.harebourg;
    if ('baseQ' in patch) h.baseQ = ((patch.baseQ | 0) % 4 + 4) % 4;
    if ('meleeLines' in patch) h.meleeLines = Math.max(0, Math.min(10, patch.meleeLines | 0));
    if ('hp' in patch) {
      h.hp = patch.hp;
      const q = Harebourg.rotationFromHp(patch.hp, settings.get().harebourg.tiers || Harebourg.DEFAULT_TIERS);
      if (q !== null) h.baseQ = q;
    }
    if (patch.clear) { h.me = null; h.target = null; }
    broadcast();
  });
  ipcMain.handle('vigie:board-mode', (_e, mode) => setBoardMode(mode));
  ipcMain.handle('vigie:board-done', (_e, mode, payload) => {
    if (mode === 'calibrate' && payload) {
      const cal = { ...settings.get().harebourg.calibration, [sizeKey()]: payload };
      settings.set({ harebourg: { calibration: cal } });
    }
    if (mode === 'ocrzone' && payload) {
      settings.set({ detection: { region: payload } });
      setTimeout(() => scanOnce(), 300);
    }
    setBoardMode('idle');
    if (panel) panel.webContents.send('vigie:settings', settings.get());
  });
  ipcMain.handle('vigie:settings', (_e, patch) => {
    const s = settings.set(patch || {});
    if (patch && patch.hotkeys) registerHotkeys();
    if (patch && 'contentProtection' in patch) {
      for (const w of [panel, board]) if (w) w.setContentProtection(!!s.contentProtection);
    }
    if (patch && patch.panel && 'opacity' in patch.panel && panel) panel.setOpacity(s.panel.opacity);
    broadcast();
    return s;
  });
  ipcMain.handle('vigie:open', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('vigie:open-fiches', () => {
    fs.mkdirSync(USER_FICHES, { recursive: true });
    shell.openPath(USER_FICHES);
  });
  ipcMain.handle('vigie:reload-fiches', () => { loadData(); broadcast(); return gd.stats(); });
  ipcMain.handle('vigie:check-updates', async () => { await checkUpdates(); return gd.stats(); });
  ipcMain.handle('vigie:hide', () => { state.panelHidden = true; if (panel) panel.hide(); });
  ipcMain.handle('vigie:panel-height', (_e, h) => {
    if (!panel) return;
    const b = panel.getBounds();
    panel.setBounds({ ...b, height: Math.max(120, Math.min(1400, Math.round(h))) });
  });
  ipcMain.handle('vigie:quit', () => app.quit());
}

// -------------------------------------------------------------- Tray

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ROOT, '..', 'assets', 'icon.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Vigie — aide aux combats Dofus');
  const menu = () => Menu.buildFromTemplate([
    { label: 'Afficher / masquer le panneau', click: () => { state.panelHidden = !state.panelHidden; if (state.panelHidden) panel.hide(); else panel.show(); } },
    {
      label: 'Détection automatique',
      type: 'checkbox',
      checked: settings.get().detection.enabled,
      click: (it) => { settings.set({ detection: { enabled: it.checked } }); broadcast(); },
    },
    { type: 'separator' },
    { label: 'Définir la zone de lecture…', click: () => { showOverlay(); setBoardMode('ocrzone'); } },
    { label: 'Calibrer la grille de combat…', click: () => { showOverlay(); setBoardMode('calibrate'); } },
    { label: 'Lire les monstres sous le curseur', click: () => scanMonsters() },
    { label: 'Ouvrir le dossier des guides perso', click: () => { fs.mkdirSync(USER_FICHES, { recursive: true }); shell.openPath(USER_FICHES); } },
    { type: 'separator' },
    { label: 'Quitter Vigie', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu());
  tray.on('click', () => { state.panelHidden = false; panel.show(); });
  tray.on('right-click', () => tray.setContextMenu(menu()));
}

// -------------------------------------------------------------- Démarrage

app.whenReady().then(() => {
  USER_DIR = app.getPath('userData');
  USER_FICHES = path.join(USER_DIR, 'fiches');
  DATA_CACHE = path.join(USER_DIR, 'donnees');
  settings = new Settings(USER_DIR);
  ocr = new Ocr(path.join(USER_DIR, 'ocr-cache'));
  const { net } = require('electron');
  updater = new DataUpdater({ bundledDir: DATA_DIR, cacheDir: DATA_CACHE, fetchFn: (u, o) => net.fetch(u, o) });
  loadData();
  registerIpc();
  createPanel();
  if (!process.env.VIGIE_NO_BOARD) createBoard();
  try { createTray(); } catch (e) { console.warn('[vigie] icône de notification indisponible', e.message); }
  registerHotkeys();

  winwatch = new WinWatch(__dirname);
  winwatch.on('change', onForeground);
  winwatch.start();

  ocr.init().catch((e) => { state.detection.error = `OCR : ${e.message}`; broadcast(); });
  setTimeout(scanLoop, 1500);
  if (settings.get().updates !== false && !process.env.VIGIE_TEST) {
    setTimeout(checkUpdates, 8000);
    setInterval(checkUpdates, 6 * 3600 * 1000);
  }

  // Les repères Harebourg s'effacent seuls après un délai.
  setInterval(() => {
    const h = state.harebourg;
    const ttl = settings.get().harebourg.markerTimeoutMs || 30000;
    if ((h.me || h.target) && Date.now() - h.at > ttl) clearAim();
  }, 1000);
});

app.on('second-instance', () => { if (panel) { state.panelHidden = false; panel.show(); } });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (winwatch) winwatch.stop();
  if (ocr) ocr.stop();
});
app.on('window-all-closed', () => app.quit());
