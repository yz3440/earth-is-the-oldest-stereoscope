// Static "NO SIGNAL" canvas used as a per-eye stand-in when a telescope
// video exists but doesn't cover the current sim time.

const SIZE = 1024;

const cached: Record<string, HTMLCanvasElement> = {};

export function getNoSignalCanvas(fontPx = 44): HTMLCanvasElement {
  const key = String(fontPx);
  if (cached[key]) return cached[key];
  const c = document.createElement('canvas');
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Match the app's dimmed text token (`--text = #c2c2c2`). Canvas fillStyle
  // can't read CSS vars, so we hardcode the same value.
  ctx.fillStyle = '#c2c2c2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontPx}px ui-monospace, "SF Mono", Menlo, monospace`;
  ctx.fillText('NO SIGNAL', SIZE / 2, SIZE / 2);

  cached[key] = c;
  return c;
}
