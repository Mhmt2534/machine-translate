import { TEXT_GROUPING_CONFIG } from './config';
import type { DetectedText, TextBlock } from './types';

type GroupingConfig = { [Key in keyof typeof TEXT_GROUPING_CONFIG]: number };

const right = (r: DetectedText) => r.x + r.width;
const bottom = (r: DetectedText) => r.y + r.height;
const centerX = (r: DetectedText) => r.x + r.width / 2;
const centerY = (r: DetectedText) => r.y + r.height / 2;
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function shouldJoin(a: DetectedText, b: DetectedText, config: GroupingConfig): boolean {
  const averageHeight = (a.height + b.height) / 2;
  const heightDifference = Math.abs(a.height - b.height) / Math.max(a.height, b.height);
  if (!averageHeight || heightDifference > config.maxLineHeightDifferenceRatio) return false;

  const verticalOverlap = overlap(a.y, bottom(a), b.y, bottom(b)) / Math.min(a.height, b.height);
  const horizontalGap = Math.max(0, Math.max(a.x, b.x) - Math.min(right(a), right(b))) / averageHeight;
  const sameRow = verticalOverlap >= config.minSameRowVerticalOverlapRatio ||
    Math.abs(centerY(a) - centerY(b)) / averageHeight <= config.sameRowCenterToleranceRatio;
  if (sameRow) return horizontalGap <= config.maxSameRowGapRatio;

  const upper = centerY(a) <= centerY(b) ? a : b;
  const lower = upper === a ? b : a;
  const verticalGap = Math.max(0, lower.y - bottom(upper)) / averageHeight;
  if (verticalGap > config.maxVerticalGapRatio) return false;
  const horizontalOverlap = overlap(a.x, right(a), b.x, right(b)) / Math.min(a.width, b.width);
  const centerDistance = Math.abs(centerX(a) - centerX(b)) / Math.max(a.width, b.width);
  return horizontalOverlap >= config.minHorizontalOverlapRatio ||
    centerDistance <= config.maxHorizontalCenterDistanceRatio;
}

function orderedRows(lines: DetectedText[], config: GroupingConfig): DetectedText[][] {
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
      const safeHyphenJoin = newRow && new RegExp(`\\p{Lu}{${config.minHyphenFragmentLetters},}-$`, 'u').test(output) &&
        new RegExp(`^\\p{Lu}{${config.minHyphenFragmentLetters},}$`, 'u').test(text);
      if (safeHyphenJoin) output = output.slice(0, -1) + text;
      else if (/^[,.;:!?%)\]}…]+/.test(text)) output += text;
      else output += `${output ? ' ' : ''}${text}`;
    }
  }
  return output.replace(/\s+/g, ' ').trim();
}

/** Aynı görsele ait OCR bölgelerini geometrik olarak gruplar. DOM kullanmaz. */
export function groupTextRegions(
  regions: readonly DetectedText[],
  imageId = 'image',
  config: GroupingConfig = TEXT_GROUPING_CONFIG,
): TextBlock[] {
  if (!regions.length) return [];
  const parent = regions.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const union = (a: number, b: number) => {
    const rootA = find(a); const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  for (let a = 0; a < regions.length; a++) {
    for (let b = a + 1; b < regions.length; b++) {
      if (shouldJoin(regions[a], regions[b], config)) union(a, b);
    }
  }
  const groups = new Map<number, DetectedText[]>();
  regions.forEach((region, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(region);
    groups.set(root, group);
  });

  const drafts = [...groups.values()].map(group => {
    const rows = orderedRows(group, config);
    const lines = rows.flat();
    const x = Math.min(...lines.map(line => line.x));
    const y = Math.min(...lines.map(line => line.y));
    const maxX = Math.max(...lines.map(right));
    const maxY = Math.max(...lines.map(bottom));
    const weights = lines.map(line => Math.max(1, (line.text.match(/[\p{L}\p{N}]/gu) ?? []).length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const confidence = lines.reduce((sum, line, index) => sum + line.confidence * weights[index], 0) / totalWeight;
    return { text: joinText(rows, config), x, y, width: maxX - x, height: maxY - y, confidence, lines };
  }).sort((a, b) => a.y - b.y || a.x - b.x);

  return drafts.map((block, index) => ({ id: `${imageId}-block-${index + 1}`, ...block }));
}
