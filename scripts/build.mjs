import { build } from 'esbuild';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
await build({
  entryPoints: ['src/content.ts', 'src/popup.ts', 'src/background.ts', 'src/offscreen.ts'],
  outdir: 'dist', bundle: true, format: 'iife', platform: 'browser', target: 'chrome116',
});
await build({
  entryPoints: ['server/translationServer.ts'],
  outfile: 'dist-server/translationServer.mjs', bundle: true, format: 'esm', platform: 'node', target: 'node20',
});
await import('./copy-static.mjs');
await copyFile('src/offscreen.html', 'dist/offscreen.html');
await mkdir('dist/vendor/lang', { recursive: true });
const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(createRequire(join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'));
await copyFile(join(tesseract, 'dist/worker.min.js'), 'dist/vendor/worker.min.js');
for (const file of await readdir(core)) {
  if (file.includes('lstm') && /\.wasm(\.js)?$/.test(file)) {
    await copyFile(join(core, file), join('dist/vendor', file));
  }
}
const lang = dirname(require.resolve('@tesseract.js-data/eng/package.json'));
await copyFile(join(lang, '4.0.0/eng.traineddata.gz'), 'dist/vendor/lang/eng.traineddata.gz');
console.log('Yerel OCR worker, WASM ve eng dil verisi dist/vendor içine kopyalandı.');
