import { TEXT_BLOCK_VALIDATION_CONFIG, TEXT_GROUPING_CONFIG } from './config';
import { getTextBlockMetrics, type BlockMetrics } from './textGrouping';
import type { ImageDimensions, TextBlock } from './types';

export type BlockQualityRejectionReason =
  'symbol-noise' | 'short-low-confidence' | 'invalid-short-text' | 'garbage-pattern' | 'low-text-density';

export interface RejectedQualityBlock {
  block: TextBlock;
  reason: BlockQualityRejectionReason;
  details: BlockQualityMetrics;
}

export interface BlockQualityMetrics extends BlockMetrics {
  alphaNumericCharacters: number;
  alphaNumericRatio: number;
  punctuationRatio: number;
  minimumChildConfidence: number;
}

export interface TextBlockValidationResult {
  blocks: TextBlock[];
  rejected: RejectedQualityBlock[];
}

type ValidationConfig = { [Key in keyof typeof TEXT_BLOCK_VALIDATION_CONFIG]: number };
const independentWords = new Set(['I', 'A', 'NO', 'SO', 'OK', 'HI', 'YES', 'HEY', 'ISE']);
const punctuationDialogue = (text: string) => /^(?:[!?]+|\.{3,}|…+)$/.test(text);
const centerX = (block: TextBlock) => block.x + block.width / 2;
const bottom = (block: TextBlock) => block.y + block.height;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const medianLineHeight = (block: TextBlock) => {
  const values = block.lines.map(line => line.height).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] || block.height || 1;
};

function qualityMetrics(block: TextBlock, image?: ImageDimensions): BlockQualityMetrics {
  const visible = block.text.match(/\S/gu) ?? [];
  const alphaNumeric = block.text.match(/[\p{L}\p{N}]/gu) ?? [];
  const punctuation = block.text.match(/[^\p{L}\p{N}\s]/gu) ?? [];
  return {
    ...getTextBlockMetrics(block.lines, image),
    alphaNumericCharacters: alphaNumeric.length,
    alphaNumericRatio: alphaNumeric.length / Math.max(1, visible.length),
    punctuationRatio: punctuation.length / Math.max(1, visible.length),
    minimumChildConfidence: Math.min(...block.lines.map(line => line.confidence)),
  };
}

function isMeaningfulNeighbor(block: TextBlock, config: ValidationConfig): boolean {
  const alphaNumeric = block.text.match(/[\p{L}\p{N}]/gu) ?? [];
  const text = block.text.trim();
  if (punctuationDialogue(text)) return true;
  if (alphaNumeric.length < 4 || block.confidence < config.mediumTextConfidence) return false;
  if (/[^\p{L}\p{N}\s.!?,:'"…-]/u.test(text) || (/\p{L}/u.test(text) && /\p{N}/u.test(text))) return false;
  if (/^\p{Ll}+[.!?…]*$/u.test(text) && block.confidence < config.shortLowercaseConfidence) return false;
  return true;
}

function hasNearbyMeaningfulBlock(block: TextBlock, blocks: readonly TextBlock[], config: ValidationConfig): boolean {
  return blocks.some(other => {
    if (other === block || !isMeaningfulNeighbor(other, config)) return false;
    const averageHeight = (medianLineHeight(block) + medianLineHeight(other)) / 2;
    const verticalGap = other.y >= block.y
      ? Math.max(0, other.y - bottom(block))
      : Math.max(0, block.y - bottom(other));
    const horizontalOverlap = overlap(block.x, block.x + block.width, other.x, other.x + other.width) /
      Math.min(block.width, other.width);
    const centerDistance = Math.abs(centerX(block) - centerX(other)) / Math.max(block.width, other.width);
    return verticalGap / averageHeight <= config.nearbyVerticalGapRatio &&
      (horizontalOverlap >= TEXT_GROUPING_CONFIG.minHorizontalOverlapRatio || centerDistance <= config.nearbyCenterDistanceRatio);
  });
}

export function validateTextBlocks(
  input: readonly TextBlock[],
  image?: ImageDimensions,
  config: ValidationConfig = TEXT_BLOCK_VALIDATION_CONFIG,
): TextBlockValidationResult {
  const blocks: TextBlock[] = [];
  const rejected: RejectedQualityBlock[] = [];
  for (const block of input) {
    const text = block.text.trim();
    const details = qualityMetrics(block, image);
    const compactWord = text.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
    const nearby = hasNearbyMeaningfulBlock(block, input, config);
    const singleCharacter = details.alphaNumericCharacters === 1 && details.alphaNumericRatio === 1;
    const shortText = details.alphaNumericCharacters <= config.shortTextMaxAlphaNumericCharacters;
    const mediumText = details.alphaNumericCharacters <= config.mediumTextMaxAlphaNumericCharacters;
    // Kısa block'ta kötü bir child tamamen gizlenmesin; uzun cümlede tek outlier karar vermesin.
    const shortConfidence = Math.min(block.confidence,
      details.minimumChildConfidence + config.shortChildConfidenceAllowance);
    const hasOddSymbol = /[^\p{L}\p{N}\s.!?,:'"…-]/u.test(text);
    const mixedLettersAndNumbers = /\p{L}/u.test(text) && /\p{N}/u.test(text);
    let reason: BlockQualityRejectionReason | undefined;

    if (!details.alphaNumericCharacters) {
      if (!punctuationDialogue(text)) reason = 'symbol-noise';
    } else if (singleCharacter) {
      const independent = independentWords.has(text.toUpperCase());
      const numeric = /^\p{N}$/u.test(text);
      const confident = shortConfidence >= config.singleCharacterHighConfidence;
      const contextConfidence = numeric ? config.singleCharacterHighConfidence : config.shortTextNearbyConfidence;
      if ((!independent || shortConfidence < config.independentWordConfidence) &&
        (!confident || numeric) && !(nearby && shortConfidence >= contextConfidence)) {
        reason = 'short-low-confidence';
      }
    } else if (shortText) {
      if (hasOddSymbol || mixedLettersAndNumbers) reason = 'garbage-pattern';
      else if (details.alphaNumericRatio < config.minShortAlphaNumericRatio && !independentWords.has(compactWord)) {
        reason = 'invalid-short-text';
      } else {
        const minimumConfidence = independentWords.has(compactWord)
          ? config.independentWordConfidence
          : nearby ? config.shortTextNearbyConfidence : config.shortTextIsolatedConfidence;
        if (shortConfidence < minimumConfidence) reason = 'short-low-confidence';
      }
    } else if (mediumText) {
      const lowercaseOnly = /^\p{Ll}+[.!?…]*$/u.test(text);
      if (hasOddSymbol || mixedLettersAndNumbers) reason = 'garbage-pattern';
      else if (details.alphaNumericRatio < config.minAlphaNumericRatio) reason = 'invalid-short-text';
      else if (block.confidence < config.mediumTextConfidence ||
        (lowercaseOnly && !nearby && block.confidence < config.shortLowercaseConfidence)) reason = 'short-low-confidence';
    }
    if (!reason && details.areaPerCharacterRatio > TEXT_GROUPING_CONFIG.maxBlockAreaPerCharacterRatio) {
      reason = 'low-text-density';
    }

    if (reason) rejected.push({ block, reason, details });
    else blocks.push(block);
  }
  return { blocks, rejected };
}
