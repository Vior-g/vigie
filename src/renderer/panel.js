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
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

/** replaceChildren qui ignore null / false. */
function put(node, ...kids) {
  node.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return node;
}

const ELEMENTS = [
  ['neutre', 'Neutre'], ['terre', 'Terre'], ['feu', 'Feu'], ['eau', 'Eau'], ['air', 'Air'],
];
const EL_LABEL = Object.fromEntries(ELEMENTS);

let D = { settings: null, state: null, defaults: {}, hotkeysFailed: [], stats: null, version: '' };
const ui = {
  settingsOpen: false, compact: false, searchOpen: false,
  fiche: null, ficheKey: null, secsKey: null, wantSec: null,
  mrev: -1, cardsKey: '', expanded: new Set(), lastFocus: null,
  sel: -1, results: [], mini: { me: null, target: null }, normalHeight: null, recentKey: '', notesOpen: false,
};

const fmt = (n) => (n == null ? '?' : Number(n).toLocaleString('fr-FR'));
const hk = (name) => (D.settings && D.settings.hotkeys[name]) || '';
const prettyKey = (acc) => (acc || '—').replace(/Control/g, 'Ctrl').replace(/Shift/g, 'Maj');
const range = (r) => (Array.isArray(r) ? (r[0] === r[1] ? fmt(r[0]) : `${fmt(r[0])} à ${fmt(r[1])}`) : fmt(r));
const G = () => (ui.fiche && ui.fiche.guide) || null;
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

// Sections ouvertes : mémorisées d'une fois sur l'autre (confort uniquement).
const OPEN_KEY = 'vigie.sections';
let openSecs = { essentiel: true, visee: true, 's-essentiel': true };
try { openSecs = { ...openSecs, ...JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') }; } catch (e) { /* stockage indisponible */ }
function rememberSection(key, open) {
  openSecs[key] = open;
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(openSecs)); } catch (e) { /* stockage indisponible */ }
}

// ------------------------------------------------------------------ rendu

function render() {
  renderNotice();
  renderUpdate();
  renderModes();
  const s = D.state;
  if (s.dataRev !== ui.mrev) { ui.mrev = s.dataRev; ui.ficheKey = null; ui.cardsKey = ''; }

  const ficheKey = s.ficheId ? `${s.ficheId}|${s.dataRev}` : null;
  if (ficheKey !== ui.ficheKey) {
    ui.ficheKey = ficheKey;
    ui.fiche = null;
    ui.secsKey = null;
    ui.mini = { me: null, target: null };
    if (s.ficheId) {
      const want = ficheKey;
      window.vigie.fiche(s.ficheId).then((f) => {
        if (ui.ficheKey !== want) return;
        ui.fiche = f;
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
    const h = Math.ceil(main.offsetTop + content.offsetHeight + 22);
    if (Math.abs(h - window.innerHeight) > 2) window.vigie.panelHeight(Math.min(h, 560));
  });
}

function renderHeader() {
  const f = ui.fiche;
  const p = $('portrait');
  const combat = D.state.view === 'combat';
  let title = 'Vigie'; let sub = 'Aide aux combats Dofus'; let img = null;
  if (combat) {
    const n = D.state.combat.ids.length;
    title = 'Combat';
    sub = [n ? plural(n, 'monstre', 'monstres') : 'Aucun monstre lu', D.state.combat.songe ? `Songe niveau ${D.state.combat.songeLevel}` : null].filter(Boolean).join(', ');
  } else if (f) {
    title = f.nom;
    if (f.type === 'songe') sub = 'Mode Songe';
    else sub = [f.donjon !== f.nom ? f.donjon : null, f.niveau ? `niveau ${f.niveau}` : null].filter(Boolean).join(', ');
    img = f.bosses && f.bosses[0] && f.bosses[0].image;
  }
  $('bossName').textContent = title;
  $('dungeonName').textContent = sub;
  const initial = combat ? '⚔' : (f && f.type === 'songe' ? '☾' : title.slice(0, 1));
  const key = img || initial;
  if (p.dataset.src !== key) {
    p.dataset.src = key;
    if (img) put(p, el('img', { src: img, alt: '', onerror: () => { p.textContent = initial; } }));
    else p.textContent = initial;
  }
  // Point d'état : le détail est dans l'infobulle, l'avis n'apparaît que s'il faut agir.
  const det = D.state.detection || {};
  const dot = $('statusDot');
  let cls = 'dot'; let tip;
  if (!det.enabled) tip = 'Détection en pause';
  else if (det.error) { cls += ' err'; tip = `Erreur : ${det.error}`; }
  else if (D.state.pinned) { cls += ' pin'; tip = 'Fiche choisie à la main'; }
  else if (D.state.platform === 'win32' && !det.dofusVisible) tip = 'En attente de la fenêtre Dofus';
  else if (det.match) { cls += ' on'; tip = `Détecté : ${det.match.label}`; }
  else { cls += ' on'; tip = 'Détection active : lieu non reconnu'; }
  dot.className = cls;
  dot.title = tip;
}

/** Avis : seulement quand une action est utile (pause, erreur, choix manuel, mise à jour masquée). */
function renderNotice() {
  const s = D.state; const box = $('notice');
  const det = s.detection || {};
  const u = s.update;
  let text = null; let action = null; let cls = 'notice';
  if (!det.enabled) {
    text = 'La détection du lieu est en pause.';
    action = el('button', { class: 'textbtn', onclick: () => setSettings({ detection: { enabled: true } }) }, 'Reprendre');
  } else if (det.error) {
    cls += ' err'; text = `Lecture de l'écran impossible : ${det.error}`;
  } else if (s.pinned && s.view !== 'combat') {
    text = 'Fiche choisie à la main.';
    action = el('button', { class: 'textbtn', onclick: () => window.vigie.select(null) }, 'Revenir en auto');
  } else if (u && u.dismissed && ['available', 'error'].includes(u.phase)) {
    text = `Vigie ${u.version} est disponible.`;
    action = el('button', { class: 'textbtn', onclick: () => window.vigie.appUpdate('show') }, 'Voir');
  }
  box.hidden = !text;
  if (!text) return;
  box.className = cls;
  put(box, el('span', { class: 'grow' }, text), action);
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
  const btn = (label, action, cls = '') => el('button', { class: `btn ${cls}`, onclick: () => window.vigie.appUpdate(action) }, label);
  if (u.phase === 'available') {
    put(box,
      el('p', {}, el('b', {}, `Vigie ${u.version} est disponible`), ` (tu as la ${u.current}).`),
      el('p', { class: 'muted small' }, u.canInstall
        ? `${mo(u.size)} à télécharger. Vigie redémarre tout seul.`
        : 'Télécharge-la sur GitHub ; les suivantes s\'installeront toutes seules.'),
      el('div', { class: 'u-actions' },
        u.canInstall ? btn('Mettre à jour', 'install', 'go') : btn('Télécharger', 'open', 'go'),
        btn('Plus tard', 'later'),
        u.notes ? el('button', { class: 'btn quiet', onclick: () => { ui.notesOpen = !ui.notesOpen; renderUpdate(); } }, ui.notesOpen ? 'Masquer les nouveautés' : 'Nouveautés') : null,
        btn('Ignorer cette version', 'skip', 'quiet')),
      ui.notesOpen && u.notes ? el('div', { class: 'u-notes' }, u.notes) : null);
  } else if (u.phase === 'download' || u.phase === 'extract') {
    const pct = u.total ? Math.min(100, Math.floor((u.done / u.total) * 100)) : 0;
    put(box,
      el('p', {}, u.phase === 'download' ? `Téléchargement de Vigie ${u.version} : ${pct} % (${mo(u.done || 0)} sur ${mo(u.total || 0)})` : 'Préparation de la mise à jour…'),
      el('div', { class: 'u-bar' }, el('i', { style: `width:${u.phase === 'extract' ? 100 : pct}%` })));
  } else if (u.phase === 'restart') {
    put(box, el('p', {}, el('b', {}, `Installation de Vigie ${u.version}, redémarrage…`)));
  } else if (u.phase === 'error') {
    put(box,
      el('p', {}, el('b', {}, 'La mise à jour a échoué : '), u.error || 'erreur inconnue'),
      el('div', { class: 'u-actions' }, u.canInstall ? btn('Réessayer', 'install', 'go') : null, btn('Page de téléchargement', 'open'), btn('Plus tard', 'later')));
  }
}

function renderModes() {
  const s = D.state;
  $('modeFiche').textContent = s.ficheId === 'songes' ? 'Songe' : 'Donjon';
  $('modeFiche').classList.toggle('on', s.view !== 'combat');
  $('modeCombat').classList.toggle('on', s.view === 'combat');
  $('modeFiche').setAttribute('aria-selected', s.view !== 'combat');
  $('modeCombat').setAttribute('aria-selected', s.view === 'combat');
  $('combatCount').textContent = s.combat.ids.length ? s.combat.ids.length : '';
  const btn = $('btnRead');
  btn.disabled = !!s.combat.reading;
  btn.firstElementChild.textContent = s.combat.reading ? 'Lecture…' : 'Lire les monstres';
  $('readKey').textContent = prettyKey(hk('scanMonsters'));
  btn.title = 'Survole un groupe ou un monstre dans le jeu, puis appuie sur le raccourci';
}

// ---------------------------------------------------- verdict élémentaire

/** Ce qu'il faut frapper : les éléments les plus faibles, celui à éviter, puis les 5 valeurs. */
function verdict(res, { label = 'Frappe en', extra = null } = {}) {
  if (!res) return null;
  const vals = ELEMENTS.map(([k]) => [k, res[k]]).filter(([, v]) => typeof v === 'number').sort((a, b) => a[1] - b[1]);
  if (!vals.length) return null;
  const min = vals[0][1]; const max = vals[vals.length - 1][1];
  const best = max - min < 3 ? [] : vals.filter(([, v]) => v <= min + 3).slice(0, 3);
  const bestKeys = new Set(best.map(([k]) => k));
  const worst = max - min >= 5 ? vals[vals.length - 1] : null;
  const pill = ([k, v]) => el('span', { class: 'pill', style: `--c: var(--${k})` }, EL_LABEL[k], el('small', {}, `${v} %`));
  return el('div', { class: 'verdict' },
    el('div', { class: 'v-main' },
      best.length
        ? [el('span', { class: 'v-label' }, label), best.map(pill)]
        : el('span', { class: 'v-label' }, `Résistances égales partout (${min} %)`),
      worst && best.length ? el('span', { class: 'v-avoid', style: `--c: var(--${worst[0]})` }, 'évite ', el('b', {}, `${EL_LABEL[worst[0]]} ${worst[1]} %`)) : null),
    el('div', { class: 'v-all', 'aria-label': 'Toutes les résistances' }, ELEMENTS.map(([k, l]) => el('span', {
      class: bestKeys.has(k) ? 'best' : '', style: `--c: var(--${k})`,
    }, el('i', {}, l), res[k] == null ? '?' : `${res[k]} %`))),
    extra);
}

function bestPill(res) {
  if (!res) return null;
  const vals = ELEMENTS.map(([k]) => [k, res[k]]).filter(([, v]) => typeof v === 'number').sort((a, b) => a[1] - b[1]);
  if (vals.length < 2 || vals[vals.length - 1][1] - vals[0][1] < 3) return null;
  const [k, v] = vals[0];
  return el('span', { class: 'pill', style: `--c: var(--${k})`, title: 'Élément le plus efficace' }, EL_LABEL[k], el('small', {}, `${v} %`));
}

// ------------------------------------------------------------ accueil

async function renderEmpty() {
  const recent = (D.state.recent || []).filter((id) => id !== 'songes');
  const key = recent.join(',');
  put($('emptyHint'),
    'La fiche du donjon s\'ouvre toute seule quand tu y entres. En combat, survole un groupe de monstres et appuie sur ',
    el('kbd', {}, prettyKey(hk('scanMonsters'))), '.');
  const st = D.stats;
  if (st) $('dataStats').textContent = `${fmt(st.dungeons)} donjons, ${fmt(st.monsters)} monstres et ${st.guides} guides de boss. Vigie ${D.version}.`;
  if (ui.recentKey === key && $('quick').childElementCount) return;
  ui.recentKey = key;
  const labels = recent.length ? await window.vigie.ficheLabels(recent) : [];
  put($('quick'),
    el('button', { class: 'songe', onclick: () => window.vigie.select('songes') },
      el('span', { class: 'ico' }, '☾'), el('span', {}, el('strong', {}, 'Songes Infinis'), el('small', {}, 'Règles, Aberrations, avis de recherche'))),
    el('button', { onclick: () => openSearch() },
      el('span', { class: 'ico' }, '⌕'), el('span', {}, el('strong', {}, 'Chercher un donjon ou un monstre'), el('small', {}, prettyKey(hk('search'))))),
    labels.length ? el('h3', {}, 'Ouverts récemment') : null,
    labels.map((f) => el('button', { onclick: () => window.vigie.select(f.id) },
      el('span', { class: 'ico' }, f.nom.slice(0, 1)),
      el('span', {}, el('strong', {}, f.nom), el('small', {}, `${f.donjon}${f.niveau ? `, niveau ${f.niveau}` : ''}`)))),
  );
}

// ------------------------------------------------------------- fiche

function renderFiche() {
  const f = ui.fiche;
  const songe = f.type === 'songe';
  const tours = (G() && G().tours) || [];
  const boss = !songe && f.bosses && f.bosses[0];
  const showTurns = !songe && (tours.length > 0 || f.outil === 'harebourg');
  $('turnbar').hidden = !showTurns;
  renderTurn(showTurns ? tours : []);

  const secsKey = `${ui.ficheKey}`;
  if (ui.secsKey !== secsKey) {
    ui.secsKey = secsKey;
    put($('verdict'), boss ? verdict(boss.res, {
      extra: el('p', { class: 'v-stats' },
        el('b', {}, range(boss.pv)), ' PV, ', el('b', {}, boss.pa ?? '?'), ' PA, ', el('b', {}, boss.pm ?? '?'), ' PM. ',
        'Esquive PA ', el('b', {}, boss.esquivePA ?? '?'), ', PM ', el('b', {}, boss.esquivePM ?? '?'), '.'),
    }) : null);
    put($('sections'), (songe ? songeSections(f) : donjonSections(f)).map(section));
    $('main').scrollTop = 0;
    if (ui.wantSec) {
      const d = $('sections').querySelector(`[data-sec="${ui.wantSec}"]`);
      ui.wantSec = null;
      if (d) { d.open = true; requestAnimationFrame(() => d.scrollIntoView({ block: 'start' })); }
    }
  }
  updateVisee();
}

/** Une section repliable ; son état ouvert/fermé est mémorisé. */
function section(s) {
  const d = el('details', { class: 'sec', 'data-sec': s.key },
    el('summary', {}, s.title, s.n != null ? el('span', { class: 'n' }, s.n) : null),
    el('div', { class: 'sec-body' }, s.body));
  const open = openSecs[s.key] != null ? openSecs[s.key] : !!s.open;
  if (open) d.open = true;
  d.addEventListener('toggle', () => {
    rememberSection(s.key, d.open);
    if (d.open && s.key === 'visee') requestAnimationFrame(drawMini);
    if (ui.compact) fitCompact();
  });
  return d;
}

const bullets = (items) => el('ul', { class: 'bullets' }, items.map((t) => el('li', {}, t)));
const itemList = (items, cls = '') => el('div', { class: 'items' }, items.map(([t, x, c]) => el('div', { class: `item ${c || cls}` }, t ? el('h4', {}, t) : null, el('p', {}, x))));

function donjonSections(f) {
  const g = f.guide;
  const out = [];
  if (f.outil === 'harebourg') out.push({ key: 'visee', title: 'Viser le Comte malgré la confusion', body: viseeBody(), open: true });
  out.push({
    key: 'essentiel', title: g ? 'L\'essentiel' : 'L\'essentiel (données du jeu)', open: true,
    body: g
      ? [bullets(g.essentiel || []), g.note ? el('p', { class: 'note' }, g.note) : null]
      : [el('p', { class: 'warnbox' }, 'Pas encore de guide pour ce donjon : voici ce que disent les données du jeu.'), autoSummary(f)],
  });
  const meca = [...(g ? g.mecaniques || [] : []).map((m) => [m.t, m.x])];
  if (meca.length || (g && (g.sorts || []).length)) {
    out.push({
      key: 'mecaniques', title: 'Mécaniques', n: meca.length || null,
      body: [meca.length ? itemList(meca) : null,
        g && (g.sorts || []).length ? [el('p', { class: 'sub-h' }, `Sorts à connaître de ${f.nom}`), itemList(g.sorts.map((s) => [s.n, s.x]))] : null],
    });
  }
  const mons = f.monsters || [];
  if (mons.length || (f.extraNotes || []).length) {
    out.push({
      key: 'monstres', title: 'Monstres du donjon', n: mons.length || null,
      body: [
        el('div', { class: 'rows' }, mons.map((m) => monsterRow(m, {}))),
        (f.extraNotes || []).length ? [el('p', { class: 'sub-h' }, 'Invocations et autres'), itemList(f.extraNotes.map((m) => [m.nom, m.note, m.danger === 'haut' ? 'warn' : '']))] : null,
      ],
    });
  }
  if (g && ((g.strategie || []).length || (g.pieges || []).length)) {
    out.push({
      key: 'strategie', title: 'Stratégie et pièges',
      body: [
        (g.strategie || []).length ? el('ol', { class: 'steps' }, g.strategie.map((t) => el('li', {}, t))) : null,
        (g.pieges || []).length ? [el('p', { class: 'sub-h' }, 'Pièges à éviter'), bullets(g.pieges)] : null,
      ],
    });
  }
  const bosses = f.bosses || [];
  if (bosses.length) {
    out.push({
      key: 'sorts', title: bosses.length > 1 ? 'Sorts des boss' : `Sorts de ${bosses[0].nom}`,
      body: bosses.map((b, i) => [bosses.length > 1 ? el('p', { class: 'sub-h' }, i === 0 ? b.nom : `${b.nom} (autre boss du donjon)`) : null, spellList(b.spells)]),
    });
  }
  if (g && (g.succes || []).length) out.push({ key: 'succes', title: 'Succès', n: g.succes.length, body: itemList(g.succes.map((s) => [s.n, s.x])) });
  out.push({ key: 'acces', title: 'Accès et source', body: accesBody(f) });
  return out;
}

function accesBody(f) {
  const g = f.guide;
  const facts = [
    f.donjon ? `Donjon : ${f.donjon}` : null,
    f.niveau ? `Niveau : ${f.niveau}` : null,
    f.zone ? `Zone : ${f.zone}` : null,
    f.pos ? `Entrée en [${f.pos[0]}, ${f.pos[1]}]` : null,
  ].filter(Boolean);
  return [
    facts.length ? bullets(facts) : null,
    g && (g.acces || []).length ? [el('p', { class: 'sub-h' }, 'Pour y aller'), bullets(g.acces)] : null,
    g && g.src ? el('p', { class: 'note' }, 'Guide résumé d\'après ', el('a', { class: 'link', onclick: () => window.vigie.open(g.src) }, g.src.replace(/^https:\/\/(www\.)?/, '').split('/')[0]),
      g.maj ? `, mis à jour le ${new Date(g.maj).toLocaleDateString('fr-FR')}` : '', g.perso ? ' (guide perso)' : '', '. Les mécaniques peuvent changer avec les mises à jour du jeu.') : null,
    el('p', { class: 'note' }, 'Statistiques, résistances et sorts : données du jeu, mises à jour chaque semaine.'),
  ];
}

/** Donjon sans guide : faits utiles tirés des données. */
function autoSummary(f) {
  const b = f.bosses && f.bosses[0];
  const items = [];
  if (b) {
    if (b.flags.length) items.push(b.flags.join(', '));
    const strong = (b.spells || []).filter((s) => spellTags([s]).length);
    for (const s of strong.slice(0, 6)) items.push(`${s.n} : ${(s.e || []).slice(0, 3).join(', ')}`);
  }
  return items.length ? bullets(items) : el('p', { class: 'muted' }, 'Rien de particulier dans les sorts du boss.');
}

function songeSections(f) {
  const sg = f.songes;
  const seen = new Set(D.state.combat.aberrations || []);
  return [
    {
      key: 's-essentiel', title: 'L\'essentiel', open: true,
      body: [bullets(sg.essentiel || []),
        el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: () => window.vigie.combatScan() }, 'Lire les monstres'), el('kbd', {}, prettyKey(hk('scanMonsters'))))],
    },
    {
      key: 's-aberrations', title: 'Aberrations', n: (sg.aberrations || []).length,
      body: [el('p', { class: 'muted small', style: 'margin-bottom:8px' }, 'Gardiens modifiés quand une Aberration est active (icône en haut à droite dans le jeu).'),
        el('div', { class: 'items' }, (sg.aberrations || []).map((a) => el('div', { class: `item ${seen.has(a.boss) ? 'aber-on' : ''}` },
          el('h4', {}, a.famille ? `Famille ${a.boss}` : a.boss, seen.has(a.boss) ? el('span', { class: 'badge ab' }, 'active') : null),
          el('p', {}, a.x))))],
    },
    { key: 's-regles', title: 'Règles des Songes', body: [itemList((sg.regles || []).map((r) => [r.t, r.x])), (sg.sources || []).length ? el('p', { class: 'note' }, 'Source : ', ...sg.sources.map((s) => el('a', { class: 'link', onclick: () => window.vigie.open(s.url) }, s.titre))) : null] },
    {
      key: 's-avis', title: 'Avis de recherche des Songes', n: (sg.avis || []).length,
      body: [el('p', { class: 'muted small', style: 'margin-bottom:8px' }, 'Touche un nom pour afficher sa fiche. Ils perdent environ 1 500 PV et 100 de puissance par allié présent.'),
        el('div', { class: 'chips' }, (sg.avis || []).map((a) => el('button', { class: 'chip', disabled: !a.id, onclick: () => a.id && window.vigie.combatAdd(a.id) }, a.nom)))],
    },
  ];
}

function renderTurn(tours) {
  const t = D.state.turn;
  $('turnNum').textContent = t;
  $('turnParity').textContent = t % 2 === 0 ? 'pair' : 'impair';
  const rules = tours.length ? window.TurnRules.rulesFor({ tours }, t) : [];
  const key = `${ui.ficheKey}|${t}`;
  if ($('reminders').dataset.key === key) return;
  $('reminders').dataset.key = key;
  put($('reminders'), rules.map((r) => el('li', { class: r.level || 'info' }, r.text)));
}

// ------------------------------------------------------- monstres / sorts

const SPELL_TAGS = [
  [/(^|\| )-\d+( à -\d+)? PA\b|Vole \d+ PA\b/, 'retire des PA'],
  [/(^|\| )-\d+( à -\d+)? PM\b|Vole \d+ PM\b/, 'retire des PM'],
  [/-\d+ Portée|Vole \d+ Portée/, 'retire de la portée'],
  [/Repousse/, 'repousse'], [/Attire/, 'attire'],
  [/Téléporte|Échange de positions|Téléportation/, 'se téléporte'],
  [/Invoque|par l'invocation/, 'invoque'],
  [/\bvol (Neutre|Terre|Feu|Eau|Air)\b/, 'vole de la vie'],
  [/Soin :|\bsoins (Neutre|Terre|Feu|Eau|Air)\b/, 'soigne'],
  [/Bouclier/, 'bouclier'], [/Érosion/, 'érosion'],
  [/-\d+ Puissance|-\d+% Résistance|-\d+% Dommages/, 'affaiblit'],
  [/invisible/i, 'invisible'], [/glyphe|piège/i, 'glyphes ou pièges'],
  [/État Pesanteur/, 'Pesanteur'], [/État Indéplaçable/, 'Indéplaçable'], [/État Insoignable/, 'Insoignable'],
  [/État Pacifiste/, 'Pacifiste'], [/État Affaibli/, 'Affaibli'], [/État Intaclable/, 'Intaclable'],
];

/** Effets marquants des sorts d'un monstre, lisibles sans déplier. */
function spellTags(spells) {
  const text = (spells || []).map((sp) => (sp.e || []).join(' | ')).join(' | ');
  return SPELL_TAGS.filter(([re]) => re.test(text)).map(([, t]) => t);
}

function spellList(spells) {
  if (!spells || !spells.length) return el('p', { class: 'muted' }, 'Aucun sort connu.');
  return el('ul', { class: 'spells' }, spells.map((s) => {
    const meta = [];
    if (s.pa != null) meta.push(`${s.pa} PA`);
    if (s.po) meta.push(`portée ${s.po[0] === s.po[1] ? s.po[0] : `${s.po[0]} à ${s.po[1]}`}${s.mod ? ' (modifiable)' : ''}`);
    if (s.lig) meta.push('en ligne');
    if (s.dia) meta.push('en diagonale');
    if (s.ldv === 0) meta.push('sans ligne de vue');
    if (s.tour) meta.push(`${s.tour} fois par tour`);
    if (s.cib) meta.push(`${s.cib} fois par cible`);
    if (s.cd) meta.push(`relance ${s.cd} tours`);
    if (s.ini) meta.push(`dès le tour ${s.ini + 1}`);
    return el('li', {},
      el('div', { class: 'sp-head' }, el('b', {}, s.n), el('span', { class: 'sp-meta' }, meta.join(', '))),
      (s.e || []).length ? el('div', { class: 'sp-eff' }, s.e.join(', ')) : null,
      s.d ? el('div', { class: 'sp-desc' }, s.d) : null);
  }));
}

/** Ligne niveau, PV, PA, PM (avec la mise à l'échelle du Songe). */
function statLine(m) {
  const sc = m.scaled;
  const lv = sc ? el('span', { class: 'lv-songe', title: `Niveau de l'étage (version de base : niveau ${range(sc.baseLevel)})` }, `niveau ${sc.level}`) : `niveau ${range(m.niveau)}`;
  let pv;
  if (m.pvRead) pv = el('span', { title: 'PV lus à l\'écran' }, `${fmt(m.pvRead)} PV`);
  else if (sc && sc.estimated) pv = el('span', { title: `Estimation : PV de base ${range(sc.basePv)} au niveau ${range(sc.baseLevel)}, mis au niveau ${sc.level} avec la courbe de PV du jeu` }, `environ ${fmt(m.pv[1])} PV`);
  else pv = `${range(m.pv)} PV`;
  return [lv, ', ', pv, `, ${m.pa ?? '?'} PA, ${m.pm ?? '?'} PM`];
}

/**
 * Un monstre en une ligne : nom, niveau et PV, élément à jouer, effets
 * marquants. Un clic déplie résistances, conseils et sorts.
 */
function monsterRow(m, { removable = false, ctx = 'f' } = {}) {
  const key = `${ctx}${m.id}`;
  const open = ui.expanded.has(key);
  const ab = m.aberration && (D.state.combat.songe || D.state.songe || (D.state.combat.aberrations || []).includes(m.nom));
  const tags = spellTags(m.spells);
  const variants = (m.variants || []).filter((v) => (v.lv[1] || 0) >= 10);
  const row = el('div', { class: `mrow ${m.boss ? 'boss' : ''} ${m.danger === 'haut' ? 'danger-haut' : ''}`, 'data-id': m.id });
  const toggle = () => {
    if (ui.expanded.has(key)) ui.expanded.delete(key); else ui.expanded.add(key);
    row.replaceWith(monsterRow(m, { removable, ctx }));
    if (ui.compact) fitCompact();
  };
  const head = el('div', { class: 'm-head', role: 'button', tabindex: '0', 'aria-expanded': open, onclick: toggle, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } },
    m.image ? el('img', { src: m.image, alt: '', loading: 'lazy', onerror: (e) => e.target.replaceWith(el('span', { class: 'noimg' }, m.nom.slice(0, 1))) }) : el('span', { class: 'noimg' }, m.nom.slice(0, 1)),
    el('div', { class: 'm-t' },
      el('div', { class: 'm-name' }, m.nom, m.boss ? el('span', { class: 'badge' }, 'boss') : null, ab ? el('span', { class: 'badge ab' }, 'Aberration') : null),
      el('div', { class: 'm-line' }, ...statLine(m))),
    el('div', { class: 'm-weak' }, bestPill(m.res)),
    removable ? el('button', { class: 'm-x', title: 'Retirer de la liste', 'aria-label': `Retirer ${m.nom}`, onclick: (e) => { e.stopPropagation(); window.vigie.combatRemove(m.id); } }, '×') : null);
  const tagLine = tags.length || (m.note && !open)
    ? el('div', { class: 'tags' }, tags.map((t) => el('span', {}, t)), m.note && !open ? el('span', { class: 'tip' }, 'Conseil disponible') : null)
    : null;
  put(row, head, tagLine);
  if (open) {
    row.append(el('div', { class: 'm-more' },
      m.res ? verdict(m.res, { label: 'Frappe en' }).querySelector('.v-all') : null,
      el('p', { class: 'm-facts' }, `Esquive PA ${m.esquivePA ?? '?'}, PM ${m.esquivePM ?? '?'}`, m.race ? `. Famille : ${m.race}` : '', m.flags && m.flags.length ? `. ${m.flags.join(', ')}` : '', '.'),
      ab ? el('div', { class: 'abbox' }, el('b', {}, 'Aberration : '), m.aberration) : null,
      m.note ? el('div', { class: 'm-note' }, m.note, m.noteFrom && ctx === 'c' ? el('span', { class: 'from' }, ` (guide : ${m.noteFrom})`) : null) : null,
      (m.ficheId && ctx === 'c') || (removable && variants.length > 1 && !m.scaled)
        ? el('div', { class: 'm-actions' },
          m.ficheId && ctx === 'c' ? el('button', { class: 'btn', onclick: () => window.vigie.select(m.ficheId) }, 'Voir le donjon de ce boss') : null,
          removable && variants.length > 1 && !m.scaled ? [el('span', { class: 'lbl' }, 'Version :'), ...variants.slice(-3).map((v) => el('button', {
            class: `chip ${v.id === m.id ? 'on' : ''}`, title: v.expe ? 'Version des expéditions' : '',
            onclick: () => v.id !== m.id && window.vigie.combatSwap(m.id, v.id),
          }, `niveau ${range(v.lv)}${v.expe ? ' (expédition)' : ''}`))] : null)
        : null,
      (m.spells || []).length ? [el('p', { class: 'sub-h', style: 'margin:4px 0 0' }, 'Sorts'), spellList(m.spells)] : null));
  }
  return row;
}

// ------------------------------------------------------------- combat

function renderSongeBar(c) {
  const bar = $('songeBar');
  const on = !!c.songe;
  const key = `${on}|${c.songeLevel}|${c.songeManual}`;
  if (bar.dataset.key === key || bar.contains(document.activeElement)) return;
  bar.dataset.key = key;
  put(bar,
    el('button', {
      class: `toggle ${on ? 'on' : ''}`, 'aria-pressed': on,
      title: on ? 'Les monstres sont affichés au niveau de l\'étage du Songe' : 'Afficher les monstres au niveau d\'un étage de Songe',
      onclick: () => window.vigie.combatSonge({ on: !on }),
    }, el('i'), 'Songe'),
    on ? el('label', { class: 'lvl' }, 'niveau', el('input', {
      type: 'number', min: 1, max: 400, value: c.songeLevel, 'aria-label': 'Niveau des monstres',
      onchange: (e) => window.vigie.combatSonge({ level: Number(e.target.value) }),
    })) : null,
    c.songeManual != null ? el('button', { class: 'textbtn', title: 'Laisser Vigie décider', onclick: () => window.vigie.combatSonge({ auto: true }) }, 'auto') : null);
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
    put($('cards')); put($('groupVerdict')); put($('aberr'));
    put($('combatEmpty'),
      el('h2', {}, 'Aucun monstre pour l\'instant'),
      el('ol', { class: 'steps' },
        el('li', {}, 'Dans le jeu, survole le groupe de monstres (ou un monstre en combat, sur le terrain ou dans la timeline).'),
        el('li', {}, 'Appuie sur ', el('kbd', {}, prettyKey(hk('scanMonsters'))), '. Vigie lit les noms et affiche ce qu\'il faut frapper.'),
        el('li', {}, 'Recommence pour ajouter d\'autres monstres.')),
      el('p', { class: 'foot' }, 'Tu peux aussi chercher un monstre par son nom (', prettyKey(hk('search')), ').'));
    return;
  }
  put($('combatEmpty'));
  const want = key;
  window.vigie.combatViews().then(({ views, summary }) => {
    if (ui.cardsKey !== want) return;
    put($('groupVerdict'), summary && views.length > 1 ? verdict(summary.avg, {
      label: 'Contre ce groupe, frappe en',
      extra: el('p', { class: 'v-stats' }, 'Résistances moyennes, pondérées par les PV.'),
    }) : null);
    const ab = (c.aberrations || []);
    put($('aberr'), ab.length ? el('div', { class: 'abbox big' }, el('b', {}, `Aberration active : ${ab.join(', ')}`),
      ...ab.map((name) => {
        const v = views.find((x) => x.nom === name);
        return v && v.aberration ? el('p', {}, v.aberration) : null;
      }),
      el('button', { class: 'textbtn', onclick: () => { ui.wantSec = 's-aberrations'; if (D.state.ficheId === 'songes') ui.secsKey = null; window.vigie.select('songes'); } }, 'Toutes les Aberrations')) : null);
    // Un seul monstre lu : on le déplie directement.
    if (D.state.focusMonster && D.state.focusMonster !== ui.lastFocus) {
      ui.lastFocus = D.state.focusMonster;
      if (views.length === 1) ui.expanded.add(`c${views[0].id}`);
    }
    put($('cards'), views.map((v) => monsterRow(v, { removable: true, ctx: 'c' })));
    const focus = D.state.focusMonster && $('cards').querySelector(`[data-id="${D.state.focusMonster}"]`);
    if (focus) requestAnimationFrame(() => { focus.scrollIntoView({ block: 'nearest' }); focus.classList.add('focus-flash'); });
    if (ui.compact) fitCompact();
  });
}

// -------------------------------------------------------------- Harebourg

function rotButton(q, glyph, label) {
  return el('button', { 'data-q': q, onclick: () => window.vigie.harebourg({ baseQ: q }) },
    el('span', { class: 'g' }, glyph), label);
}

function viseeBody() {
  const s = D.settings; const tiers = s.harebourg.tiers || D.defaults.tiers;
  const hpInput = el('input', {
    type: 'number', min: 0, max: 100, id: 'hpInput', placeholder: '%',
    oninput: (e) => { if (e.target.value !== '') window.vigie.harebourg({ hp: Number(e.target.value) }); },
  });
  const canvas = el('canvas', { class: 'mini', id: 'miniCanvas' });
  canvas.addEventListener('mousedown', (e) => onMiniClick(e, canvas));
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  const cal = D.state.calibration;
  return [
    el('p', { class: 'muted' }, 'Ta confusion de ce tour (visible dans tes états) :'),
    el('div', { class: 'rot', id: 'rotBtns' },
      rotButton(1, '↻', '90° horaire'), rotButton(2, '⟲', '180°'), rotButton(3, '↺', '90° anti-horaire')),
    el('div', { class: 'row' },
      el('label', { for: 'hpInput' }, 'Ou tes PV en début de tour :'), hpInput,
      el('span', { class: 'muted', id: 'tierHint' })),
    el('p', { class: 'muted', style: 'margin-top:4px' }, 'Coups au corps à corps déjà donnés ce tour :'),
    el('div', { class: 'row stepper' },
      el('button', { class: 'step', 'aria-label': 'Un coup de moins', onclick: () => window.vigie.harebourg({ meleeLines: D.state.harebourg.meleeLines - 1 }) }, '−'),
      el('b', { id: 'meleeNum' }, '0'),
      el('button', { class: 'step', 'aria-label': 'Un coup de plus', onclick: () => window.vigie.harebourg({ meleeLines: D.state.harebourg.meleeLines + 1 }) }, '+'),
      el('span', { class: 'muted small' }, 'chaque coup décale la confusion d\'un quart de tour')),
    el('div', { class: 'eff', id: 'effBox' }),
    el('p', { class: 'sub-h' }, 'Dans le jeu'),
    el('ol', { class: 'steps' },
      el('li', {}, 'Survole ta case et appuie sur ', el('kbd', {}, prettyKey(hk('harebourgAim'))), '.'),
      el('li', {}, 'Survole la cible et appuie de nouveau.'),
      el('li', {}, 'Clique la case verte. ', el('kbd', {}, prettyKey(hk('harebourgClear'))), ' efface les repères.')),
    el('div', { class: 'row' },
      el('span', { class: 'muted', id: 'calStatus' }, cal ? `Grille calibrée pour ${D.state.sizeKey}.` : 'Grille pas encore calibrée : la case affichée sera approximative.'),
      el('button', { class: `btn ${cal ? '' : 'primary'}`, onclick: () => window.vigie.boardMode('calibrate') }, cal ? 'Recalibrer' : 'Calibrer la grille')),
    el('p', { class: 'sub-h' }, 'Simulateur'),
    el('p', { class: 'muted small' }, 'Clic gauche : ta case. Clic droit : la cible.'),
    canvas,
    el('div', { class: 'legend' },
      el('span', { style: '--c:#55c7ff' }, el('i'), 'toi'),
      el('span', { style: '--c:#ff5d5d' }, el('i'), 'cible'),
      el('span', { style: '--c:#5cff8f' }, el('i'), 'case à viser'),
      el('span', { style: '--c:#ffae42' }, el('i'), 'tir direct'),
      el('span', { style: '--c:#c48bff' }, el('i'), 'arrivée de la téléportation')),
    el('p', { class: 'note' }, `Paliers de PV indicatifs : ${tiers.map((t) => `${t.min} à ${t.max} % ${H.ROT_LABEL[H.ROT[t.rotation]]}`).join(', ')}. Fie-toi d'abord à l'état affiché en combat (modifiable dans les réglages).`),
  ];
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
  $('tierHint').textContent = tier ? `donc ${H.ROT_LABEL[H.ROT[tier.rotation]]}` : '';
  $('effBox').replaceChildren('Rotation à appliquer : ', el('b', {}, H.ROT_LABEL[h.q]),
    h.meleeLines ? ` (base ${H.ROT_LABEL[h.baseQ]}, ${plural(h.meleeLines, 'coup', 'coups')} au corps à corps)` : '');
  drawMini();
}

function drawMini() {
  const canvas = $('miniCanvas');
  if (!canvas || !canvas.clientWidth) return;
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

function openSearch() {
  ui.searchOpen = true;
  $('searchRow').hidden = false;
  $('btnSearch').classList.add('on');
  closeSettings();
  const i = $('search');
  i.focus();
  i.select();
}

function closeSearch() {
  ui.searchOpen = false;
  $('search').value = '';
  $('results').hidden = true;
  $('searchRow').hidden = true;
  $('btnSearch').classList.remove('on');
}

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
    if (e.key === 'Escape') closeSearch();
  });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
}

function drawResults() {
  const box = $('results');
  const KIND = { donjon: 'donjon', boss: 'boss', monstre: 'monstre', songe: 'Songe' };
  if (!ui.results.length) {
    put(box, el('p', { class: 'muted small', style: 'padding:10px 12px' }, 'Aucun résultat. Essaie une partie du nom.'));
    box.hidden = false;
    return;
  }
  put(box, ui.results.map((r, i) => el('button', {
    class: i === ui.sel ? 'sel' : '', onmousedown: (e) => { e.preventDefault(); pick(r); },
  }, el('span', { class: 'lbl' }, r.label), el('span', { class: 'kind' }, KIND[r.kind] || r.kind),
  r.sub ? el('span', { class: 'sub' }, r.sub.replace(/ · /g, ', ')) : null)));
  box.hidden = false;
}

function pick(r) {
  closeSearch();
  if (r.kind === 'monstre') window.vigie.combatAdd(r.ref);
  else window.vigie.select(r.ref);
}

// -------------------------------------------------------------- réglages

function setSettings(patch) {
  return window.vigie.setSettings(patch).then((s) => { D.settings = s; return s; });
}

function line(label, control) { return el('label', { class: 'line' }, el('span', {}, label), control); }

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
    scanMonsters: 'Lire les monstres sous la souris', clearMonsters: 'Vider la liste des monstres',
    togglePanel: 'Afficher ou masquer Vigie', search: 'Chercher',
    nextTurn: 'Tour suivant', prevTurn: 'Tour précédent', resetTurn: 'Revenir au tour 1',
    harebourgAim: 'Harebourg : poser ta case puis la cible', harebourgClear: 'Harebourg : effacer les repères',
    forceScan: 'Relire le lieu maintenant',
  };
  const st = D.stats || {};
  const u = D.state.update;

  sh.replaceChildren(
    el('h2', {}, 'Réglages', el('button', { class: 'btn', onclick: closeSettings }, 'Fermer')),
    el('section', {}, el('h3', {}, 'Affichage'),
      line('Taille du texte', el('select', { onchange: (e) => setSettings({ panel: { zoom: Number(e.target.value) } }) },
        [[0.9, 'Petite'], [1, 'Normale'], [1.15, 'Grande'], [1.3, 'Très grande']].map(([v, l]) => el('option', { value: v, selected: Math.abs((s.panel.zoom || 1) - v) < 0.01 }, l)))),
      line('Opacité', el('input', { type: 'range', min: 0.5, max: 1, step: 0.02, value: s.panel.opacity, oninput: (e) => setSettings({ panel: { opacity: Number(e.target.value) } }) })),
      line('Masquer quand Dofus n\'est pas au premier plan', checkbox(s.panel.autoHide, (v) => setSettings({ panel: { autoHide: v } }))),
      line('Invisible aux captures et aux streams', checkbox(s.contentProtection, (v) => setSettings({ contentProtection: v })))),
    el('section', {}, el('h3', {}, 'Raccourcis'),
      Object.keys(HOTKEY_LABELS).map((k) => {
        hotkeyInputs[k] = el('input', { type: 'text', value: s.hotkeys[k] || '' });
        return line(HOTKEY_LABELS[k], hotkeyInputs[k]);
      }),
      el('p', { class: 'muted small' }, 'Format : Control+Alt+M, Control+Shift+F2…'),
      (D.hotkeysFailed || []).length ? el('p', {}, `Déjà utilisés par un autre logiciel : ${D.hotkeysFailed.join(', ')}. Choisis-en un autre.`) : null,
      el('div', { class: 'row' }, el('button', {
        class: 'btn primary',
        onclick: () => {
          const patch = {};
          for (const k of Object.keys(hotkeyInputs)) patch[k] = hotkeyInputs[k].value.trim();
          setSettings({ hotkeys: patch });
        },
      }, 'Enregistrer les raccourcis'))),
    el('section', {}, el('h3', {}, 'Détection du lieu'),
      line('Ouvrir la fiche du donjon toute seule', checkbox(d.enabled, (v) => setSettings({ detection: { enabled: v } }))),
      el('p', {}, 'Vigie lit le nom du lieu en haut à gauche du jeu. Si rien n\'est reconnu, encadre cette zone :'),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', onclick: () => window.vigie.boardMode('ocrzone') }, 'Choisir la zone de lecture'),
        el('button', { class: 'btn', onclick: () => window.vigie.scan() }, 'Relire maintenant')),
      el('div', { id: 'ocrDebug' })),
    el('section', {}, el('h3', {}, 'Lecture des monstres'),
      el('p', {}, 'Survole un monstre dans le jeu, puis teste ici ce que Vigie lit.'),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => window.vigie.combatScan() }, 'Tester la lecture')),
      el('div', { id: 'monDebug' }),
      line('Niveau des monstres en Songe (si non lu)', num(c.songeLevel || 200, { min: 1, max: 400 }, (v) => window.vigie.combatSonge({ level: v })))),
    el('section', {}, el('h3', {}, 'Mises à jour'),
      el('p', {}, `Vigie ${D.version}. ${st.guides || '?'} guides, données du jeu du ${st.generatedAt ? new Date(st.generatedAt).toLocaleDateString('fr-FR') : '?'}. ${D.state.dataInfo || ''}`),
      line('Chercher les mises à jour au démarrage', checkbox(s.updates !== false, (v) => setSettings({ updates: v }))),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: async () => { D.stats = await window.vigie.checkUpdates(); openSettings(); } }, 'Vérifier maintenant'),
        u && u.phase === 'uptodate' ? el('span', { class: 'muted' }, 'Vigie est à jour.') : null,
        u && u.phase === 'available' ? el('button', { class: 'btn go', onclick: () => { closeSettings(); window.vigie.appUpdate('show'); } }, `Installer la ${u.version}`) : null,
        u && u.phase === 'error' ? el('span', { class: 'muted' }, u.error) : null)),
    el('details', {}, el('summary', {}, 'Comte Harebourg'),
      el('p', {}, 'Paliers de PV et confusion. À corriger si tu constates autre chose en jeu.'),
      el('table', { class: 'tiers' }, tiers.map((t, i) => el('tr', {},
        el('td', {}, el('input', { type: 'number', value: t.min, onchange: (e) => { tiers[i].min = Number(e.target.value); } })),
        el('td', {}, 'à'),
        el('td', {}, el('input', { type: 'number', value: t.max, onchange: (e) => { tiers[i].max = Number(e.target.value); } })),
        el('td', {}, '%'),
        el('td', {}, el('select', { onchange: (e) => { tiers[i].rotation = e.target.value; } },
          ['horaire', 'demi', 'antihoraire', 'aucune'].map((r) => el('option', { value: r, selected: r === t.rotation }, H.ROT_LABEL[H.ROT[r]]))))))),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', onclick: () => setSettings({ harebourg: { tiers } }) }, 'Enregistrer'),
        el('button', { class: 'btn', onclick: () => setSettings({ harebourg: { tiers: null } }).then(openSettings) }, 'Valeurs par défaut')),
      line('Sens du décalage au corps à corps', el('select', { onchange: (e) => setSettings({ harebourg: { meleeDir: Number(e.target.value) } }) },
        el('option', { value: -1, selected: s.harebourg.meleeDir !== 1 }, 'anti-horaire (guides)'),
        el('option', { value: 1, selected: s.harebourg.meleeDir === 1 }, 'horaire'))),
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => window.vigie.boardMode('calibrate') }, 'Calibrer la grille de combat'))),
    el('details', {}, el('summary', {}, 'Réglages avancés de lecture'),
      line('Intervalle de lecture du lieu (ms)', num(d.intervalMs, { min: 700, step: 100 }, (v) => setSettings({ detection: { intervalMs: v } }))),
      line('Seuil du texte clair (0 à 255)', num(d.threshold, { min: 60, max: 250 }, (v) => setSettings({ detection: { threshold: v } }))),
      line('Agrandissement avant lecture', num(d.scale, { min: 1, max: 4 }, (v) => setSettings({ detection: { scale: v } }))),
      line('Lire toute la fenêtre (plus lent)', checkbox(d.fullWindow, (v) => setSettings({ detection: { fullWindow: v } }))),
      line('Nom du processus du jeu', el('input', { type: 'text', value: d.processPattern, onchange: (e) => setSettings({ detection: { processPattern: e.target.value } }) })),
      line('Garder la liste des monstres (secondes)', num(Math.round((c.mergeWindowMs || 120000) / 1000), { min: 10, max: 1800 }, (v) => setSettings({ combat: { mergeWindowMs: v * 1000 } }))),
      line('Zone autour de la souris : largeur (0 à 1)', num(c.cursorBox.w, { min: 0.1, max: 1, step: 0.02 }, (v) => setSettings({ combat: { cursorBox: { w: v } } }))),
      line('au-dessus (0 à 1)', num(c.cursorBox.up, { min: 0.05, max: 1, step: 0.02 }, (v) => setSettings({ combat: { cursorBox: { up: v } } }))),
      line('en dessous (0 à 1)', num(c.cursorBox.down, { min: 0, max: 1, step: 0.02 }, (v) => setSettings({ combat: { cursorBox: { down: v } } }))),
      line('Seuil du texte sombre (0 à 255)', num(c.darkThreshold, { min: 20, max: 200 }, (v) => setSettings({ combat: { darkThreshold: v } }))),
      line('Si rien n\'est lu, lire toute la fenêtre', checkbox(c.fullWindowFallback, (v) => setSettings({ combat: { fullWindowFallback: v } })))),
    el('details', {}, el('summary', {}, 'Guides perso'),
      el('p', {}, 'Ajoute tes propres guides (même format que ceux fournis) ; un guide perso du même nom remplace celui d\'origine.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => window.vigie.openFiches() }, 'Ouvrir le dossier'),
        el('button', { class: 'btn', onclick: async () => { D.stats = await window.vigie.reloadFiches(); openSettings(); } }, 'Recharger'))),
    el('div', { class: 'row' }, el('button', { class: 'btn', onclick: () => window.vigie.quit() }, 'Quitter Vigie')),
  );
  updateDebug();
}

function updateDebug() {
  const box = $('ocrDebug');
  if (box) {
    const det = D.state.detection || {};
    put(box,
      el('p', { class: 'muted small' }, det.time ? `Dernière lecture à ${new Date(det.time).toLocaleTimeString('fr-FR')}` : 'Aucune lecture pour l\'instant.'),
      det.preview ? el('img', { class: 'ocrprev', src: det.preview, alt: 'Zone lue' }) : null,
      det.text ? el('div', { class: 'ocrtext' }, det.text) : null,
      el('p', { class: 'muted small' }, det.match ? `Reconnu : ${det.match.label} (${det.match.score} %)` : 'Rien de reconnu.'),
    );
  }
  const mb = $('monDebug');
  if (mb) {
    const c = D.state.combat || {};
    put(mb,
      c.preview ? el('img', { class: 'ocrprev', src: c.preview, alt: 'Zone lue autour de la souris' }) : null,
      c.text ? el('div', { class: 'ocrtext' }, c.text) : null,
      c.info ? el('p', { class: 'muted small' }, c.info) : null);
  }
}

function closeSettings() { ui.settingsOpen = false; $('settings').hidden = true; }

// -------------------------------------------------------------- démarrage

async function start() {
  D = await window.vigie.init();
  setupSearch();
  $('btnSearch').addEventListener('click', () => (ui.searchOpen ? closeSearch() : openSearch()));
  $('btnSettings').addEventListener('click', () => (ui.settingsOpen ? closeSettings() : openSettings()));
  $('btnHide').addEventListener('click', () => window.vigie.hide());
  $('btnCompact').addEventListener('click', () => {
    ui.compact = !ui.compact;
    if (ui.compact) ui.normalHeight = window.innerHeight;
    document.body.classList.toggle('compact', ui.compact);
    $('btnCompact').classList.toggle('on', ui.compact);
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
  window.vigie.on('focus-search', () => openSearch());
  window.addEventListener('resize', () => drawMini());
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (ui.settingsOpen) closeSettings();
    else if (ui.searchOpen) closeSearch();
  });
  render();
}

start();
