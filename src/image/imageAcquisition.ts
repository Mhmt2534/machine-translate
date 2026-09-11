import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from '../ocr/types';
import { acquisitionLog, type AcquiredImage, type ImageRequest, type AcquisitionLog } from './types';
import { mapCapture } from './captureMapping';

export class AcquisitionError extends Error {
  constructor(message: string, public logs: AcquisitionLog[]) { super(message); }
}

export async function readImageResponse(response: Response): Promise<Blob> {
  if (!response.ok) throw new Error(`Image fetch failed: HTTP ${response.status} ${response.statusText}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Görsel yanıtı boş.');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new Error('Görsel aktarım sınırı: 20 MB.');
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
  } finally { await reader.cancel(); }
  return new Blob(chunks, { type: response.headers.get('content-type') || 'application/octet-stream' });
}

export async function acquireImage(request: ImageRequest): Promise<AcquiredImage> {
  const log = acquisitionLog(request, 'failed');
  try {
    let blob: Blob;
    let naturalRect = { x: 0, y: 0, width: request.naturalWidth, height: request.naturalHeight };
    if (request.method === 'extension-fetch') {
      if (!/^https?:\/\//i.test(request.source)) throw new Error('Extension fetch yalnızca HTTP(S) destekler.');
      // MV3 test: page-origin referrer was normalized to about:client and
      // no Referer was sent. Use page-fetch for a real page referrer instead.
      const response = await fetch(request.source, {
        credentials: request.credentials, cache: 'force-cache', redirect: 'follow', signal: AbortSignal.timeout(15000),
      });
      Object.assign(log, { status: response.status, statusText: response.statusText,
        redirected: response.redirected, responseUrl: response.url,
        detail: `credentials=${request.credentials}; cache=force-cache; referrer=extension client`,
      });
      blob = await readImageResponse(response);
    } else {
      if (!request.dataUrl?.startsWith('data:image/') || request.dataUrl.length > MAX_IMAGE_BYTES * 1.4) {
        throw new Error('Görsel verisi geçersiz veya 20 MB sınırını aşıyor.');
      }
      blob = await readImageResponse(await fetch(request.dataUrl));
    }
    const bitmap = await createImageBitmap(blob);
    try {
      if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error('Görsel 32 megapiksel sınırını aşıyor.');
      if (request.method === 'viewport-capture') {
        const geometry = request.capture;
        if (!geometry) throw new Error('Ekran kırpma geometrisi eksik.');
        const { viewportWidth, viewportHeight } = geometry;
        // Screenshot dimensions already include device scale AND browser zoom.
        // Do not multiply by devicePixelRatio again.
        const mapped = mapCapture(bitmap.width, bitmap.height, geometry, request.naturalWidth, request.naturalHeight);
        const { x, y, width, height } = mapped.pixels;
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext('2d')!.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
        blob = await canvas.convertToBlob({ type: 'image/png' });
        naturalRect = mapped.natural;
        log.detail = `Visible crop only; screenshot=${bitmap.width}x${bitmap.height}; viewport=${viewportWidth}x${viewportHeight}; dpr=${geometry.dpr}`;
      } else if (Math.abs(bitmap.width / bitmap.height / (request.naturalWidth / request.naturalHeight) - 1) > 0.02) {
        throw new Error('Görselin en-boy oranı değişti; koordinatlar uygulanmadı.');
      }
    } finally { bitmap.close(); }
    log.outcome = 'acquired';
    return { blob, method: request.method, naturalRect, logs: [log] };
  } catch (error) {
    log.detail = `${log.detail || ''} ${error instanceof Error ? error.message : String(error)}`.trim();
    throw new AcquisitionError(`${request.method}: ${log.detail}`, [log]);
  }
}
