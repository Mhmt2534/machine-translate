import { OCR_FILTER_CONFIG } from './config';
import type { DetectedText, ImageDimensions } from './types';

export interface RejectedTextRegion {
  region: DetectedText;
  reason: string;
}

export interface TextFilterResult {
  regions: DetectedText[];
  rejected: RejectedTextRegion[];
}

type FilterConfig = {
  minConfidence: number;
  minWidthToMedianLineHeight: number;
  minHeightToMedianLineHeight: number;
  minAlphaNumericRatio: number;
  lowConfidenceGeometryGate: number;
  maxShortTextAspectRatio: number;
  maxRegionAreaPerCharacterRatio: number;
  maxShortTextImageAreaRatio: number;
};

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
const expressivePunctuation = (text: string) => /^[.!?…]+$/.test(text) && (/[!?]/.test(text) || /\.{2,}|…/.test(text));
const shortDialogueWords = new Set(['I', 'A', 'NO', 'SO', 'OK', 'HI']);
const protectedShortExpression = (text: string) => expressivePunctuation(text) ||
  /^[\p{Lu}\p{N}]{2,}[.!?…]+$/u.test(text) || shortDialogueWords.has(text);

/** Saf ve muhafazakâr OCR gürültü filtresi. Girdi nesnelerini değiştirmez. */
export function filterTextRegions(
  input: readonly DetectedText[],
  image?: ImageDimensions,
  config: FilterConfig = OCR_FILTER_CONFIG,
): TextFilterResult {
  const validHeights = input
    .filter(region => Number.isFinite(region.height) && region.height > 0)
    .map(region => region.height)
    .sort((a, b) => a - b);
  const medianHeight = validHeights.length
    ? validHeights[Math.floor(validHeights.length / 2)]
    : 1;
  const regions: DetectedText[] = [];
  const rejected: RejectedTextRegion[] = [];

  for (const source of input) {
    const region = { ...source, text: normalize(source.text) };
    const visibleLength = (region.text.match(/\S/gu) ?? []).length;
    const alphaNumericLength = (region.text.match(/[\p{L}\p{N}]/gu) ?? []).length;
    const alphaNumericRatio = alphaNumericLength / Math.max(1, visibleLength);
    const aspectRatio = region.width / Math.max(1, region.height);
    const areaPerCharacter = region.width * region.height /
      (Math.max(1, alphaNumericLength) * medianHeight * medianHeight);
    const imageAreaRatio = image?.width && image.height
      ? region.width * region.height / (image.width * image.height)
      : 0;
    let reason = '';
    if (!region.text) reason = 'empty text';
    else if (![region.x, region.y, region.width, region.height, region.confidence].every(Number.isFinite) ||
      region.width <= 0 || region.height <= 0) reason = 'invalid geometry or confidence';
    else if (!expressivePunctuation(region.text) && (region.width / medianHeight < config.minWidthToMedianLineHeight ||
      region.height / medianHeight < config.minHeightToMedianLineHeight)) reason = 'tiny box relative to median line height';
    else if (/^[^\p{L}\p{N}!?…]+$/u.test(region.text) && !expressivePunctuation(region.text)) reason = 'meaningless punctuation';
    else if (alphaNumericLength === 0 && !expressivePunctuation(region.text)) reason = 'no meaningful characters';
    else if (region.confidence < config.lowConfidenceGeometryGate && alphaNumericRatio < config.minAlphaNumericRatio &&
      !protectedShortExpression(region.text)) reason = 'low-confidence symbol-heavy text';
    else if (alphaNumericLength <= 3 && aspectRatio > config.maxShortTextAspectRatio &&
      region.confidence < config.lowConfidenceGeometryGate) reason = 'short text with implausible aspect ratio';
    else if (areaPerCharacter > config.maxRegionAreaPerCharacterRatio &&
      region.confidence < config.lowConfidenceGeometryGate) reason = 'sparse text geometry';
    else if (alphaNumericLength <= 3 && imageAreaRatio > config.maxShortTextImageAreaRatio) reason = 'short text covers excessive image area';
    else if (region.confidence < config.minConfidence && !protectedShortExpression(region.text)) reason = 'very low confidence';

    if (reason) rejected.push({ region, reason });
    else regions.push(region);
  }
  return { regions, rejected };
}
