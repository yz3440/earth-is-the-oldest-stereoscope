// Static text canvases used as per-eye stand-ins: "LOADING" while the
// telescope videos are still downloading, and as the sim-view tile
// placeholder while the user is scrubbing (the video element is mid-seek and
// any frame it holds is stale); "NO VIDEO" when a <video> element reports a
// decode / unsupported-source error. Replaced with the real video source
// once `canplaythrough` fires (boot path) or the seek settles (scrub path).

const SIZE = 1024;

const cached: Record<string, HTMLCanvasElement> = {};

export function getMessageCanvas(text: string, fontPx = 44): HTMLCanvasElement {
  const key = `${text}@${fontPx}`;
  if (cached[key]) return cached[key];
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Match `--text = #c2c2c2` (canvas can't read CSS vars).
  ctx.fillStyle = '#c2c2c2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontPx}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillText(text, SIZE / 2, SIZE / 2);

  cached[key] = c;
  return c;
}

export function getLoadingCanvas(fontPx = 44): HTMLCanvasElement {
  return getMessageCanvas('LOADING', fontPx);
}

// Title + a dim one-line status underneath (download %, per-video
// readyState). One reusable canvas, redrawn only when the text changes —
// it lets a phone user report *where* loading is stuck without a console.
let statusCanvas: HTMLCanvasElement | null = null;
let statusKey = '';
export function getStatusCanvas(title: string, status: string, fontPx = 44): HTMLCanvasElement {
  const key = `${title}\n${status}\n${fontPx}`;
  if (statusCanvas && statusKey === key) return statusCanvas;
  if (!statusCanvas) {
    statusCanvas = document.createElement('canvas');
    statusCanvas.width = SIZE;
    statusCanvas.height = SIZE;
  }
  const ctx = statusCanvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c2c2c2';
  ctx.font = `bold ${fontPx}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillText(title, SIZE / 2, SIZE / 2);
  ctx.fillStyle = '#5a5a5a';
  ctx.font = `${Math.round(fontPx * 0.45)}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillText(status, SIZE / 2, SIZE / 2 + fontPx * 1.1);
  statusKey = key;
  return statusCanvas;
}
