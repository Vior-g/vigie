'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(`vigie:${ch}`, ...args);

contextBridge.exposeInMainWorld('vigie', {
  init: () => invoke('init'),
  fiche: (id) => invoke('fiche', id),
  ficheLabels: (ids) => invoke('fiche-label', ids),
  monsters: (ids) => invoke('monsters', ids),
  group: (ids) => invoke('group', ids),
  select: (id) => invoke('select', id),
  view: (v) => invoke('view', v),
  combatAdd: (id, opts) => invoke('combat-add', id, opts || null),
  combatSwap: (from, to) => invoke('combat-swap', from, to),
  combatRemove: (id) => invoke('combat-remove', id),
  combatClear: () => invoke('combat-clear'),
  combatScan: () => invoke('combat-scan'),
  search: (q) => invoke('search', q),
  setTurn: (n) => invoke('turn', n),
  scan: () => invoke('scan'),
  harebourg: (patch) => invoke('harebourg', patch),
  boardMode: (mode) => invoke('board-mode', mode),
  boardDone: (mode, payload) => invoke('board-done', mode, payload),
  setSettings: (patch) => invoke('settings', patch),
  open: (url) => invoke('open', url),
  openFiches: () => invoke('open-fiches'),
  reloadFiches: () => invoke('reload-fiches'),
  checkUpdates: () => invoke('check-updates'),
  hide: () => invoke('hide'),
  panelHeight: (h) => invoke('panel-height', h),
  quit: () => invoke('quit'),
  on: (event, cb) => {
    const ch = `vigie:${event}`;
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
});
