/* Vigie — panneau principal */
'use strict';

const H = window.Harebourg;
const $ = (id) => document.getElementById(id);

/** Petit constructeur DOM sûr (textContent uniquement). */
function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.setAttribute('style', v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

/** replaceChildren qui ignore null / false. */
function put(node, ...kids) {
  node.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  return node;
}

const ELEMENTS = [
  ['neutre', 'Neutre'], ['terre', 'Terre'], ['feu', 'Feu'], ['eau', 'Eau'], ['air', 'Air'],
];
const TABS = [
  ['essentiel', 'Essentiel'], ['visee', 'Visée'], ['mecaniques', 'Mécaniques'], ['monstres', 'Monstres'],
  ['strategie', 'Stratégie'], ['succes', 'Succès'], ['acces', 'Accès'],
];

let D = { bosses: [], settings: null, state: null, defaults: {}, hotkeysFailed: [] };
const ui = {
  tab: 'essentiel', bossKey: null, tabKey: null, settingsOpen: false, compact: false,
  monsters: {}, liveBoss: {}, sel: -1, results: [], mini: { me: null, target: null }, normalHeight: null,
};

const boss = () => D.bosses.find((b) => b.id === (D.state && D.state.bossId)) || null;
const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('fr-FR'));
const hk = (name) => (D.settings && D.settings.hotkeys[name]) || '';
const prettyKey = (acc) => acc.replace(/Control/g, 'Ctrl').replace(/Shift/g, 'Maj').replace(/\+/g, ' + ');

// ------------------------------------------------------------------ rendu

function render() {
  renderHeader();
  renderStatus();
  const b = boss();
  $('empty').hidden = !!b;
  $('fiche').hidden = !b;
  if (!b) { renderQuick(); ui.bossKey = null; return; }

  if (ui.bossKey !== b.id) {
    ui.bossKey = b.id;
    ui.tab = D.state.monstre ? 'monstres' : 'essentiel';
    ui.tabKey = null;
    ui.mini = { me: null, target: null };
    loadLiveBoss(b);
  } else if (D.state.monstre && ui.lastMonstre !== D.state.monstre) {
    ui.tab = 'monstres';
    ui.tabKey = null;
  }
  ui.lastMonstre = D.state.monstre;

  renderTurn(b);
  renderStats(b);
  renderTabs(b);
  const key = `${b.id}|${ui.tab}`;
  if (ui.tabKey !== key) { ui.tabKey = key; renderTab(b); }
  else if (ui.tab === 'visee') updateVisee(b);
  if (ui.settingsOpen) updateOcrDebug();
  if (ui.compact) fitCompact();
}

/** En mode réduit, la fenêtre se cale sur l'en-tête + rappels du tour. */
function fitCompact() {
  requestAnimationFrame(() => {
    const main = $('main');
    const content = boss() ? $('fiche') : $('empty');
    const h = Math.ceil(main.offsetTop + content.offsetHeight + 20);
    if (Math.abs(h - window.innerHeight) > 2) window.vigie.panelHeight(h);
  });
}

function renderHeader() {
  const b = boss();
  const p = $('portrait');
  $('bossName').textContent = b ? b.nom : 'Vigie';
  $('dungeonName').textContent = b ? `${b.donjon} · ${b.zone || ''}` : 'Aide aux combats de boss';
  const img = b && (ui.liveBoss[b.id]?.image || b.image);
  const initial = b ? b.nom.slice(0, 1) : 'V';
  if (p.dataset.src === (img || initial)) return;
  p.dataset.src = img || initial;
  if (img) {
    put(p, el('img', { src: img, alt: '', onerror: () => { p.textContent = initial; } }));
  } else {
    p.textContent = initial;
  }
}

function renderStatus() {
  const s = D.state; const st = $('status');
  st.replaceChildren();
  const det = s.detection || {};
  let dot = 'dot'; let text; let action = null;
  if (!det.enabled) {
    text = 'Détection en pause';
    action = el('button', { class: 'chip-btn', onclick: () => setSettings({ detection: { enabled: true } }) }, 'Reprendre');
  } else if (det.error) {
    dot += ' err'; text = `Erreur : ${det.error}`;
  } else if (s.pinned) {
    dot += ' pin'; text = 'Fiche choisie à la main';
    action = el('button', { class: 'chip-btn', onclick: () => window.vigie.select(null) }, 'Revenir en auto');
  } else if (s.platform === 'win32' && !det.dofusVisible) {
    text = 'En attente de la fenêtre Dofus…';
  } else if (det.match) {
    dot += ' on'; text = `Auto · « ${det.match.label} » (${det.match.score} %)`;
  } else {
    dot += ' on'; text = det.time ? 'Détection active · rien de reconnu sur la carte' : 'Détection en cours de démarrage…';
  }
  st.append(el('span', { class: dot }), el('span', { class: 'grow', title: det.text || '' }, text));
  if (action) st.append(action);
}

function renderQuick() {
  const q = $('quick');
  if (q.childElementCount === D.bosses.length) return;
  q.replaceChildren(...D.bosses.map((b) => el('button', { onclick: () => window.vigie.select(b.id) },
    b.image ? el('img', { src: b.image, alt: '', onerror: (e) => e.target.remove() }) : null,
    el('span', {}, el('strong', {}, b.nom), el('small', {}, b.donjon)))));
}

function renderTurn(b) {
  const t = D.state.turn;
  $('turnNum').textContent = t;
  const par = $('turnParity');
  par.textContent = t % 2 === 0 ? 'tour pair' : 'tour impair';
  par.className = `parity ${t % 2 === 0 ? 'pair' : ''}`;
  const rules = window.TurnRules.rulesFor(b, t);
  $('reminders').replaceChildren(...rules.map((r) => el('li', { class: r.level || 'info' }, r.text)));
}

function renderStats(b) {
  const live = ui.liveBoss[b.id];
  const st = { ...b.stats, ...(live ? { pv: live.pv, pa: live.pa, pm: live.pm, res: live.res } : {}) };
  const pv = Array.isArray(st.pv) ? (st.pv[0] === st.pv[1] ? fmt(st.pv[0]) : `${fmt(st.pv[0])} – ${fmt(st.pv[1])}`) : fmt(st.pv);
  put($('stats'), 
    el('span', {}, 'Niv. ', el('b', {}, st.niveau || '?')),
    el('span', {}, el('b', {}, pv), ' PV'),
    el('span', {}, el('b', {}, st.pa ?? '?'), ' PA'),
    el('span', {}, el('b', {}, st.pm ?? '?'), ' PM'),
    live ? el('span', { title: 'Valeurs à jour depuis DofusDB' }, '· DofusDB ✓') : null,
  );
  $('res').replaceChildren(...resChips(st.res));
}

function resChips(res) {
  if (!res) return [];
  const vals = ELEMENTS.map(([k]) => res[k]).filter((v) => typeof v === 'number');
  const min = Math.min(...vals);
  return ELEMENTS.map(([k, label]) => el('div', {
    class: `r ${res[k] === min ? 'best' : ''}`, style: `--c: var(--${k})`, title: `Résistance ${label}`,
  }, el('div', { class: 'n' }, label), el('div', { class: 'v' }, res[k] == null ? '?' : `${res[k]}%`)));
}

function renderTabs(b) {
  const tabs = TABS.filter(([id]) => id !== 'visee' || b.outil === 'harebourg');
  $('tabs').replaceChildren(...tabs.map(([id, label]) => el('button', {
    class: ui.tab === id ? 'on' : '', onclick: () => { ui.tab = id; render(); },
  }, label)));
}

function renderTab(b) {
  const body = $('tabbody');
  body.replaceChildren();
  const T = ui.tab;
  if (T === 'essentiel') {
    body.append(el('ul', { class: 'list' }, (b.essentiel || []).map((t) => el('li', {}, t))));
    if (b.salleBoss) body.append(el('p', { class: 'note' }, b.salleBoss));
  } else if (T === 'mecaniques') {
    body.append(el('ul', { class: 'list' },
      (b.mecaniques || []).map((m) => el('li', {}, el('h4', {}, m.titre), el('p', {}, m.texte))),
      (b.sortsBoss || []).length ? el('li', {}, el('h4', {}, `Sorts de ${b.nom}`),
        el('ul', { style: 'margin:4px 0 0;padding-left:16px' }, b.sortsBoss.map((s) => el('li', {}, el('b', {}, s.nom), ' — ', s.texte)))) : null));
  } else if (T === 'monstres') {
    renderMonsters(b, body);
  } else if (T === 'strategie') {
    body.append(el('ol', { class: 'steps' }, (b.strategie || []).map((t) => el('li', {}, t))));
    if ((b.pieges || []).length) {
      body.append(el('h4', { style: 'margin:12px 0 6px' }, 'Pièges à éviter'),
        el('ul', { class: 'list' }, b.pieges.map((t) => el('li', { class: 'danger-haut' }, t))));
    }
  } else if (T === 'succes') {
    body.append(el('ul', { class: 'list' }, (b.succes || []).map((s) => el('li', {}, el('h4', {}, s.nom), el('p', {}, s.texte)))));
  } else if (T === 'acces') {
    body.append(el('ul', { class: 'list' }, (b.acces || []).map((t) => el('li', {}, t))));
    body.append(el('h4', { style: 'margin:12px 0 6px' }, 'Sources'),
      el('ul', { class: 'list' }, (b.sources || []).map((s) => el('li', {},
        el('a', { onclick: () => window.vigie.open(s.url) }, s.titre)))));
    body.append(el('p', { class: 'note' }, `Fiche mise à jour le ${b.maj || '?'}${b.perso ? ' · fiche perso' : ''}. Les guides peuvent dater : vérifie en jeu après une mise à jour d'Ankama.`));
  } else if (T === 'visee') {
    renderVisee(b, body);
  }
}

// --------------------------------------------------------------- monstres

async function loadLiveBoss(b) {
  try {
    const r = await window.vigie.monsters([b.nom]);
    if (r && r[b.nom] && r[b.nom].res) {
      ui.liveBoss[b.id] = r[b.nom];
      if (boss() && boss().id === b.id) { renderStats(b); renderHeader(); }
    }
  } catch (e) { /* hors ligne : on garde la fiche */ }
}

function renderMonsters(b, body) {
  const list = el('ul', { class: 'list' });
  const items = {};
  for (const m of b.monstres || []) {
    const li = el('li', { class: `danger-${m.danger || 'moyen'}`, 'data-name': m.nom });
    items[m.nom] = li;
    fillMonster(li, m);
    list.append(li);
  }
  body.append(list);
  const missing = (b.monstres || []).map((m) => m.nom).filter((n) => !(n in ui.monsters));
  if (missing.length) {
    window.vigie.monsters(missing).then((r) => {
      Object.assign(ui.monsters, r || {});
      for (const m of b.monstres || []) if (items[m.nom]?.isConnected) fillMonster(items[m.nom], m);
    }).catch(() => {});
  }
  const target = D.state.monstre && items[D.state.monstre];
  if (target) requestAnimationFrame(() => { target.scrollIntoView({ block: 'center' }); target.classList.add('focus-flash'); });
}

function fillMonster(li, m) {
  const live = ui.monsters[m.nom];
  const head = el('div', { class: 'monster-head' },
    live?.image ? el('img', { src: live.image, alt: '', onerror: (e) => e.target.remove() }) : null,
    el('h4', {}, m.nom),
    live?.pv ? el('span', { class: 'pv' }, `${fmt(live.pv[1])} PV · ${live.pa} PA · ${live.pm} PM`) : null);
  const kids = [head];
  if (live?.res) {
    const vals = ELEMENTS.map(([k]) => live.res[k]).filter((v) => typeof v === 'number');
    const min = Math.min(...vals);
    kids.push(el('div', { class: 'mini-res' }, ELEMENTS.map(([k, label]) => el('span', {
      style: `--c: var(--${k})`, class: live.res[k] === min ? 'best' : '', title: label,
    }, `${label.slice(0, 1)} ${live.res[k]}%`))));
  }
  kids.push(el('p', {}, m.texte));
  put(li, kids);
}

// -------------------------------------------------------------- Harebourg

function rotButton(q, glyph, label) {
  return el('button', { 'data-q': q, onclick: () => window.vigie.harebourg({ baseQ: q }) },
    el('span', { class: 'g' }, glyph), label);
}

function renderVisee(b, body) {
  const s = D.settings; const tiers = s.harebourg.tiers || D.defaults.tiers;
  const hpInput = el('input', {
    type: 'number', min: 0, max: 100, id: 'hpInput', placeholder: '%',
    oninput: (e) => { if (e.target.value !== '') window.vigie.harebourg({ hp: Number(e.target.value) }); },
  });
  const canvas = el('canvas', { class: 'mini', id: 'miniCanvas' });
  canvas.addEventListener('mousedown', (e) => onMiniClick(e, canvas));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const cal = D.state.calibration;

  body.append(
    el('p', { class: 'muted' }, 'Ta confusion de ce tour (état affiché dans tes envoûtements) :'),
    el('div', { class: 'rot', id: 'rotBtns' },
      rotButton(1, '↻', '90° horaire'), rotButton(2, '⟲', '180°'), rotButton(3, '↺', '90° anti-horaire')),
    el('div', { class: 'row' },
      el('label', { for: 'hpInput' }, 'Ou tes PV au début du tour :'), hpInput,
      el('span', { class: 'muted', id: 'tierHint' })),
    el('div', { class: 'row' },
      el('label', {}, 'Lignes de dégâts infligées au CàC ce tour :'),
      el('button', { class: 'step', onclick: () => window.vigie.harebourg({ meleeLines: D.state.harebourg.meleeLines - 1 }) }, '−'),
      el('b', { id: 'meleeNum' }, '0'),
      el('button', { class: 'step', onclick: () => window.vigie.harebourg({ meleeLines: D.state.harebourg.meleeLines + 1 }) }, '+')),
    el('div', { class: 'eff', id: 'effBox' }),
    el('h4', { style: 'margin:12px 0 2px' }, 'Simulateur'),
    el('p', { class: 'muted' }, 'Clic gauche : ta case · clic droit : la cible (Comte ou monstre).'),
    canvas,
    el('div', { class: 'legend' },
      el('span', { style: '--c:#55c7ff' }, el('i'), 'toi'),
      el('span', { style: '--c:#ff5d5d' }, el('i'), 'cible'),
      el('span', { style: '--c:#5cff8f' }, el('i'), 'case à viser'),
      el('span', { style: '--c:#ffae42' }, el('i'), 'où tomberait un tir direct'),
      el('span', { style: '--c:#c48bff' }, el('i'), 'arrivée de la téléportation')),
    el('h4', { style: 'margin:14px 0 4px' }, 'Directement sur le jeu'),
    el('ol', { class: 'steps' },
      el('li', {}, 'Survole ta case et appuie sur ', el('kbd', {}, prettyKey(hk('harebourgAim')))),
      el('li', {}, 'Survole la cible et appuie de nouveau sur le même raccourci.'),
      el('li', {}, 'Clique la case verte dans le jeu. ', el('kbd', {}, prettyKey(hk('harebourgClear'))), ' efface les repères.')),
    el('div', { class: 'row' },
      el('span', { class: 'muted', id: 'calStatus' },
        cal ? `Grille calibrée pour ${D.state.sizeKey}.` : 'Grille non calibrée : la visée en jeu sera approximative.'),
      el('button', { class: `btn ${cal ? '' : 'gold'}`, onclick: () => window.vigie.boardMode('calibrate') }, cal ? 'Recalibrer' : 'Calibrer la grille')),
    el('p', { class: 'note' }, `Paliers de PV indicatifs (source Papycha) : ${tiers.map((t) => `${t.min}–${t.max} % ${H.ROT_LABEL[H.ROT[t.rotation]]}`).join(' · ')}. Fie-toi d'abord à l'état affiché en combat ; la table se modifie dans les réglages.`),
  );
  requestAnimationFrame(() => updateVisee(b));
}

function updateVisee() {
  const h = D.state.harebourg;
  const btns = $('rotBtns');
  if (!btns) return;
  for (const btn of btns.children) btn.classList.toggle('on', Number(btn.dataset.q) === h.baseQ);
  $('meleeNum').textContent = h.meleeLines;
  const tiers = D.settings.harebourg.tiers || D.defaults.tiers;
  const hpIn = $('hpInput');
  if (h.hp != null && document.activeElement !== hpIn) hpIn.value = h.hp;
  const tier = h.hp != null ? tiers.find((t) => h.hp >= t.min && h.hp <= t.max) : null;
  $('tierHint').textContent = tier ? `→ ${H.ROT_LABEL[H.ROT[tier.rotation]]}` : '';
  const eff = $('effBox');
  eff.replaceChildren('Rotation à appliquer : ', el('b', {}, H.ROT_LABEL[h.q]),
    h.meleeLines ? ` (base ${H.ROT_LABEL[h.baseQ]}, ${h.meleeLines} coup${h.meleeLines > 1 ? 's' : ''} au CàC)` : '');
  drawMini();
}

function drawMini() {
  const canvas = $('miniCanvas');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth; const ch = canvas.clientHeight;
  if (canvas.width !== cw * dpr) { canvas.width = cw * dpr; canvas.height = ch * dpr; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const g = { w: 30, origin: { x: cw / 2, y: ch / 2 } };
  window.MiniGrid.drawGrid(ctx, g.origin, g.w, 9);
  const { me, target } = ui.mini;
  window.MiniGrid.drawMarks(ctx, g.origin, g.w, me, target, D.state.harebourg.q, D.state.turn, { labels: false });
}

function onMiniClick(e, canvas) {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const g = { w: 30, origin: { x: r.width / 2, y: r.height / 2 } };
  const c = H.snap(H.pixelToGrid({ x: e.clientX - r.left, y: e.clientY - r.top }, g.origin, g.w));
  if (e.button === 2) ui.mini.target = c; else ui.mini.me = c;
  drawMini();
}

// -------------------------------------------------------------- recherche

function setupSearch() {
  const input = $('search'); const box = $('results');
  let t;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = input.value.trim();
      if (!q) { box.hidden = true; return; }
      ui.results = await window.vigie.search(q);
      ui.sel = ui.results.length ? 0 : -1;
      drawResults();
    }, 80);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { ui.sel = Math.min(ui.results.length - 1, ui.sel + 1); drawResults(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { ui.sel = Math.max(0, ui.sel - 1); drawResults(); e.preventDefault(); }
    if (e.key === 'Enter' && ui.results[ui.sel]) pick(ui.results[ui.sel]);
    if (e.key === 'Escape') { input.value = ''; box.hidden = true; input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
}

function drawResults() {
  const box = $('results');
  const KIND = { donjon: 'donjon', boss: 'boss', monstre: 'monstre', entree: 'entrée' };
  box.replaceChildren(...ui.results.map((r, i) => {
    const b = D.bosses.find((x) => x.id === r.bossId);
    return el('button', { class: i === ui.sel ? 'sel' : '', onmousedown: (e) => { e.preventDefault(); pick(r); } },
      el('span', {}, r.label), r.kind === 'monstre' ? el('span', { class: 'muted' }, `· ${b ? b.nom : ''}`) : null,
      el('span', { class: 'kind' }, KIND[r.kind] || r.kind));
  }));
  box.hidden = !ui.results.length;
}

function pick(r) {
  $('search').value = '';
  $('results').hidden = true;
  $('search').blur();
  window.vigie.select(r.bossId, r.monstre || null);
}

// -------------------------------------------------------------- réglages

function setSettings(patch) {
  return window.vigie.setSettings(patch).then((s) => { D.settings = s; return s; });
}

function line(label, control) { return el('div', { class: 'line' }, el('span', {}, label), control); }

function checkbox(checked, onchange) {
  return el('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked) });
}

function openSettings() {
  ui.settingsOpen = true;
  const s = D.settings; const sh = $('settings');
  sh.hidden = false;
  const d = s.detection;
  const tiers = (s.harebourg.tiers || D.defaults.tiers).map((t) => ({ ...t }));

  const hotkeyInputs = {};
  const HOTKEY_LABELS = {
    togglePanel: 'Afficher / masquer', search: 'Recherche', harebourgAim: 'Visée : poser toi / la cible',
    harebourgClear: 'Visée : effacer', nextTurn: 'Tour suivant', prevTurn: 'Tour précédent',
    resetTurn: 'Revenir au tour 1', forceScan: 'Relire l\'écran maintenant',
  };

  sh.replaceChildren(
    el('h3', {}, 'Réglages', el('button', { class: 'btn', onclick: closeSettings }, 'Fermer')),
    el('fieldset', {}, el('legend', {}, 'Détection automatique'),
      line('Activée', checkbox(d.enabled, (v) => setSettings({ detection: { enabled: v } }))),
      line('Intervalle (ms)', el('input', { type: 'number', min: 700, step: 100, value: d.intervalMs, onchange: (e) => setSettings({ detection: { intervalMs: Number(e.target.value) } }) })),
      line('Seuil du texte clair (0-255)', el('input', { type: 'number', min: 60, max: 250, value: d.threshold, onchange: (e) => setSettings({ detection: { threshold: Number(e.target.value) } }) })),
      line('Agrandissement avant lecture', el('input', { type: 'number', min: 1, max: 4, value: d.scale, onchange: (e) => setSettings({ detection: { scale: Number(e.target.value) } }) })),
      line('Lire toute la fenêtre (plus lent)', checkbox(d.fullWindow, (v) => setSettings({ detection: { fullWindow: v } }))),
      line('Processus du jeu (regex)', el('input', { type: 'text', value: d.processPattern, onchange: (e) => setSettings({ detection: { processPattern: e.target.value } }) })),
      el('div', { class: 'row' },
        el('button', { class: 'btn gold', onclick: () => window.vigie.boardMode('ocrzone') }, 'Définir la zone de lecture'),
        el('button', { class: 'btn', onclick: () => window.vigie.scan() }, 'Lire maintenant')),
      el('div', { id: 'ocrDebug' })),
    el('fieldset', {}, el('legend', {}, 'Affichage'),
      line('Opacité du panneau', el('input', { type: 'range', min: 0.4, max: 1, step: 0.02, value: s.panel.opacity, oninput: (e) => setSettings({ panel: { opacity: Number(e.target.value) } }) })),
      line('Masquer hors de Dofus', checkbox(s.panel.autoHide, (v) => setSettings({ panel: { autoHide: v } }))),
      line('Invisible aux captures et aux streams', checkbox(s.contentProtection, (v) => setSettings({ contentProtection: v })))),
    el('fieldset', {}, el('legend', {}, 'Comte Harebourg'),
      el('p', { class: 'muted', style: 'margin:2px 0 6px' }, 'Paliers de PV → confusion. À corriger si tu constates autre chose en jeu.'),
      el('table', { class: 'tiers' }, tiers.map((t, i) => el('tr', {},
        el('td', {}, el('input', { type: 'number', value: t.min, onchange: (e) => { tiers[i].min = Number(e.target.value); } })),
        el('td', {}, '–'),
        el('td', {}, el('input', { type: 'number', value: t.max, onchange: (e) => { tiers[i].max = Number(e.target.value); } })),
        el('td', {}, '%'),
        el('td', {}, el('select', { onchange: (e) => { tiers[i].rotation = e.target.value; } },
          ['horaire', 'demi', 'antihoraire', 'aucune'].map((r) => el('option', { value: r, selected: r === t.rotation }, H.ROT_LABEL[H.ROT[r]]))))))),
      el('div', { class: 'row' },
        el('button', { class: 'btn gold', onclick: () => setSettings({ harebourg: { tiers } }) }, 'Enregistrer la table'),
        el('button', { class: 'btn', onclick: () => setSettings({ harebourg: { tiers: null } }).then(openSettings) }, 'Table par défaut')),
      line('Sens du décalage au CàC', el('select', { onchange: (e) => setSettings({ harebourg: { meleeDir: Number(e.target.value) } }) },
        el('option', { value: -1, selected: s.harebourg.meleeDir !== 1 }, 'anti-horaire (guides)'),
        el('option', { value: 1, selected: s.harebourg.meleeDir === 1 }, 'horaire'))),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => window.vigie.boardMode('calibrate') }, 'Calibrer la grille de combat'))),
    el('fieldset', {}, el('legend', {}, 'Raccourcis'),
      Object.keys(HOTKEY_LABELS).map((k) => {
        hotkeyInputs[k] = el('input', { type: 'text', value: s.hotkeys[k] || '' });
        return line(HOTKEY_LABELS[k], hotkeyInputs[k]);
      }),
      (D.hotkeysFailed || []).length ? el('p', { class: 'muted' }, `Déjà pris par un autre logiciel : ${D.hotkeysFailed.join(', ')}`) : null,
      el('div', { class: 'row' }, el('button', {
        class: 'btn gold',
        onclick: () => {
          const patch = {};
          for (const k of Object.keys(hotkeyInputs)) patch[k] = hotkeyInputs[k].value.trim();
          setSettings({ hotkeys: patch });
        },
      }, 'Appliquer les raccourcis'))),
    el('fieldset', {}, el('legend', {}, 'Fiches'),
      el('p', { class: 'muted', style: 'margin:2px 0 6px' }, 'Ajoute tes propres fiches (avis de recherche, autres donjons) en JSON dans le dossier perso : même format que les fiches fournies. Une fiche perso avec le même « id » remplace la fiche d\'origine.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => window.vigie.openFiches() }, 'Ouvrir le dossier'),
        el('button', { class: 'btn', onclick: async () => { D.bosses = await window.vigie.reloadFiches(); render(); } }, 'Recharger les fiches'))),
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => window.vigie.quit() }, 'Quitter Vigie')),
  );
  updateOcrDebug();
}

function updateOcrDebug() {
  const box = $('ocrDebug');
  if (!box) return;
  const det = D.state.detection || {};
  put(box,
    el('p', { class: 'muted', style: 'margin:8px 0 2px' }, det.time ? `Dernière lecture : ${new Date(det.time).toLocaleTimeString('fr-FR')}` : 'Aucune lecture pour l\'instant.'),
    det.preview ? el('img', { class: 'ocrprev', src: det.preview, alt: 'Zone lue' }) : null,
    el('div', { class: 'ocrtext' }, det.text || '—'),
    el('p', { class: 'muted', style: 'margin:4px 0 0' }, det.match ? `Reconnu : ${det.match.label} (${det.match.kind}, ${det.match.score} %)` : 'Rien de reconnu.'),
  );
}

function closeSettings() { ui.settingsOpen = false; $('settings').hidden = true; }

// -------------------------------------------------------------- démarrage

async function start() {
  D = await window.vigie.init();
  setupSearch();
  $('btnSettings').addEventListener('click', () => (ui.settingsOpen ? closeSettings() : openSettings()));
  $('btnHide').addEventListener('click', () => window.vigie.hide());
  $('btnCompact').addEventListener('click', () => {
    ui.compact = !ui.compact;
    if (ui.compact) ui.normalHeight = window.innerHeight;
    document.body.classList.toggle('compact', ui.compact);
    if (ui.compact) fitCompact();
    else if (ui.normalHeight) window.vigie.panelHeight(ui.normalHeight);
  });
  $('turnPlus').addEventListener('click', () => window.vigie.setTurn(D.state.turn + 1));
  $('turnMinus').addEventListener('click', () => window.vigie.setTurn(D.state.turn - 1));
  $('turnReset').addEventListener('click', () => window.vigie.setTurn(1));
  window.vigie.on('state', (s) => { D.state = s; render(); });
  window.vigie.on('settings', (s) => { D.settings = s; if (ui.settingsOpen) openSettings(); });
  window.vigie.on('focus-search', () => { closeSettings(); $('search').focus(); $('search').select(); });
  window.addEventListener('resize', () => { if (ui.tab === 'visee') drawMini(); });
  render();
}

start();
