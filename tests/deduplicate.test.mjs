import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
const code = buildSync({ entryPoints: ['src/ocr/deduplicate.ts'], bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text;
const { deduplicateRegions } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
const line = { text: 'HELLO WORLD!', confidence: 80, x: 40, y: 100, width: 300, height: 40 };

test('keeps highest confidence across overlapping captures with minor OCR differences', () => {
  const better = { ...line, text: 'HELLO W0RLD', confidence: 95, x: 42, y: 101 };
  assert.deepEqual(deduplicateRegions([line, better]), [better]);
});
test('same text at a different location is not a duplicate', () => {
  assert.equal(deduplicateRegions([line, { ...line, y: 220 }]).length, 2);
});
test('overlapping boxes with unrelated text remain separate', () => {
  assert.equal(deduplicateRegions([line, { ...line, text: 'GOODBYE FRIEND' }]).length, 2);
});
