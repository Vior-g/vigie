/*
 * Test Windows du remplacement des fichiers lors d'une mise à jour
 * (script PowerShell généré par src/main/appupdate.js), dans un faux dossier
 * d'installation dont le chemin contient des accents et des espaces.
 *   node test/update-swap.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeScript } = require('../src/main/appupdate');

if (process.platform !== 'win32') {
  console.log('Test réservé à Windows : ignoré.');
  process.exit(0);
}

const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe');
const write = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const read = (p) => fs.readFileSync(p, 'utf8');
let failed = 0;
const check = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) failed++; };

function setup(name) {
  const dir = path.join(os.tmpdir(), `Vigie test ${name} Loïc`);
  fs.rmSync(dir, { recursive: true, force: true });
  const res = path.join(dir, 'resources');
  write(path.join(dir, 'Vigie.exe'), 'ancien exe');
  write(path.join(res, 'app', 'package.json'), 'ancienne version');
  write(path.join(res, 'app', 'src', 'obsolete.js'), 'à supprimer');
  write(path.join(res, 'app', 'node_modules', 'tesseract.js', 'package.json'), 'modules installés');
  return { dir, res, staging: path.join(res, 'mise-a-jour'), log: path.join(res, 'mise-a-jour.log') };
}

function runScript(p, mode) {
  const body = makeScript({ mode, pid: 999999, exe, installDir: p.dir, resourcesDir: p.res, staging: p.staging, log: p.log });
  const script = path.join(p.res, 'mise-a-jour.ps1');
  fs.writeFileSync(script, `\ufeff${body}`, 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'inherit' });
}

console.log('Mise à jour « app » (code seul, modules conservés)');
{
  const p = setup('app');
  write(path.join(p.staging, 'app', 'package.json'), 'nouvelle version');
  write(path.join(p.staging, 'app', 'src', 'main.js'), 'nouveau code');
  runScript(p, 'app');
  check(read(path.join(p.res, 'app', 'package.json')) === 'nouvelle version', 'code remplacé');
  check(!fs.existsSync(path.join(p.res, 'app', 'src', 'obsolete.js')), 'ancien fichier supprimé');
  check(read(path.join(p.res, 'app', 'node_modules', 'tesseract.js', 'package.json')) === 'modules installés', 'modules conservés');
  check(!fs.existsSync(path.join(p.res, 'app.old')) && !fs.existsSync(p.staging), 'dossiers temporaires nettoyés');
  check(/ok/.test(read(p.log)), 'journal : ok');
}

console.log('Mise à jour « app+mods » (code et modules)');
{
  const p = setup('mods');
  write(path.join(p.staging, 'app', 'package.json'), 'nouvelle version');
  write(path.join(p.staging, 'node_modules', 'tesseract.js', 'package.json'), 'nouveaux modules');
  runScript(p, 'app+mods');
  check(read(path.join(p.res, 'app', 'node_modules', 'tesseract.js', 'package.json')) === 'nouveaux modules', 'modules remplacés');
}

console.log('Mise à jour « full » (paquet complet)');
{
  const p = setup('full');
  write(path.join(p.staging, 'Vigie', 'Vigie.exe'), 'nouvel exe');
  write(path.join(p.staging, 'Vigie', 'resources', 'app', 'package.json'), 'nouvelle version');
  write(path.join(p.staging, 'Vigie', 'resources', 'app', 'node_modules', 'tesseract.js', 'package.json'), 'nouveaux modules');
  runScript(p, 'full');
  check(read(path.join(p.dir, 'Vigie.exe')) === 'nouvel exe', 'exe remplacé');
  check(read(path.join(p.res, 'app', 'package.json')) === 'nouvelle version', 'code remplacé');
  check(!fs.existsSync(path.join(p.res, 'app', 'src', 'obsolete.js')), 'ancien fichier supprimé');
  check(!fs.existsSync(p.staging), 'dossier temporaire nettoyé');
}

console.log('Échec simulé : l\'ancienne version est restaurée');
{
  const p = setup('echec');
  fs.mkdirSync(p.staging, { recursive: true }); // pas de dossier app : le déplacement échoue
  runScript(p, 'app');
  check(read(path.join(p.res, 'app', 'package.json')) === 'ancienne version', 'ancienne version intacte');
  check(/échec/.test(read(p.log)), 'journal : échec');
}

console.log(failed ? `\n${failed} échec(s)` : '\nRemplacement OK');
process.exit(failed ? 1 : 0);
