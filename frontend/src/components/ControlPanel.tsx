// Controls panel body. Rendered in two orientations:
//   - vertical: inside the popover on mobile (isNarrow)
//   - horizontal: inside the desktop controls bar above BottomBar
// Both share the same signals and input elements; only layout differs.

import { layout, encoding, sourceMode, correction, flipHead, parallaxPx, view, showTelescopes, showEyeTop, showEyeBottom } from '../state';
import type { Layout, Encoding, SourceMode } from '../state';
import { TooltipLabel } from './Tooltip';

type Orientation = 'vertical' | 'horizontal';

const TOOLTIPS = {
  LAYOUT: 'How the two eye images are arranged on screen (side-by-side or top-bottom, full or half width).',
  ENCODING: 'How the stereo pair is combined for viewing: anaglyph (colored glasses), frame-sequential (shutter glasses), or none (raw).',
  SOURCE: 'Show the captured telescope video, or the 3D simulation instead.',
  CORRECTION: 'Rotate each eye image so the stereo baseline is horizontal (uses telescope orientation data).',
  'FLIP HEAD': 'Flip the view 180° and swap eyes — useful for lying on your back or upside-down headsets.',
  PARALLAX: 'Horizontal shift between eyes in pixels — adjusts perceived depth.',
  'TOP TEXT': 'Show the city name, coordinates, and local time block at the top of each eye.',
  'BOT TEXT': 'Show the weather, UTC time, and eclipse phase block at the bottom of each eye.',
  TELESCOPES: 'Show or hide the telescope grid overlay in the 3D scene.',
  FOCUS: 'Center the 3D camera on the full system, Earth, or the Moon.',
} as const;

type LabelKey = keyof typeof TOOLTIPS;

function VRow({ label, children }: { label: LabelKey; children: any }) {
  return (
    <div class="flex items-center justify-between gap-3 py-1.5">
      <TooltipLabel text={label} tooltip={TOOLTIPS[label]} className="text-[11px] opacity-60 tracking-wider" />
      <div class="flex items-center">{children}</div>
    </div>
  );
}

function HCell({ label, children }: { label: LabelKey; children: any }) {
  return (
    <div class="flex items-center gap-2" style={{ flex: 'none' }}>
      <TooltipLabel text={label} tooltip={TOOLTIPS[label]} className="text-[10px] opacity-60 tracking-wider" />
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
  { v: 'video-only', l: 'VIDEO' },
  { v: 'sim-only',   l: 'SIM'   },
];

function LayoutSelect() {
  return (
    <select
      value={layout.value}
      onChange={(e) => (layout.value = (e.target as HTMLSelectElement).value as Layout)}
    >
      {LAYOUT_OPTS.map((o) => (<option value={o.v}>{o.l}</option>))}
    </select>
  );
}

function EncodingSelect() {
  return (
    <select
      value={encoding.value}
      onChange={(e) => (encoding.value = (e.target as HTMLSelectElement).value as Encoding)}
    >
      {ENCODING_OPTS.map((o) => (<option value={o.v}>{o.l}</option>))}
    </select>
  );
}

function SourceToggle() {
  return (
    <div class="flex" style={{ border: '1px solid var(--line)' }}>
      {SOURCE_OPTS.map((o) => {
        const active = sourceMode.value === o.v;
        return (
          <button
            type='button'
            onClick={() => (sourceMode.value = o.v)}
            style={{
              padding: '3px 10px',
              fontSize: 10,
              letterSpacing: '0.12em',
              background: active ? 'var(--accent-fill)' : 'transparent',
              color: active ? 'var(--text)' : 'var(--text-3)',
              border: 'none',
              transition: 'color 0.12s, background 0.12s',
            }}
          >
            {o.l}
          </button>
        );
      })}
    </div>
  );
}

function ParallaxSlider({ width = 100 }: { width?: number }) {
  return (
    <div class="flex items-center gap-2">
      <input
        type="range"
        min={-200}
        max={200}
        value={parallaxPx.value}
        onInput={(e) => (parallaxPx.value = parseInt((e.target as HTMLInputElement).value))}
        style={{ width }}
      />
      <span style={{ fontSize: 11, opacity: 0.7, minWidth: 36, textAlign: 'right' }}>
        {parallaxPx.value > 0 ? '+' : ''}{parallaxPx.value}px
      </span>
      <button
        type="button"
        onClick={() => (parallaxPx.value = 0)}
        style={{ padding: '2px 6px', fontSize: 10, opacity: 0.7 }}
        title="Reset parallax to 0"
      >
        reset
      </button>
    </div>
  );
}

function FocusButtons({ flex = 1 }: { flex?: number | string }) {
  return (
    <div class="flex gap-1">
      {(['SYSTEM', 'EARTH', 'MOON'] as const).map((k) => (
        <button
          type="button"
          data-focus={k}
          style={{ flex, padding: '4px 8px', fontSize: 10, letterSpacing: '0.08em' }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

// ---------- Vertical (popover) layout ----------

export function ControlPanelBody() {
  return (
    <div style={{ padding: '10px 12px 12px', width: 260 }}>
      <StereoControls orientation="vertical" />
      <SimControls orientation="vertical" />
    </div>
  );
}

// ---------- Shared control groups (both orientations) ----------

export function StereoControls({ orientation }: { orientation: Orientation }) {
  if (view.value === 'sim') return null;

  if (orientation === 'vertical') {
    return (
      <>
        <VRow label="LAYOUT"><LayoutSelect /></VRow>
        <VRow label="ENCODING"><EncodingSelect /></VRow>
        <VRow label="SOURCE"><SourceToggle /></VRow>
        <VRow label="CORRECTION">
          <Switch checked={correction.value} onToggle={() => (correction.value = !correction.value)} />
        </VRow>
        <VRow label="FLIP HEAD">
          <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
        </VRow>
        <VRow label="PARALLAX"><ParallaxSlider width={100} /></VRow>
        <VRow label="TOP TEXT">
          <Switch checked={showEyeTop.value} onToggle={() => (showEyeTop.value = !showEyeTop.value)} />
        </VRow>
        <VRow label="BOT TEXT">
          <Switch checked={showEyeBottom.value} onToggle={() => (showEyeBottom.value = !showEyeBottom.value)} />
        </VRow>
      </>
    );
  }

  return (
    <>
      <HCell label="LAYOUT"><LayoutSelect /></HCell>
      <HCell label="ENCODING"><EncodingSelect /></HCell>
      <HCell label="SOURCE"><SourceToggle /></HCell>
      <HCell label="CORRECTION">
        <Switch checked={correction.value} onToggle={() => (correction.value = !correction.value)} />
      </HCell>
      <HCell label="FLIP HEAD">
        <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
      </HCell>
      <HCell label="PARALLAX"><ParallaxSlider width={120} /></HCell>
      <HCell label="TOP TEXT">
        <Switch checked={showEyeTop.value} onToggle={() => (showEyeTop.value = !showEyeTop.value)} />
      </HCell>
      <HCell label="BOT TEXT">
        <Switch checked={showEyeBottom.value} onToggle={() => (showEyeBottom.value = !showEyeBottom.value)} />
      </HCell>
    </>
  );
}

export function SimControls({ orientation }: { orientation: Orientation }) {
  if (view.value !== 'sim') return null;

  if (orientation === 'vertical') {
    return (
      <>
        <VRow label="FLIP HEAD">
          <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
        </VRow>
        <VRow label="TELESCOPES">
          <Switch checked={showTelescopes.value} onToggle={() => (showTelescopes.value = !showTelescopes.value)} />
        </VRow>
        <div class="pt-1">
          <TooltipLabel text="FOCUS" tooltip={TOOLTIPS.FOCUS} className="text-[10px] opacity-50" style={{ letterSpacing: '0.1em' }} />
        </div>
        <div class="pt-1">
          <FocusButtons flex={1} />
        </div>
        <div class="text-[10px] opacity-50 pt-2" style={{ letterSpacing: '0.05em' }}>
          drag to orbit · scroll to zoom
        </div>
      </>
    );
  }

  return (
    <>
      <HCell label="FLIP HEAD">
        <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
      </HCell>
      <HCell label="TELESCOPES">
        <Switch checked={showTelescopes.value} onToggle={() => (showTelescopes.value = !showTelescopes.value)} />
      </HCell>
      <HCell label="FOCUS"><FocusButtons flex="none" /></HCell>
      <span class="text-[10px] opacity-50" style={{ letterSpacing: '0.05em', marginLeft: 8 }}>
        drag to orbit · scroll to zoom
      </span>
    </>
  );
}
