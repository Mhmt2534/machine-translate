export const MAX_OCR_IMAGES = 3;

// Boyut eşikleri, farklı çözünürlüklerde aynı davranmak için medyan OCR satır
// yüksekliğine oranlanır. Düşük eşikler kısa webtoon ünlemlerini korur.
export const OCR_FILTER_CONFIG = {
  minConfidence: 12,
  minWidthToMedianLineHeight: 0.12,
  minHeightToMedianLineHeight: 0.18,
  minAlphaNumericRatio: 0.3,
  lowConfidenceGeometryGate: 38,
  maxShortTextAspectRatio: 10,
  maxRegionAreaPerCharacterRatio: 14,
  maxShortTextImageAreaRatio: 0.025,
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
  maxAverageCenterDistanceRatio: 0.78,
  maxCenterSpreadRatio: 0.9,
  maxVerticalGapDifferenceRatio: 1.0,
  maxBlockWidthToMedianLineWidth: 2.6,
  maxBlockHeightToMedianLineHeight: 14,
  maxBlockWidthRatio: 0.72,
  maxBlockHeightRatio: 0.35,
  maxBlockAreaRatio: 0.12,
  maxBlockAreaPerCharacterRatio: 12,
  splitVerticalGapRatio: 1.55,
  confidenceOutlierClamp: 25,
  minHyphenFragmentLetters: 3,
} as const;

export const TEXT_BLOCK_VALIDATION_CONFIG = {
  singleCharacterHighConfidence: 82,
  independentWordConfidence: 45,
  shortTextNearbyConfidence: 48,
  shortTextIsolatedConfidence: 78,
  mediumTextConfidence: 28,
  shortTextMaxAlphaNumericCharacters: 3,
  mediumTextMaxAlphaNumericCharacters: 6,
  minAlphaNumericRatio: 0.55,
  minShortAlphaNumericRatio: 0.65,
  shortLowercaseConfidence: 60,
  shortChildConfidenceAllowance: 20,
  nearbyVerticalGapRatio: 2.8,
  nearbyCenterDistanceRatio: 0.65,
} as const;

export const TEXT_BLOCK_MERGE_CONFIG = {
  maxVerticalGapRatio: 2.6,
  minHorizontalOverlapRatio: 0.18,
  maxCenterDistanceRatio: 0.58,
  minWidthSimilarityRatio: 0.22,
  maxLineHeightDifferenceRatio: 0.55,
  maxCenterSpreadRatio: 1.0,
  maxVerticalGapDifferenceRatio: 1.35,
  maxBlockWidthRatio: 0.72,
  maxBlockHeightRatio: 0.35,
  maxBlockAreaRatio: 0.12,
  competingScoreMargin: 0.18,
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
