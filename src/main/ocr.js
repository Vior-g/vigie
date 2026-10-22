'use strict';
/*
 * OCR local avec Tesseract (langue française embarquée, aucun envoi réseau).
 */
const path = require('path');
const fs = require('fs');

class Ocr {
  constructor(cacheDir) {
    this.cacheDir = cacheDir;
    this.worker = null;
    this.ready = null;
    this.busy = false;
  }

  langPath() {
    const pkg = path.dirname(require.resolve('@tesseract.js-data/fra/package.json'));
    return path.join(pkg, '4.0.0_best_int');
  }

  init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const { createWorker, PSM } = require('tesseract.js');
      fs.mkdirSync(this.cacheDir, { recursive: true });
      this.worker = await createWorker('fra', 1, {
        langPath: this.langPath(),
        cachePath: this.cacheDir,
        gzip: true,
      });
      await this.worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
      });
      return this.worker;
    })();
    return this.ready;
  }

  /** @param {Buffer} png image PNG */
  async recognize(png) {
    await this.init();
    if (this.busy) return null;
    this.busy = true;
    try {
      const { data } = await this.worker.recognize(png);
      return data.text || '';
    } finally {
      this.busy = false;
    }
  }

  async stop() {
    if (this.worker) await this.worker.terminate();
  }
}

module.exports = { Ocr };
