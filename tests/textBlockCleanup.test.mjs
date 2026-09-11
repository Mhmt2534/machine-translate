import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const load = async entry => {
  const code = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};
const { createTextBlock } = await load('src/ocr/textGrouping.ts');
const { validateTextBlocks } = await load('src/ocr/textBlockValidation.ts');
const { mergeTextBlocks } = await load('src/ocr/textBlockMerge.ts');
const image = { width: 1000, height: 1200 };
const line = (text, x = 100, y = 20, width = 100, height = 30, confidence = 90) =>
  ({ text, x, y, width, height, confidence });
const block = (text, confidence, id = 'image-1-block-1', x = 100, y = 20, width = 100) =>
  createTextBlock([line(text, x, y, width, 30, confidence)], id);
const validateOne = value => validateTextBlocks([value], image);

test('rejects isolated lowercase a at confidence 15', () => {
  const result = validateOne(block('a', 15));
  assert.equal(result.blocks.length, 0);
  assert.equal(result.rejected[0].reason, 'short-low-confidence');
});

test('rejects isolated Z at confidence 25', () => {
  assert.equal(validateOne(block('Z', 25)).blocks.length, 0);
});

test('keeps independent I at confidence 95', () => {
  assert.equal(validateOne(block('I', 95)).blocks.length, 1);
});

test('keeps question mark dialogue punctuation', () => {
  assert.equal(validateOne(block('?', 90, 'image-1-block-1', 100, 20, 20)).blocks.length, 1);
});

test('keeps double exclamation dialogue punctuation', () => {
  assert.equal(validateOne(block('!!', 30, 'image-1-block-1', 100, 20, 25)).blocks.length, 1);
});

test('rejects slash symbol noise', () => {
  const result = validateOne(block('/', 90, 'image-1-block-1', 100, 20, 15));
  assert.equal(result.blocks.length, 0);
  assert.equal(result.rejected[0].reason, 'symbol-noise');
});

test('keeps NO! at confidence 70', () => {
  assert.equal(validateOne(block('NO!', 70, 'image-1-block-1', 100, 20, 60)).blocks.length, 1);
});

test('keeps ISE. at confidence 70', () => {
  assert.equal(validateOne(block('ISE.', 70, 'image-1-block-1', 100, 20, 70)).blocks.length, 1);
});

test('merges four vertically aligned dialogue fragments', () => {
  const parts = [
    block('NOW...', 80, 'image-1-block-1', 100, 20, 90),
    block("IT'S FINE", 82, 'image-1-block-2', 70, 70, 150),
    block('IT WILL WORK', 84, 'image-1-block-3', 45, 120, 200),
    block('OUT SOMEHOW...', 86, 'image-1-block-4', 35, 170, 220),
  ];
  const merged = mergeTextBlocks(parts, image.width, image.height);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "NOW... IT'S FINE IT WILL WORK OUT SOMEHOW...");
});

test('does not merge two side-by-side conversations', () => {
  const parts = [
    block('LEFT ONE', 90, 'image-1-block-1', 50, 20, 150),
    block('RIGHT ONE', 90, 'image-1-block-2', 500, 20, 170),
    block('LEFT TWO', 90, 'image-1-block-3', 55, 70, 145),
    block('RIGHT TWO', 90, 'image-1-block-4', 505, 70, 165),
  ];
  assert.deepEqual(mergeTextBlocks(parts, image.width, image.height).map(item => item.text),
    ['LEFT ONE LEFT TWO', 'RIGHT ONE RIGHT TWO']);
});

test('does not merge same-center blocks across a large vertical gap', () => {
  const parts = [block('TOP TEXT', 90, 'image-1-block-1', 100, 20, 150),
    block('BOTTOM TEXT', 90, 'image-1-block-2', 100, 400, 150)];
  assert.equal(mergeTextBlocks(parts, image.width, image.height).length, 2);
});

test('does not choose between two equally plausible competing lower blocks', () => {
  const parts = [
    block('UPPER TEXT', 90, 'image-1-block-1', 150, 20, 200),
    block('LOWER LEFT', 90, 'image-1-block-2', 80, 70, 180),
    block('LOWER RIGHT', 90, 'image-1-block-3', 240, 70, 180),
  ];
  assert.equal(mergeTextBlocks(parts, image.width, image.height).length, 3);
});

test('rejects low-confidence nearby garbage before merge', () => {
  const garbage = block('<j a', 18, 'image-1-block-1', 100, 20, 70);
  const dialogue = block('HELLO THERE', 90, 'image-1-block-2', 90, 65, 160);
  const validated = validateTextBlocks([garbage, dialogue], image);
  assert.deepEqual(validated.blocks.map(item => item.text), ['HELLO THERE']);
  assert.equal(validated.rejected[0].reason, 'garbage-pattern');
  assert.equal(mergeTextBlocks(validated.blocks, image.width, image.height).length, 1);
});

test('rejects representative short OCR garbage patterns', () => {
  const samples = [block('1', 50), block('PS', 35), block('I 7G', 70), block('<j a', 70), block('cj', 50), block('rudd.', 50)];
  const result = validateTextBlocks(samples, image);
  assert.equal(result.blocks.length, 0);
  assert.equal(result.rejected.length, samples.length);
});
