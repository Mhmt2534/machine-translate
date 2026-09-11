import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildSync } from 'esbuild';

const load = async entry => {
  const code = buildSync({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node' }).outputFiles[0].text;
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
};
const { createGoogleTranslationProvider, GoogleUsageStore } = await load('server/translation/googleTranslationProvider.ts');
const { TranslationService } = await load('server/translation/translationService.ts');
const { TranslationRouter } = await load('server/translation/translationRouter.ts');
const { toTranslatedTextBlock } = await load('src/translation/contentTranslation.ts');

const request = { provider: 'google', imageId: 'image-1', blocks: [
  { id: 'b1', text: 'Are you feeling better now?' },
  { id: 'b2', text: 'Do not worry about it.' },
] };

function setup(t, { limit = 450000, now } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'wt-google-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new GoogleUsageStore(join(directory, 'usage.json'), limit, now);
  return { store, directory };
}

function googleResponse(texts) {
  return Response.json({ data: { translations: texts.map(translatedText => ({ translatedText, model: 'nmt' })) } });
}

test('Google NMT translates multiple blocks in one request and preserves ID order', async t => {
  const { store } = setup(t);
  let calls = 0;
  let sent;
  const provider = createGoogleTranslationProvider({ apiKey: 'key', projectId: 'project', usageStore: store,
    fetcher: async (_url, init) => { calls++; sent = JSON.parse(init.body); return googleResponse(['Şimdi daha iyi misin?', 'Bunu dert etme.']); } });
  const result = await provider.translate(request);
  assert.equal(calls, 1);
  assert.deepEqual(sent, { q: request.blocks.map(block => block.text), source: 'en', target: 'tr', format: 'text', model: 'nmt' });
  assert.deepEqual(result.translations.map(item => item.id), ['b1', 'b2']);
  assert.equal(result.translations[0].translatedText, 'Şimdi daha iyi misin?');
});

test('translated block preserves coordinates and quality fields', () => {
  const source = { id: 'b1', text: 'HELLO', x: 11, y: 22, width: 33, height: 44, confidence: 88, qualityScore: 0.91, lineCount: 1 };
  const result = toTranslatedTextBlock(source, { id: 'b1', translatedText: 'MERHABA', skip: false });
  assert.deepEqual({ x: result.x, y: result.y, width: result.width, height: result.height,
    confidence: result.confidence, qualityScore: result.qualityScore },
  { x: 11, y: 22, width: 33, height: 44, confidence: 88, qualityScore: 0.91 });
});

test('Google provider rejects missing API key and project config', async t => {
  const { store } = setup(t);
  await assert.rejects(() => createGoogleTranslationProvider({ projectId: 'p', usageStore: store }).translate(request), /API_KEY/);
  await assert.rejects(() => createGoogleTranslationProvider({ apiKey: 'k', usageStore: store }).translate(request), /PROJECT_ID/);
});

for (const [status, pattern] of [[403, /credentials or project/], [429, /quota or rate limit/], [500, /HTTP 500/]]) {
  test(`Google provider handles HTTP ${status}`, async t => {
    const { store } = setup(t);
    const provider = createGoogleTranslationProvider({ apiKey: 'k', projectId: 'p', usageStore: store,
      maxRetries: 0, fetcher: async () => new Response('{}', { status }) });
    await assert.rejects(() => provider.translate(request), pattern);
  });
}

test('Google provider distinguishes quota-related HTTP 403', async t => {
  const { store } = setup(t);
  const provider = createGoogleTranslationProvider({ apiKey: 'k', projectId: 'p', usageStore: store, maxRetries: 0,
    fetcher: async () => Response.json({ error: { message: 'Daily quota limit exceeded' } }, { status: 403 }) });
  await assert.rejects(() => provider.translate(request), error => error.code === 'GOOGLE_QUOTA');
});

test('Google provider identifies an invalid API key returned as HTTP 400', async t => {
  const { store } = setup(t);
  const provider = createGoogleTranslationProvider({ apiKey: 'k', projectId: 'p', usageStore: store,
    fetcher: async () => Response.json({ error: { message: 'API key not valid' } }, { status: 400 }) });
  await assert.rejects(() => provider.translate(request), error => error.code === 'GOOGLE_AUTH');
});

test('Google provider handles timeout', async t => {
  const { store } = setup(t);
  const provider = createGoogleTranslationProvider({ apiKey: 'k', projectId: 'p', usageStore: store,
    fetcher: async () => { throw new DOMException('timeout', 'TimeoutError'); } });
  await assert.rejects(() => provider.translate(request), /timed out/);
});

test('Google provider rejects malformed response', async t => {
  const { store } = setup(t);
  const provider = createGoogleTranslationProvider({ apiKey: 'k', projectId: 'p', usageStore: store,
    fetcher: async () => Response.json({ data: { translations: [] } }) });
  await assert.rejects(() => provider.translate(request), /invalid translation count/);
});

test('router calls the selected Google or OpenAI service and rejects unknown provider', async () => {
  const calls = [];
  const router = new TranslationRouter({
    google: { translate: async value => { calls.push('google'); return { provider: 'google', translations: [], cached: false }; } },
    openai: { translate: async value => { calls.push('openai'); return { provider: 'openai', translations: [], cached: false }; } },
  });
  await router.translate({ provider: 'google' });
  await router.translate({ provider: 'openai' });
  assert.deepEqual(calls, ['google', 'openai']);
  assert.throws(() => router.translate({ provider: 'other' }), /Unknown translation provider/);
});

test('Google cache hit avoids a second API call and does not increase usage', async t => {
  const { store } = setup(t);
  let calls = 0;
  const provider = createGoogleTranslationProvider({ apiKey: 'k', projectId: 'p', usageStore: store,
    fetcher: async () => { calls++; return googleResponse(['İyi misin?', 'Dert etme.']); } });
  const service = new TranslationService(provider);
  const first = await service.translate(request);
  const usage = first.usage.characters;
  const second = await service.translate(request);
  assert.equal(calls, 1);
  assert.equal(second.cached, true);
  assert.equal(second.usage.characters, usage);
});

test('real Google request attempt increments usage by submitted Unicode code points', async t => {
  const { store } = setup(t);
  const provider = createGoogleTranslationProvider({ apiKey: 'k', projectId: 'p', usageStore: store,
    fetcher: async () => googleResponse(['A', 'B']) });
  await provider.translate(request);
  const expected = request.blocks.reduce((sum, block) => sum + [...block.text].length, 0);
  assert.equal(store.getUsage().characters, expected);
});

test('monthly counter resets and persists the new month', t => {
  let date = new Date('2026-09-15T00:00:00Z');
  const { store, directory } = setup(t, { now: () => date });
  store.consume(25);
  date = new Date('2026-10-01T00:00:00Z');
  assert.equal(store.getUsage().characters, 0);
  assert.equal(JSON.parse(readFileSync(join(directory, 'usage.json'), 'utf8')).month, '2026-10');
});

test('local free-mode limit blocks Google request without OpenAI fallback', async t => {
  const { store } = setup(t, { limit: 10 });
  let googleCalls = 0;
  let openaiCalls = 0;
  const google = new TranslationService(createGoogleTranslationProvider({ apiKey: 'k', projectId: 'p', usageStore: store,
    fetcher: async () => { googleCalls++; return googleResponse(['x', 'y']); } }));
  const openai = { translate: async () => { openaiCalls++; return { provider: 'openai', translations: [] }; } };
  const router = new TranslationRouter({ google, openai });
  await assert.rejects(() => router.translate(request), /free-mode local limit reached/);
  assert.equal(googleCalls, 0);
  assert.equal(openaiCalls, 0);
});
