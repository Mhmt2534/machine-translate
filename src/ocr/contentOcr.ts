import { createOcrOverlay } from './overlay';
import { MAX_OCR_IMAGES, MAX_IMAGE_PIXELS, type OcrStatus } from './types';
import { acquireAndRecognize } from '../image/contentAcquisition';
import { checkInterrupted, startScrollSession, waitForStableImage } from '../image/autoScroll';
import { OCR_FILTER_CONFIG } from './config';
import { filterTextRegions } from './textFiltering';
import { groupTextRegionsDetailed } from './textGrouping';
import { validateTextBlocks } from './textBlockValidation';
import { mergeTextBlocksDetailed } from './textBlockMerge';
import { validateFinalTextBlocks } from './textSanity';
import { installTranslation } from '../translation/contentTranslation';
import type { TranslationImageInput } from '../translation/types';

export function installOcr(getCandidates: () => HTMLImageElement[]) {
  let status: OcrStatus = { running: false, message: `Ready — first ${MAX_OCR_IMAGES} candidates; automatic scroll`,
    regions: 0, filteredRegions: 0, initialTextBlocks: 0, textBlocks: 0, errors: [] };
  let overlay: ReturnType<typeof createOcrOverlay> | undefined;
  const translation = installTranslation(results => overlay?.setTranslations(results));

  async function run() {
    overlay?.clear();
    overlay = createOcrOverlay();
    translation.setInput([]);
    const images = getCandidates().slice(0, MAX_OCR_IMAGES);
    const session = startScrollSession(images);
    let processed = 0;
    const translationImages: TranslationImageInput[] = [];
    const failedAcquisitions = new Set<string>();
    status = { running: true, message: 'OCR processing — page will scroll automatically.',
      regions: 0, filteredRegions: 0, initialTextBlocks: 0, textBlocks: 0, errors: [] };
    try {
      for (const [index, img] of images.entries()) {
        if (session.signal.aborted) break;
        status.message = `Processing image ${index + 1} / ${images.length}\nOCR processing — page will scroll automatically.`;
        try {
          if (!img.complete || !img.naturalWidth) await session.scrollToImageOffset(img, 0);
          await waitForStableImage(img, session.signal);
          const source = img.currentSrc || img.src;
          const naturalWidth = img.naturalWidth;
          const naturalHeight = img.naturalHeight;
          const scrollContexts = session.contextsFor(img);
          const primaryContext = scrollContexts.find(context => context.mode === 'container') ?? scrollContexts.at(-1)!;
          console.log('[Webtoon Translator] Scroll context', {
            candidate: `${index + 1} / ${images.length}`,
            scrollContainer: primaryContext.label,
            isWindowScroll: primaryContext.mode === 'window',
            scrollTop: primaryContext.scrollTop,
            scrollHeight: primaryContext.scrollHeight,
            clientHeight: primaryContext.clientHeight,
            ancestors: scrollContexts.map(context => ({ mode: context.mode, container: context.label,
              scrollTop: context.scrollTop, scrollHeight: context.scrollHeight, clientHeight: context.clientHeight })),
          });
          console.log('[Webtoon Translator] Processing candidate', {
            imageIndex: `${index + 1} / ${images.length}`,
            renderedRect: img.getBoundingClientRect().toJSON(), naturalWidth, naturalHeight,
            scrollMode: primaryContext.mode, scrollContainer: primaryContext.label, segments: 'pending',
          });
          if (naturalWidth * naturalHeight > MAX_IMAGE_PIXELS) throw new Error('Görsel 32 megapiksel sınırını aşıyor.');
          const response = await acquireAndRecognize(img, failedAcquisitions, {
            signal: session.signal, scroll: session, imageIndex: index + 1,
            onCapture(segment, total) {
              status.message = `Processing image ${index + 1} / ${images.length}\nCapture ${segment} / ${total}\nOCR processing — page will scroll automatically.`;
              console.log('[Webtoon Translator] Viewport capture', { image: index + 1, segment: `${segment} / ${total}` });
            },
          });
          checkInterrupted(session.signal);
          if (response?.error) throw new Error(response.error);
          if (!response?.regions || !response.width || !response.height) throw new Error('Geçersiz OCR yanıtı.');
          if (!img.isConnected || source !== (img.currentSrc || img.src) || naturalWidth !== img.naturalWidth || naturalHeight !== img.naturalHeight) {
            throw new Error('OCR sırasında görsel değişti veya kaldırıldı; tekrar tarayın.');
          }
          const regions = response.regions;
          for (const region of regions) console.log('[Webtoon Translator] OCR text', region);
          const imageDimensions = { width: naturalWidth, height: naturalHeight };
          const filtered = filterTextRegions(regions, imageDimensions);
          if (OCR_FILTER_CONFIG.debug) {
            for (const rejected of filtered.rejected) {
              console.debug('[Webtoon Translator] OCR region filtered', rejected);
            }
          }
          const grouping = groupTextRegionsDetailed(filtered.regions, `image-${index + 1}`, imageDimensions);
          const validation = validateTextBlocks(grouping.blocks, imageDimensions);
          const merge = mergeTextBlocksDetailed(validation.blocks, naturalWidth, naturalHeight);
          for (const record of merge.merges) console.debug('[Webtoon Translator] Final blocks merged', record);
          const finalValidation = validateFinalTextBlocks(merge.blocks);
          const blocks = finalValidation.blocks;
          for (const block of blocks) {
            console.log('[Webtoon Translator] Text block', {
              id: block.id, text: block.text, confidence: Math.round(block.confidence * 10) / 10,
              qualityScore: Math.round((block.qualityScore ?? 0) * 1000) / 1000,
              x: block.x, y: block.y, width: block.width, height: block.height, lineCount: block.lines.length,
              widthRatio: block.width / naturalWidth, heightRatio: block.height / naturalHeight,
            });
          }
          for (const rejected of grouping.rejected) {
            console.debug('[Webtoon Translator] Text block rejected', {
              id: rejected.block.id, text: rejected.block.text, lineCount: rejected.block.lines.length,
              reason: rejected.reason, ...rejected.metrics,
            });
          }
          for (const rejected of validation.rejected) {
            console.debug('[Webtoon Translator] Text block rejected', {
              id: rejected.block.id, text: rejected.block.text, lineCount: rejected.block.lines.length,
              confidence: Math.round(rejected.block.confidence * 10) / 10,
              reason: rejected.reason, ...rejected.details,
            });
          }
          for (const rejected of finalValidation.rejected) {
            console.debug('[Webtoon Translator] Final block rejected', {
              id: rejected.block.id, text: rejected.block.text,
              confidence: Math.round(rejected.block.confidence * 10) / 10,
              qualityScore: Math.round(rejected.sanity.qualityScore * 1000) / 1000,
              reason: rejected.sanity.reason,
            });
          }
          console.log('[Webtoon Translator] Text grouping complete', {
            image: index + 1, rawRegions: regions.length, filteredRegions: filtered.regions.length,
            initialTextBlocks: grouping.blocks.length, finalTextBlocks: blocks.length,
            rejectedTextBlocks: grouping.rejected.length + validation.rejected.length + finalValidation.rejected.length,
          });
          console.log('[Webtoon Translator] OCR completed for image', { src: source, method: response.method,
            image: index + 1, regions: regions.length, naturalWidth, naturalHeight, segments: response.segments || 1 });
          overlay.add(img, source, filtered.regions, blocks,
            OCR_FILTER_CONFIG.debug ? filtered.rejected.map(item => item.region) : [],
            OCR_FILTER_CONFIG.debug ? [...grouping.rejected.map(item => item.block), ...validation.rejected.map(item => item.block),
              ...finalValidation.rejected.map(item => item.block)] : []);
          status.regions += regions.length;
          status.filteredRegions += filtered.regions.length;
          status.initialTextBlocks += grouping.blocks.length;
          status.textBlocks += blocks.length;
          translationImages.push({ imageId: `image-${index + 1}`, blocks });
          processed++;
        } catch (error) {
          const detail = `Image ${index + 1}: ${error instanceof Error ? error.message : String(error)}`;
          status.errors.push(detail);
          console.error('[Webtoon Translator] OCR image failed', { image: index + 1, src: img.currentSrc || img.src, reason: detail });
        }
      }
    } finally {
      await session.restore();
      status.running = false;
      status.message = `${session.signal.aborted ? 'OCR interrupted' : status.errors.length ? 'OCR finished with errors' : 'OCR complete'}\nImages processed: ${processed} / ${images.length}\nErrors: ${status.errors.length}\nOCR regions: ${status.regions}\nFiltered regions: ${status.filteredRegions}\nInitial text blocks: ${status.initialTextBlocks}\nFinal text blocks: ${status.textBlocks}`;
      translation.setInput(session.signal.aborted ? [] : translationImages);
      if (!images.length) status.message += '\nNo candidate images. Önce Scan Images çalıştırın.';
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'GET_OCR_STATUS') sendResponse(status);
    if (message?.type === 'START_OCR') {
      if (!status.running) void run().catch((error: unknown) => {
        status.running = false;
        status.message = `OCR failed: ${String(error)}`;
      });
      sendResponse(status);
    }
  });
}
