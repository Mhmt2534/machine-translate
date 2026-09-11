import type { TranslationBatchItem, TranslationBatchRequest, TranslationBatchResponse } from './types';

export function validateTranslationResponse(request: TranslationBatchRequest, value: unknown): TranslationBatchResponse {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { translations?: unknown }).translations)) {
    throw new Error('Malformed translation response.');
  }
  const requested = new Set(request.blocks.map(block => block.id));
  const found = new Map<string, TranslationBatchItem>();
  for (const raw of (value as { translations: unknown[] }).translations) {
    if (!raw || typeof raw !== 'object') throw new Error('Malformed translation item.');
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || !requested.has(item.id)) throw new Error(`Unknown translation ID: ${String(item.id)}`);
    if (found.has(item.id)) throw new Error(`Duplicate translation ID: ${item.id}`);
    if (typeof item.skip !== 'boolean') throw new Error(`Invalid skip value for ${item.id}.`);
    const translatedText = typeof item.translatedText === 'string' ? item.translatedText.trim() : null;
    if (!item.skip && !translatedText) {
      found.set(item.id, { id: item.id, translatedText: null, skip: true,
        reason: 'empty-provider-output', error: 'Provider returned an empty translation.' });
    } else {
      found.set(item.id, { id: item.id, translatedText: item.skip ? null : translatedText, skip: item.skip,
        ...(typeof item.reason === 'string' && item.reason ? { reason: item.reason } : {}) });
    }
  }
  const translations = request.blocks.map(block => found.get(block.id) ?? ({ id: block.id, translatedText: null, skip: true,
    reason: 'missing-provider-output', error: 'Provider did not return this block.' }));
  const usage = (value as { usage?: TranslationBatchResponse['usage'] }).usage;
  return { provider: request.provider, translations, ...(usage ? { usage } : {}) };
}
