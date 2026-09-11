import { TranslationProviderError, type TranslationProvider } from './types';
import { GoogleUsageLimitError, GoogleUsageStore } from './googleUsageStore';
export { GoogleUsageStore } from './googleUsageStore';

interface GoogleProviderOptions {
  apiKey?: string;
  projectId?: string;
  usageStore: GoogleUsageStore;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (whole, entity: string) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? whole;
    const hexadecimal = entity[1].toLowerCase() === 'x';
    const code = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

export function createGoogleTranslationProvider(options: GoogleProviderOptions): TranslationProvider {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 30000;
  return {
    id: 'google',
    name: 'google:nmt:en:tr',
    getUsage: () => options.usageStore.getUsage(),
    async translate(request) {
      if (!options.apiKey) throw new TranslationProviderError('GOOGLE_API_KEY_MISSING', 'GOOGLE_TRANSLATE_API_KEY is missing.', 503);
      if (!options.projectId) throw new TranslationProviderError('GOOGLE_PROJECT_MISSING', 'GOOGLE_TRANSLATE_PROJECT_ID is missing.', 503);
      const characters = request.blocks.reduce((sum, block) => sum + [...block.text].length, 0);
      for (let attempt = 0; ; attempt++) {
        let reservation: ReturnType<GoogleUsageStore['reserve']>;
        try { reservation = options.usageStore.reserve(characters); }
        catch (error) {
          if (error instanceof GoogleUsageLimitError) {
            throw new TranslationProviderError('GOOGLE_LOCAL_LIMIT', error.message, 429);
          }
          throw error;
        }
        let response: Response;
        try {
          const endpoint = new URL('https://translation.googleapis.com/language/translate/v2');
          endpoint.searchParams.set('key', options.apiKey);
          response = await fetcher(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json; charset=utf-8' },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({ q: request.blocks.map(block => block.text), source: 'en', target: 'tr', format: 'text', model: 'nmt' }),
          });
          reservation.commit();
        } catch (error) {
          reservation.cancel();
          if (error instanceof DOMException && error.name === 'TimeoutError') {
            throw new TranslationProviderError('GOOGLE_TIMEOUT', 'Google Translation timed out.', 504);
          }
          throw new TranslationProviderError('GOOGLE_NETWORK', 'Google Translation network error.', 502);
        }
        if (response.ok) {
          let body: unknown;
          try { body = await response.json(); }
          catch { throw new TranslationProviderError('GOOGLE_MALFORMED_RESPONSE', 'Google Translation returned malformed JSON.'); }
          const translations = (body as { data?: { translations?: unknown } })?.data?.translations;
          if (!Array.isArray(translations) || translations.length !== request.blocks.length) {
            throw new TranslationProviderError('GOOGLE_MALFORMED_RESPONSE', 'Google Translation returned an invalid translation count.');
          }
          return { translations: translations.map((raw, index) => {
            const translatedText = raw && typeof raw === 'object' && typeof (raw as { translatedText?: unknown }).translatedText === 'string'
              ? decodeEntities((raw as { translatedText: string }).translatedText).trim() : '';
            if (!translatedText) throw new TranslationProviderError('GOOGLE_MALFORMED_RESPONSE', 'Google Translation returned an empty translation.');
            return { id: request.blocks[index].id, translatedText, skip: false };
          }) };
        }
        let providerDetail = '';
        try { providerDetail = JSON.stringify(await response.json()); } catch { /* Status remains authoritative. */ }
        if (response.status === 400) {
          if (/api.?key|key.*valid|credential/i.test(providerDetail)) {
            throw new TranslationProviderError('GOOGLE_AUTH', 'Google Translation API key was rejected.', 502);
          }
          throw new TranslationProviderError('GOOGLE_BAD_REQUEST', 'Google Translation rejected the request (HTTP 400).', 502);
        }
        if (response.status === 401 || response.status === 403) {
          if (/quota|limit|billing/i.test(providerDetail)) {
            throw new TranslationProviderError('GOOGLE_QUOTA', 'Google Translation quota or billing limit was reached.', 503);
          }
          throw new TranslationProviderError('GOOGLE_AUTH', `Google Translation credentials or project were rejected (HTTP ${response.status}).`, 502);
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= maxRetries) {
          const message = response.status === 429 ? 'Google Translation quota or rate limit reached.' :
            `Google Translation failed with HTTP ${response.status}.`;
          throw new TranslationProviderError(response.status === 429 ? 'GOOGLE_QUOTA' : 'GOOGLE_HTTP_ERROR', message, 503);
        }
        await sleep(500 * 2 ** attempt);
      }
    },
  };
}
