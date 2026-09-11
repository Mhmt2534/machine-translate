import { VIEWPORT_CAPTURE_CONFIG as config } from '../ocr/config';

export interface ScrollContextInfo {
  mode: 'window' | 'container';
  element: HTMLElement | null;
  label: string;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface ScrollSession {
  signal: AbortSignal;
  contextsFor(img: HTMLImageElement): ScrollContextInfo[];
  scrollToImageOffset(img: HTMLImageElement, naturalY: number): Promise<ScrollContextInfo[]>;
  restore(): Promise<void>;
}

export function checkInterrupted(signal: AbortSignal) {
  if (signal.aborted) throw new Error('Manuel etkileşim nedeniyle otomatik OCR durduruldu.');
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 100);
    const frame = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
  });
}

function label(element: Element): string {
  const id = element.id ? `#${element.id}` : '';
  const classes = [...element.classList].slice(0, 2).map(name => `.${name}`).join('');
  return `${element.tagName.toLowerCase()}${id}${classes}`;
}

export function findScrollableAncestors(element: Element): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  const scrollingElement = document.scrollingElement;
  for (let current = element.parentElement; current; current = current.parentElement) {
    if (current === scrollingElement || current === document.documentElement || current === document.body) continue;
    const overflowY = getComputedStyle(current).overflowY;
    if (/^(auto|scroll|overlay)$/.test(overflowY) && current.scrollHeight > current.clientHeight + 1) ancestors.push(current);
  }
  return ancestors;
}

function elementViewport(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { top: rect.top + element.clientTop, bottom: rect.top + element.clientTop + element.clientHeight,
    left: rect.left + element.clientLeft, right: rect.left + element.clientLeft + element.clientWidth };
}

function contextInfo(element: HTMLElement | null): ScrollContextInfo {
  if (!element) {
    const scrolling = document.scrollingElement;
    return { mode: 'window', element: null, label: 'window', scrollTop: scrollY, scrollLeft: scrollX,
      scrollHeight: scrolling?.scrollHeight ?? document.documentElement.scrollHeight, clientHeight: innerHeight };
  }
  return { mode: 'container', element, label: label(element), scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
    scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
}

function scrollSignature(img: HTMLImageElement): string {
  const rect = img.getBoundingClientRect();
  const positions = findScrollableAncestors(img).map(element => [element.scrollLeft, element.scrollTop]);
  return JSON.stringify([rect.x, rect.y, rect.width, rect.height, scrollX, scrollY, positions,
    img.currentSrc || img.src, img.naturalWidth, img.naturalHeight]);
}

export async function waitForStableImage(img: HTMLImageElement, signal: AbortSignal) {
  const deadline = performance.now() + config.layoutTimeoutMs;
  let previous = '', stableSince = performance.now();
  while (performance.now() < deadline) {
    checkInterrupted(signal);
    if (!img.isConnected) throw new Error('Candidate sayfadan kaldırıldı.');
    const rect = img.getBoundingClientRect();
    const current = scrollSignature(img);
    if (current !== previous || !img.complete || !img.naturalWidth || !img.naturalHeight || !rect.width || !rect.height) {
      previous = current;
      stableSince = performance.now();
    } else if (performance.now() - stableSince >= config.stableForMs) return;
    await nextFrame();
  }
  throw new Error('Görsel yüklenmesi/layout belirtilen sürede stabil olmadı.');
}

function setTemporaryScrollStyles(element: HTMLElement, restorers: (() => void)[]) {
  for (const [property, value] of [['scroll-behavior', 'auto'], ['scroll-snap-type', 'none'], ['overflow-anchor', 'none']]) {
    const oldValue = element.style.getPropertyValue(property);
    const priority = element.style.getPropertyPriority(property);
    element.style.setProperty(property, value, 'important');
    restorers.push(() => oldValue ? element.style.setProperty(property, oldValue, priority) : element.style.removeProperty(property));
  }
}

export function startScrollSession(images: HTMLImageElement[]): ScrollSession {
  const controller = new AbortController();
  const elements = [...new Set(images.flatMap(findScrollableAncestors))];
  const elementState = elements.map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
  const windowState = { x: scrollX, y: scrollY };
  const styleRestorers: (() => void)[] = [];
  for (const element of [document.documentElement, document.body, ...elements]) setTemporaryScrollStyles(element, styleRestorers);

  const interrupt = (event: Event) => {
    if (event.isTrusted && (!(event instanceof KeyboardEvent) || ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key))) controller.abort();
  };
  for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.addEventListener(type, interrupt, { capture: true, passive: true });
  const contextsFor = (img: HTMLImageElement) => [...findScrollableAncestors(img).map(contextInfo), contextInfo(null)];

  return {
    signal: controller.signal,
    contextsFor,
    async scrollToImageOffset(img, naturalY) {
      checkInterrupted(controller.signal);
      const ancestors = findScrollableAncestors(img);
      const fraction = img.naturalHeight ? naturalY / img.naturalHeight : 0;
      for (const container of ancestors) {
        const imageRect = img.getBoundingClientRect();
        const viewport = elementViewport(container);
        const targetY = imageRect.top + fraction * imageRect.height;
        const imageFits = imageRect.height <= viewport.bottom - viewport.top;
        const alreadyVisible = imageFits
          ? targetY >= viewport.top - 1 && imageRect.bottom <= viewport.bottom + 1
          : Math.abs(targetY - viewport.top) <= 1;
        if (!alreadyVisible) container.scrollTop = Math.max(0, Math.min(container.scrollHeight - container.clientHeight,
          container.scrollTop + targetY - viewport.top));
        const refreshed = img.getBoundingClientRect();
        if (refreshed.left < viewport.left) container.scrollLeft += refreshed.left - viewport.left;
        else if (refreshed.width <= viewport.right - viewport.left && refreshed.right > viewport.right) container.scrollLeft += refreshed.right - viewport.right;
        await nextFrame();
      }
      const imageRect = img.getBoundingClientRect();
      const targetY = imageRect.top + fraction * imageRect.height;
      const imageFits = imageRect.height <= innerHeight;
      const alreadyVisible = imageFits
        ? targetY >= -1 && imageRect.bottom <= innerHeight + 1
        : Math.abs(targetY) <= 1;
      if (!alreadyVisible) window.scrollTo({ left: scrollX, top: Math.max(0, scrollY + targetY), behavior: 'instant' });
      const refreshed = img.getBoundingClientRect();
      if (refreshed.left < 0) window.scrollTo({ left: Math.max(0, scrollX + refreshed.left), top: scrollY, behavior: 'instant' });
      else if (refreshed.width <= innerWidth && refreshed.right > innerWidth) window.scrollTo({ left: scrollX + refreshed.right - innerWidth, top: scrollY, behavior: 'instant' });
      await waitForStableImage(img, controller.signal);
      return contextsFor(img);
    },
    async restore() {
      for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) window.removeEventListener(type, interrupt, true);
      if (controller.signal.aborted) {
        const deadline = performance.now() + 1000;
        let last = `${scrollX},${scrollY}`, stableSince = performance.now();
        while (performance.now() < deadline && performance.now() - stableSince < config.stableForMs) {
          await nextFrame();
          const current = `${scrollX},${scrollY}`;
          if (current !== last) { last = current; stableSince = performance.now(); }
        }
      }
      for (const state of [...elementState].reverse()) {
        state.element.scrollLeft = state.left;
        state.element.scrollTop = state.top;
      }
      window.scrollTo({ left: windowState.x, top: windowState.y, behavior: 'instant' });
      await nextFrame();
      for (const state of [...elementState].reverse()) {
        state.element.scrollLeft = state.left;
        state.element.scrollTop = state.top;
      }
      window.scrollTo({ left: windowState.x, top: windowState.y, behavior: 'instant' });
      await nextFrame();
      styleRestorers.reverse().forEach(restore => restore());
      console.log('[Webtoon Translator] Scroll restored', {
        window: { requestedX: windowState.x, requestedY: windowState.y, actualX: scrollX, actualY: scrollY },
        containers: elementState.map(state => ({ container: label(state.element), requestedTop: state.top, actualTop: state.element.scrollTop })),
      });
    },
  };
}
