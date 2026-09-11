export type AcquisitionMethod = 'loaded-image' | 'extension-fetch' | 'page-fetch' | 'viewport-capture';
export interface Rect { x: number; y: number; width: number; height: number }
export interface CaptureGeometry {
  crop: Rect;
  rendered: Rect;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  dpr: number;
}
export interface ImageRequest {
  method: AcquisitionMethod;
  source: string;
  pageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  credentials: RequestCredentials;
  dataUrl?: string;
  capture?: CaptureGeometry;
  captureToken?: string;
}
export interface AcquisitionLog {
  method: AcquisitionMethod;
  imageUrl: string;
  pageUrl: string;
  hostname: string;
  status: number | null;
  statusText: string;
  outcome: 'acquired' | 'failed';
  detail?: string;
  redirected?: boolean;
  responseUrl?: string;
}
export interface AcquiredImage {
  blob: Blob;
  method: AcquisitionMethod;
  naturalRect: Rect;
  logs: AcquisitionLog[];
}
export function acquisitionLog(request: ImageRequest, outcome: AcquisitionLog['outcome'], detail = ''): AcquisitionLog {
  const safeUrl = (url: string) => {
    if (url.startsWith('data:')) return '[image data URL]';
    try { const parsed = new URL(url); parsed.username = ''; parsed.password = ''; return parsed.href; }
    catch { return '[invalid URL]'; }
  };
  return { method: request.method, imageUrl: safeUrl(request.source), pageUrl: safeUrl(request.pageUrl),
    hostname: new URL(request.pageUrl).hostname, status: null, statusText: '', outcome, detail,
    ...( /^https?:/.test(request.source) ? { hostname: new URL(request.source).hostname } : {}),
  };
}
