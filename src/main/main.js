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
const { DofusDb } = require('./dofusdb');
const capture = require('./capture');
const matcher = require('../core/matcher');
const { crop, binarize, regionToRect } = require('../core/preprocess');
const Harebourg = require('../core/harebourg');

if (!app.requestSingleInstanceLock()) { app.quit(); }

const ROOT = path.join(__dirname, '..');
const BUILTIN_FICHES = path.join(ROOT, 'data', 'bosses');
let USER_DIR; let USER_FICHES;

let settings; let winwatch; let ocr; let dofusdb;
let panel = null; let board = null; let tray = null;

const state = {
  bosses: [],
  index: null,
  bossId: null,
  monstre: null,
  source: null, // 'auto' | 'manuel'
  pinned: false,
  lastAutoId: null,
  turn: 1,
  detection: {
    enabled: true, text: '', preview: null, match: null, time: 0, error: null,
    dofusVisible: false, dofusTitle: '',
  },
  harebourg: { baseQ: 1, hp: null, meleeLines: 0, me: null, target: null, at: 0 },
  board: { mode: 'idle' },
  panelHidden: false,
};

let dofusWin = null; // dernière fenêtre Dofus connue (pixels physiques)
const perWindow = new Map(); // hwnd -> bossId détecté

// ---------------------------------------------------------------- Fiches

function readFiches(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const b = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (b && b.id) out.push(b);
    } catch (e) {
      console.error(`[vigie] fiche invalide ignorée : ${f}`, e.message);
    }
  }
  return out;
}

function loadBosses() {
  const map = new Map();
  for (const b of readFiches(BUILTIN_FICHES)) map.set(b.id, b);
  for (const b of readFiches(USER_FICHES)) map.set(b.id, { ...b, perso: true });
  state.bosses = [...map.values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  state.index = matcher.buildIndex(state.bosses);
}

// ------------------------------------------------------------ Diffusion

function publicState() {
  const s = settings.get();
  return {
    bossId: state.bossId,
    monstre: state.monstre,
    source: state.source,
    pinned: state.pinned,
    turn: state.turn,
    detection: { ...state.detection, enabled: s.detection.enabled },
    harebourg: { ...state.harebourg, q: currentQ() },
    board: state.board,
    sizeKey: sizeKey(),
    calibration: s.harebourg.calibration[sizeKey()] || null,
    platform: process.platform,
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

function setBoss(id, source, extra = {}) {
  const changed = id !== state.bossId;
  state.bossId = id;
  state.source = source;
  state.monstre = extra.monstre || null;
  state.pinned = source === 'manuel';
  if (changed) {
    state.turn = 1;
    state.harebourg.meleeLines = 0;
    state.harebourg.me = null;
    state.harebourg.target = null;
  }
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
      if (known && !state.pinned && known !== state.bossId) setBoss(known, 'auto');
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
    const m = matcher.match(text, state.index);
    state.detection = {
      ...state.detection,
      text: text.trim(),
      preview: prevImg.resize({ width: pw }).toDataURL(),
      match: m ? { bossId: m.bossId, label: m.label, kind: m.kind, score: Math.round(m.score * 100) } : null,
      time: Date.now(),
      error: null,
    };
    if (m) {
      if (dofusWin) perWindow.set(dofusWin.hwnd, m.bossId);
      const newDungeon = m.bossId !== state.lastAutoId;
      state.lastAutoId = m.bossId;
      if (!state.pinned || newDungeon) {
        if (m.bossId !== state.bossId || state.source !== 'auto') {
          setBoss(m.bossId, 'auto', { monstre: m.monstre });
          return;
        }
        if (m.monstre && m.monstre !== state.monstre) state.monstre = m.monstre;
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
    bosses: state.bosses,
    settings: settings.get(),
    state: publicState(),
    hotkeysFailed: state.hotkeysFailed || [],
    defaults: { tiers: Harebourg.DEFAULT_TIERS },
  }));
  ipcMain.handle('vigie:select', (_e, id, monstre) => {
    if (id === null) {
      state.pinned = false; state.source = state.bossId ? 'auto' : null; broadcast(); return;
    }
    if (state.bosses.some((b) => b.id === id)) setBoss(id, 'manuel', { monstre });
  });
  ipcMain.handle('vigie:search', (_e, q) => matcher.search(q, state.index));
  ipcMain.handle('vigie:turn', (_e, n) => setTurn(n));
  ipcMain.handle('vigie:monsters', (_e, names) => dofusdb.many(names.slice(0, 20)));
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
  ipcMain.handle('vigie:reload-fiches', () => { loadBosses(); return state.bosses; });
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
    { label: 'Ouvrir le dossier des fiches perso', click: () => { fs.mkdirSync(USER_FICHES, { recursive: true }); shell.openPath(USER_FICHES); } },
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
  settings = new Settings(USER_DIR);
  ocr = new Ocr(path.join(USER_DIR, 'ocr-cache'));
  dofusdb = new DofusDb(USER_DIR);
  loadBosses();
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
