'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Raccourcis globaux (syntaxe Electron « Accelerator »).
  hotkeys: {
    togglePanel: 'Control+Alt+O',
    search: 'Control+Alt+F',
    harebourgAim: 'Control+Alt+H',
    harebourgClear: 'Control+Alt+Shift+H',
    nextTurn: 'Control+Alt+T',
    prevTurn: 'Control+Alt+Shift+T',
    resetTurn: 'Control+Alt+R',
    forceScan: 'Control+Alt+D',
    // Lecture des noms de monstres sous le curseur (combat, Songes).
    scanMonsters: 'Control+Alt+M',
    clearMonsters: 'Control+Alt+Shift+M',
  },
  detection: {
    enabled: true,
    intervalMs: 2000,
    // Zone lue par l'OCR, en fractions de la fenêtre Dofus (coin haut-gauche).
    region: { x: 0, y: 0, w: 0.34, h: 0.13 },
    fullWindow: false,
    threshold: 165,
    scale: 2,
    // Nom de processus de la fenêtre du jeu (expression régulière).
    processPattern: '^dofus',
  },
  combat: {
    // Une nouvelle lecture moins de 2 min après la précédente complète la
    // liste ; au-delà, elle la remplace (nouveau combat).
    mergeWindowMs: 120000,
    // Zone lue autour du curseur, en fractions de la fenêtre du jeu.
    cursorBox: { w: 0.46, up: 0.34, down: 0.14 },
    darkThreshold: 95,
    fullWindowFallback: true,
    // Afficher la version niv. 200+ des monstres (toujours vrai en Songe).
    preferHighLevel: false,
  },
  recent: [],
  // Vérifier les nouvelles données et versions sur GitHub.
  updates: true,
  panel: {
    bounds: null,
    opacity: 0.96,
    autoHide: true, // masquer quand ni Dofus ni Vigie n'est au premier plan
    compact: false,
  },
  // Les fenêtres de Vigie sont invisibles aux captures (OCR, streams).
  contentProtection: true,
  harebourg: {
    tiers: null, // null = table par défaut (core/harebourg.js)
    meleeDir: -1, // -1 = anti-horaire (guides), +1 si tu constates l'inverse
    // Calibrage de la grille, par taille de fenêtre : "1920x1080" -> {x,y,w}
    calibration: {},
    markerTimeoutMs: 30000,
  },
};

function deepMerge(base, extra) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return extra === undefined ? base : extra;
  }
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    out[k] = (k in base) ? deepMerge(base[k], extra[k]) : extra[k];
  }
  return out;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = deepMerge(DEFAULTS, {});
    try {
      if (fs.existsSync(this.file)) {
        this.data = deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
      }
    } catch (e) {
      console.error('[vigie] réglages illisibles, valeurs par défaut', e);
    }
  }

  get() { return this.data; }

  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.save();
    return this.data;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('[vigie] impossible d\'enregistrer les réglages', e);
    }
  }
}

module.exports = { Settings, DEFAULTS, deepMerge };
