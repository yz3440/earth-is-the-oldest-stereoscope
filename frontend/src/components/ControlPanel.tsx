// Controls panel body. Rendered in two orientations:
//   - vertical: inside the popover on mobile (isNarrow)
//   - horizontal: inside the desktop controls bar above BottomBar
// Both share the same signals and input elements; only layout differs.

import { layout, encoding, method, setMethod, ANAGLYPH_ENCODINGS, sourceMode, correction, flipHead, parallaxPx, view, showTelescopes, showEyeTop, showEyeBottom, loopOverlap, squeezePct, wiggleMs } from '../state';
import type { Layout, Encoding, Method, SourceMode } from '../state';
import { TooltipLabel } from './Tooltip';

type Orientation = 'vertical' | 'horizontal';

const TOOLTIPS = {
  METHOD: 'How to view the stereo pair: side-by-side (a stereoscope / cross-eye), wiggle (alternates the two views — depth with no glasses), anaglyph (colored glasses), or shutter (DLP shutter glasses).',
  LAYOUT: 'How the two eye images are arranged on screen (side-by-side or top-bottom, full or half width).',
  COLOR: 'Which color-channel split the anaglyph uses — match your glasses (red/cyan, green/magenta, or amber/blue).',
  SOURCE: 'Show the captured telescope video, or the 3D simulation instead.',
  CORRECTION: 'Rotate each eye image so the stereo baseline is horizontal (uses telescope orientation data).',
  'FLIP HEAD': 'Flip the view 180° and swap eyes — useful for lying on your back or upside-down headsets.',
  PARALLAX: 'Horizontal shift between eyes in pixels — adjusts perceived depth.',
  WIGGLE: 'How fast the two views alternate, in milliseconds per view. Lower = faster wobble.',
  'TOP TEXT': 'Show the city name, coordinates, and local time block at the top of each eye.',
  'BOT TEXT': 'Show the weather, UTC time, and eclipse phase block at the bottom of each eye.',
  TELESCOPES: 'Show or hide the telescope grid overlay in the 3D scene.',
  FOCUS: 'Center the 3D camera on the full system, Earth, or the Moon.',
  LOOP: 'Loop playback between the start and end of the Boston/Santiago overlap window.',
  SQUEEZE: 'Horizontally squeeze (>100%) or stretch (<100%) each eye image — useful when the downstream display alters aspect ratio (e.g. half-SBS 3D TVs).',
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
// Primary viewing-method choice. Each method maps to an `encoding` via
// setMethod(); the matching secondary control (LAYOUT / WIGGLE / COLOR) is shown
// contextually below. `split` is the raw stereo pair (side-by-side label, but
// LAYOUT also offers top-bottom).
const METHOD_OPTS: { v: Method; l: string }[] = [
  { v: 'split',    l: 'side-by-side'        },
  { v: 'wiggle',   l: 'wiggle (no glasses)' },
  { v: 'anaglyph', l: 'anaglyph (glasses)'  },
  { v: 'shutter',  l: 'shutter (DLP)'       },
];
// Friendly labels for the anaglyph color variants (the COLOR sub-control).
const ANAGLYPH_LABELS: Partial<Record<Encoding, string>> = {
  'anaglyph-rc': 'red / cyan',
  'anaglyph-rc-dubois': 'red / cyan (dubois)',
  'anaglyph-gm': 'green / magenta',
  'anaglyph-amber': 'amber / blue',
};
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

function MethodSelect() {
  return (
    <select
      value={method.value}
      onChange={(e) => setMethod((e.target as HTMLSelectElement).value as Method)}
    >
      {METHOD_OPTS.map((o) => (<option value={o.v}>{o.l}</option>))}
    </select>
  );
}

// COLOR sub-control — shown only for the anaglyph method. Writes the concrete
// anaglyph variant straight to `encoding`.
function AnaglyphSelect() {
  return (
    <select
      value={encoding.value}
      onChange={(e) => (encoding.value = (e.target as HTMLSelectElement).value as Encoding)}
    >
      {ANAGLYPH_ENCODINGS.map((v) => (<option value={v}>{ANAGLYPH_LABELS[v]}</option>))}
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

function SqueezeSlider({ width = 100 }: { width?: number }) {
  return (
    <div class="flex items-center gap-2">
      <input
        type="range"
        min={50}
        max={200}
        value={squeezePct.value}
        onInput={(e) => (squeezePct.value = parseInt((e.target as HTMLInputElement).value))}
        style={{ width }}
      />
      <span style={{ fontSize: 11, opacity: 0.7, minWidth: 36, textAlign: 'right' }}>
        {squeezePct.value}%
      </span>
      <button
        type="button"
        onClick={() => (squeezePct.value = 100)}
        style={{ padding: '2px 6px', fontSize: 10, opacity: 0.7 }}
        title="Reset squeeze to 100%"
      >
        reset
      </button>
    </div>
  );
}

// Wiggle speed: ms each eye is shown before swapping. Lower = faster wobble.
function WiggleSlider({ width = 100 }: { width?: number }) {
  return (
    <div class="flex items-center gap-2">
      <input
        type="range"
        min={80}
        max={400}
        step={10}
        value={wiggleMs.value}
        onInput={(e) => (wiggleMs.value = parseInt((e.target as HTMLInputElement).value))}
        style={{ width }}
      />
      <span style={{ fontSize: 11, opacity: 0.7, minWidth: 44, textAlign: 'right' }}>
        {wiggleMs.value}ms
      </span>
      <button
        type="button"
        onClick={() => (wiggleMs.value = 150)}
        style={{ padding: '2px 6px', fontSize: 10, opacity: 0.7 }}
        title="Reset wiggle speed to 150ms"
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
      <IntroductionControls orientation="vertical" />
    </div>
  );
}

// ---------- Shared control groups (both orientations) ----------

export function StereoControls({ orientation }: { orientation: Orientation }) {
  // Stereo (videos) controls only — these settings (source switch, frame
  // correction, eye-overlay text toggles, parallax) are about the live
  // telescope footage, not the orbital diagram. The introduction view has
  // its own minimal control group.
  if (view.value !== 'stereo') return null;

  if (orientation === 'vertical') {
    return (
      <>
        <VRow label="METHOD"><MethodSelect /></VRow>
        {method.value === 'split' && (
          <VRow label="LAYOUT"><LayoutSelect /></VRow>
        )}
        {method.value === 'wiggle' && (
          <VRow label="WIGGLE"><WiggleSlider width={100} /></VRow>
        )}
        {method.value === 'anaglyph' && (
          <VRow label="COLOR"><AnaglyphSelect /></VRow>
        )}
        <VRow label="SOURCE"><SourceToggle /></VRow>
        <VRow label="CORRECTION">
          <Switch checked={correction.value} onToggle={() => (correction.value = !correction.value)} />
        </VRow>
        <VRow label="FLIP HEAD">
          <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
        </VRow>
        <VRow label="PARALLAX"><ParallaxSlider width={100} /></VRow>
        <VRow label="SQUEEZE"><SqueezeSlider width={100} /></VRow>
        <VRow label="LOOP">
          <Switch checked={loopOverlap.value} onToggle={() => (loopOverlap.value = !loopOverlap.value)} />
        </VRow>
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
      <HCell label="METHOD"><MethodSelect /></HCell>
      {method.value === 'split' && (
        <HCell label="LAYOUT"><LayoutSelect /></HCell>
      )}
      {method.value === 'wiggle' && (
        <HCell label="WIGGLE"><WiggleSlider width={120} /></HCell>
      )}
      {method.value === 'anaglyph' && (
        <HCell label="COLOR"><AnaglyphSelect /></HCell>
      )}
      <HCell label="SOURCE"><SourceToggle /></HCell>
      <HCell label="CORRECTION">
        <Switch checked={correction.value} onToggle={() => (correction.value = !correction.value)} />
      </HCell>
      <HCell label="FLIP HEAD">
        <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
      </HCell>
      <HCell label="PARALLAX"><ParallaxSlider width={120} /></HCell>
      <HCell label="SQUEEZE"><SqueezeSlider width={120} /></HCell>
      <HCell label="LOOP">
        <Switch checked={loopOverlap.value} onToggle={() => (loopOverlap.value = !loopOverlap.value)} />
      </HCell>
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

// Controls relevant to the introduction view. The diagram is mono and there's
// no video source here, so the only knob that changes what the user sees is
// flip-head (for upside-down headsets / lying on your back).
export function IntroductionControls({ orientation }: { orientation: Orientation }) {
  if (view.value !== 'introduction') return null;

  if (orientation === 'vertical') {
    return (
      <VRow label="FLIP HEAD">
        <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
      </VRow>
    );
  }

  return (
    <HCell label="FLIP HEAD">
      <Switch checked={flipHead.value} onToggle={() => (flipHead.value = !flipHead.value)} />
    </HCell>
  );
}
