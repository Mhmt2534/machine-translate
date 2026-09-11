import { TEXT_GROUPING_CONFIG } from './config';
import type { DetectedText, ImageDimensions, TextBlock } from './types';

type GroupingConfig = { [Key in keyof typeof TEXT_GROUPING_CONFIG]: number };
export type TextBlockRejectionReason = 'oversized-block' | 'noise' | 'inconsistent-centers' | 'sparse-text';

export interface BlockMetrics {
  widthRatio: number;
  heightRatio: number;
  areaRatio: number;
  centerSpreadRatio: number;
  areaPerCharacterRatio: number;
}

export interface RejectedTextBlock {
  block: TextBlock;
  reason: TextBlockRejectionReason;
  metrics: BlockMetrics;
}

export interface TextGroupingResult {
  blocks: TextBlock[];
  rejected: RejectedTextBlock[];
}

export interface BlockAddDecision {
  accepted: boolean;
  reason?: string;
  score: number;
}

const right = (r: DetectedText) => r.x + r.width;
const bottom = (r: DetectedText) => r.y + r.height;
const centerX = (r: DetectedText) => r.x + r.width / 2;
const centerY = (r: DetectedText) => r.y + r.height / 2;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
};
const alphaNumericLength = (text: string) => (text.match(/[\p{L}\p{N}]/gu) ?? []).length;

function pairScore(a: DetectedText, b: DetectedText, config: GroupingConfig): number | undefined {
  const averageHeight = (a.height + b.height) / 2;
  const heightDifference = Math.abs(a.height - b.height) / Math.max(a.height, b.height);
  if (!averageHeight || heightDifference > config.maxLineHeightDifferenceRatio) return;

  const verticalOverlap = overlap(a.y, bottom(a), b.y, bottom(b)) / Math.min(a.height, b.height);
  const horizontalGap = Math.max(0, Math.max(a.x, b.x) - Math.min(right(a), right(b))) / averageHeight;
  const sameRow = verticalOverlap >= config.minSameRowVerticalOverlapRatio ||
    Math.abs(centerY(a) - centerY(b)) / averageHeight <= config.sameRowCenterToleranceRatio;
  if (sameRow) return horizontalGap <= config.maxSameRowGapRatio ? 3 - horizontalGap : undefined;

  const upper = centerY(a) <= centerY(b) ? a : b;
  const lower = upper === a ? b : a;
  const verticalGap = Math.max(0, lower.y - bottom(upper)) / averageHeight;
  if (verticalGap > config.maxVerticalGapRatio) return;
  const horizontalOverlap = overlap(a.x, right(a), b.x, right(b)) / Math.min(a.width, b.width);
  const centerDistance = Math.abs(centerX(a) - centerX(b)) / Math.max(a.width, b.width);
  if (horizontalOverlap < config.minHorizontalOverlapRatio && centerDistance > config.maxHorizontalCenterDistanceRatio) return;
  return 2 + horizontalOverlap - verticalGap - centerDistance;
}

function orderedRows(lines: readonly DetectedText[], config: GroupingConfig): DetectedText[][] {
  const byPosition = [...lines].sort((a, b) => centerY(a) - centerY(b) || a.x - b.x);
  const rows: DetectedText[][] = [];
  for (const line of byPosition) {
    const row = rows.find(items => {
      const anchor = items[0];
      const averageHeight = (anchor.height + line.height) / 2;
      return overlap(anchor.y, bottom(anchor), line.y, bottom(line)) / Math.min(anchor.height, line.height) >=
        config.minSameRowVerticalOverlapRatio || Math.abs(centerY(anchor) - centerY(line)) / averageHeight <=
        config.sameRowCenterToleranceRatio;
    });
    (row ?? rows[rows.push([]) - 1]).push(line);
  }
  rows.sort((a, b) => Math.min(...a.map(line => line.y)) - Math.min(...b.map(line => line.y)));
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

function joinText(rows: DetectedText[][], config: GroupingConfig): string {
  let output = '';
  for (const [rowIndex, row] of rows.entries()) {
    for (const [itemIndex, line] of row.entries()) {
      const text = line.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const newRow = rowIndex > 0 && itemIndex === 0;
      const safeHyphenJoin = newRow && new RegExp(`\\p{L}{${config.minHyphenFragmentLetters},}-$`, 'u').test(output) &&
        new RegExp(`^\\p{L}{2,}-?$`, 'u').test(text);
      if (safeHyphenJoin) output = output.slice(0, -1) + text;
      else if (/^[,.;:!?%)\]}…]+/.test(text)) output += text;
      else output += `${output ? ' ' : ''}${text}`;
    }
  }
  return output.replace(/\s+/g, ' ').trim();
}

function geometry(lines: readonly DetectedText[]) {
  const x = Math.min(...lines.map(line => line.x));
  const y = Math.min(...lines.map(line => line.y));
  const maxX = Math.max(...lines.map(right));
  const maxY = Math.max(...lines.map(bottom));
  return { x, y, width: maxX - x, height: maxY - y };
}

export function getTextBlockMetrics(lines: readonly DetectedText[], image?: ImageDimensions): BlockMetrics {
  const box = geometry(lines);
  const medianWidth = median(lines.map(line => line.width));
  const medianHeight = median(lines.map(line => line.height));
  const centers = lines.map(centerX);
  const characters = Math.max(1, lines.reduce((sum, line) => sum + alphaNumericLength(line.text), 0));
  return {
    widthRatio: image?.width ? box.width / image.width : 0,
    heightRatio: image?.height ? box.height / image.height : 0,
    areaRatio: image?.width && image.height ? box.width * box.height / (image.width * image.height) : 0,
    centerSpreadRatio: (Math.max(...centers) - Math.min(...centers)) / medianWidth,
    areaPerCharacterRatio: box.width * box.height / (characters * medianHeight * medianHeight),
  };
}

/** Yeni satırı yalnızca yakın komşuya değil, oluşacak block'un tamamına göre değerlendirir. */
export function canAddRegionToBlock(
  region: DetectedText,
  blockLines: readonly DetectedText[],
  image?: ImageDimensions,
  config: GroupingConfig = TEXT_GROUPING_CONFIG,
): BlockAddDecision {
  const scores = blockLines.map(line => pairScore(region, line, config)).filter((score): score is number => score !== undefined);
  if (!scores.length) return { accepted: false, reason: 'not-near-block', score: -Infinity };
  const proposed = [...blockLines, region];
  const box = geometry(proposed);
  const medianWidth = median(proposed.map(line => line.width));
  const medianHeight = median(proposed.map(line => line.height));
  const centers = proposed.map(centerX);
  const centerSpread = (Math.max(...centers) - Math.min(...centers)) / medianWidth;
  const averageCenterDistance = blockLines.reduce((sum, line) => sum + Math.abs(centerX(line) - centerX(region)), 0) /
    blockLines.length / Math.max(region.width, medianWidth);
  if (centerSpread > config.maxCenterSpreadRatio || averageCenterDistance > config.maxAverageCenterDistanceRatio) {
    return { accepted: false, reason: 'inconsistent-centers', score: -Infinity };
  }
  if (box.width / medianWidth > config.maxBlockWidthToMedianLineWidth ||
    box.height / medianHeight > config.maxBlockHeightToMedianLineHeight) {
    return { accepted: false, reason: 'abnormal-block-growth', score: -Infinity };
  }
  const rows = orderedRows(proposed, config);
  if (rows.length >= 3) {
    const gaps = rows.slice(1).map((row, index) => {
      const previousBottom = Math.max(...rows[index].map(bottom));
      const nextTop = Math.min(...row.map(line => line.y));
      return Math.max(0, nextTop - previousBottom) / medianHeight;
    });
    if (Math.max(...gaps) - Math.min(...gaps) > config.maxVerticalGapDifferenceRatio) {
      return { accepted: false, reason: 'inconsistent-vertical-spacing', score: -Infinity };
    }
  }
  const metrics = getTextBlockMetrics(proposed, image);
  if (metrics.widthRatio > config.maxBlockWidthRatio || metrics.heightRatio > config.maxBlockHeightRatio ||
    metrics.areaRatio > config.maxBlockAreaRatio) {
    return { accepted: false, reason: 'oversized-block', score: -Infinity };
  }
  if (metrics.areaPerCharacterRatio > config.maxBlockAreaPerCharacterRatio) {
    return { accepted: false, reason: 'sparse-text', score: -Infinity };
  }
  return { accepted: true, score: Math.max(...scores) - averageCenterDistance - centerSpread / 2 };
}

export function splitTextRegionsAtLargeGaps(
  lines: readonly DetectedText[],
  config: GroupingConfig = TEXT_GROUPING_CONFIG,
): DetectedText[][] {
  const rows = orderedRows(lines, config);
  if (rows.length < 2) return [[...lines]];
  const medianHeight = median(lines.map(line => line.height));
  const groups: DetectedText[][] = [[]];
  rows.forEach((row, index) => {
    if (index) {
      const previousBottom = Math.max(...rows[index - 1].map(bottom));
      const nextTop = Math.min(...row.map(line => line.y));
      if (Math.max(0, nextTop - previousBottom) / medianHeight > config.splitVerticalGapRatio) groups.push([]);
    }
    groups.at(-1)!.push(...row);
  });
  return groups;
}

export function createTextBlock(
  lines: readonly DetectedText[],
  id = '',
  config: GroupingConfig = TEXT_GROUPING_CONFIG,
): TextBlock {
  const rows = orderedRows(lines, config);
  const orderedLines = rows.flat();
  const box = geometry(orderedLines);
  const weights = orderedLines.map(line => Math.max(1, alphaNumericLength(line.text)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const medianConfidence = median(orderedLines.map(line => line.confidence));
  const confidence = orderedLines.reduce((sum, line, index) => {
    const robustConfidence = Math.max(medianConfidence - config.confidenceOutlierClamp,
      Math.min(medianConfidence + config.confidenceOutlierClamp, line.confidence));
    return sum + robustConfidence * weights[index];
  }, 0) / totalWeight;
  return { id, text: joinText(rows, config), ...box, confidence, lines: orderedLines };
}

export function isValidTextBlock(
  block: TextBlock,
  image?: ImageDimensions,
  config: GroupingConfig = TEXT_GROUPING_CONFIG,
): { valid: true; metrics: BlockMetrics } | { valid: false; reason: TextBlockRejectionReason; metrics: BlockMetrics } {
  const metrics = getTextBlockMetrics(block.lines, image);
  const characterCount = alphaNumericLength(block.text);
  const dialoguePunctuation = /^[.!?…]+$/.test(block.text) && (/[!?]/.test(block.text) || /\.{2,}|…/.test(block.text));
  if (!characterCount && !dialoguePunctuation) return { valid: false, reason: 'noise', metrics };
  if (metrics.widthRatio > config.maxBlockWidthRatio || metrics.heightRatio > config.maxBlockHeightRatio ||
    metrics.areaRatio > config.maxBlockAreaRatio) return { valid: false, reason: 'oversized-block', metrics };
  if (metrics.centerSpreadRatio > config.maxCenterSpreadRatio) return { valid: false, reason: 'inconsistent-centers', metrics };
  if (metrics.areaPerCharacterRatio > config.maxBlockAreaPerCharacterRatio) return { valid: false, reason: 'sparse-text', metrics };
  return { valid: true, metrics };
}

/** Aynı görsele ait OCR bölgelerini block-aware geometrik kurallarla gruplar. */
export function groupTextRegionsDetailed(
  regions: readonly DetectedText[],
  imageId = 'image',
  image?: ImageDimensions,
  config: GroupingConfig = TEXT_GROUPING_CONFIG,
): TextGroupingResult {
  const clusters: DetectedText[][] = [];
  const ordered = [...regions].sort((a, b) => centerY(a) - centerY(b) || a.x - b.x);
  for (const region of ordered) {
    const choices = clusters.map((lines, index) => ({ index, decision: canAddRegionToBlock(region, lines, image, config) }))
      .filter(choice => choice.decision.accepted)
      .sort((a, b) => b.decision.score - a.decision.score);
    if (choices.length) clusters[choices[0].index].push(region);
    else clusters.push([region]);
  }

  const drafts = clusters.flatMap(lines => splitTextRegionsAtLargeGaps(lines, config))
    .map(lines => createTextBlock(lines, '', config))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const blocks: TextBlock[] = [];
  const rejected: RejectedTextBlock[] = [];
  for (const draft of drafts) {
    const validation = isValidTextBlock(draft, image, config);
    if (validation.valid) {
      draft.id = `${imageId}-block-${blocks.length + 1}`;
      blocks.push(draft);
    } else {
      draft.id = `${imageId}-rejected-${rejected.length + 1}`;
      rejected.push({ block: draft, reason: validation.reason, metrics: validation.metrics });
    }
  }
  return { blocks, rejected };
}

export function groupTextRegions(
  regions: readonly DetectedText[],
  imageId = 'image',
  image?: ImageDimensions,
  config: GroupingConfig = TEXT_GROUPING_CONFIG,
): TextBlock[] {
  return groupTextRegionsDetailed(regions, imageId, image, config).blocks;
}
