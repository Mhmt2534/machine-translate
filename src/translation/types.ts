import type { TextBlock } from '../ocr/types';

export type TranslationProviderId = 'google' | 'openai';
export interface GoogleUsage { month: string; characters: number; limit: number }
export interface TranslationBlockInput { id: string; text: string }
export interface TranslationBatchRequest { provider: TranslationProviderId; imageId: string; blocks: TranslationBlockInput[] }
export interface TranslationBatchItem {
  id: string;
  translatedText: string | null;
  skip: boolean;
  reason?: string;
  error?: string;
}
export interface TranslationBatchResponse {
  provider: TranslationProviderId;
  translations: TranslationBatchItem[];
  cached?: boolean;
  usage?: GoogleUsage;
}

export interface TranslatedTextBlock {
  id: string;
  originalText: string;
  translatedText: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  qualityScore?: number;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

export interface TranslationImageInput { imageId: string; blocks: TextBlock[] }
export interface TranslationStatus {
  running: boolean;
  ready: boolean;
  message: string;
  blocks: number;
  translated: number;
  skipped: number;
  errors: number;
  batches: number;
  provider?: TranslationProviderId;
  usage?: GoogleUsage;
}
