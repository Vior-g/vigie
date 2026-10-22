'use strict';
/*
 * Suivi de la fenêtre au premier plan (Windows) via un petit script
 * PowerShell persistant. Sur les autres systèmes, renvoie un état neutre
 * (utile pour développer et tester l'interface).
 */
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

class WinWatch extends EventEmitter {
  constructor(scriptDir) {
    super();
    this.scriptPath = path.join(scriptDir, 'winwatch.ps1');
    this.proc = null;
    this.current = null;
    this.supported = process.platform === 'win32';
  }

  start() {
    if (!this.supported || this.proc) return;
    this.proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath,
    ], { windowsHide: true });
    let buf = '';
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        try {
          const info = JSON.parse(line);
          this.current = info;
          this.emit('change', info);
        } catch (e) { /* ligne partielle : ignorée */ }
      }
    });
    this.proc.stderr.on('data', (d) => console.error('[vigie/winwatch]', String(d).trim()));
    this.proc.on('exit', (code) => {
      this.proc = null;
      if (!this.stopping) {
        console.error('[vigie/winwatch] arrêt inattendu, relance dans 2 s', code);
        setTimeout(() => this.start(), 2000);
      }
    });
  }

  stop() {
    this.stopping = true;
    if (this.proc) this.proc.kill();
  }
}

module.exports = { WinWatch };
