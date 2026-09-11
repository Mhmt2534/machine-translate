import type { ImageRequest } from './image/types';
import { postTranslationBatch } from './translation/httpClient';

let creating: Promise<void> | undefined;
let processing = false;
let lastCapture = 0;

async function captureCandidate(request: ImageRequest, sender: chrome.runtime.MessageSender): Promise<string> {
  const tabId = sender.tab!.id!;
  const tab = await chrome.tabs.get(tabId);
  if (!tab.active || tab.url !== sender.url) throw new Error('Ekran yakalama için webtoon sekmesini aktif tutun.');
  const geometry = request.capture;
  if (!geometry || !request.captureToken || ![geometry.crop.x, geometry.crop.y, geometry.crop.width, geometry.crop.height,
    geometry.viewportWidth, geometry.viewportHeight, geometry.rendered.width, geometry.rendered.height].every(Number.isFinite) ||
    geometry.crop.x < 0 || geometry.crop.y < 0 || geometry.crop.width <= 0 || geometry.crop.height <= 0 ||
    geometry.crop.x + geometry.crop.width > geometry.viewportWidth || geometry.crop.y + geometry.crop.height > geometry.viewportHeight) {
    throw new Error('Geçersiz candidate kırpma isteği.');
  }
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 600 - (Date.now() - lastCapture))));
  const activeBefore = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
  if (activeBefore?.id !== tabId) throw new Error('Aktif sekme değişti; görüntü alınmadı.');
  lastCapture = Date.now();
  let screenshot: string;
  try { screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
  catch (error) {
    throw new Error(`viewport-capture: Eklentiyi webtoon sekmesindeyken araç çubuğundaki simgesinden açıp tekrar deneyin. ${String(error)}`);
  }
  const activeAfter = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
  if (activeAfter?.id !== tabId || activeAfter.url !== sender.url) throw new Error('Yakalama sırasında sekme değişti; görüntü atıldı.');
  const check = await chrome.tabs.sendMessage(tabId, { type: 'VALIDATE_CAPTURE', token: request.captureToken },
    sender.documentId ? { documentId: sender.documentId } : { frameId: 0 });
  if (!check?.valid) throw new Error('Yakalama sırasında sayfa kaydı/boyutu değişti; tekrar deneyin.');
  return screenshot;
}

async function ensureOffscreen(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length) return;
  creating ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
    justification: 'Yerel Tesseract Web Worker ile görsel Blob üzerinde İngilizce OCR çalıştırmak.',
  }).finally(() => { creating = undefined; });
  await creating;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'OCR_HEARTBEAT' && sender.id === chrome.runtime.id && !sender.tab) {
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === 'TRANSLATE_BATCH' && sender.id === chrome.runtime.id && sender.tab && sender.frameId === 0) {
    void postTranslationBatch(message.request).then(sendResponse, (error: unknown) => {
      sendResponse({ error: error instanceof Error ? error.message : 'Translation request failed.' });
    });
    return true;
  }
  if (message?.type !== 'OCR_IMAGE' || sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return;
  if (processing) {
    sendResponse({ error: 'Başka sekmede OCR çalışıyor. Bitince tekrar deneyin.' });
    return;
  }
  processing = true;
  void (async () => {
    try {
      const request: ImageRequest = { ...message.request, pageUrl: sender.url || message.request?.pageUrl };
      if (!['loaded-image', 'extension-fetch', 'page-fetch', 'viewport-capture'].includes(request.method) ||
        !Number.isFinite(request.naturalWidth) || !Number.isFinite(request.naturalHeight) || request.naturalWidth <= 0 || request.naturalHeight <= 0) {
        throw new Error('Geçersiz görsel edinme isteği.');
      }
      if (request.method === 'viewport-capture') request.dataUrl = await captureCandidate(request, sender);
      await ensureOffscreen();
      return await chrome.runtime.sendMessage({ target: 'offscreen', type: 'RECOGNIZE', request });
    } finally {
      // Belgeyi kapatmak başarısız worker başlangıçlarında da kaynakları bırakır.
      await chrome.offscreen.closeDocument().catch(() => {});
      processing = false;
    }
  })().then(sendResponse, (error: unknown) => sendResponse({ error: String(error) }));
  return true;
});
