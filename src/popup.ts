import type { OcrStatus } from './ocr/types';

(() => {
  const button = document.querySelector<HTMLButtonElement>('#scan-images');
  const result = document.querySelector<HTMLParagraphElement>('#scan-result');
  if (!button || !result) return;

  button.addEventListener('click', async () => {
    button.disabled = true;
    result.textContent = 'Scanning images…';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('Aktif sekme bulunamadı.');
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_IMAGES' }, { frameId: 0 });
      if (response?.error || typeof response?.candidateCount !== 'number') {
        throw new Error(response?.error || 'Geçersiz tarama yanıtı.');
      }
      result.textContent = `Candidate images: ${response.candidateCount}`;
      if (response.pendingCount > 0) {
        result.textContent += ` — ${response.pendingCount} görsel henüz yüklenmedi. Kaydırıp tekrar tarayın.`;
      }
      console.log('[Webtoon Translator] candidate image count:', response.candidateCount);
    } catch (error) {
      console.error('[Webtoon Translator] Tarama yapılamadı:', error);
      result.textContent = 'Tarama yapılamadı. Normal bir web sayfasını yenileyip tekrar deneyin.';
    } finally {
      button.disabled = false;
    }
  });

  const detect = document.querySelector<HTMLButtonElement>('#detect-text');
  const ocrResult = document.querySelector<HTMLParagraphElement>('#ocr-result');
  if (!detect || !ocrResult) return;
  let tabId: number | undefined;
  let polling = false;
  let starting = false;
  let generation = 0;
  const render = (status: OcrStatus) => {
    detect.disabled = status.running;
    ocrResult.textContent = [status.message, ...status.errors].join('\n');
  };
  const poll = async () => {
    if (polling || starting || tabId === undefined) return;
    polling = true;
    const requestGeneration = generation;
    try {
      const status = await chrome.tabs.sendMessage(tabId, { type: 'GET_OCR_STATUS' }, { frameId: 0 });
      if (requestGeneration === generation) render(status);
    } catch {
      if (requestGeneration === generation) {
        ocrResult.textContent = 'OCR bağlantısı yok. Web sayfasını yenileyin.';
        detect.disabled = false;
      }
    } finally { polling = false; }
  };
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    tabId = tab?.id;
    void poll();
  });
  detect.addEventListener('click', async () => {
    if (tabId === undefined) return;
    generation++;
    starting = true;
    detect.disabled = true;
    ocrResult.textContent = 'Starting OCR…';
    try {
      render(await chrome.tabs.sendMessage(tabId, { type: 'START_OCR' }, { frameId: 0 }));
    } catch {
      ocrResult.textContent = 'OCR başlatılamadı. Web sayfasını yenileyin.';
      detect.disabled = false;
    } finally { starting = false; }
  });
  window.setInterval(() => { void poll(); }, 750);
})();
