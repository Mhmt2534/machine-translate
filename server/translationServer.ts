import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadLocalEnv } from './env';
import { createOpenAIProvider, TranslationProviderError } from './translation/openAIProvider';
import { TranslationService } from './translation/translationService';

loadLocalEnv();
const host = '127.0.0.1';
const port = Number(process.env.TRANSLATION_PORT || 4317);
const service = new TranslationService(createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
}));
const allowedOrigin = (origin?: string) => !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin) ||
  /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);

function cors(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  if (!allowedOrigin(origin)) { response.writeHead(403).end(); return false; }
  if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'content-type');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return true;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Request body is malformed JSON.'); }
}

const server = createServer((request, response) => {
  if (!cors(request, response)) return;
  if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true })); return;
  }
  if (request.method !== 'POST' || request.url !== '/api/translate') {
    response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found.' } })); return;
  }
  void readJson(request).then(value => service.translate(value)).then(result => {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
  }, (error: unknown) => {
    const providerError = error instanceof TranslationProviderError ? error : undefined;
    const status = providerError?.status ?? 400;
    const code = providerError?.code ?? 'INVALID_REQUEST';
    const message = error instanceof Error ? error.message : 'Translation failed.';
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { code, message } }));
  });
});

server.listen(port, host, () => {
  console.log(`[Webtoon Translator] Translation server listening on http://${host}:${port}`);
  console.log(`[Webtoon Translator] Provider model: ${process.env.OPENAI_MODEL || 'gpt-5.6-luna'}`);
});
