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
const { scoreTextBlock, validateFinalTextBlocks } = await load('src/ocr/textSanity.ts');
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

test('merges the remaining NOW dialogue fragments including SOME- HOW-', () => {
  const first = createTextBlock([
    line('NOW...', 100, 20, 90, 30, 82), line("IT'S FINE,", 70, 55, 150, 30, 84),
  ], 'image-1-block-1');
  const second = createTextBlock([
    line('IT WILL', 65, 100, 160, 30, 80), line('WORK', 95, 135, 100, 30, 83),
    line('SOME-', 100, 170, 90, 30, 78), line('HOW-', 105, 205, 80, 30, 79),
  ], 'image-1-block-2');
  const merged = mergeTextBlocks([first, second], image.width, image.height);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].text, "NOW... IT'S FINE, IT WILL WORK SOMEHOW-");
});

test('joins SOME- HOW and INTRO- DUCE across lines', () => {
  const some = createTextBlock([line('SOME-', 100, 20), line('HOW', 105, 60)]);
  const intro = createTextBlock([line('INTRO-', 100, 20), line('DUCE', 105, 60)]);
  assert.equal(some.text, 'SOMEHOW');
  assert.equal(intro.text, 'INTRODUCE');
});

test('final sanity rejects real low-confidence garbage examples', () => {
  const samples = [
    block('eveaoor Bedi', 20, 'image-1-block-1', 100, 20, 180),
    block('TE CLuss', 25, 'image-1-block-2', 100, 60, 130),
    block('rk Aware', 20, 'image-1-block-3', 100, 100, 130),
    block('Geri os', 20, 'image-1-block-4', 100, 140, 120),
    block('WONDER} CLASS} ANGRY', 45, 'image-1-block-5', 100, 180, 260),
  ];
  const result = validateFinalTextBlocks(samples);
  assert.equal(result.blocks.length, 0);
  assert.equal(result.rejected.length, samples.length);
});

test('final sanity keeps names and short real dialogue', () => {
  const samples = [block('MIKOTO', 80), block('ISE.', 75), block('TOUKO', 80), block('!!', 20), block('?', 20)];
  assert.deepEqual(validateFinalTextBlocks(samples).blocks.map(item => item.text), ['MIKOTO', 'ISE.', 'TOUKO', '!!', '?']);
});

test('final sanity keeps long dialogue with OCR digit typos', () => {
  const typo = block('ARE YOU FEEL1NG BETTER NOW?', 55, 'image-1-block-1', 100, 20, 320);
  const fantasy = block('TH1S AETH3R SIGIL WILL WORK OUT SOMEHOW...', 45, 'image-1-block-2', 100, 60, 430);
  const result = validateFinalTextBlocks([typo, fantasy]);
  assert.equal(result.blocks.length, 2);
  assert.ok(result.blocks.every(item => (item.qualityScore ?? 0) >= 0.58));
  assert.equal(scoreTextBlock(typo).accepted, true);
});
