import { FINAL_TEXT_SANITY_CONFIG } from './config';
import type { TextBlock } from './types';

type SanityConfig = { [Key in keyof typeof FINAL_TEXT_SANITY_CONFIG]: number };
export type FinalBlockRejectionReason = 'low-quality-text' | 'unexpected-symbols' | 'garbage-case-pattern' | 'symbol-noise';

export interface TextSanityResult {
  qualityScore: number;
  accepted: boolean;
  reason?: FinalBlockRejectionReason;
  alphabeticRatio: number;
  normalWordRatio: number;
  unexpectedSymbolRatio: number;
}

export interface RejectedFinalBlock { block: TextBlock; sanity: TextSanityResult }
export interface FinalBlockValidationResult { blocks: TextBlock[]; rejected: RejectedFinalBlock[] }

const punctuationDialogue = (text: string) => /^(?:[!?]+|\.{3,}|…+)$/.test(text);

/** Sözlük kullanmadan metnin OCR çıktısı olarak yapısal tutarlılığını puanlar. */
export function scoreTextBlock(
  block: TextBlock,
  config: SanityConfig = FINAL_TEXT_SANITY_CONFIG,
): TextSanityResult {
  const text = block.text.trim();
  const visible = text.match(/\S/gu) ?? [];
  const alphabetic = text.match(/\p{L}/gu) ?? [];
  const alphaNumeric = text.match(/[\p{L}\p{N}]/gu) ?? [];
  const unexpected = text.match(/[^\p{L}\p{N}\s.,!?;:'"…()\-]/gu) ?? [];
  const words = text.split(/\s+/).map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  const normalWords = words.filter(word => /^[\p{L}\p{N}][\p{L}\p{N}'-]*$/u.test(word) &&
    (word.length >= 2 || /^(?:I|A)$/i.test(word)));
  const weirdCaseWords = words.filter(word => {
    const letters = word.replace(/[^\p{L}]/gu, '');
    if (!letters || letters === letters.toUpperCase() || letters === letters.toLowerCase()) return false;
    return !/^\p{Lu}\p{Ll}+$/u.test(letters);
  });
  const alphabeticRatio = alphabetic.length / Math.max(1, visible.length);
  const allowedCharacterRatio = 1 - unexpected.length / Math.max(1, visible.length);
  const normalWordRatio = normalWords.length / Math.max(1, words.length);
  const weirdCaseRatio = weirdCaseWords.length / Math.max(1, words.length);
  const lengthScore = Math.min(1, alphaNumeric.length / config.longTextCharacters);
  let qualityScore = Math.min(1, block.confidence / 70) * 0.35 + alphabeticRatio * 0.2 +
    allowedCharacterRatio * 0.15 + normalWordRatio * 0.15 + (1 - weirdCaseRatio) * 0.1 + lengthScore * 0.05;
  if (block.confidence < config.lowConfidence && alphaNumeric.length < config.shortLowConfidenceCharacters) {
    qualityScore -= config.lowConfidenceShortPenalty;
  }
  if (unexpected.length) qualityScore -= config.unexpectedSymbolPenalty;
  if (weirdCaseRatio > 0.34) qualityScore -= config.weirdCasePenalty;
  qualityScore = Math.max(0, Math.min(1, qualityScore));

  if (punctuationDialogue(text)) {
    return { qualityScore: Math.max(config.minimumQualityScore, qualityScore), accepted: true,
      alphabeticRatio, normalWordRatio, unexpectedSymbolRatio: 0 };
  }

  let reason: FinalBlockRejectionReason | undefined;
  if (!alphaNumeric.length) reason = 'symbol-noise';
  else if (unexpected.length && block.confidence < config.unexpectedSymbolConfidence) reason = 'unexpected-symbols';
  else if (weirdCaseRatio > 0.34 && block.confidence < config.weirdCaseConfidence) reason = 'garbage-case-pattern';
  else if (qualityScore < config.minimumQualityScore) reason = 'low-quality-text';
  return { qualityScore, accepted: !reason, reason, alphabeticRatio, normalWordRatio,
    unexpectedSymbolRatio: unexpected.length / Math.max(1, visible.length) };
}

export function validateFinalTextBlocks(
  input: readonly TextBlock[],
  config: SanityConfig = FINAL_TEXT_SANITY_CONFIG,
): FinalBlockValidationResult {
  const blocks: TextBlock[] = [];
  const rejected: RejectedFinalBlock[] = [];
  const prefix = input[0]?.id.match(/^(.*?)-block-/)?.[1] ?? 'image';
  for (const block of input) {
    const sanity = scoreTextBlock(block, config);
    if (sanity.accepted) blocks.push({ ...block, qualityScore: sanity.qualityScore });
    else rejected.push({ block, sanity });
  }
  return { blocks: blocks.map((block, index) => ({ ...block, id: `${prefix}-block-${index + 1}` })), rejected };
}
