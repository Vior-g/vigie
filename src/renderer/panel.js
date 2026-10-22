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
const EL_LABEL = Object.fromEntries(ELEMENTS);
const TABS = [
  ['essentiel', 'Essentiel'], ['visee', 'Visée'], ['mecaniques', 'Mécaniques'], ['monstres', 'Monstres'],
  ['strategie', 'Stratégie'], ['succes', 'Succès'], ['acces', 'Accès'],
];
const SONGE_TABS = [['essentiel', 'Essentiel'], ['regles', 'Règles'], ['aberrations', 'Aberrations'], ['avis', 'Avis de recherche']];

let D = { settings: null, state: null, defaults: {}, hotkeysFailed: [], stats: null, version: '' };
const ui = {
  tab: 'essentiel', tabKey: null, settingsOpen: false, compact: false,
  fiche: null, ficheKey: null, loadingFiche: null,
  mcache: new Map(), mrev: -1, group: null, groupKey: '', cardsKey: '', openSpells: new Set(),
  sel: -1, results: [], mini: { me: null, target: null }, normalHeight: null, recentKey: '',
};

const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('fr-FR'));
const hk = (name) => (D.settings && D.settings.hotkeys[name]) || '';
const prettyKey = (acc) => (acc || '—').replace(/Control/g, 'Ctrl').replace(/Shift/g, 'Maj').replace(/\+/g, ' + ');
const range = (r) => (Array.isArray(r) ? (r[0] === r[1] ? fmt(r[0]) : `${fmt(r[0])}–${fmt(r[1])}`) : fmt(r));
const G = () => (ui.fiche && ui.fiche.guide) || null;

// ------------------------------------------------------------------ rendu

function render() {
  renderStatus();
  renderUpdate();
  renderModes();
  const s = D.state;
  if (s.dataRev !== ui.mrev) { ui.mrev = s.dataRev; ui.mcache.clear(); ui.ficheKey = null; ui.cardsKey = ''; ui.groupKey = ''; }

  const ficheKey = s.ficheId ? `${s.ficheId}|${s.dataRev}` : null;
  if (ficheKey !== ui.ficheKey) {
    ui.ficheKey = ficheKey;
    ui.fiche = null;
    ui.tabKey = null;
    ui.mini = { me: null, target: null };
    if (s.ficheId) {
      const want = ficheKey;
      ui.loadingFiche = want;
      window.vigie.fiche(s.ficheId).then((f) => {
        if (ui.ficheKey !== want) return;
        ui.fiche = f;
        ui.tab = ui.wantTab || 'essentiel';
        ui.wantTab = null;
        render();
      });
    }
  }

  const combat = s.view === 'combat';
  $('combat').hidden = !combat;
  $('fiche').hidden = combat || !ui.fiche;
  $('empty').hidden = combat || !!ui.fiche || !!s.ficheId;
  renderHeader();
  if (combat) renderCombat();
  else if (ui.fiche) renderFiche();
  else if (!s.ficheId) renderEmpty();
  if (ui.settingsOpen) updateDebug();
  if (ui.compact) fitCompact();
}

/** En mode réduit, la fenêtre se cale sur le contenu utile. */
function fitCompact() {
  requestAnimationFrame(() => {
    const main = $('main');
    const content = [$('combat'), $('fiche'), $('empty')].find((n) => !n.hidden);
    if (!content) return;
    const h = Math.ceil(main.offsetTop + content.offsetHeight + 20);
    if (Math.abs(h - window.innerHeight) > 2) window.vigie.panelHeight(Math.min(h, 520));
  });
}

function renderHeader() {
  const f = ui.fiche;
  const p = $('portrait');
  const combat = D.state.view === 'combat';
  let title = 'Vigie'; let sub = 'Aide aux combats Dofus'; let img = null;
  if (combat) {
    title = 'Combat';
    sub = D.state.combat.songe ? `Songe · monstres au niv. ${D.state.combat.songeLevel}` : 'Monstres lus à l\'écran';
  } else if (f) {
    title = f.nom;
    if (f.type === 'songe') sub = 'Mode Songe';
    else sub = [f.donjon !== f.nom ? f.donjon : null, f.niveau ? `niv. ${f.niveau}` : null, f.zone].filter(Boolean).join(' · ');
    img = f.bosses && f.bosses[0] && f.bosses[0].image;
  }
  $('bossName').textContent = title;
  $('dungeonName').textContent = sub;
  const initial = combat ? '⚔' : (f && f.type === 'songe' ? '☾' : title.slice(0, 1));
  const key = img || initial;
  if (p.dataset.src === key) return;
  p.dataset.src = key;
  if (img) put(p, el('img', { src: img, alt: '', onerror: () => { p.textContent = initial; } }));
  else p.textContent = initial;
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
    dot += ' on'; text = det.time ? 'Détection active · lieu non reconnu' : 'Détection en cours de démarrage…';
  }
  st.append(el('span', { class: dot }), el('span', { class: 'grow', title: det.text || '' }, text));
  if (action) st.append(action);
  const u = s.update;
  if (u && u.dismissed && ['available', 'error'].includes(u.phase)) {
    st.append(el('button', { class: 'chip-btn up', title: 'Une nouvelle version de Vigie est disponible', onclick: () => window.vigie.appUpdate('show') }, `v${u.version} dispo`));
  }
}

const mo = (b) => `${Math.max(0.1, b / 1048576).toFixed(b > 10485760 ? 0 : 1).replace('.', ',')} Mo`;

/** Bandeau de mise à jour du logiciel (comme dans Relais). */
function renderUpdate() {
  const box = $('updateBanner');
  const u = D.state.update;
  const show = u && !u.dismissed && ['available', 'download', 'extract', 'restart', 'error'].includes(u.phase);
  box.hidden = !show;
  if (!show) { box.dataset.key = ''; return; }
  const key = JSON.stringify([u.phase, u.version, u.error, u.phase === 'download' ? Math.floor((u.done / (u.total || 1)) * 100) : 0, ui.notesOpen]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const btn = (label, action, cls = '') => el('button', { class: `chip-btn ${cls}`, onclick: () => window.vigie.appUpdate(action) }, label);
  if (u.phase === 'available') {
    put(box,
      el('div', { class: 'u-line' }, el('b', {}, `Vigie v${u.version} est disponible`), ` (tu as la v${u.current}).`),
      el('div', { class: 'u-line muted small' }, u.canInstall
        ? `${mo(u.size)} à télécharger, Vigie redémarrera tout seul.`
        : 'Télécharge-la sur GitHub (mise à jour automatique disponible à partir de la version installée suivante).'),
      el('div', { class: 'u-actions' },
        u.canInstall ? btn('Mettre à jour', 'install', 'gold') : btn('Télécharger', 'open', 'gold'),
        btn('Plus tard', 'later'),
        u.notes ? el('button', { class: 'chip-btn', onclick: () => { ui.notesOpen = !ui.notesOpen; renderUpdate(); } }, ui.notesOpen ? 'Masquer les nouveautés' : 'Nouveautés') : null,
        btn('Ignorer cette version', 'skip', 'ghosty')),
      ui.notesOpen && u.notes ? el('div', { class: 'u-notes' }, u.notes) : null);
  } else if (u.phase === 'download' || u.phase === 'extract') {
    const pct = u.total ? Math.min(100, Math.floor((u.done / u.total) * 100)) : 0;
    put(box,
      el('div', { class: 'u-line' }, u.phase === 'download' ? `Téléchargement de la v${u.version}… ${pct} % (${mo(u.done || 0)} / ${mo(u.total || 0)})` : 'Préparation de la mise à jour…'),
      el('div', { class: 'u-bar' }, el('i', { style: `width:${u.phase === 'extract' ? 100 : pct}%` })));
  } else if (u.phase === 'restart') {
    put(box, el('div', { class: 'u-line' }, el('b', {}, `Installation de la v${u.version} : Vigie redémarre…`)));
  } else if (u.phase === 'error') {
    put(box,
      el('div', { class: 'u-line' }, el('b', {}, 'Mise à jour impossible : '), u.error || 'erreur inconnue'),
      el('div', { class: 'u-actions' }, u.canInstall ? btn('Réessayer', 'install', 'gold') : null, btn('Page de téléchargement', 'open'), btn('Plus tard', 'later')));
  }
}

function renderModes() {
  const s = D.state;
  $('modeFiche').classList.toggle('on', s.view !== 'combat');
  $('modeCombat').classList.toggle('on', s.view === 'combat');
  $('combatCount').textContent = s.combat.ids.length ? s.combat.ids.length : '';
  const btn = $('btnRead');
  btn.disabled = !!s.combat.reading;
  btn.textContent = s.combat.reading ? '… lecture' : '◎ Lire les monstres';
  btn.title = `Survole un groupe ou un monstre puis ${prettyKey(hk('scanMonsters'))}`;
}

// ------------------------------------------------------------ accueil

async function renderEmpty() {
  const recent = (D.state.recent || []).filter((id) => id !== 'songes');
  const key = recent.join(',');
  $('emptyHint').textContent = `Entre dans un donjon ou un Songe : la fiche s'ouvre toute seule. En combat, survole un groupe et appuie sur ${prettyKey(hk('scanMonsters'))} pour afficher les monstres.`;
  const st = D.stats;
  if (st) $('dataStats').textContent = `${fmt(st.dungeons)} donjons · ${fmt(st.monsters)} monstres · ${st.guides} guides de boss${st.generatedAt ? ` · données du ${new Date(st.generatedAt).toLocaleDateString('fr-FR')}` : ''} · v${D.version}`;
  if (ui.recentKey === key && $('quick').childElementCount) return;
  ui.recentKey = key;
  const labels = recent.length ? await window.vigie.ficheLabels(recent) : [];
  put($('quick'),
    el('button', { class: 'songe', onclick: () => window.vigie.select('songes') },
      el('span', { class: 'ico' }, '☾'), el('span', {}, el('strong', {}, 'Songes Infinis'), el('small', {}, 'règles, Aberrations, avis de recherche'))),
    labels.length ? el('div', { class: 'qlabel' }, 'Récents') : null,
    labels.map((f) => el('button', { onclick: () => window.vigie.select(f.id) },
      el('span', { class: 'ico' }, f.nom.slice(0, 1)),
      el('span', {}, el('strong', {}, f.nom), el('small', {}, `${f.donjon}${f.niveau ? ` · niv. ${f.niveau}` : ''}${f.guide ? '' : ' · sans guide'}`)))),
  );
}

// ------------------------------------------------------------- fiche

function renderFiche() {
  const f = ui.fiche;
  const songe = f.type === 'songe';
  const tours = (G() && G().tours) || [];
  $('turnbar').hidden = songe || (!tours.length && f.outil !== 'harebourg');
  renderTurn(tours);
  const boss = !songe && f.bosses && f.bosses[0];
  $('stats').hidden = !boss; $('res').hidden = !boss;
  if (boss) {
    put($('stats'),
      el('span', {}, 'Niv. ', el('b', {}, range(boss.niveau))),
      el('span', {}, el('b', {}, range(boss.pv)), ' PV'),
      el('span', {}, el('b', {}, boss.pa ?? '?'), ' PA'),
      el('span', {}, el('b', {}, boss.pm ?? '?'), ' PM'),
      el('span', { title: 'Esquive PA / PM' }, 'Esq. ', el('b', {}, `${boss.esquivePA ?? '?'} / ${boss.esquivePM ?? '?'}`)),
    );
    $('res').replaceChildren(...resChips(boss.res));
  }
  const tabs = (songe ? SONGE_TABS : TABS).filter(([id]) => hasTab(f, id));
  if (!tabs.some(([id]) => id === ui.tab)) ui.tab = tabs[0] ? tabs[0][0] : 'essentiel';
  $('tabs').replaceChildren(...tabs.map(([id, label]) => el('button', {
    class: ui.tab === id ? 'on' : '', onclick: () => { ui.tab = id; render(); },
  }, label)));
  const ess = songe ? (f.songes.essentiel || []) : ((G() && G().essentiel) || []);
  const ck = `${ui.ficheKey}`;
  if ($('compactInfo').dataset.key !== ck) {
    $('compactInfo').dataset.key = ck;
    put($('compactInfo'), ess.slice(0, 3).map((t) => el('li', {}, t)));
  }
  const key = `${ui.ficheKey}|${ui.tab}`;
  if (ui.tabKey !== key) { ui.tabKey = key; renderTab(f); $('main').scrollTop = 0; }
  else if (ui.tab === 'visee') updateVisee();
}

function hasTab(f, id) {
  const g = f.guide;
  if (f.type === 'songe') return true;
  switch (id) {
    case 'essentiel': return true;
    case 'visee': return f.outil === 'harebourg';
    case 'mecaniques': return true;
    case 'monstres': return !!((f.monsters && f.monsters.length) || (f.bosses && f.bosses.length > 1) || (f.extraNotes && f.extraNotes.length));
    case 'strategie': return !!(g && ((g.strategie || []).length || (g.pieges || []).length));
    case 'succes': return !!(g && (g.succes || []).length);
    case 'acces': return true;
    default: return false;
  }
}

function renderTurn(tours) {
  const t = D.state.turn;
  $('turnNum').textContent = t;
  const par = $('turnParity');
  par.textContent = t % 2 === 0 ? 'tour pair' : 'tour impair';
  par.className = `parity ${t % 2 === 0 ? 'pair' : ''}`;
  const rules = ui.fiche && ui.fiche.type !== 'songe' ? window.TurnRules.rulesFor({ tours }, t) : [];
  $('reminders').replaceChildren(...rules.map((r) => el('li', { class: r.level || 'info' }, r.text)));
}

function resChips(res) {
  if (!res) return [];
  const vals = ELEMENTS.map(([k]) => res[k]).filter((v) => typeof v === 'number');
  const min = Math.max(...vals) > Math.min(...vals) ? Math.min(...vals) : NaN;
  return ELEMENTS.map(([k, label]) => el('div', {
    class: `r ${res[k] === min ? 'best' : ''}`, style: `--c: var(--${k})`, title: `Résistance ${label}`,
  }, el('div', { class: 'n' }, label), el('div', { class: 'v' }, res[k] == null ? '?' : `${res[k]}%`)));
}

function list(items, fn) { return el('ul', { class: 'list' }, items.map(fn)); }

function renderTab(f) {
  const body = $('tabbody');
  body.replaceChildren();
  const T = ui.tab;
  const g = f.guide;
  if (f.type === 'songe') { renderSongeTab(f, body); return; }
  if (T === 'essentiel') {
    if (g) {
      body.append(list(g.essentiel || [], (t) => el('li', {}, t)));
      if (g.note) body.append(el('p', { class: 'note' }, g.note));
    } else {
      body.append(el('p', { class: 'warnbox' }, 'Pas encore de guide détaillé pour ce donjon : voici ce que disent les données du jeu.'));
      body.append(autoSummary(f));
    }
  } else if (T === 'mecaniques') {
    if (g && (g.mecaniques || []).length) body.append(list(g.mecaniques, (m) => el('li', {}, m.t ? el('h4', {}, m.t) : null, el('p', {}, m.x))));
    if (g && (g.sorts || []).length) {
      body.append(el('h4', { class: 'sec' }, `Sorts à connaître (${f.nom})`),
        list(g.sorts, (s) => el('li', {}, el('b', {}, s.n), s.x ? ` — ${s.x}` : '')));
    }
    for (const b of f.bosses || []) {
      body.append(el('h4', { class: 'sec' }, `Sorts de ${b.nom} (données du jeu)`), spellList(b.spells, true));
    }
  } else if (T === 'monstres') {
    const others = (f.bosses || []).slice(1);
    if ((f.monsters || []).length) body.append(el('div', { class: 'cards' }, f.monsters.map((m) => monsterCard(m, { compact: true }))));
    if (others.length) {
      body.append(el('h4', { class: 'sec' }, 'Autres boss rattachés à ce donjon (données du jeu)'),
        el('div', { class: 'cards' }, others.map((b) => monsterCard(b, { compact: true }))));
    }
    if ((f.extraNotes || []).length) {
      body.append(el('h4', { class: 'sec' }, 'Invocations et autres'),
        list(f.extraNotes, (m) => el('li', { class: `danger-${m.danger || 'moyen'}` }, el('h4', {}, m.nom), el('p', {}, m.note))));
    }
  } else if (T === 'strategie') {
    if ((g.strategie || []).length) body.append(el('ol', { class: 'steps' }, g.strategie.map((t) => el('li', {}, t))));
    if ((g.pieges || []).length) {
      body.append(el('h4', { class: 'sec' }, 'Pièges à éviter'), list(g.pieges, (t) => el('li', { class: 'danger-haut' }, t)));
    }
  } else if (T === 'succes') {
    body.append(list(g.succes, (s) => el('li', {}, el('h4', {}, s.n), el('p', {}, s.x))));
  } else if (T === 'acces') {
    const facts = [
      f.donjon ? `Donjon : ${f.donjon}` : null,
      f.niveau ? `Niveau : ${f.niveau}` : null,
      f.zone ? `Zone : ${f.zone}` : null,
      f.pos ? `Position de l'entrée : [${f.pos[0]}, ${f.pos[1]}]` : null,
    ].filter(Boolean);
    if (facts.length) body.append(list(facts, (t) => el('li', {}, t)));
    if (g && (g.acces || []).length) body.append(el('h4', { class: 'sec' }, 'Accès'), list(g.acces, (t) => el('li', {}, t)));
    if (g && g.src) {
      body.append(el('h4', { class: 'sec' }, 'Source'),
        el('p', {}, el('a', { onclick: () => window.vigie.open(g.src) }, g.src.replace(/^https:\/\/(www\.)?/, ''))));
    }
    body.append(el('p', { class: 'note' }, g
      ? `Guide résumé${g.maj ? ` (mis à jour le ${g.maj})` : ''}${g.perso ? ' · guide perso' : ''}. Les mécaniques peuvent changer avec les mises à jour d'Ankama : vérifie en jeu.`
      : 'Statistiques, résistances et sorts : données du jeu (DofusDB), mises à jour chaque semaine.'));
  } else if (T === 'visee') {
    renderVisee(body);
  }
}

/** Fiche sans guide : faits utiles tirés des données. */
function autoSummary(f) {
  const box = el('div', {});
  const b = f.bosses && f.bosses[0];
  if (b) {
    const vals = ELEMENTS.map(([k]) => [k, b.res[k]]).filter(([, v]) => typeof v === 'number').sort((x, y) => x[1] - y[1]);
    const items = [];
    if (vals.length) items.push(`Élément le plus efficace : ${EL_LABEL[vals[0][0]]} (${vals[0][1]} %) · le moins : ${EL_LABEL[vals[vals.length - 1][0]]} (${vals[vals.length - 1][1]} %).`);
    items.push(`${b.nom} : ${range(b.pv)} PV, ${b.pa} PA, ${b.pm} PM, esquive PA ${b.esquivePA ?? '?'} / PM ${b.esquivePM ?? '?'}.`);
    if (b.flags.length) items.push(b.flags.join(' · '));
    const strong = (b.spells || []).filter((s) => (s.e || []).some((e) => /PA|PM|Pousse|Attire|Invoque|Téléporte|vol|Vole|état|Soigne|Renvoie|bouclier|Bouclier|Termine/i.test(e)));
    for (const s of strong.slice(0, 6)) items.push(`${s.n} : ${(s.e || []).slice(0, 3).join(' · ')}`);
    box.append(list(items, (t) => el('li', {}, t)));
  }
  const monsters = (f.monsters || []).slice(0, 6);
  if (monsters.length) {
    box.append(el('h4', { class: 'sec' }, 'Monstres du donjon'),
      list(monsters, (m) => {
        const vals = ELEMENTS.map(([k]) => [k, m.res[k]]).filter(([, v]) => typeof v === 'number').sort((x, y) => x[1] - y[1]);
        return el('li', {}, el('b', {}, m.nom), ` — ${range(m.pv)} PV, faible ${vals.length ? `${EL_LABEL[vals[0][0]]} (${vals[0][1]} %)` : '?'}`);
      }));
  }
  return box;
}

function renderSongeTab(f, body) {
  const sg = f.songes;
  if (ui.tab === 'essentiel') {
    body.append(list(sg.essentiel || [], (t) => el('li', {}, t)));
    body.append(el('div', { class: 'row' },
      el('button', { class: 'btn gold', onclick: () => window.vigie.combatScan() }, `Lire les monstres (${prettyKey(hk('scanMonsters'))})`),
      el('button', { class: 'btn', onclick: () => window.vigie.view('combat') }, 'Voir le combat')));
    body.append(el('p', { class: 'note' }, 'En Songe, Vigie affiche la version niveau 200+ des monstres lus. Une Aberration se lit en survolant son icône (en haut à droite) avant d\'appuyer sur le raccourci.'));
  } else if (ui.tab === 'regles') {
    body.append(list(sg.regles || [], (r) => el('li', {}, el('h4', {}, r.t), el('p', {}, r.x))));
  } else if (ui.tab === 'aberrations') {
    const seen = new Set(D.state.combat.aberrations || []);
    body.append(el('p', { class: 'muted' }, 'Gardiens modifiés quand une Aberration est active dans le Songe :'));
    body.append(list(sg.aberrations || [], (a) => el('li', { class: seen.has(a.boss) ? 'aber-on' : '' },
      el('h4', {}, a.famille ? `Famille ${a.boss}` : a.boss, seen.has(a.boss) ? el('span', { class: 'badge ab' }, 'active') : null),
      el('p', {}, a.x))));
  } else if (ui.tab === 'avis') {
    body.append(el('p', { class: 'muted' }, 'Avis de recherche pouvant apparaître dans les Songes (cliquer pour afficher la fiche du monstre) :'));
    body.append(el('div', { class: 'chips' }, (sg.avis || []).map((a) => el('button', {
      class: 'chip', disabled: !a.id, onclick: () => a.id && window.vigie.combatAdd(a.id),
    }, a.nom))));
    body.append(el('p', { class: 'note' }, 'Ils sont plus faibles pour chaque allié présent : environ 1 500 PV et 100 de puissance en moins par allié.'));
  }
  if ((sg.sources || []).length && ui.tab === 'regles') {
    body.append(el('p', { class: 'note' }, 'Source : ', ...sg.sources.map((s) => el('a', { onclick: () => window.vigie.open(s.url) }, s.titre))));
  }
}

// ------------------------------------------------------- monstres / sorts

function spellList(spells, open) {
  if (!spells || !spells.length) return el('p', { class: 'muted' }, 'Aucun sort connu.');
  return el('ul', { class: `spells ${open ? 'open' : ''}` }, spells.map((s) => {
    const meta = [];
    if (s.pa != null) meta.push(`${s.pa} PA`);
    if (s.po) meta.push(`PO ${s.po[0] === s.po[1] ? s.po[0] : `${s.po[0]}–${s.po[1]}`}${s.mod ? '+' : ''}`);
    if (s.lig) meta.push('en ligne');
    if (s.dia) meta.push('en diagonale');
    if (s.ldv === 0) meta.push('sans ligne de vue');
    if (s.tour) meta.push(`${s.tour}×/tour`);
    if (s.cib) meta.push(`${s.cib}×/cible`);
    if (s.cd) meta.push(`relance ${s.cd} t`);
    if (s.ini) meta.push(`dispo tour ${s.ini + 1}`);
    return el('li', {},
      el('div', { class: 'sp-head' }, el('b', {}, s.n), el('span', { class: 'sp-meta' }, meta.join(' · '))),
      (s.e || []).length ? el('div', { class: 'sp-eff' }, s.e.join(' · ')) : null,
      s.d ? el('div', { class: 'sp-desc' }, s.d) : null);
  }));
}

function miniRes(res) {
  const vals = ELEMENTS.map(([k]) => res[k]).filter((v) => typeof v === 'number');
  const min = Math.max(...vals) > Math.min(...vals) ? Math.min(...vals) : NaN;
  return el('div', { class: 'mini-res' }, ELEMENTS.map(([k, label]) => el('span', {
    style: `--c: var(--${k})`, class: res[k] === min ? 'best' : '', title: `Résistance ${label}`,
  }, `${label.slice(0, 1)} ${res[k] ?? '?'}%`)));
}

/** Élément le plus faible d'un monstre (texte court). */
function weakTag(res) {
  if (!res) return null;
  const vals = ELEMENTS.map(([k]) => [k, res[k]]).filter(([, v]) => typeof v === 'number').sort((a, b) => a[1] - b[1]);
  if (vals.length < 2 || vals[0][1] === vals[vals.length - 1][1]) return null;
  return el('span', { class: 'weak', style: `--c: var(--${vals[0][0]})`, title: 'Élément le plus efficace' }, `faible ${EL_LABEL[vals[0][0]]} ${vals[0][1]} %`);
}

const SPELL_TAGS = [
  [/(^|\| )-\d+( à -\d+)? PA\b|Vole \d+ PA\b/, 'retrait PA'],
  [/(^|\| )-\d+( à -\d+)? PM\b|Vole \d+ PM\b/, 'retrait PM'],
  [/-\d+ Portée|Vole \d+ Portée/, 'retrait PO'],
  [/Repousse/, 'poussée'], [/Attire/, 'attirance'],
  [/Téléporte|Échange de positions|Téléportation/, 'téléportation'],
  [/Invoque|par l'invocation/, 'invocations'],
  [/\bvol (Neutre|Terre|Feu|Eau|Air)\b/, 'vol de vie'],
  [/Soin :|\bsoins (Neutre|Terre|Feu|Eau|Air)\b/, 'soins'],
  [/Bouclier/, 'bouclier'], [/Érosion/, 'érosion'],
  [/-\d+ Puissance|-\d+% Résistance|-\d+% Dommages/, 'malus'],
  [/invisible/i, 'invisibilité'], [/glyphe|piège/i, 'glyphes/pièges'],
  [/État Pesanteur/, 'Pesanteur'], [/État Indéplaçable/, 'Indéplaçable'], [/État Insoignable/, 'Insoignable'],
  [/État Pacifiste/, 'Pacifiste'], [/État Affaibli/, 'Affaibli'], [/État Intaclable/, 'Intaclable'],
];

/** Effets marquants des sorts d'un monstre, lisibles sans déplier. */
function spellTags(spells) {
  const text = (spells || []).map((sp) => (sp.e || []).join(' | ')).join(' | ');
  return SPELL_TAGS.filter(([re]) => re.test(text)).map(([, t]) => t);
}

/** Ligne niveau · PV · PA · PM, avec la mise à l'échelle du Songe. */
function statLine(m) {
  const sc = m.scaled;
  const lv = sc ? el('b', { class: 'songe-lv', title: `Niveau de l'étage (version de base : niv. ${range(sc.baseLevel)})` }, `niv. ${sc.level}`) : `niv. ${range(m.niveau)}`;
  let pv;
  if (m.pvRead) pv = el('b', { title: 'PV lus à l\'écran' }, `${fmt(m.pvRead)} PV`);
  else if (sc && sc.estimated) pv = el('span', { title: `Estimation : PV de base ${range(sc.basePv)} au niv. ${range(sc.baseLevel)}, mis au niveau ${sc.level} avec la courbe de PV du jeu` }, `≈ ${fmt(m.pv[1])} PV`);
  else pv = `${range(m.pv)} PV`;
  return [lv, m.levelRead && !sc ? ` (lu ${m.levelRead})` : '', ' · ', pv, ` · ${m.pa ?? '?'} PA · ${m.pm ?? '?'} PM`];
}

/**
 * Carte d'un monstre.
 * opts.compact : sorts repliés ; opts.combat : boutons retirer / variantes.
 */
function monsterCard(m, opts = {}) {
  const key = `${opts.combat ? 'c' : 'f'}${m.id}`;
  const open = ui.openSpells.has(key);
  const danger = m.danger || (m.boss ? 'boss' : '');
  const card = el('div', { class: `card ${danger ? `danger-${danger}` : ''} ${m.boss ? 'is-boss' : ''}`, 'data-id': m.id });
  const ab = m.aberration && (D.state.combat.songe || D.state.songe || (D.state.combat.aberrations || []).includes(m.nom));
  const variants = (m.variants || []).filter((v) => (v.lv[1] || 0) >= 10);
  put(card,
    el('div', { class: 'monster-head' },
      m.image ? el('img', { src: m.image, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : el('span', { class: 'noimg' }, m.nom.slice(0, 1)),
      el('div', { class: 'mh-t' },
        el('h4', {}, m.nom, m.boss ? el('span', { class: 'badge' }, 'boss') : null, m.miniBoss ? el('span', { class: 'badge' }, 'archi/mini-boss') : null),
        el('div', { class: 'pv' }, ...statLine(m))),
      opts.combat ? el('button', { class: 'x', title: 'Retirer', onclick: () => window.vigie.combatRemove(m.id) }, '✕') : null),
    m.res ? el('div', { class: 'res-line' }, miniRes(m.res), weakTag(m.res)) : null,
    (() => { const t = spellTags(m.spells); return t.length ? el('div', { class: 'tags' }, t.map((x) => el('span', {}, x))) : null; })(),
    el('div', { class: 'facts' },
      `Esquive PA ${m.esquivePA ?? '?'} · PM ${m.esquivePM ?? '?'}`,
      m.race ? ` · ${m.race}` : '',
      m.flags && m.flags.length ? ` · ${m.flags.join(' · ')}` : ''),
    ab ? el('div', { class: 'abbox' }, el('b', {}, 'Aberration : '), m.aberration) : null,
    m.note ? el('div', { class: 'note-m' }, m.note, m.noteFrom && opts.combat ? el('span', { class: 'from' }, ` — ${m.noteFrom}`) : null) : null,
  );
  const actions = el('div', { class: 'card-actions' });
  if (m.ficheId && opts.combat) actions.append(el('button', { class: 'chip-btn', onclick: () => window.vigie.select(m.ficheId) }, 'Mécaniques du boss →'));
  if (opts.combat && variants.length > 1) {
    actions.append(el('span', { class: 'muted small' }, 'Version :'),
      ...variants.slice(-3).map((v) => el('button', {
        class: `chip-btn ${v.id === m.id ? 'on' : ''}`, title: v.expe ? 'Version des expéditions' : '',
        onclick: () => v.id !== m.id && window.vigie.combatSwap(m.id, v.id),
      }, `niv. ${range(v.lv)}${v.expe ? ' (expé.)' : ''}`)));
  }
  const sp = m.spells || [];
  if (sp.length) {
    actions.append(el('button', {
      class: 'chip-btn', onclick: () => {
        if (ui.openSpells.has(key)) ui.openSpells.delete(key); else ui.openSpells.add(key);
        const n = card.querySelector('.spells');
        n.classList.toggle('open');
        if (ui.compact) fitCompact();
      },
    }, `Sorts (${sp.length})`));
  }
  if (actions.childElementCount) card.append(actions);
  if (sp.length) card.append(spellList(sp, open));
  return card;
}

// ------------------------------------------------------------- combat

function renderSongeBar(c) {
  const bar = $('songeBar');
  const on = !!c.songe;
  const key = `${on}|${c.songeLevel}|${c.songeManual}`;
  if (bar.dataset.key === key || bar.contains(document.activeElement)) return;
  bar.dataset.key = key;
  const level = el('input', {
    type: 'number', min: 1, max: 400, value: c.songeLevel, title: 'Niveau des monstres (étage du Songe)',
    onchange: (e) => window.vigie.combatSonge({ level: Number(e.target.value) }),
  });
  put(bar,
    el('button', {
      class: `chip-btn ${on ? 'on' : ''}`, title: on ? 'Les monstres sont mis au niveau de l\'étage' : 'Afficher les monstres au niveau d\'un étage de Songe',
      onclick: () => window.vigie.combatSonge({ on: !on }),
    }, on ? '☾ Songe : oui' : '☾ Songe : non'),
    on ? el('label', { class: 'lvl' }, 'niv.', level) : null,
    c.songeManual != null ? el('button', { class: 'chip-btn', title: 'Revenir à la détection automatique', onclick: () => window.vigie.combatSonge({ auto: true }) }, 'auto') : null,
  );
}

function renderCombat() {
  const c = D.state.combat;
  $('combatInfo').textContent = c.info || '';
  $('combatClear').hidden = !c.ids.length;
  renderSongeBar(c);
  const key = JSON.stringify([c.ids, c.aberrations, c.songe, c.songeLevel, c.levels, c.pvRead, ui.mrev]);
  if (key === ui.cardsKey) return;
  ui.cardsKey = key;
  if (!c.ids.length) {
    put($('cards')); put($('summary')); put($('aberr'));
    put($('combatEmpty'),
      el('p', {}, el('b', {}, 'Aucun monstre pour l\'instant.')),
      el('ol', { class: 'steps' },
        el('li', {}, 'Survole le groupe de monstres sur la carte, ou un monstre en combat (sur le terrain ou dans la timeline).'),
        el('li', {}, 'Appuie sur ', el('kbd', {}, prettyKey(hk('scanMonsters'))), ' : Vigie lit les noms affichés et montre résistances, PA/PM, sorts et conseils.'),
        el('li', {}, 'Recommence pour ajouter d\'autres monstres. ', el('kbd', {}, prettyKey(hk('clearMonsters'))), ' vide la liste.')),
      el('p', { class: 'muted small' }, 'Tu peux aussi chercher un monstre par son nom dans la barre de recherche.'));
    return;
  }
  put($('combatEmpty'));
  const want = key;
  window.vigie.combatViews().then(({ views, summary }) => {
    if (ui.cardsKey !== want) return;
    ui.group = summary;
    renderSummary(views);
    const ab = (c.aberrations || []);
    put($('aberr'), ab.length ? el('div', { class: 'abbox big' }, el('b', {}, `Aberration active : ${ab.join(', ')}`),
      ...ab.map((name) => {
        const v = views.find((x) => x.nom === name);
        return v && v.aberration ? el('p', {}, v.aberration) : null;
      }),
      el('button', { class: 'chip-btn', onclick: () => { ui.wantTab = 'aberrations'; if (D.state.ficheId === 'songes') { ui.tab = 'aberrations'; ui.tabKey = null; } window.vigie.select('songes'); } }, 'Toutes les Aberrations')) : null);
    put($('cards'), views.map((v) => monsterCard(v, { combat: true, compact: true })));
    const focus = D.state.focusMonster && $('cards').querySelector(`[data-id="${D.state.focusMonster}"]`);
    if (focus) requestAnimationFrame(() => { focus.scrollIntoView({ block: 'nearest' }); focus.classList.add('focus-flash'); });
    if (ui.compact) fitCompact();
  });
}

function renderSummary(views) {
  const g = ui.group;
  if (!g || views.length < 2) {
    put($('summary'), views.length === 1 && g ? el('div', { class: 'sum-line' }, 'Élément conseillé : ', el('b', {}, g.best.map((e) => EL_LABEL[e]).join(', '))) : null);
    return;
  }
  const bosses = views.filter((v) => v.boss).length;
  put($('summary'),
    el('div', { class: 'sum-line' },
      `${views.length} monstres${bosses ? ` dont ${bosses} boss` : ''} · élément conseillé : `,
      el('b', {}, g.best.map((e) => EL_LABEL[e]).join(', ')),
      ` · à éviter : `, el('b', { class: 'bad' }, EL_LABEL[g.worst])),
    el('div', { class: 'res small' }, resChips(g.avg)),
    el('div', { class: 'muted small' }, 'Résistances moyennes du groupe, pondérées par les PV.'));
}

// -------------------------------------------------------------- Harebourg

function rotButton(q, glyph, label) {
  return el('button', { 'data-q': q, onclick: () => window.vigie.harebourg({ baseQ: q }) },
    el('span', { class: 'g' }, glyph), label);
}

function renderVisee(body) {
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
    el('h4', { class: 'sec' }, 'Simulateur'),
    el('p', { class: 'muted' }, 'Clic gauche : ta case · clic droit : la cible (Comte ou monstre).'),
    canvas,
    el('div', { class: 'legend' },
      el('span', { style: '--c:#55c7ff' }, el('i'), 'toi'),
      el('span', { style: '--c:#ff5d5d' }, el('i'), 'cible'),
      el('span', { style: '--c:#5cff8f' }, el('i'), 'case à viser'),
      el('span', { style: '--c:#ffae42' }, el('i'), 'où tomberait un tir direct'),
      el('span', { style: '--c:#c48bff' }, el('i'), 'arrivée de la téléportation')),
    el('h4', { class: 'sec' }, 'Directement sur le jeu'),
    el('ol', { class: 'steps' },
      el('li', {}, 'Survole ta case et appuie sur ', el('kbd', {}, prettyKey(hk('harebourgAim')))),
      el('li', {}, 'Survole la cible et appuie de nouveau sur le même raccourci.'),
      el('li', {}, 'Clique la case verte dans le jeu. ', el('kbd', {}, prettyKey(hk('harebourgClear'))), ' efface les repères.')),
    el('div', { class: 'row' },
      el('span', { class: 'muted', id: 'calStatus' },
        cal ? `Grille calibrée pour ${D.state.sizeKey}.` : 'Grille non calibrée : la visée en jeu sera approximative.'),
      el('button', { class: `btn ${cal ? '' : 'gold'}`, onclick: () => window.vigie.boardMode('calibrate') }, cal ? 'Recalibrer' : 'Calibrer la grille')),
    el('p', { class: 'note' }, `Paliers de PV indicatifs : ${tiers.map((t) => `${t.min}–${t.max} % ${H.ROT_LABEL[H.ROT[t.rotation]]}`).join(' · ')}. Fie-toi d'abord à l'état affiché en combat ; la table se modifie dans les réglages.`),
  );
  requestAnimationFrame(() => updateVisee());
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
  const KIND = { donjon: 'donjon', boss: 'boss', monstre: 'monstre', songe: 'songe' };
  box.replaceChildren(...ui.results.map((r, i) => el('button', {
    class: i === ui.sel ? 'sel' : '', onmousedown: (e) => { e.preventDefault(); pick(r); },
  }, el('span', { class: 'lbl' }, r.label), r.sub ? el('span', { class: 'muted sub' }, r.sub) : null,
  el('span', { class: `kind k-${r.kind}` }, KIND[r.kind] || r.kind))));
  box.hidden = !ui.results.length;
}

function pick(r) {
  $('search').value = '';
  $('results').hidden = true;
  $('search').blur();
  if (r.kind === 'monstre') window.vigie.combatAdd(r.ref);
  else window.vigie.select(r.ref);
}

// -------------------------------------------------------------- réglages

function setSettings(patch) {
  return window.vigie.setSettings(patch).then((s) => { D.settings = s; return s; });
}

function line(label, control) { return el('div', { class: 'line' }, el('span', {}, label), control); }

function checkbox(checked, onchange) {
  return el('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onchange(e.target.checked) });
}

function num(value, attrs, onchange) {
  return el('input', { type: 'number', value, ...attrs, onchange: (e) => onchange(Number(e.target.value)) });
}

function openSettings() {
  ui.settingsOpen = true;
  const s = D.settings; const sh = $('settings');
  sh.hidden = false;
  const d = s.detection; const c = s.combat;
  const tiers = (s.harebourg.tiers || D.defaults.tiers).map((t) => ({ ...t }));

  const hotkeyInputs = {};
  const HOTKEY_LABELS = {
    togglePanel: 'Afficher / masquer', search: 'Recherche',
    scanMonsters: 'Lire les monstres sous le curseur', clearMonsters: 'Vider la liste des monstres',
    harebourgAim: 'Harebourg : poser toi / la cible', harebourgClear: 'Harebourg : effacer',
    nextTurn: 'Tour suivant', prevTurn: 'Tour précédent', resetTurn: 'Revenir au tour 1', forceScan: 'Relire le lieu maintenant',
  };
  const st = D.stats || {};

  sh.replaceChildren(
    el('h3', {}, 'Réglages', el('button', { class: 'btn', onclick: closeSettings }, 'Fermer')),
    el('fieldset', {}, el('legend', {}, 'Détection du lieu (coin haut-gauche)'),
      line('Activée', checkbox(d.enabled, (v) => setSettings({ detection: { enabled: v } }))),
      line('Intervalle (ms)', num(d.intervalMs, { min: 700, step: 100 }, (v) => setSettings({ detection: { intervalMs: v } }))),
      line('Seuil du texte clair (0-255)', num(d.threshold, { min: 60, max: 250 }, (v) => setSettings({ detection: { threshold: v } }))),
      line('Agrandissement avant lecture', num(d.scale, { min: 1, max: 4 }, (v) => setSettings({ detection: { scale: v } }))),
      line('Lire toute la fenêtre (plus lent)', checkbox(d.fullWindow, (v) => setSettings({ detection: { fullWindow: v } }))),
      line('Processus du jeu (regex)', el('input', { type: 'text', value: d.processPattern, onchange: (e) => setSettings({ detection: { processPattern: e.target.value } }) })),
      el('div', { class: 'row' },
        el('button', { class: 'btn gold', onclick: () => window.vigie.boardMode('ocrzone') }, 'Définir la zone de lecture'),
        el('button', { class: 'btn', onclick: () => window.vigie.scan() }, 'Lire maintenant')),
      el('div', { id: 'ocrDebug' })),
    el('fieldset', {}, el('legend', {}, 'Combat et Songes'),
      line('Compléter la liste si lue dans les (s)', num(Math.round((c.mergeWindowMs || 120000) / 1000), { min: 10, max: 1800 }, (v) => setSettings({ combat: { mergeWindowMs: v * 1000 } }))),
      line('Zone autour du curseur : largeur (0-1)', num(c.cursorBox.w, { min: 0.1, max: 1, step: 0.02 }, (v) => setSettings({ combat: { cursorBox: { w: v } } }))),
      line('… au-dessus du curseur (0-1)', num(c.cursorBox.up, { min: 0.05, max: 1, step: 0.02 }, (v) => setSettings({ combat: { cursorBox: { up: v } } }))),
      line('… en dessous du curseur (0-1)', num(c.cursorBox.down, { min: 0, max: 1, step: 0.02 }, (v) => setSettings({ combat: { cursorBox: { down: v } } }))),
      line('Seuil du texte sombre (0-255)', num(c.darkThreshold, { min: 20, max: 200 }, (v) => setSettings({ combat: { darkThreshold: v } }))),
      line('Si rien n\'est lu, lire toute la fenêtre', checkbox(c.fullWindowFallback, (v) => setSettings({ combat: { fullWindowFallback: v } }))),
      line('Niveau des monstres en Songe (si non lu)', num(c.songeLevel || 200, { min: 1, max: 400 }, (v) => window.vigie.combatSonge({ level: v }))),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => window.vigie.combatScan() }, 'Tester la lecture des monstres')),
      el('div', { id: 'monDebug' })),
    el('fieldset', {}, el('legend', {}, 'Affichage'),
      line('Opacité du panneau', el('input', { type: 'range', min: 0.4, max: 1, step: 0.02, value: s.panel.opacity, oninput: (e) => setSettings({ panel: { opacity: Number(e.target.value) } }) })),
      line('Taille du texte', el('select', { onchange: (e) => setSettings({ panel: { zoom: Number(e.target.value) } }) },
        [[0.85, 'Petite'], [1, 'Normale'], [1.15, 'Grande'], [1.3, 'Très grande']].map(([v, l]) => el('option', { value: v, selected: Math.abs((s.panel.zoom || 1) - v) < 0.01 }, l)))),
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
    el('fieldset', {}, el('legend', {}, 'Données et guides'),
      el('p', { class: 'muted', style: 'margin:2px 0 6px' },
        `${fmt(st.dungeons)} donjons, ${fmt(st.monsters)} monstres, ${fmt(st.spells)} sorts, ${st.guides} guides (${st.fichesWithGuide} donjons couverts). Données du jeu du ${st.generatedAt ? new Date(st.generatedAt).toLocaleDateString('fr-FR') : '?'}. ${D.state.dataInfo || ''}`),
      line('Chercher les mises à jour sur GitHub', checkbox(s.updates !== false, (v) => setSettings({ updates: v }))),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: async () => { D.stats = await window.vigie.checkUpdates(); openSettings(); } }, 'Vérifier maintenant'),
        D.state.update && D.state.update.phase === 'uptodate' ? el('span', { class: 'muted' }, `Vigie est à jour (v${D.version}).`) : null,
        D.state.update && D.state.update.phase === 'available' ? el('button', { class: 'btn gold', onclick: () => { closeSettings(); window.vigie.appUpdate('show'); } }, `Installer la v${D.state.update.version}`) : null,
        D.state.update && D.state.update.phase === 'error' ? el('span', { class: 'muted' }, D.state.update.error) : null),
      el('p', { class: 'muted', style: 'margin:8px 0 6px' }, 'Tes propres guides (JSON, même format que ceux fournis) vont dans le dossier perso ; un guide perso du même nom remplace celui d\'origine.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => window.vigie.openFiches() }, 'Ouvrir le dossier perso'),
        el('button', { class: 'btn', onclick: async () => { D.stats = await window.vigie.reloadFiches(); openSettings(); } }, 'Recharger'))),
    el('div', { class: 'row' }, el('span', { class: 'muted' }, `Vigie v${D.version}`), el('button', { class: 'btn', onclick: () => window.vigie.quit() }, 'Quitter Vigie')),
  );
  updateDebug();
}

function updateDebug() {
  const box = $('ocrDebug');
  if (box) {
    const det = D.state.detection || {};
    put(box,
      el('p', { class: 'muted', style: 'margin:8px 0 2px' }, det.time ? `Dernière lecture : ${new Date(det.time).toLocaleTimeString('fr-FR')}` : 'Aucune lecture pour l\'instant.'),
      det.preview ? el('img', { class: 'ocrprev', src: det.preview, alt: 'Zone lue' }) : null,
      el('div', { class: 'ocrtext' }, det.text || '—'),
      el('p', { class: 'muted', style: 'margin:4px 0 0' }, det.match ? `Reconnu : ${det.match.label} (${det.match.kind}, ${det.match.score} %)` : 'Rien de reconnu.'),
    );
  }
  const mb = $('monDebug');
  if (mb) {
    const c = D.state.combat || {};
    put(mb,
      c.preview ? el('img', { class: 'ocrprev', src: c.preview, alt: 'Zone lue autour du curseur' }) : null,
      c.text ? el('div', { class: 'ocrtext' }, c.text) : null,
      c.info ? el('p', { class: 'muted', style: 'margin:4px 0 0' }, c.info) : null);
  }
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
  $('modeFiche').addEventListener('click', () => window.vigie.view('fiche'));
  $('modeCombat').addEventListener('click', () => window.vigie.view('combat'));
  $('btnRead').addEventListener('click', () => window.vigie.combatScan());
  $('combatClear').addEventListener('click', () => window.vigie.combatClear());
  $('turnPlus').addEventListener('click', () => window.vigie.setTurn(D.state.turn + 1));
  $('turnMinus').addEventListener('click', () => window.vigie.setTurn(D.state.turn - 1));
  $('turnReset').addEventListener('click', () => window.vigie.setTurn(1));
  window.vigie.on('state', (s) => { D.state = s; render(); });
  window.vigie.on('settings', (s) => { D.settings = s; if (ui.settingsOpen) openSettings(); });
  window.vigie.on('focus-search', () => { closeSettings(); $('search').focus(); $('search').select(); });
  window.addEventListener('resize', () => { if (ui.tab === 'visee') drawMini(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.settingsOpen) closeSettings();
  });
  render();
}

start();
