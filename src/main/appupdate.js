'use strict';
/*
 * Mise à jour du logiciel, comme Relais : Vigie regarde la dernière Release
 * GitHub, propose la mise à jour, la télécharge, puis un petit script
 * remplace les fichiers une fois Vigie fermé et le relance.
 *
 * Pour limiter le téléchargement :
 *  - « app »      : seul le code de Vigie (quelques Mo) si Electron et les
 *                   modules n'ont pas changé ;
 *  - « app+mods » : code + modules (OCR) si les modules ont changé ;
 *  - « full »     : tout le paquet si la version d'Electron a changé.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { cmpVersion } = require('./updater');
const { depsSignature } = require('../core/depsig');

const REPO = 'Vior-g/vigie';
const ASSETS = { meta: 'vigie-update.json', app: 'vigie-app.zip', modules: 'vigie-modules.zip', full: 'Vigie-win-x64.zip' };

/** Choix du paquet à télécharger. */
function planUpdate({ meta, assets, electron, deps }) {
  const has = (k) => !!assets[ASSETS[k]];
  if (meta && meta.electron === electron && has('app')) {
    if (meta.deps === deps) return { mode: 'app', files: ['app'] };
    if (has('modules')) return { mode: 'app+mods', files: ['app', 'modules'] };
  }
  return has('full') ? { mode: 'full', files: ['full'] } : null;
}

/** Échappement d'une chaîne PowerShell entre apostrophes. */
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** Script PowerShell qui remplace les fichiers après la fermeture de Vigie. */
function makeScript({ mode, pid, exe, installDir, resourcesDir, staging, log }) {
  const lines = [
    '$ErrorActionPreference = \'Stop\'',
    `$log = ${psq(log)}`,
    'function Log($m) { try { Add-Content -LiteralPath $log -Encoding UTF8 -Value ((Get-Date -Format s) + \' \' + $m) } catch {} }',
    // Un antivirus peut bloquer un fichier quelques instants : on réessaie.
    'function Retry($sb) { for ($i = 0; $i -lt 10; $i++) { try { & $sb; return } catch { if ($i -eq 9) { throw }; Start-Sleep -Milliseconds 500 } } }',
    `try { Wait-Process -Id ${Number(pid)} -Timeout 60 -ErrorAction SilentlyContinue } catch {}`,
    'Start-Sleep -Milliseconds 800',
    `$stage = ${psq(staging)}`,
    `$res = ${psq(resourcesDir)}`,
    `$dir = ${psq(installDir)}`,
    '$app = Join-Path $res \'app\'',
    '$old = Join-Path $res \'app.old\'',
    'Log \'début\'',
  ];
  if (mode === 'full') {
    lines.push(
      'try {',
      '  $src = Join-Path $stage \'Vigie\'',
      '  robocopy $src $dir /E /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null',
      '  if ($LASTEXITCODE -ge 8) { throw "robocopy $LASTEXITCODE" }',
      '  robocopy (Join-Path $src \'resources\\app\') $app /MIR /R:3 /W:1 /NFL /NDL /NJH /NJS /NP | Out-Null',
      '  if ($LASTEXITCODE -ge 8) { throw "robocopy app $LASTEXITCODE" }',
      '  Log \'ok (complet)\'',
      '} catch { Log (\'échec : \' + $_) }',
    );
  } else {
    lines.push(
      'try {',
      '  if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }',
      '  Retry { Rename-Item -LiteralPath $app -NewName \'app.old\' }',
      '  Retry { Move-Item -LiteralPath (Join-Path $stage \'app\') -Destination $app }',
      '  $mods = Join-Path $stage \'node_modules\'',
      '  if (Test-Path -LiteralPath $mods) { Move-Item -LiteralPath $mods -Destination (Join-Path $app \'node_modules\') }',
      '  else { Move-Item -LiteralPath (Join-Path $old \'node_modules\') -Destination (Join-Path $app \'node_modules\') }',
      '  Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction SilentlyContinue',
      '  Log \'ok\'',
      '} catch {',
      '  Log (\'échec : \' + $_)',
      '  if (Test-Path -LiteralPath $old) {',
      '    if (Test-Path -LiteralPath $app) { Remove-Item -LiteralPath $app -Recurse -Force -ErrorAction SilentlyContinue }',
      '    Rename-Item -LiteralPath $old -NewName \'app\'',
      '  }',
      '}',
    );
  }
  lines.push(
    'Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue',
    `Start-Process -FilePath ${psq(exe)}`,
  );
  return `${lines.join('\r\n')}\r\n`;
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(file)} : ${String(stderr || err.message).trim().split('\n')[0]}`));
      else resolve(stdout);
    });
  });
}

/** Décompresse une archive zip (tar de Windows 10+, sinon PowerShell). */
async function extract(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  try {
    await run(fs.existsSync(tar) ? tar : 'tar', ['-xf', zip, '-C', dest]);
  } catch (e) {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${psq(zip)} -DestinationPath ${psq(dest)} -Force`]);
  }
}

class AppUpdater {
  /**
   * @param {object} o
   * @param {Function} o.fetchFn  fetch (net.fetch d'Electron)
   * @param {string} o.version    version installée
   * @param {string} o.electron   version d'Electron installée
   * @param {string} o.resourcesDir dossier resources de l'appli empaquetée
   * @param {string} o.exe        chemin de Vigie.exe
   */
  constructor({ fetchFn, version, electron, resourcesDir, exe, repo = REPO }) {
    this.fetchFn = fetchFn;
    this.version = version;
    this.electron = electron;
    this.resourcesDir = resourcesDir;
    this.exe = exe;
    this.repo = repo;
    this.installDir = path.dirname(exe);
    this.staging = path.join(resourcesDir, 'mise-a-jour');
  }

  async getJson(url) {
    const r = await this.fetchFn(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vigie-Updater' } });
    if (!r.ok) throw new Error(r.status === 403 ? 'GitHub limite le nombre de vérifications, réessaie plus tard' : `HTTP ${r.status}`);
    return JSON.parse(await r.text());
  }

  /** Nouvelle version disponible, ou null. */
  async check() {
    const rel = await this.getJson(`https://api.github.com/repos/${this.repo}/releases/latest`);
    if (!rel || !rel.tag_name || rel.draft || rel.prerelease) return null;
    if (cmpVersion(rel.tag_name, this.version) <= 0) return null;
    const assets = {};
    for (const a of rel.assets || []) assets[a.name] = { url: a.browser_download_url, size: a.size };
    let meta = null;
    if (assets[ASSETS.meta]) {
      try { meta = JSON.parse(await (await this.fetchFn(assets[ASSETS.meta].url)).text()); } catch (e) { meta = null; }
    }
    let deps = null;
    try { deps = depsSignature(path.join(this.resourcesDir, 'app', 'node_modules')); } catch (e) { deps = null; }
    const plan = planUpdate({ meta, assets, electron: this.electron, deps });
    return {
      version: rel.tag_name.replace(/^v/, ''),
      notes: String(rel.body || '').trim().slice(0, 1200),
      page: rel.html_url,
      plan,
      assets,
      size: plan ? plan.files.reduce((n, k) => n + ((assets[ASSETS[k]] || {}).size || 0), 0) : 0,
    };
  }

  /** Le dossier de Vigie est-il modifiable ? */
  canWrite() {
    try {
      const probe = path.join(this.resourcesDir, '.vigie-write-test');
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      return true;
    } catch (e) {
      return false;
    }
  }

  async downloadFile(url, dest, onBytes) {
    const r = await this.fetchFn(url, { headers: { 'User-Agent': 'Vigie-Updater' } });
    if (!r.ok || !r.body) throw new Error(`téléchargement impossible (HTTP ${r.status})`);
    const out = fs.createWriteStream(dest);
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!out.write(Buffer.from(value))) await new Promise((res) => out.once('drain', res));
        onBytes(value.length);
      }
    } finally {
      await new Promise((res) => out.end(res));
    }
  }

  /** Télécharge et décompresse la mise à jour dans le dossier de Vigie. */
  async prepare(info, onProgress = () => {}) {
    if (!info.plan) throw new Error('aucun paquet de mise à jour dans cette Release');
    if (!this.canWrite()) throw new Error(`Vigie ne peut pas écrire dans son dossier (${this.installDir}) : déplace-le dans un dossier à toi, par exemple Documents`);
    fs.rmSync(this.staging, { recursive: true, force: true });
    fs.mkdirSync(this.staging, { recursive: true });
    const total = info.size || 1;
    let got = 0;
    for (const k of info.plan.files) {
      const a = info.assets[ASSETS[k]];
      const zip = path.join(this.staging, `${k}.zip`);
      await this.downloadFile(a.url, zip, (n) => { got += n; onProgress({ phase: 'download', done: got, total }); });
      if (a.size && fs.statSync(zip).size !== a.size) throw new Error('fichier téléchargé incomplet');
      onProgress({ phase: 'extract', done: got, total });
      await extract(zip, this.staging);
      fs.rmSync(zip, { force: true });
    }
    const need = info.plan.mode === 'full' ? path.join('Vigie', 'Vigie.exe') : path.join('app', 'package.json');
    if (!fs.existsSync(path.join(this.staging, need))) throw new Error('archive inattendue');
    return this.staging;
  }

  /** Écrit le script de remplacement et le lance ; il faut ensuite quitter Vigie. */
  launch(info, pid) {
    const script = path.join(this.resourcesDir, 'mise-a-jour.ps1');
    const log = path.join(this.resourcesDir, 'mise-a-jour.log');
    const body = makeScript({
      mode: info.plan.mode, pid, exe: this.exe, installDir: this.installDir,
      resourcesDir: this.resourcesDir, staging: this.staging, log,
    });
    fs.writeFileSync(script, `\ufeff${body}`, 'utf8'); // BOM : chemins accentués (Loïc…)
    const { spawn } = require('child_process');
    // Dossier courant hors de Vigie : un processus dont le dossier courant est
    // dans resources\app empêcherait de le renommer.
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script], {
      detached: true, stdio: 'ignore', windowsHide: true, cwd: require('os').tmpdir(),
    });
    child.unref();
  }
}

module.exports = { AppUpdater, planUpdate, makeScript, ASSETS };
