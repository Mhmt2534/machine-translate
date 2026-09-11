import type { CaptureGeometry, Rect } from './types';

export function getCaptureGeometry(img: HTMLImageElement): CaptureGeometry {
  if (!img.isConnected || !img.complete || !img.naturalWidth) throw new Error('Görsel artık yüklü değil.');
  if (visualViewport && (visualViewport.scale !== 1 || visualViewport.offsetLeft || visualViewport.offsetTop)) {
    throw new Error('Pinch zoom açık; ekran yakalama için normal sayfa görünümüne dönün.');
  }
  const rect = img.getBoundingClientRect();
  const style = getComputedStyle(img);
  if (style.visibility !== 'visible' || Number(style.opacity) !== 1) throw new Error('Görsel görünür/opak değil.');
  const zoomX = rect.width / img.offsetWidth, zoomY = rect.height / img.offsetHeight;
  const left = (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoomX;
  const top = (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoomY;
  const width = rect.width - left - (parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)) * zoomX;
  const height = rect.height - top - (parseFloat(style.borderBottomWidth) + parseFloat(style.paddingBottom)) * zoomY;
  let sx = width / img.naturalWidth, sy = height / img.naturalHeight;
  if (style.objectFit !== 'fill') {
    const scale = style.objectFit === 'cover' ? Math.max(sx, sy) : style.objectFit === 'none' ? zoomX :
      style.objectFit === 'scale-down' ? Math.min(zoomX, sx, sy) : Math.min(sx, sy);
    sx = sy = scale;
  }
  const position = style.objectPosition.split(' ');
  if (position.length !== 2 || !position.every(p => /^-?[\d.]+(%|px)$/.test(p))) {
    throw new Error('Karmaşık object-position ekran yakalamada desteklenmiyor.');
  }
  const offset = (value: string, space: number, zoom: number) => value.endsWith('%') ? parseFloat(value) / 100 * space : parseFloat(value) * zoom;
  const rendered: Rect = { x: rect.left + left + offset(position[0], width - img.naturalWidth * sx, zoomX),
    y: rect.top + top + offset(position[1], height - img.naturalHeight * sy, zoomY),
    width: img.naturalWidth * sx, height: img.naturalHeight * sy };
  let x1 = Math.max(0, rect.left + left, rendered.x), y1 = Math.max(0, rect.top + top, rendered.y);
  let x2 = Math.min(innerWidth, document.documentElement.clientWidth, rect.left + left + width, rendered.x + rendered.width);
  let y2 = Math.min(innerHeight, document.documentElement.clientHeight, rect.top + top + height, rendered.y + rendered.height);
  for (let node: Element | null = img; node; node = node.parentElement) {
    const css = getComputedStyle(node);
    if (css.transform !== 'none') {
      const matrix = new DOMMatrixReadOnly(css.transform);
      if (!matrix.is2D || matrix.b || matrix.c || matrix.a <= 0 || matrix.d <= 0) throw new Error('Döndürülmüş görselde ekran yakalama desteklenmiyor.');
    }
    if (css.clipPath !== 'none' || css.maskImage !== 'none' || css.filter !== 'none') throw new Error('Maskeli/filtreli görselde ekran yakalama desteklenmiyor.');
    if (node !== img) {
      const bounds = node.getBoundingClientRect();
      const html = node as HTMLElement;
      const clientLeft = bounds.left + (html.clientLeft || 0);
      const clientTop = bounds.top + (html.clientTop || 0);
      if (/(hidden|clip|scroll|auto|overlay)/.test(css.overflowX)) {
        x1 = Math.max(x1, clientLeft);
        x2 = Math.min(x2, clientLeft + html.clientWidth);
      }
      if (/(hidden|clip|scroll|auto|overlay)/.test(css.overflowY)) {
        y1 = Math.max(y1, clientTop);
        y2 = Math.min(y2, clientTop + html.clientHeight);
      }
    }
  }
  if (x2 - x1 < 2 || y2 - y1 < 2) throw new Error('Candidate ekranda görünmüyor. Görsele kaydırıp Detect Text’i tekrar çalıştırın.');
  for (let row = 0; row < 5; row++) for (let col = 0; col < 5; col++) {
    if (document.elementFromPoint(x1 + (x2 - x1) * (col + 0.5) / 5, y1 + (y2 - y1) * (row + 0.5) / 5) !== img) {
      throw new Error('Görselin üzerinde başka bir sayfa öğesi var. Örtüşen paneli kapatıp tekrar deneyin.');
    }
  }
  return { crop: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, rendered,
    viewportWidth: innerWidth, viewportHeight: innerHeight, scrollX, scrollY, dpr: devicePixelRatio };
}
