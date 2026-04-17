// Static "NO SIGNAL" canvas used as a per-eye stand-in when a telescope
// video exists but doesn't cover the current sim time.

const SIZE = 1024;

let cached: HTMLCanvasElement | null = null;

export function getNoSignalCanvas(): HTMLCanvasElement {
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
  ctx.fillText('NO SIGNAL', SIZE / 2, SIZE / 2);

  cached = c;
  return c;
}
