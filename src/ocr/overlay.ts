import type { DetectedText, TextBlock } from './types';

interface OverlayRect { x: number; y: number; width: number; height: number }

export function createOcrOverlay() {
  const host = document.createElement('div');
  host.dataset.wtOcrOverlay = '';
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });
  document.documentElement.append(host);
  const entries: { img: HTMLImageElement; source: string; layer: HTMLDivElement; boxes: { rect: OverlayRect; box: HTMLDivElement }[] }[] = [];
  let index = 0;
  let frame = 0;
  function update() {
    for (const { img, source, layer, boxes } of entries) {
      const rect = img.getBoundingClientRect();
      layer.hidden = !img.isConnected || (img.currentSrc || img.src) !== source || !rect.width || !rect.height;
      if (layer.hidden) continue;
      const style = getComputedStyle(img);
      const zoomX = rect.width / (img.offsetWidth || rect.width);
      const zoomY = rect.height / (img.offsetHeight || rect.height);
      const left = (parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)) * zoomX;
      const top = (parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)) * zoomY;
      const width = rect.width - left - (parseFloat(style.borderRightWidth) + parseFloat(style.paddingRight)) * zoomX;
      const height = rect.height - top - (parseFloat(style.borderBottomWidth) + parseFloat(style.paddingBottom)) * zoomY;
      let sx = width / img.naturalWidth;
      let sy = height / img.naturalHeight;
      if (style.objectFit !== 'fill') {
        const contain = Math.min(sx, sy);
        const scale = style.objectFit === 'cover' ? Math.max(sx, sy) :
          style.objectFit === 'none' ? 1 : style.objectFit === 'scale-down' ? Math.min(1, contain) : contain;
        sx = sy = scale;
      }
      const position = style.objectPosition.split(' ');
      const offset = (value: string, space: number) => value.endsWith('%') ? parseFloat(value) / 100 * space : parseFloat(value) || 0;
      const dx = offset(position[0], width - img.naturalWidth * sx);
      const dy = offset(position[1] || '50%', height - img.naturalHeight * sy);
      Object.assign(layer.style, { left: `${rect.left + left}px`, top: `${rect.top + top}px`, width: `${width}px`, height: `${height}px` });
      for (const { rect: boxRect, box } of boxes) {
        Object.assign(box.style, {
          left: `${dx + boxRect.x * sx}px`, top: `${dy + boxRect.y * sy}px`,
          width: `${boxRect.width * sx}px`, height: `${boxRect.height * sy}px`,
        });
      }
    }
    frame = requestAnimationFrame(update);
  }
  update();
  return {
    add(img: HTMLImageElement, source: string, regions: DetectedText[], blocks: TextBlock[],
      rejected: DetectedText[] = [], rejectedBlocks: TextBlock[] = []) {
      const layer = document.createElement('div');
      layer.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none;';
      const boxes: { rect: OverlayRect; box: HTMLDivElement }[] = regions.map(region => {
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;box-sizing:border-box;border:2px solid #00bfff;background:rgba(0,191,255,.12);';
        const label = document.createElement('span');
        label.textContent = `OCR ${++index}`;
        label.style.cssText = 'position:absolute;left:0;top:0;background:#003d66;color:white;font:bold 11px/1.2 sans-serif;white-space:nowrap;';
        box.append(label);
        layer.append(box);
        return { rect: region, box };
      });
      for (const region of rejected) {
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;box-sizing:border-box;border:2px dashed #ff9f1c;background:rgba(255,159,28,.08);';
        const label = document.createElement('span');
        label.textContent = 'REJECTED OCR';
        label.style.cssText = 'position:absolute;left:0;top:0;background:#7a4300;color:white;font:bold 10px/1.2 sans-serif;white-space:nowrap;';
        box.append(label);
        layer.append(box);
        boxes.push({ rect: region, box });
      }
      for (const [blockIndex, block] of blocks.entries()) {
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;box-sizing:border-box;border:4px solid #ff2d8d;background:rgba(255,45,141,.05);';
        box.title = block.text;
        const label = document.createElement('span');
        label.textContent = `BLOCK ${blockIndex + 1}`;
        label.title = block.text;
        label.style.cssText = 'position:absolute;left:0;top:0;background:#a0004d;color:white;font:bold 12px/1.3 sans-serif;padding:2px 4px;white-space:nowrap;';
        box.append(label);
        layer.append(box);
        boxes.push({ rect: block, box });
      }
      for (const block of rejectedBlocks) {
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;box-sizing:border-box;border:3px dashed #ff9f1c;background:rgba(255,159,28,.05);';
        const label = document.createElement('span');
        label.textContent = 'REJECTED BLOCK';
        label.title = block.text;
        label.style.cssText = 'position:absolute;left:0;top:0;background:#7a4300;color:white;font:bold 10px/1.2 sans-serif;white-space:nowrap;';
        box.append(label);
        layer.append(box);
        boxes.push({ rect: block, box });
      }
      shadow.append(layer);
      entries.push({ img, source, layer, boxes });
    },
    clear() { cancelAnimationFrame(frame); host.remove(); },
  };
}
