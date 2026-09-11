export const MAX_OCR_IMAGES = 3;

// Boyut eşikleri, farklı çözünürlüklerde aynı davranmak için medyan OCR satır
// yüksekliğine oranlanır. Düşük eşikler kısa webtoon ünlemlerini korur.
export const OCR_FILTER_CONFIG = {
  minConfidence: 12,
  minWidthToMedianLineHeight: 0.12,
  minHeightToMedianLineHeight: 0.18,
  debug: false,
} as const;

// Gruplama eşikleri iki kutunun ortalama satır yüksekliğine/genişliğine göre
// normalize edilir; böylece görsel çözünürlüğüne bağlı sabit piksel yoktur.
export const TEXT_GROUPING_CONFIG = {
  maxVerticalGapRatio: 1.8,
  minHorizontalOverlapRatio: 0.24,
  maxHorizontalCenterDistanceRatio: 0.42,
  maxLineHeightDifferenceRatio: 0.65,
  minSameRowVerticalOverlapRatio: 0.55,
  maxSameRowGapRatio: 0.35,
  sameRowCenterToleranceRatio: 0.5,
  minHyphenFragmentLetters: 3,
} as const;
export const VIEWPORT_CAPTURE_CONFIG = {
  overlapRatio: 0.12,
  maxSegmentsPerImage: 40,
  stableForMs: 120,
  layoutTimeoutMs: 8000,
  textSimilarity: 0.78,
  overlapOfSmallerBox: 0.55,
  centerDistanceX: 0.5,
  centerDistanceY: 0.65,
};
