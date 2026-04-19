import { useEffect, useRef } from 'preact/hooks';
import {
  currentTime,
  playing,
  videosReady,
  rateIdx,
  view,
  panelOpen,
  RATE_STEPS,
  DEFAULT_RATE_INDEX,
  isNarrow,
  isCompact,
} from '../state';
import { SIM_START, SIM_END } from '../astronomy';
import { ControlPanelBody } from './ControlPanel';

const fmtUTC = (d: Date) => d.toISOString().slice(11, 16) + ' UTC';

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function setRate(i: number) {
  rateIdx.value = clamp(i, 0, RATE_STEPS.length - 1);
}

function Tab({ id, label }: { id: 'stereo' | 'sim'; label: string }) {
  const active = view.value === id;
  // Bare-text nav, not a boxed control: strip border/background so the tab
  // reads as inline navigation alongside the heavier play / rate / CONTROLS
  // buttons. Active state = full-brightness text + underline; inactive =
  // `--text-3` with transparent underline (keeps baseline constant).
  return (
    <button
      type='button'
      onClick={() => (view.value = id)}
      class='tab-bare'
      style={{
        padding: '4px 6px',
        fontSize: 11,
        letterSpacing: '0.06em',
        color: active ? 'var(--text)' : 'var(--text-3)',
        borderBottom: active
          ? '1px solid var(--text)'
          : '1px solid transparent',
      }}
    >
      {label}
    </button>
  );
}

function ControlsPopover({
  anchorRef,
}: {
  anchorRef: { current: HTMLElement | null };
}) {
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelOpen.value) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return;
      panelOpen.value = false;
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [panelOpen.value]);

  if (!panelOpen.value) return null;

  // Position the popover relative to the anchor button. Compute anchor's
  // right edge so the popover's right edge aligns — feels attached.
  const a = anchorRef.current?.getBoundingClientRect();
  const rightPx = a ? Math.max(8, window.innerWidth - a.right) : 200;

  return (
    <div
      ref={popRef}
      style={{
        position: 'fixed',
        bottom: 44,
        right: rightPx,
        zIndex: 40,
        background: 'rgba(0,0,0,0.92)',
        border: '1px solid rgba(255,255,255,0.22)',
        boxShadow: '0 0 12px rgba(255,255,255,0.06)',
      }}
    >
      <ControlPanelBody />
    </div>
  );
}

export function BottomBar() {
  const narrow = isNarrow.value;
  const compact = isCompact.value;
  const nowStr =
    new Date(currentTime.value).toISOString().slice(11, narrow ? 16 : 19) +
    ' UTC';
  const anchorRef = useRef<HTMLButtonElement>(null);

  const gap = narrow ? 6 : 12;
  const padX = narrow ? 8 : 14;

  return (
    <div
      class='absolute left-0 right-0 bottom-0 flex items-center'
      style={{
        height: 40,
        zIndex: 20,
        background: 'rgba(0,0,0,0.85)',
        borderTop: '1px solid var(--line-2)',
        padding: `0 ${padX}px`,
        gap,
      }}
    >
      <button
        type='button'
        disabled={!videosReady.value}
        onClick={() => (playing.value = !playing.value)}
        style={{ width: 32, height: 24, padding: 0, flex: 'none' }}
        title='Play/Pause (space)'
      >
        {playing.value ? '❚❚' : '▶'}
      </button>

      <button
        type='button'
        disabled={!videosReady.value}
        onClick={() => setRate(rateIdx.value - 1)}
        style={{ width: 24, height: 24, padding: 0, flex: 'none' }}
        title='Slower ( [ )'
      >
        ◀
      </button>
      <span
        style={{
          minWidth: 36,
          textAlign: 'center',
          fontSize: 11,
          opacity: 0.85,
          flex: 'none',
        }}
        title='Reset with 0'
      >
        {RATE_STEPS[rateIdx.value]}×
      </span>
      <button
        type='button'
        disabled={!videosReady.value}
        onClick={() => setRate(rateIdx.value + 1)}
        style={{ width: 24, height: 24, padding: 0, flex: 'none' }}
        title='Faster ( ] )'
      >
        ▶
      </button>

      {/* Clock — hidden entirely on narrow viewports (progress-bar hover/
          scrub already surfaces exact times). Desktop also shows the
          sim-window range in dim text. */}
      {!narrow && (
        <div
          class='flex items-center gap-2'
          style={{ marginLeft: 6, opacity: 0.7, fontSize: 11, flex: 'none' }}
        >
          <span style={{ minWidth: 72 }}>{nowStr}</span>
          {!compact && (
            <span style={{ opacity: 0.5 }}>
              {fmtUTC(SIM_START)} → {fmtUTC(SIM_END)}
            </span>
          )}
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }} />

      <button
        ref={anchorRef}
        type='button'
        onClick={() => (panelOpen.value = !panelOpen.value)}
        style={{
          padding: narrow ? '4px 8px' : '4px 12px',
          fontSize: 11,
          letterSpacing: narrow ? '0.06em' : '0.12em',
          border: panelOpen.value
            ? '1px solid var(--text)'
            : '1px solid var(--line)',
          background: panelOpen.value ? 'var(--accent-fill)' : 'transparent',
          flex: 'none',
        }}
      >
        {narrow ? 'CTRL' : 'CONTROLS'} {panelOpen.value ? '▴' : '▾'}
      </button>

      <div
        class='flex items-center'
        style={{ gap: narrow ? 4 : 8, flex: 'none' }}
      >
        <Tab id='stereo' label={narrow ? 'ST' : 'STEREOSCOPY'} />
        <Tab id='sim' label={narrow ? 'SIM' : 'SIMULATION'} />
      </div>

      <ControlsPopover anchorRef={anchorRef} />
    </div>
  );
}

export { setRate, DEFAULT_RATE_INDEX };
