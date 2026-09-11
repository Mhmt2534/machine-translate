import { validateTranslationResponse } from '../../src/translation/responseValidation';
import type { TranslationBatchRequest, TranslationBatchResponse } from '../../src/translation/types';
import type { TranslationProvider } from './types';

function validateRequest(value: unknown): TranslationBatchRequest {
  if (!value || typeof value !== 'object') throw new Error('Invalid translation request.');
  const request = value as Partial<TranslationBatchRequest>;
  if (typeof request.imageId !== 'string' || !request.imageId || !Array.isArray(request.blocks) ||
    !request.blocks.length || request.blocks.length > 25) throw new Error('Translation request must contain 1-25 blocks.');
  const ids = new Set<string>();
  for (const block of request.blocks) {
    if (!block || typeof block.id !== 'string' || typeof block.text !== 'string' || !block.id || !block.text.trim()) {
      throw new Error('Translation block has an invalid ID or text.');
    }
    if (ids.has(block.id)) throw new Error(`Duplicate request ID: ${block.id}`);
    ids.add(block.id);
  }
  return { imageId: request.imageId, blocks: request.blocks.map(block => ({ id: block.id, text: block.text.replace(/\s+/g, ' ').trim() })) };
}

export class TranslationService {
  private readonly cache = new Map<string, TranslationBatchResponse>();
  constructor(private readonly provider: TranslationProvider) {}

  async translate(value: unknown): Promise<TranslationBatchResponse> {
    const request = validateRequest(value);
    const cacheKey = JSON.stringify([this.provider.name,
      request.blocks.map(block => block.text.toLocaleLowerCase('en-US'))]);
    const cached = this.cache.get(cacheKey);
    if (cached) return {
      translations: cached.translations.map((item, index) => ({ ...item, id: request.blocks[index].id })),
      cached: true,
    };
    const result = validateTranslationResponse(request, await this.provider.translate(request));
    this.cache.set(cacheKey, result);
    return { translations: result.translations.map(item => ({ ...item })), cached: false };
  }
}
