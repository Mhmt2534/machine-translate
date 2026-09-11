import type { DetectedText } from './types';
import { VIEWPORT_CAPTURE_CONFIG as config } from './config';

function similarity(first: string, second: string): number {
  const a = first.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  const b = second.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!a.length || !b.length) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(a[i - 1] !== b[j - 1]));
    previous = current;
  }
  return 1 - previous[b.length] / Math.max(a.length, b.length);
}

export function deduplicateRegions(regions: DetectedText[]): DetectedText[] {
  const kept: DetectedText[] = [];
  for (const candidate of [...regions].sort((a, b) => b.confidence - a.confidence)) {
    const duplicate = kept.some(other => {
      const intersection = Math.max(0, Math.min(candidate.x + candidate.width, other.x + other.width) - Math.max(candidate.x, other.x)) *
        Math.max(0, Math.min(candidate.y + candidate.height, other.y + other.height) - Math.max(candidate.y, other.y));
      const area = Math.min(candidate.width * candidate.height, other.width * other.height);
      return area > 0 && intersection / area >= config.overlapOfSmallerBox &&
        Math.abs(candidate.x + candidate.width / 2 - other.x - other.width / 2) <= Math.max(candidate.width, other.width) * config.centerDistanceX &&
        Math.abs(candidate.y + candidate.height / 2 - other.y - other.height / 2) <= Math.max(candidate.height, other.height) * config.centerDistanceY &&
        similarity(candidate.text, other.text) >= config.textSimilarity;
    });
    if (!duplicate) kept.push(candidate);
  }
  return kept.sort((a, b) => a.y - b.y || a.x - b.x);
}
