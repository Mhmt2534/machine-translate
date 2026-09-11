import { recognizeImage } from './ocr/ocrService';
import { acquireImage, AcquisitionError } from './image/imageAcquisition';

let busy = false;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || message.type !== 'RECOGNIZE' || sender.id !== chrome.runtime.id || sender.tab) return;
  if (busy) {
    sendResponse({ error: 'Başka bir OCR görseli işleniyor. Bitince tekrar deneyin.' });
    return;
  }
  busy = true;
  // Uzun OCR sırasında MV3 service worker'ın boşta kapanmasını önler.
  const heartbeat = window.setInterval(() => {
    void chrome.runtime.sendMessage({ type: 'OCR_HEARTBEAT' }).catch(() => {});
  }, 20000);
  void (async () => {
    const acquired = await acquireImage(message.request);
    try {
      const result = await recognizeImage(acquired.blob);
      const rect = acquired.naturalRect;
      return { ...result, method: acquired.method, logs: acquired.logs, regions: result.regions.map(region => ({ ...region,
        x: rect.x + region.x / result.width * rect.width, y: rect.y + region.y / result.height * rect.height,
        width: region.width / result.width * rect.width, height: region.height / result.height * rect.height,
      })) };
    } catch (error) {
      return { error: String(error), stage: 'ocr', logs: acquired.logs };
    }
  })().then(sendResponse, (error: unknown) => {
    sendResponse({ error: error instanceof Error ? error.message : String(error), stage: 'acquisition',
      logs: error instanceof AcquisitionError ? error.logs : [] });
  }).finally(() => { clearInterval(heartbeat); busy = false; });
  return true;
});
