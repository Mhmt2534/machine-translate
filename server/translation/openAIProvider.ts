import type { TranslationProvider, TranslationRequest, TranslationResult } from './types';

export const TRANSLATION_INSTRUCTIONS = `You translate English OCR text from webtoon and manga dialogue into natural Turkish.
Use surrounding blocks in the same request as context, but return a separate translation for every block ID.
Use natural everyday Turkish instead of mechanical word-for-word phrasing. Preserve character names, tone, emotion,
questions, exclamations, hesitation, and punctuation. The source is OCR: silently repair small contextual OCR mistakes
such as FEEL1NG, but never invent a sentence absent from the source. Do not add explanations. Do not censor.
Never move meaning between block IDs. If a block is unrecoverable OCR garbage, set skip=true, translatedText=null,
and reason="unrecoverable-ocr". A small typo in otherwise meaningful dialogue is not a reason to skip.`;

export class TranslationProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) { super(message); }
}

interface OpenAIProviderOptions {
  apiKey?: string;
  model: string;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  maxRetries?: number;
  timeoutMs?: number;
}

const schema = {
  type: 'object', additionalProperties: false, required: ['translations'],
  properties: {
    translations: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'translatedText', 'skip', 'reason'],
        properties: {
          id: { type: 'string' },
          translatedText: { type: ['string', 'null'] },
          skip: { type: 'boolean' },
          reason: { type: ['string', 'null'] },
        },
      },
    },
  },
};

function outputText(response: Record<string, unknown>): string {
  if (typeof response.output_text === 'string') return response.output_text;
  if (!Array.isArray(response.output)) return '';
  for (const item of response.output) {
    if (!item || typeof item !== 'object' || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === 'object' && (content as { type?: unknown }).type === 'output_text' &&
        typeof (content as { text?: unknown }).text === 'string') return (content as { text: string }).text;
    }
  }
  return '';
}

export function createOpenAIProvider(options: OpenAIProviderOptions): TranslationProvider {
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const maxRetries = options.maxRetries ?? 2;
  const timeoutMs = options.timeoutMs ?? 60000;
  return {
    name: `openai:${options.model}`,
    async translate(request: TranslationRequest): Promise<TranslationResult> {
      if (!options.apiKey) throw new TranslationProviderError('API_KEY_MISSING', 'OPENAI_API_KEY is missing.', 503);
      for (let attempt = 0; ; attempt++) {
        let response: Response;
        try {
          response = await fetcher('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
              model: options.model, store: false, temperature: 0.2, instructions: TRANSLATION_INSTRUCTIONS,
              input: JSON.stringify({ imageId: request.imageId, blocks: request.blocks }),
              max_output_tokens: 4000,
              text: { format: { type: 'json_schema', name: 'webtoon_translations', strict: true, schema } },
            }),
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'TimeoutError') {
            throw new TranslationProviderError('PROVIDER_TIMEOUT', 'Translation provider timed out.', 504);
          }
          throw new TranslationProviderError('PROVIDER_NETWORK', 'Translation provider network error.', 502);
        }
        if (response.ok) {
          let envelope: Record<string, unknown>;
          try { envelope = await response.json() as Record<string, unknown>; }
          catch { throw new TranslationProviderError('MALFORMED_PROVIDER_RESPONSE', 'Provider returned malformed JSON.'); }
          const text = outputText(envelope);
          try { return JSON.parse(text) as TranslationResult; }
          catch { throw new TranslationProviderError('MALFORMED_AI_RESPONSE', 'AI returned malformed structured output.'); }
        }
        if (response.status === 401) throw new TranslationProviderError('PROVIDER_AUTH', 'OpenAI authentication failed.', 502);
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= maxRetries) {
          const code = response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_HTTP_ERROR';
          const message = response.status === 429 ? 'OpenAI rate limit reached.' : `Translation provider failed with HTTP ${response.status}.`;
          throw new TranslationProviderError(code, message, response.status === 429 ? 503 : 502);
        }
        await sleep(500 * 2 ** attempt);
      }
    },
  };
}
