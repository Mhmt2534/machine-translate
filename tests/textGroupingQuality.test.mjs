import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const load = async entry => {
  const code = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};
const {
  canAddRegionToBlock, groupTextRegions, groupTextRegionsDetailed, splitTextRegionsAtLargeGaps,
} = await load('src/ocr/textGrouping.ts');
const { filterTextRegions } = await load('src/ocr/textFiltering.ts');
const line = (text, x, y, width = 100, height = 30, confidence = 90) => ({ text, x, y, width, height, confidence });
const image = { width: 1000, height: 1200 };

test('stops A-B-C single-linkage chaining when A and C are far apart', () => {
  const blocks = groupTextRegions([
    line('A TEXT', 0, 10), line('B TEXT', 70, 50), line('C TEXT', 140, 90),
  ], 'image-1', image);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].lines.length, 2);
  assert.equal(blocks[1].text, 'C TEXT');
});

test('keeps two neighboring text columns as separate blocks', () => {
  const blocks = groupTextRegions([
    line('LEFT ONE', 50, 20, 160), line('RIGHT ONE', 350, 20, 160),
    line('LEFT TWO', 55, 60, 160), line('RIGHT TWO', 355, 60, 160),
  ], 'image-1', image);
  assert.deepEqual(blocks.map(block => block.text), ['LEFT ONE LEFT TWO', 'RIGHT ONE RIGHT TWO']);
});

test('keeps groups separated by a large vertical gutter apart', () => {
  const blocks = groupTextRegions([
    line('TOP ONE', 100, 20), line('TOP TWO', 105, 60),
    line('BOTTOM ONE', 100, 300), line('BOTTOM TWO', 105, 340),
  ], 'image-1', image);
  assert.equal(blocks.length, 2);
});

test('still groups a normal four-line speech bubble', () => {
  const blocks = groupTextRegions([
    line('ARE YOU', 100, 20, 150), line('FEELING', 110, 60, 130),
    line('BETTER', 108, 100, 135), line('NOW?', 125, 140, 90),
  ], 'image-1', image);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'ARE YOU FEELING BETTER NOW?');
});

test('filters slash, underscore and backslash face-like OCR noise', () => {
  const result = filterTextRegions([
    line('/', 10, 10, 15), line('_', 30, 10, 15), line('\\', 50, 10, 15),
  ], image);
  assert.equal(result.regions.length, 0);
  assert.equal(result.rejected.length, 3);
});

test('keeps dialogue punctuation-only text', () => {
  assert.deepEqual(filterTextRegions([line('!!', 10, 10, 8, 12, 1)], image).regions.map(item => item.text), ['!!']);
});

test('keeps ISE. and SO as short dialogue text', () => {
  const result = filterTextRegions([line('ISE.', 10, 10, 55, 30, 1), line('SO', 80, 10, 35, 30, 1)], image);
  assert.deepEqual(result.regions.map(item => item.text), ['ISE.', 'SO']);
});

test('rejects an oversized box containing very little text', () => {
  const result = groupTextRegionsDetailed([line('SO', 20, 20, 800, 500)], 'image-1', image);
  assert.equal(result.blocks.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, 'oversized-block');
});

test('splits a provisional block at a large internal vertical gap', () => {
  const groups = splitTextRegionsAtLargeGaps([
    line('FIRST', 100, 10), line('SECOND', 105, 50), line('NEW PANEL', 100, 180),
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.map(item => item.text)), [['FIRST', 'SECOND'], ['NEW PANEL']]);
});

test('rejects a region that would make the current block grow abnormally', () => {
  const block = [line('A TEXT', 0, 10), line('B TEXT', 70, 50)];
  const decision = canAddRegionToBlock(line('C TEXT', 140, 90), block, image);
  assert.equal(decision.accepted, false);
  assert.match(decision.reason, /inconsistent|growth/);
});
