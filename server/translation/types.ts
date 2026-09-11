import type { GoogleUsage, TranslationBatchItem, TranslationBatchRequest, TranslationProviderId } from '../../src/translation/types';

export type TranslationRequest = TranslationBatchRequest;
export interface TranslationResult { translations: TranslationBatchItem[] }

export class TranslationProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) { super(message); }
}

export interface TranslationProvider {
  readonly id: TranslationProviderId;
  readonly name: string;
  translate(request: TranslationRequest): Promise<TranslationResult>;
  getUsage?(): GoogleUsage;
}
