import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
const code = buildSync({ entryPoints: ['src/image/captureMapping.ts'], bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text;
const { mapCapture } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const geometry = {
  crop: { x: 40, y: 0, width: 600, height: 300 },
  rendered: { x: 40, y: -100, width: 600, height: 400 },
  viewportWidth: 1000, viewportHeight: 720, scrollX: 0, scrollY: 160, dpr: 2,
};
test('partial viewport retains natural y offset at screenshot scale 1 and 2', () => {
  for (const scale of [1, 2]) {
    const result = mapCapture(1000 * scale, 720 * scale, geometry, 1200, 800);
    assert.deepEqual(result.natural, { x: 0, y: 200, width: 1200, height: 600 });
    assert.equal(result.pixels.x, 40 * scale);
  }
});
test('fractional crop rounds inward without including neighboring pixels', () => {
  const result = mapCapture(1500, 1080, { ...geometry, crop: { x: 40.2, y: 0.2, width: 599.4, height: 299.4 } }, 1200, 800);
  assert.ok(result.pixels.x >= 40.2 * 1.5);
  assert.ok(result.pixels.x + result.pixels.width <= 639.6 * 1.5);
  assert.ok(result.natural.y > 200);
});
test('rejects stale viewport ratios and invalid crops', () => {
  assert.throws(() => mapCapture(1000, 500, geometry, 1200, 800));
  assert.throws(() => mapCapture(1000, 720, { ...geometry, crop: { x: -1, y: 0, width: 300, height: 200 } }, 1200, 800));
});
