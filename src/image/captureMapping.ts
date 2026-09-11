import type { CaptureGeometry, Rect } from './types';

export function mapCapture(width: number, height: number, geometry: CaptureGeometry, naturalWidth: number, naturalHeight: number): { pixels: Rect; natural: Rect } {
  const { crop, rendered, viewportWidth, viewportHeight } = geometry;
  const scaleX = width / viewportWidth, scaleY = height / viewportHeight;
  if (![scaleX, scaleY, rendered.width, rendered.height].every(value => Number.isFinite(value) && value > 0) ||
    Math.abs(scaleX / scaleY - 1) > 0.03) throw new Error('Ekran/viewport ölçeği değişti; tekrar deneyin.');
  const x = Math.ceil(crop.x * scaleX), y = Math.ceil(crop.y * scaleY);
  const w = Math.floor((crop.x + crop.width) * scaleX) - x;
  const h = Math.floor((crop.y + crop.height) * scaleY) - y;
  if (w < 2 || h < 2 || x < 0 || y < 0 || x + w > width || y + h > height) throw new Error('Candidate görünür alanı geçersiz veya çok küçük.');
  return {
    pixels: { x, y, width: w, height: h },
    natural: {
      x: (x / scaleX - rendered.x) / rendered.width * naturalWidth,
      y: (y / scaleY - rendered.y) / rendered.height * naturalHeight,
      width: w / scaleX / rendered.width * naturalWidth,
      height: h / scaleY / rendered.height * naturalHeight,
    },
  };
}
