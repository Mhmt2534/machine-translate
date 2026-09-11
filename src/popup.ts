import type { OcrStatus } from './ocr/types';
import type { TranslationProviderId, TranslationStatus } from './translation/types';

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
  const translate = document.querySelector<HTMLButtonElement>('#translate-text');
  const engine = document.querySelector<HTMLSelectElement>('#translation-engine');
  const translationResult = document.querySelector<HTMLParagraphElement>('#translation-result');
  if (!detect || !ocrResult || !translate || !engine || !translationResult) return;
  let tabId: number | undefined;
  let polling = false;
  let starting = false;
  let translating = false;
  let generation = 0;
  let latestOcr: OcrStatus | undefined;
  let latestTranslation: TranslationStatus | undefined;
  const updateControls = () => {
    detect.disabled = Boolean(latestOcr?.running || latestTranslation?.running || starting);
    translate.disabled = Boolean(!latestTranslation?.ready || latestTranslation.running || latestOcr?.running || translating);
  };
  const render = (status: OcrStatus) => {
    latestOcr = status;
    ocrResult.textContent = [status.message, ...status.errors].join('\n');
    updateControls();
  };
  const renderTranslation = (status: TranslationStatus) => {
    latestTranslation = status;
    translationResult.textContent = status.message;
    updateControls();
  };
  const poll = async () => {
    if (polling || starting || tabId === undefined) return;
    polling = true;
    const requestGeneration = generation;
    try {
      const [ocrStatus, translationStatus] = await Promise.all([
        chrome.tabs.sendMessage(tabId, { type: 'GET_OCR_STATUS' }, { frameId: 0 }),
        chrome.tabs.sendMessage(tabId, { type: 'GET_TRANSLATION_STATUS' }, { frameId: 0 }),
      ]);
      if (requestGeneration === generation) { render(ocrStatus); renderTranslation(translationStatus); }
    } catch {
      if (requestGeneration === generation) {
        ocrResult.textContent = 'OCR bağlantısı yok. Web sayfasını yenileyin.';
        detect.disabled = false;
        translate.disabled = true;
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
  translate.addEventListener('click', async () => {
    if (tabId === undefined || !latestTranslation?.ready) return;
    generation++;
    translating = true;
    updateControls();
    translationResult.textContent = 'Starting translation…';
    try {
      const provider = engine.value as TranslationProviderId;
      renderTranslation(await chrome.tabs.sendMessage(tabId, { type: 'START_TRANSLATION', provider }, { frameId: 0 }));
    } catch {
      translationResult.textContent = 'Translation failed:\nWeb page connection is unavailable.';
    } finally { translating = false; updateControls(); }
  });
  window.setInterval(() => { void poll(); }, 750);
})();
