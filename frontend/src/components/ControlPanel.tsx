// Controls panel body. Rendered inside a popover mounted from BottomBar;
// the popover handles open/closed state and positioning.

import { layout, encoding, sourceMode, correction, swap, flipHead, parallaxPx, view, showTelescopes } from '../state';
import type { Layout, Encoding, SourceMode } from '../state';

function Row({ label, children }: { label: string; children: any }) {
  return (
    <div class="flex items-center justify-between gap-3 py-1.5">
      <span class="text-[11px] opacity-60 tracking-wider">{label}</span>
      <div class="flex items-center">{children}</div>
    </div>
  );
}

function Switch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      class="relative"
      style={{
        width: 28,
        height: 14,
        border: `1px solid ${checked ? 'var(--text)' : 'var(--line)'}`,
        background: checked ? 'var(--accent-fill)' : 'transparent',
        transition: 'all 0.12s',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 1,
          left: checked ? 13 : 1,
          width: 12,
          height: 10,
          background: checked ? 'var(--text)' : 'var(--text-3)',
          transition: 'all 0.12s',
        }}
      />
    </button>
  );
}

const LAYOUT_OPTS: { v: Layout; l: string }[] = [
  { v: 'sbs-half', l: 'sbs-half' },
  { v: 'sbs-full', l: 'sbs-full' },
  { v: 'tb-half',  l: 'tb-half'  },
  { v: 'tb-full',  l: 'tb-full'  },
];
const ENCODING_OPTS: { v: Encoding; l: string }[] = [
  { v: 'none',               l: 'none (raw stereo)' },
  { v: 'anaglyph-rc',        l: 'anaglyph r/c'      },
  { v: 'anaglyph-rc-dubois', l: 'anaglyph r/c dubois' },
  { v: 'anaglyph-gm',        l: 'anaglyph g/m'      },
  { v: 'anaglyph-amber',     l: 'anaglyph amber'    },
  { v: 'frame-seq',          l: 'frame-seq (DLP)'   },
];
const SOURCE_OPTS: { v: SourceMode; l: string }[] = [
  { v: 'auto',       l: 'auto'       },
  { v: 'video-only', l: 'video only' },
  { v: 'sim-only',   l: 'sim only'   },
];

export function ControlPanelBody() {
  const isSim = view.value === 'sim';
  return (
    <div style={{ padding: '10px 12px 12px', width: 260 }}>
      {!isSim && (
        <>
          <Row label="LAYOUT">
            <select
              value={layout.value}
              onChange={(e) => (layout.value = (e.target as HTMLSelectElement).value as Layout)}
            >
              {LAYOUT_OPTS.map((o) => (<option value={o.v}>{o.l}</option>))}
            </select>
          </Row>
          <Row label="ENCODING">
            <select
              value={encoding.value}
              onChange={(e) => (encoding.value = (e.target as HTMLSelectElement).value as Encoding)}
            >
              {ENCODING_OPTS.map((o) => (<option value={o.v}>{o.l}</option>))}
            </select>
          </Row>
          <Row label="SOURCE">
            <select
              value={sourceMode.value}
              onChange={(e) => (sourceMode.value = (e.target as HTMLSelectElement).value as SourceMode)}
            >
              {SOURCE_OPTS.map((o) => (<option value={o.v}>{o.l}</option>))}
            </select>
          </Row>
          <Row label="CORRECTION">
            <Switch checked={correction.value} onToggle={() => (correction.value = !correction.value)} />
          </Row>
          <Row label="FLIP HEAD">
            <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
          </Row>
          <Row label="SWAP EYES">
            <Switch checked={swap.value} onToggle={() => (swap.value = !swap.value)} />
          </Row>
          <Row label="PARALLAX">
            <div class="flex items-center gap-2">
              <input
                type="range"
                min={-200}
                max={200}
                value={parallaxPx.value}
                onInput={(e) => (parallaxPx.value = parseInt((e.target as HTMLInputElement).value))}
                style={{ width: 100 }}
              />
              <span style={{ fontSize: 11, opacity: 0.7, minWidth: 36, textAlign: 'right' }}>
                {parallaxPx.value > 0 ? '+' : ''}{parallaxPx.value}px
              </span>
            </div>
          </Row>
          <div class="flex justify-end pt-1">
            <button
              type="button"
              onClick={() => (parallaxPx.value = 0)}
              style={{ padding: '2px 8px', fontSize: 10, opacity: 0.7 }}
            >
              reset
            </button>
          </div>
        </>
      )}

      {isSim && (
        <>
          <Row label="FLIP HEAD">
            <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
          </Row>
          <Row label="TELESCOPES">
            <Switch checked={showTelescopes.value} onToggle={() => (showTelescopes.value = !showTelescopes.value)} />
          </Row>
          <div class="pt-1 text-[10px] opacity-50" style={{ letterSpacing: '0.1em' }}>FOCUS</div>
          <div class="flex gap-1 pt-1">
            {(['SYSTEM', 'EARTH', 'MOON'] as const).map((k) => (
              <button
                type="button"
                data-focus={k}
                style={{ flex: 1, padding: '4px 0', fontSize: 10, letterSpacing: '0.08em' }}
              >
                {k}
              </button>
            ))}
          </div>
          <div class="text-[10px] opacity-50 pt-2" style={{ letterSpacing: '0.05em' }}>
            drag to orbit · scroll to zoom
          </div>
        </>
      )}
    </div>
  );
}
