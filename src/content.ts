import { installOcr } from './ocr/contentOcr';

(() => {
  const prefix = '[Webtoon Translator]';
  // WeakMap, DOM'dan kaldırılan elementlerin bellekte tutulmasını önler.
  const processed = new WeakMap<HTMLImageElement, string>();
  const loadTimeoutMs = 8000;
  let clearHighlights = () => {};
  let activeScan: Promise<{ candidateCount: number; pendingCount: number }> | undefined;

  function waitForImage(img: HTMLImageElement): Promise<void> {
    // complete, kaynağı olmayan img için de true olabilir.
    if (img.complete && (img.currentSrc || img.getAttribute('src'))) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        img.removeEventListener('load', finish);
        img.removeEventListener('error', finish);
        resolve();
      };
      const timer = window.setTimeout(finish, loadTimeoutMs);
      img.addEventListener('load', finish);
      img.addEventListener('error', finish);
      if (img.complete && (img.currentSrc || img.getAttribute('src'))) finish();
    });
  }

  function highlightImages(images: HTMLImageElement[]): void {
    if (!images.length) return;
    // Ayrı overlay: sitenin img stillerini ve yerleşimini değiştirmez.
    const host = document.createElement('div');
    host.dataset.wtCandidateOverlay = '';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const markers = images.map((img) => {
      const marker = document.createElement('div');
      marker.style.cssText = 'position:absolute;outline:3px solid red;pointer-events:none;';
      const label = document.createElement('span');
      label.textContent = 'WT Candidate';
      label.style.cssText = 'position:absolute;top:0;left:0;background:red;color:white;font:12px/1.4 sans-serif;padding:2px 4px;white-space:nowrap;';
      marker.append(label);
      shadow.append(marker);
      return { img, marker };
    });
    document.documentElement.append(host);
    let frame = 0;
    const update = () => {
      for (const { img, marker } of markers) {
        const rect = img.getBoundingClientRect();
        marker.hidden = !img.isConnected || !rect.width || !rect.height;
        marker.style.left = `${rect.left}px`;
        marker.style.top = `${rect.top}px`;
        marker.style.width = `${rect.width}px`;
        marker.style.height = `${rect.height}px`;
      }
      frame = requestAnimationFrame(update);
    };
    update();
    const timeout = window.setTimeout(() => clearHighlights(), 15000);
    clearHighlights = () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      host.remove();
      clearHighlights = () => {};
    };
  }

  async function scanAndHighlight(): Promise<{ candidateCount: number; pendingCount: number }> {
    clearHighlights();
    const images = [...document.querySelectorAll('img')];
    await Promise.all(images.map(waitForImage));
    const current = images.filter((img) => img.isConnected);
    const candidates = current.filter(isCandidate);
    const pendingCount = current.filter((img) => !img.complete ||
      (!img.currentSrc && !img.getAttribute('src'))).length;
    for (const img of current) processImage(img);
    highlightImages(candidates);
    console.log(`${prefix} ${pendingCount ? 'Scan partial' : 'Scan complete'} — candidate image count: ${candidates.length}`, { pendingCount });
    return { candidateCount: candidates.length, pendingCount };
  }

  function isCandidate(img: HTMLImageElement): boolean {
    return img.naturalWidth >= 300 || img.naturalHeight >= 300;
  }

  function processImage(img: HTMLImageElement): void {
    const info = {
      src: img.currentSrc || img.src,
      width: img.width,
      height: img.height,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
    };
    // Yüklenmemiş img de raporlanır; load geldiğinde gerçek boyutlarıyla güncellenir.
    // Aynı elementte lazy-load kaynak değişimine izin ver, aynı veriyi tekrarlama.
    const signature = JSON.stringify(info);
    if (processed.get(img) === signature) return;
    processed.set(img, signature);

    console.log(`${prefix} image`, info);
    if (isCandidate(img)) {
      console.log(`${prefix} candidate image`, info);
    }
  }

  function scanImages(): number {
    let candidateCount = 0;
    for (const img of document.querySelectorAll('img')) {
      processImage(img);
      if (isCandidate(img)) candidateCount++;
    }
    console.log(`${prefix} Initial scan (loaded images) — candidate image count: ${candidateCount}`);
    return candidateCount;
  }

  // load bubble etmez; capture ile mevcut ve sonradan eklenen img'leri yakala.
  document.addEventListener('load', (event) => {
    if (event.target instanceof HTMLImageElement) processImage(event.target);
  }, true);

  const observer = new MutationObserver((records) => {
    const images = new Set<HTMLImageElement>();
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof HTMLImageElement) {
        images.add(record.target);
      }
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node instanceof HTMLImageElement) images.add(node);
        for (const img of node.querySelectorAll('img')) images.add(img);
      }
    }
    for (const img of images) {
      if (img.isConnected) processImage(img);
    }
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'srcset', 'sizes'],
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SCAN_IMAGES') {
      // Popup kapatılıp tekrar açılırsa eşzamanlı taramaları birleştir.
      activeScan ??= scanAndHighlight().finally(() => { activeScan = undefined; });
      void activeScan.then(sendResponse, (error: unknown) => {
        console.error(`${prefix} Scan failed`, error);
        sendResponse({ error: 'Tarama tamamlanamadı.' });
      });
      return true; // Asenkron yanıt gelene kadar mesaj kanalını açık tut.
    }
  });

  installOcr(() => [...document.querySelectorAll('img')].filter(isCandidate));
  scanImages();
})();
