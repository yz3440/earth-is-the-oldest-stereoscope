// Static "LOADING" canvas used as the per-eye stand-in while the telescope
// videos are still downloading. Replaced with the real video source once
// both tracks fire `canplaythrough`.

const SIZE = 1024;

let cached: HTMLCanvasElement | null = null;

export function getLoadingCanvas(): HTMLCanvasElement {
  if (cached) return cached;
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 44px ui-monospace, "SF Mono", Menlo, monospace';
  ctx.fillText('LOADING', SIZE / 2, SIZE / 2);

  cached = c;
  return c;
}
