import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const load = async entry => {
  const code = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};
const { groupTextRegions } = await load('src/ocr/textGrouping.ts');
const { filterTextRegions } = await load('src/ocr/textFiltering.ts');
const line = (text, x, y, width = 120, height = 30, confidence = 90) => ({ text, x, y, width, height, confidence });

test('groups four vertically stacked dialogue lines', () => {
  const blocks = groupTextRegions([
    line('ARE YOU', 100, 10), line('FEELING', 105, 50), line('BETTER', 110, 90), line('NOW?', 120, 130),
  ], 'image-1');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'ARE YOU FEELING BETTER NOW?');
  assert.deepEqual({ x: blocks[0].x, y: blocks[0].y, width: blocks[0].width, height: blocks[0].height },
    { x: 100, y: 10, width: 140, height: 150 });
});

test('keeps distant balloons separate', () => {
  assert.equal(groupTextRegions([line('HELLO', 20, 20), line('GOODBYE', 20, 300)]).length, 2);
});

test('does not merge close side-by-side balloons', () => {
  const blocks = groupTextRegions([line('BALLOON A', 10, 20), line('BALLOON B', 150, 20)]);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(block => block.text), ['BALLOON A', 'BALLOON B']);
});

test('keeps short ISE. text', () => {
  const filtered = filterTextRegions([line(' ISE. ', 10, 10, 55)]);
  assert.equal(filtered.regions[0].text, 'ISE.');
  assert.equal(groupTextRegions(filtered.regions)[0].text, 'ISE.');
});

test('keeps expressive punctuation even at low confidence', () => {
  const filtered = filterTextRegions([
    line('!!', 10, 10, 2, 2, 1), line('?', 40, 10, 2, 2, 1),
    line('ISE.', 70, 10, 50, 30, 1), line('NO!', 130, 10, 50, 30, 1), line('HEY...', 190, 10, 70, 30, 1),
  ]);
  assert.deepEqual(filtered.regions.map(region => region.text), ['!!', '?', 'ISE.', 'NO!', 'HEY...']);
});

test('filters very low-confidence random noise with a reason', () => {
  const filtered = filterTextRegions([line('xqz', 10, 10, 40, 30, 2)]);
  assert.equal(filtered.regions.length, 0);
  assert.match(filtered.rejected[0].reason, /confidence/);
});

test('restores top-to-bottom reading order from shuffled input', () => {
  const blocks = groupTextRegions([
    line('BETTER', 110, 90), line('ARE YOU', 100, 10), line('NOW?', 120, 130), line('FEELING', 105, 50),
  ]);
  assert.equal(blocks[0].text, 'ARE YOU FEELING BETTER NOW?');
  assert.deepEqual(blocks[0].lines.map(item => item.text), ['ARE YOU', 'FEELING', 'BETTER', 'NOW?']);
});

test('joins a safe uppercase line-end hyphen split', () => {
  assert.equal(groupTextRegions([line('INTRO-', 20, 20), line('DUCE', 25, 60)])[0].text, 'INTRODUCE');
  assert.equal(groupTextRegions([line('MOTHER-', 20, 20), line('IN-LAW', 25, 60)])[0].text, 'MOTHER- IN-LAW');
});

test('keeps three balloons in one image as three blocks', () => {
  const blocks = groupTextRegions([
    line('ONE A', 10, 10), line('ONE B', 15, 50),
    line('TWO A', 300, 20), line('TWO B', 305, 60),
    line('THREE A', 120, 300), line('THREE B', 125, 340),
  ], 'image-1');
  assert.equal(blocks.length, 3);
});

test('grouping calls for different candidate images never share blocks', () => {
  const first = groupTextRegions([line('IMAGE ONE', 10, 10)], 'image-1');
  const second = groupTextRegions([line('IMAGE TWO', 10, 45)], 'image-2');
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].id, 'image-1-block-1');
  assert.equal(second[0].id, 'image-2-block-1');
});

test('attaches punctuation and normalizes whitespace', () => {
  const blocks = groupTextRegions([line('  HELLO  ', 10, 10, 90), line('!', 102, 10, 8)]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].text, 'HELLO!');
});

test('weights block confidence by text length', () => {
  const block = groupTextRegions([line('LONGER TEXT', 10, 10, 130, 30, 90), line('?', 20, 50, 20, 30, 10)])[0];
  assert.ok(block.confidence > 80 && block.confidence < 90);
});

test('groups representative webtoon dialogue into sentence-sized blocks', () => {
  const dialogue = [
    line('MIKOTO,', 80, 20, 170), line('ARE YOU FEELING', 70, 60, 230), line('BETTER NOW?', 90, 100, 190),
    line('YEAH...', 600, 30, 150), line('SORRY FOR', 610, 70, 170), line('WORRYING YOU...', 590, 110, 220),
    line("NOW... IT'S FINE,", 100, 330, 260), line('IT IS FINE,', 110, 370, 220),
    line('IT WILL WORK OUT', 90, 410, 280), line('SOMEHOW...', 130, 450, 180),
    line('HMPH!! NO!!', 610, 340, 210), line('IT PISSES ME OFF', 590, 380, 260),
    line('BECAUSE IT FEELS LIKE', 570, 420, 300), line("I'M DOING WHAT YOU WANT!!", 550, 460, 340),
  ];
  assert.deepEqual(groupTextRegions(dialogue, 'image-1').map(block => block.text), [
    'MIKOTO, ARE YOU FEELING BETTER NOW?',
    'YEAH... SORRY FOR WORRYING YOU...',
    "NOW... IT'S FINE, IT IS FINE, IT WILL WORK OUT SOMEHOW...",
    "HMPH!! NO!! IT PISSES ME OFF BECAUSE IT FEELS LIKE I'M DOING WHAT YOU WANT!!",
  ]);
});
