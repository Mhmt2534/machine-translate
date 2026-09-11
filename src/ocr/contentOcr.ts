import { createOcrOverlay } from './overlay';
import { MAX_OCR_IMAGES, MAX_IMAGE_PIXELS, type OcrStatus } from './types';
import { acquireAndRecognize } from '../image/contentAcquisition';
import { checkInterrupted, startScrollSession, waitForStableImage } from '../image/autoScroll';

export function installOcr(getCandidates: () => HTMLImageElement[]) {
  let status: OcrStatus = { running: false, message: `Ready — first ${MAX_OCR_IMAGES} candidates; automatic scroll`, regions: 0, errors: [] };
  let overlay: ReturnType<typeof createOcrOverlay> | undefined;

  async function run() {
    overlay?.clear();
    overlay = createOcrOverlay();
    const images = getCandidates().slice(0, MAX_OCR_IMAGES);
    const session = startScrollSession(images);
    let processed = 0;
    const failedAcquisitions = new Set<string>();
    status = { running: true, message: 'OCR processing — page will scroll automatically.', regions: 0, errors: [] };
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
          console.log('[Webtoon Translator] OCR completed for image', { src: source, method: response.method,
            image: index + 1, regions: regions.length, naturalWidth, naturalHeight, segments: response.segments || 1 });
          overlay.add(img, source, regions);
          status.regions += regions.length;
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
      status.message = `${session.signal.aborted ? 'OCR interrupted' : status.errors.length ? 'OCR finished with errors' : 'OCR complete'}\nImages processed: ${processed} / ${images.length}\nErrors: ${status.errors.length}\nText regions: ${status.regions}`;
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
