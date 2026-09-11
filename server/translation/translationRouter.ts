import type { TranslationBatchResponse, TranslationProviderId } from '../../src/translation/types';
import { TranslationService } from './translationService';

export class TranslationRouter {
  constructor(private readonly services: Record<TranslationProviderId, TranslationService>) {}

  translate(value: unknown): Promise<TranslationBatchResponse> {
    const provider = value && typeof value === 'object' ? (value as { provider?: unknown }).provider : undefined;
    if (provider !== 'google' && provider !== 'openai') throw new Error('Unknown translation provider.');
    return this.services[provider].translate(value);
  }
}
