import { MAX_IMAGE_BYTES, type OcrResult } from '../ocr/types';
import { readImageResponse } from './imageAcquisition';
import { getCaptureGeometry } from './captureGeometry';
import { acquisitionLog, type ImageRequest, type AcquisitionLog, type AcquisitionMethod } from './types';
import { VIEWPORT_CAPTURE_CONFIG as config } from '../ocr/config';
import { deduplicateRegions } from '../ocr/deduplicate';
import { checkInterrupted, type ScrollSession } from './autoScroll';

export interface ImageOcrResponse extends OcrResult {
  method: AcquisitionMethod;
  logs: AcquisitionLog[];
  error?: string;
  stage?: 'acquisition' | 'ocr';
  segments?: number;
}
function printLogs(logs: AcquisitionLog[] = []) {
  for (const log of logs) console.log(`[Webtoon Translator] ${log.outcome === 'acquired' ? 'Image acquired' : 'Image acquisition failed'}`, log);
}
async function dataUrl(blob: Blob): Promise<string> {
  if (blob.size > MAX_IMAGE_BYTES) throw new Error('Görsel aktarım sınırı: 20 MB.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Görsel okunamadı.'));
    reader.readAsDataURL(blob);
  });
}

let captureLease: { token: string; valid: () => boolean; restore: () => void } | undefined;
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'VALIDATE_CAPTURE') return;
  const valid = captureLease !== undefined && captureLease.token === message.token && captureLease.valid();
  captureLease?.restore();
  sendResponse({ valid: Boolean(valid) });
});

export async function acquireAndRecognize(img: HTMLImageElement, failed: Set<string>, options: {
  signal: AbortSignal; scroll: ScrollSession; imageIndex: number;
  onCapture: (segment: number, total: number) => void;
}): Promise<ImageOcrResponse> {
  const base: ImageRequest = { method: 'loaded-image', source: img.currentSrc || img.src, pageUrl: location.href,
    naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
    credentials: img.crossOrigin === 'anonymous' ? 'same-origin' : 'include' };
  const send = async (request: ImageRequest) => {
    checkInterrupted(options.signal);
    const response: ImageOcrResponse = await chrome.runtime.sendMessage({ type: 'OCR_IMAGE', request });
    if (!response) throw new Error('Eklenti edinme yanıtı yok.');
    printLogs(response.logs);
    checkInterrupted(options.signal);
    if (response.error && response.stage !== 'acquisition') throw new Error(response.error);
    return response;
  };
  // Try the existing decoded pixels without another image request.
  let pixels: string | undefined;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Canvas verisi boş.')), 'image/png'));
    pixels = await dataUrl(blob);
  } catch (error) { printLogs([acquisitionLog(base, 'failed', String(error))]); }
  if (pixels) {
    const response = await send({ ...base, dataUrl: pixels });
    if (!response.error) return response;
  }
  for (const method of ['extension-fetch', 'page-fetch'] as const) {
    const key = `${method}:${base.source}`;
    if (failed.has(key) || !/^https?:/.test(base.source)) continue;
    const request = { ...base, method };
    if (method === 'extension-fetch') {
      const response = await send(request);
      if (!response.error) return response;
    } else {
      // In the page-origin content script the browser sends the page referrer;
      // CORS still applies (including opaque/blocked response restrictions).
      let pagePixels: string | undefined;
      const log = acquisitionLog(request, 'failed');
      try {
        const response = await fetch(base.source, { credentials: base.credentials, referrer: location.href,
          referrerPolicy: (img.referrerPolicy || 'strict-origin-when-cross-origin') as ReferrerPolicy,
          cache: 'force-cache', signal: AbortSignal.timeout(15000) });
        Object.assign(log, { status: response.status, statusText: response.statusText, redirected: response.redirected,
          responseUrl: response.url, detail: `page context; credentials=${base.credentials}; cache=force-cache` });
        pagePixels = await dataUrl(await readImageResponse(response));
      } catch (error) { log.detail = `${log.detail || ''} ${String(error)}`; printLogs([log]); }
      if (pagePixels) {
        const response = await send({ ...request, dataUrl: pagePixels });
        if (!response.error) return response;
      }
    }
    failed.add(key);
  }
  let covered = 0, target = 0;
  const regions: OcrResult['regions'] = [];
  for (let segment = 1; segment <= config.maxSegmentsPerImage; segment++) {
    let scrollContexts;
    try {
      scrollContexts = await options.scroll.scrollToImageOffset(img, target);
    } catch (error) {
      console.warn('[Webtoon Translator] Candidate scroll failed', {
        image: options.imageIndex, segment, targetNaturalY: target,
        reason: error instanceof Error ? error.message : String(error),
      });
      checkInterrupted(options.signal);
      scrollContexts = options.scroll.contextsFor(img);
    }
    if (base.source !== (img.currentSrc || img.src) || base.naturalWidth !== img.naturalWidth || base.naturalHeight !== img.naturalHeight) {
      throw new Error('Segmentler arasında candidate kaynağı/boyutları değişti.');
    }
    const { response, geometry } = await captureOne(img, base, send, geometry => {
      const visibleHeight = geometry.crop.height / geometry.rendered.height * base.naturalHeight;
      const end = (geometry.crop.y + geometry.crop.height - geometry.rendered.y) / geometry.rendered.height * base.naturalHeight;
      const total = segment + Math.ceil(Math.max(0, base.naturalHeight - end - 1) / (visibleHeight * (1 - config.overlapRatio)));
      options.onCapture(segment, total);
    });
    const tolerance = 2 * base.naturalHeight / geometry.rendered.height;
    const start = (geometry.crop.y - geometry.rendered.y) / geometry.rendered.height * base.naturalHeight;
    const end = (geometry.crop.y + geometry.crop.height - geometry.rendered.y) / geometry.rendered.height * base.naturalHeight;
    console.log('[Webtoon Translator] Processing segment', {
      imageIndex: options.imageIndex, segmentIndex: segment, targetScroll: target,
      actualScroll: scrollContexts.map(context => ({ mode: context.mode, container: context.label,
        scrollTop: context.scrollTop, scrollLeft: context.scrollLeft })),
      candidateRect: geometry.rendered, visibleRect: geometry.crop,
    });
    if (Math.abs(geometry.crop.x - geometry.rendered.x) > 2 || geometry.crop.width < geometry.rendered.width - 2) {
      throw new Error('Candidate yatay olarak kırpılıyor. Sayfa zoom’unu küçültün; yatay segmentleme desteklenmiyor.');
    }
    if (start > covered + tolerance || end <= covered + 1) throw new Error('Otomatik scroll candidate’ın tamamına ulaşamadı; iç scroll/kırpma kontrol edilmeli.');
    regions.push(...response.regions);
    covered = end;
    if (covered >= base.naturalHeight - tolerance) {
      return { ...response, regions: deduplicateRegions(regions), segments: segment };
    }
    target = end - (end - start) * config.overlapRatio;
  }
  throw new Error(`Candidate ${config.maxSegmentsPerImage} capture sınırını aşıyor.`);
}

async function captureOne(img: HTMLImageElement, base: ImageRequest,
  send: (request: ImageRequest) => Promise<ImageOcrResponse>,
  onCapture: (geometry: NonNullable<ImageRequest['capture']>) => void) {
  const request: ImageRequest = { ...base, method: 'viewport-capture' };
  const bounds = img.getBoundingClientRect();
  const obstructing = [...document.querySelectorAll<HTMLElement>('body *')].filter(node => {
    if (node.contains(img) || node === img) return false;
    const style = getComputedStyle(node);
    if (!['fixed', 'sticky'].includes(style.position) || style.visibility === 'hidden') return false;
    const r = node.getBoundingClientRect();
    return r.bottom > Math.max(0, bounds.top) && r.top < Math.min(innerHeight, bounds.bottom) && r.right > bounds.left && r.left < bounds.right;
  });
  const hidden = [...new Set([...document.querySelectorAll<HTMLElement>('[data-wt-ocr-overlay], [data-wt-candidate-overlay]'), ...obstructing])].map(node => {
    const value = node.style.getPropertyValue('visibility'), priority = node.style.getPropertyPriority('visibility');
    node.style.setProperty('visibility', 'hidden', 'important');
    return () => { if (value) node.style.setProperty('visibility', value, priority); else node.style.removeProperty('visibility'); };
  });
  const restore = () => hidden.forEach(fn => fn());
  try {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    request.capture = getCaptureGeometry(img);
    onCapture(request.capture);
    const snapshot = JSON.stringify(request.capture);
    request.captureToken = crypto.randomUUID();
    captureLease = { token: request.captureToken, restore, valid: () => {
      try { return base.source === (img.currentSrc || img.src) && JSON.stringify(getCaptureGeometry(img)) === snapshot; }
      catch { return false; }
    } };
    const response = await send(request);
    if (response.error) throw new Error(response.error);
    return { response, geometry: request.capture };
  } catch (error) {
    printLogs([acquisitionLog(request, 'failed', String(error))]);
    throw error;
  } finally { restore(); captureLease = undefined; }
}
