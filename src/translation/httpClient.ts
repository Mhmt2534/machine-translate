import type { TranslationBatchRequest, TranslationBatchResponse } from './types';

export const TRANSLATION_SERVER_URL = 'http://127.0.0.1:4317/api/translate';

export async function postTranslationBatch(
  request: TranslationBatchRequest,
  fetcher: typeof fetch = fetch,
): Promise<TranslationBatchResponse> {
  let response: Response;
  try {
    response = await fetcher(TRANSLATION_SERVER_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request),
      signal: AbortSignal.timeout(70000),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error('Local translation server timed out.');
    throw new Error('Local translation server is not running.');
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error('Local translation server returned malformed JSON.'); }
  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body && typeof body.error === 'object' && body.error &&
      'message' in body.error && typeof body.error.message === 'string' ? body.error.message : `Translation server HTTP ${response.status}.`;
    throw new Error(message);
  }
  if (!body || typeof body !== 'object' || !Array.isArray((body as TranslationBatchResponse).translations)) {
    throw new Error('Local translation server returned an invalid response.');
  }
  return body as TranslationBatchResponse;
}
