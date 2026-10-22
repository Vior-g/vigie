'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(`vigie:${ch}`, ...args);

contextBridge.exposeInMainWorld('vigie', {
  init: () => invoke('init'),
  select: (id, monstre) => invoke('select', id, monstre || null),
  search: (q) => invoke('search', q),
  setTurn: (n) => invoke('turn', n),
  monsters: (names) => invoke('monsters', names),
  scan: () => invoke('scan'),
  harebourg: (patch) => invoke('harebourg', patch),
  boardMode: (mode) => invoke('board-mode', mode),
  boardDone: (mode, payload) => invoke('board-done', mode, payload),
  setSettings: (patch) => invoke('settings', patch),
  open: (url) => invoke('open', url),
  openFiches: () => invoke('open-fiches'),
  reloadFiches: () => invoke('reload-fiches'),
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
