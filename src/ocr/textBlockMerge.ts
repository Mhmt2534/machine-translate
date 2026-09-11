import { TEXT_BLOCK_MERGE_CONFIG } from './config';
import { createTextBlock, getTextBlockMetrics } from './textGrouping';
import type { ImageDimensions, TextBlock } from './types';

type MergeConfig = { [Key in keyof typeof TEXT_BLOCK_MERGE_CONFIG]: number };
interface MergeCandidate { first: number; second: number; score: number }

const centerX = (block: TextBlock) => block.x + block.width / 2;
const centerY = (block: TextBlock) => block.y + block.height / 2;
const bottom = (block: TextBlock) => block.y + block.height;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 1;
};
const lineHeight = (block: TextBlock) => median(block.lines.map(line => line.height));

function candidateScore(a: TextBlock, b: TextBlock, image: ImageDimensions, config: MergeConfig): number | undefined {
  const upper = centerY(a) <= centerY(b) ? a : b;
  const lower = upper === a ? b : a;
  const averageLineHeight = (lineHeight(a) + lineHeight(b)) / 2;
  const centerYDistance = centerY(lower) - centerY(upper);
  if (centerYDistance < averageLineHeight * 0.65) return;
  const verticalGap = Math.max(0, lower.y - bottom(upper)) / averageLineHeight;
  if (verticalGap > config.maxVerticalGapRatio) return;
  const horizontalOverlap = overlap(a.x, a.x + a.width, b.x, b.x + b.width) / Math.min(a.width, b.width);
  const centerDistance = Math.abs(centerX(a) - centerX(b)) / Math.max(a.width, b.width);
  if (horizontalOverlap < config.minHorizontalOverlapRatio && centerDistance > config.maxCenterDistanceRatio) return;
  const widthSimilarity = Math.min(a.width, b.width) / Math.max(a.width, b.width);
  if (widthSimilarity < config.minWidthSimilarityRatio) return;
  const heightDifference = Math.abs(lineHeight(a) - lineHeight(b)) / Math.max(lineHeight(a), lineHeight(b));
  if (heightDifference > config.maxLineHeightDifferenceRatio) return;

  const lines = [...a.lines, ...b.lines];
  const proposed = createTextBlock(lines);
  const metrics = getTextBlockMetrics(lines, image);
  if (metrics.centerSpreadRatio > config.maxCenterSpreadRatio || metrics.widthRatio > config.maxBlockWidthRatio ||
    metrics.heightRatio > config.maxBlockHeightRatio || metrics.areaRatio > config.maxBlockAreaRatio) return;
  const ordered = [...lines].sort((left, right) => left.y - right.y || left.x - right.x);
  const gaps: number[] = [];
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const averageHeight = (previous.height + current.height) / 2;
    if (Math.abs((current.y + current.height / 2) - (previous.y + previous.height / 2)) < averageHeight * 0.5) continue;
    gaps.push(Math.max(0, current.y - (previous.y + previous.height)) / averageHeight);
  }
  if (gaps.length && Math.max(...gaps) > config.maxVerticalGapRatio) return;
  if (gaps.length > 1 && Math.max(...gaps) - Math.min(...gaps) > config.maxVerticalGapDifferenceRatio) return;
  return 4 + horizontalOverlap + widthSimilarity - verticalGap - centerDistance - proposed.height / image.height;
}

function hasCompetingBlock(candidate: MergeCandidate, blocks: readonly TextBlock[], image: ImageDimensions, config: MergeConfig): boolean {
  const first = blocks[candidate.first];
  const second = blocks[candidate.second];
  const upper = centerY(first) <= centerY(second) ? first : second;
  const lower = upper === first ? second : first;
  const padding = (lineHeight(first) + lineHeight(second)) * 0.2;
  return blocks.some((other, index) => {
    if (index === candidate.first || index === candidate.second) return false;
    const otherCenterY = centerY(other);
    if (otherCenterY < centerY(upper) - padding || otherCenterY > centerY(lower) + padding) return false;
    const alternative = candidateScore(upper, other, image, config);
    return alternative !== undefined && alternative >= candidate.score - config.competingScoreMargin;
  });
}

/** İlk geometric grouping'in böldüğü, dikey olarak komşu ve rakipsiz block'ları kontrollü biçimde birleştirir. */
export function mergeTextBlocks(
  input: readonly TextBlock[],
  imageWidth: number,
  imageHeight: number,
  config: MergeConfig = TEXT_BLOCK_MERGE_CONFIG,
): TextBlock[] {
  const image = { width: imageWidth, height: imageHeight };
  const blocks = input.map(block => ({ ...block, lines: [...block.lines] }));
  while (true) {
    const candidates: MergeCandidate[] = [];
    for (let first = 0; first < blocks.length; first++) {
      for (let second = first + 1; second < blocks.length; second++) {
        const score = candidateScore(blocks[first], blocks[second], image, config);
        if (score !== undefined) candidates.push({ first, second, score });
      }
    }
    const best = candidates
      .filter(candidate => !hasCompetingBlock(candidate, blocks, image, config))
      .sort((a, b) => b.score - a.score)[0];
    if (!best) break;
    const merged = createTextBlock([...blocks[best.first].lines, ...blocks[best.second].lines]);
    blocks.splice(best.second, 1);
    blocks.splice(best.first, 1, merged);
  }
  blocks.sort((a, b) => a.y - b.y || a.x - b.x);
  const prefix = input[0]?.id.match(/^(.*?)-block-/)?.[1] ?? 'image';
  return blocks.map((block, index) => ({ ...block, id: `${prefix}-block-${index + 1}` }));
}
