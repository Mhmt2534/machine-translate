export interface DetectedText {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBlock {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  lines: DetectedText[];
}

export interface OcrResult {
  regions: DetectedText[];
  width: number;
  height: number;
}

export interface OcrStatus {
  running: boolean;
  message: string;
  regions: number;
  filteredRegions: number;
  textBlocks: number;
  errors: string[];
}

export { MAX_OCR_IMAGES } from './config';
export const MAX_IMAGE_PIXELS = 32_000_000;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
