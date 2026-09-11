import type { TranslationBatchRequest, TranslationBatchResponse } from '../../src/translation/types';

export type TranslationRequest = TranslationBatchRequest;
export type TranslationResult = TranslationBatchResponse;

export interface TranslationProvider {
  readonly name: string;
  translate(request: TranslationRequest): Promise<TranslationResult>;
}
