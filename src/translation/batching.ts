import type { TranslationBatchRequest, TranslationImageInput } from './types';

export const TRANSLATION_BATCH_CONFIG = { maxBlocks: 12, maxCharacters: 5000 } as const;

function readingOrder<T extends { x: number; y: number; width: number; height: number }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const sameRow = Math.abs((a.y + a.height / 2) - (b.y + b.height / 2)) <= Math.min(a.height, b.height) * 0.5;
    return sameRow ? a.x - b.x : a.y - b.y;
  });
}

/** Image sırasını ve her image içindeki okuma sırasını koruyarak bağlam batch'leri oluşturur. */
export function createTranslationBatches(
  images: readonly TranslationImageInput[],
  config: { maxBlocks: number; maxCharacters: number } = TRANSLATION_BATCH_CONFIG,
): TranslationBatchRequest[] {
  const batches: TranslationBatchRequest[] = [];
  for (const image of images) {
    let blocks: TranslationBatchRequest['blocks'] = [];
    let characters = 0;
    const flush = () => {
      if (blocks.length) batches.push({ imageId: image.imageId, blocks });
      blocks = []; characters = 0;
    };
    for (const block of readingOrder(image.blocks)) {
      const text = block.text.replace(/\s+/g, ' ').trim();
      if (blocks.length && (blocks.length >= config.maxBlocks || characters + text.length > config.maxCharacters)) flush();
      blocks.push({ id: block.id, text });
      characters += text.length;
    }
    flush();
  }
  return batches;
}
