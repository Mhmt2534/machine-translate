import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const load = async entry => {
  const code = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};
const { validateTranslationResponse } = await load('src/translation/responseValidation.ts');
const { createTranslationBatches } = await load('src/translation/batching.ts');
const { postTranslationBatch } = await load('src/translation/httpClient.ts');
const { createOpenAIProvider } = await load('server/translation/openAIProvider.ts');
const { TranslationService } = await load('server/translation/translationService.ts');
const request = { provider: 'openai', imageId: 'image-1', blocks: [
  { id: 'image-1-block-1', text: 'Are you feeling better now?' },
  { id: 'image-1-block-2', text: 'YEAH... SORRY FOR WORRYING YOU...' },
] };

test('maps a normal translation to the same ID', () => {
  const result = validateTranslationResponse({ ...request, blocks: request.blocks.slice(0, 1) }, { translations: [
    { id: 'image-1-block-1', translatedText: 'Şimdi daha iyi hissediyor musun?', skip: false },
  ] });
  assert.equal(result.translations[0].id, 'image-1-block-1');
  assert.equal(result.translations[0].translatedText, 'Şimdi daha iyi hissediyor musun?');
});

test('preserves request order for multiple provider outputs', () => {
  const result = validateTranslationResponse(request, { translations: [
    { id: 'image-1-block-2', translatedText: 'Evet...', skip: false },
    { id: 'image-1-block-1', translatedText: 'Daha iyi misin?', skip: false },
  ] });
  assert.deepEqual(result.translations.map(item => item.id), request.blocks.map(item => item.id));
});

test('accepts a contextual correction for FEEL1NG', () => {
  const typo = { provider: 'openai', imageId: 'image-1', blocks: [{ id: 'b1', text: 'ARE YOU FEEL1NG BETTER NOW?' }] };
  assert.equal(validateTranslationResponse(typo, { translations: [
    { id: 'b1', translatedText: 'Şimdi daha iyi hissediyor musun?', skip: false },
  ] }).translations[0].skip, false);
});

test('accepts provider SKIP for unrecoverable OCR garbage', () => {
  const garbage = { provider: 'openai', imageId: 'image-1', blocks: [{ id: 'b1', text: 'eveaoar Bedi' }] };
  const item = validateTranslationResponse(garbage, { translations: [
    { id: 'b1', translatedText: null, skip: true, reason: 'unrecoverable-ocr' },
  ] }).translations[0];
  assert.equal(item.skip, true);
  assert.equal(item.reason, 'unrecoverable-ocr');
});

test('rejects an unknown output ID', () => {
  assert.throws(() => validateTranslationResponse(request, { translations: [
    { id: 'unknown', translatedText: 'x', skip: false },
  ] }), /Unknown translation ID/);
});

test('rejects a duplicate output ID', () => {
  assert.throws(() => validateTranslationResponse(request, { translations: [
    { id: 'image-1-block-1', translatedText: 'x', skip: false },
    { id: 'image-1-block-1', translatedText: 'y', skip: false },
  ] }), /Duplicate translation ID/);
});

test('marks only a missing output as an item error', () => {
  const result = validateTranslationResponse(request, { translations: [
    { id: 'image-1-block-1', translatedText: 'Daha iyi misin?', skip: false },
  ] });
  assert.equal(result.translations[0].error, undefined);
  assert.match(result.translations[1].error, /did not return/);
});

test('reports an offline local backend without crashing', async () => {
  await assert.rejects(() => postTranslationBatch(request, async () => { throw new TypeError('offline'); }),
    /Local translation server is not running/);
});

test('retries 429 twice and then succeeds', async () => {
  let calls = 0;
  const provider = createOpenAIProvider({ apiKey: 'test-key', model: 'test-model', maxRetries: 2, sleep: async () => {},
    fetcher: async () => {
      calls++;
      if (calls < 3) return new Response('{}', { status: 429 });
      return Response.json({ output_text: JSON.stringify({ translations: request.blocks.map(block => ({
        id: block.id, translatedText: 'çeviri', skip: false, reason: null,
      })) }) });
    } });
  assert.equal((await provider.translate(request)).translations.length, 2);
  assert.equal(calls, 3);
});

test('reports malformed AI structured output', async () => {
  const provider = createOpenAIProvider({ apiKey: 'test-key', model: 'test-model', fetcher: async () => Response.json({ output_text: '{bad' }) });
  await assert.rejects(() => provider.translate(request), /malformed structured output/);
});

test('reports provider authentication failure without exposing the key', async () => {
  const provider = createOpenAIProvider({ apiKey: 'secret-test-key', model: 'test-model',
    fetcher: async () => new Response('{}', { status: 401 }) });
  await assert.rejects(() => provider.translate(request), error =>
    error.code === 'PROVIDER_AUTH' && !error.message.includes('secret-test-key'));
});

test('reports provider timeout', async () => {
  const provider = createOpenAIProvider({ apiKey: 'test-key', model: 'test-model',
    fetcher: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
  await assert.rejects(() => provider.translate(request), /timed out/);
});

test('uses the in-memory cache for an identical normalized batch', async () => {
  let calls = 0;
  const provider = { id: 'openai', name: 'mock', async translate(value) {
    calls++;
    return { translations: value.blocks.map(block => ({ id: block.id, translatedText: 'çeviri', skip: false })) };
  } };
  const service = new TranslationService(provider);
  assert.equal((await service.translate(request)).cached, false);
  assert.equal((await service.translate({ ...request, blocks: request.blocks.map(block => ({ ...block, text: `  ${block.text}  ` })) })).cached, true);
  assert.equal(calls, 1);
});

test('cache hit remaps translations when only block IDs change', async () => {
  let calls = 0;
  const service = new TranslationService({ id: 'openai', name: 'fake', async translate(value) {
    calls++;
    return { translations: value.blocks.map(block => ({ id: block.id, translatedText: 'aynı çeviri', skip: false })) };
  } });
  await service.translate({ provider: 'openai', imageId: 'first', blocks: [{ id: 'old-id', text: '  HELLO   WORLD ' }] });
  const cached = await service.translate({ provider: 'openai', imageId: 'second', blocks: [{ id: 'new-id', text: 'hello world' }] });
  assert.equal(calls, 1);
  assert.equal(cached.cached, true);
  assert.equal(cached.translations[0].id, 'new-id');
});

test('batches per image and keeps geometric reading order', () => {
  const blocks = [
    { id: 'b2', text: 'SECOND', x: 200, y: 10, width: 50, height: 20 },
    { id: 'b1', text: 'FIRST', x: 10, y: 10, width: 50, height: 20 },
    { id: 'b3', text: 'THIRD', x: 10, y: 50, width: 50, height: 20 },
  ];
  const batches = createTranslationBatches([{ imageId: 'image-1', blocks }], 'openai', { maxBlocks: 2, maxCharacters: 100 });
  assert.deepEqual(batches.map(batch => batch.blocks.map(block => block.id)), [['b1', 'b2'], ['b3']]);
});

test('reports malformed JSON from the local server', async () => {
  await assert.rejects(() => postTranslationBatch(request, async () => new Response('bad', { status: 200 })), /malformed JSON/);
});
