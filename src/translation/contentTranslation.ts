import { createTranslationBatches } from './batching';
import { validateTranslationResponse } from './responseValidation';
import type { TranslatedTextBlock, TranslationBatchResponse, TranslationImageInput, TranslationStatus } from './types';

export function installTranslation(onResults: (results: TranslatedTextBlock[]) => void) {
  let input: TranslationImageInput[] = [];
  let generation = 0;
  let status: TranslationStatus = { running: false, ready: false, message: 'Run Detect Text first.',
    blocks: 0, translated: 0, skipped: 0, errors: 0, batches: 0 };

  const setInput = (images: TranslationImageInput[]) => {
    generation++;
    input = images.map(image => ({ imageId: image.imageId, blocks: [...image.blocks] }));
    const blocks = input.reduce((sum, image) => sum + image.blocks.length, 0);
    status = { running: false, ready: blocks > 0,
      message: blocks ? `Ready to translate ${blocks} blocks.` : 'Run Detect Text first.',
      blocks, translated: 0, skipped: 0, errors: 0, batches: 0 };
    onResults([]);
  };

  const run = async () => {
    if (!status.ready || status.running) return;
    const runGeneration = generation;
    const batches = createTranslationBatches(input);
    const sources = new Map(input.flatMap(image => image.blocks.map(block => [block.id, block] as const)));
    const results: TranslatedTextBlock[] = [];
    status = { ...status, running: true, message: `Translating batch 1 / ${batches.length}...`,
      translated: 0, skipped: 0, errors: 0, batches: batches.length };
    let fatalError = '';
    for (const [index, batch] of batches.entries()) {
      if (runGeneration !== generation) return;
      status.message = `Translating batch ${index + 1} / ${batches.length}...`;
      try {
        const raw: TranslationBatchResponse | { error: string } | undefined = await chrome.runtime.sendMessage({ type: 'TRANSLATE_BATCH', request: batch });
        if (!raw || typeof raw !== 'object') throw new Error('Local translation server returned no response.');
        if ('error' in raw) throw new Error(raw.error);
        const response = validateTranslationResponse(batch, raw);
        for (const item of response.translations) {
          const source = sources.get(item.id)!;
          const result: TranslatedTextBlock = {
            id: item.id, originalText: source.text, translatedText: item.translatedText ?? '',
            x: source.x, y: source.y, width: source.width, height: source.height,
            confidence: source.confidence, qualityScore: source.qualityScore,
            skipped: item.skip, skipReason: item.reason, error: item.error,
          };
          results.push(result);
          if (item.error) status.errors++;
          else if (item.skip) status.skipped++;
          else status.translated++;
          console.log('[Webtoon Translator] Translation', {
            id: result.id, original: result.originalText,
            translated: result.translatedText || null, skipped: Boolean(result.skipped), reason: result.skipReason,
          });
        }
      } catch (error) {
        fatalError = error instanceof Error ? error.message : String(error);
        const unprocessed = batches.slice(index).flatMap(item => item.blocks);
        for (const block of unprocessed) {
          const source = sources.get(block.id)!;
          results.push({
            id: block.id, originalText: source.text, translatedText: '',
            x: source.x, y: source.y, width: source.width, height: source.height,
            confidence: source.confidence, qualityScore: source.qualityScore,
            skipped: true, skipReason: 'translation-error', error: fatalError,
          });
          console.error('[Webtoon Translator] Translation error', { id: block.id, error: fatalError });
        }
        status.errors += unprocessed.length;
        break;
      }
    }
    if (runGeneration !== generation) return;
    status.running = false;
    status.message = fatalError ? `Translation failed:\n${fatalError}` :
      `Translation complete\nBlocks: ${status.blocks}\nTranslated: ${status.translated}\nSkipped: ${status.skipped}\nErrors: ${status.errors}`;
    onResults(results);
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_TRANSLATION_STATUS') sendResponse(status);
    if (message?.type === 'START_TRANSLATION') {
      if (!status.ready) status.message = 'Translation unavailable: Run Detect Text first.';
      else if (!status.running) void run().catch((error: unknown) => {
        status.running = false; status.errors++; status.message = `Translation failed:\n${String(error)}`;
      });
      sendResponse(status);
    }
  });
  return { setInput };
}
