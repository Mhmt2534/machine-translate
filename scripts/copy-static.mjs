import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
for (const file of ['manifest.json', 'src/popup.html', 'src/popup.css']) {
  await copyFile(
    new URL(`../${file}`, import.meta.url),
    new URL(`../dist/${file.split('/').pop()}`, import.meta.url),
  );
}
console.log('Build tamamlandı. Tarayıcıya dist klasörünü yükleyin.');
