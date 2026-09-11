import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import { MAX_IMAGE_PIXELS, type OcrResult } from './types';

export async function recognizeImage(blob: Blob): Promise<OcrResult> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  bitmap.close();
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('Görsel çok büyük: en fazla 32 megapiksel destekleniyor.');

  let worker: Worker | undefined;
  let expired = false;
  let timer = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = window.setTimeout(() => {
      expired = true;
      reject(new Error('OCR zaman aşımı (120 saniye).'));
    }, 120000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      worker = await createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: chrome.runtime.getURL('vendor/worker.min.js'),
        corePath: chrome.runtime.getURL('vendor'),
        langPath: chrome.runtime.getURL('vendor/lang'),
        workerBlobURL: false,
        cacheMethod: 'none',
      });
      if (expired) { await worker.terminate(); throw new Error('OCR zaman aşımı.'); }
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
      const { data } = await worker.recognize(blob, {}, { blocks: true, text: true });
      const regions = (data.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph =>
        paragraph.lines.filter(line => line.text.trim()).map(line => ({
          text: line.text.trim(), confidence: line.confidence,
          x: line.bbox.x0, y: line.bbox.y0,
          width: line.bbox.x1 - line.bbox.x0, height: line.bbox.y1 - line.bbox.y0,
        })),
      ));
      return { regions, width, height };
    })()]);
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
  }
}

