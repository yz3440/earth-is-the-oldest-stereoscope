import { useEffect, useRef } from 'preact/hooks';
import {
  view,
  introductionPage,
  INTRODUCTION_PAGE_COUNT,
  nextIntroductionPage,
  prevIntroductionPage,
  introductionStereo,
  layout,
  encoding,
  videosReady,
  loadProgress,
  currentTime,
  isNarrow,
  introductionCardHeight,
} from '../state';
import { computeFrame, AU_TO_KM } from '../astronomy';
import type { JSX } from 'preact';

const HEADING_FONT = '"Redaction 35", ui-serif, Georgia, serif';

function vecLengthAU(v: { x: number; y: number; z: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function PageDots({ count, current }: { count: number; current: number }) {
  return (
    <div class='flex gap-2 items-center'>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: i === current ? 'var(--text)' : 'var(--line)',
            transition: 'background 120ms',
          }}
        />
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: JSX.Element | string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '4px 0' }}>
      <span
        style={{
          fontSize: 10,
          letterSpacing: '0.12em',
          color: 'var(--text-3)',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

type PageContent = { title: JSX.Element; body: JSX.Element };

function titleEl(text: JSX.Element | string): JSX.Element {
  return (
    <div
      style={{
        fontFamily: HEADING_FONT,
        fontWeight: 400,
        fontSize: 'clamp(20px, 2.4vw, 28px)',
        lineHeight: 1.1,
        letterSpacing: '-0.01em',
        color: 'var(--text)',
      }}
    >
      {text}
    </div>
  );
}

function page0Content(): PageContent {
  return {
    title: titleEl(
      <>
        Earth is the
        <br />
        Oldest Stereoscope
      </>,
    ),
    body: (
      <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-2)' }}>
        <p style={{ margin: '0 0 8px' }}>
          Two telescopes, <span style={{ color: 'var(--text)' }}>Boston</span> and{' '}
          <span style={{ color: 'var(--text)' }}>Santiago</span>, filmed the Moon
          simultaneously through the lunar eclipse of 2026&#8209;03&#8209;03.
        </p>
        <p style={{ margin: 0, color: 'var(--text-3)' }}>
          Made by{' '}
          <a
            href='https://yufengzhao.com'
            target='_blank'
            rel='noreferrer noopener'
            style={{ color: 'var(--text-2)', textDecoration: 'underline' }}
          >
            Yufeng Zhao
          </a>
          , with help from Carlos in Chile.
        </p>
      </div>
    ),
  };
}

function page1Content(): PageContent {
  const frame = computeFrame(new Date(currentTime.value));
  const baselineKm =
    vecLengthAU({
      x: frame.bostonPos.x - frame.santiagoPos.x,
      y: frame.bostonPos.y - frame.santiagoPos.y,
      z: frame.bostonPos.z - frame.santiagoPos.z,
    }) * AU_TO_KM;
  const moonKm = vecLengthAU(frame.moonPos) * AU_TO_KM;
  const parallaxDeg = frame.parallax;
  return {
    title: titleEl('The Angle'),
    body: (
      <div>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-2)', marginBottom: 8 }}>
          Stereo depth comes from the angle between two viewpoints. Across an Earth-scale
          baseline, the Moon&apos;s angle is small.
        </div>
        <div style={{ borderTop: '1px solid var(--line-2)', paddingTop: 6, marginBottom: 8 }}>
          <Stat label='Baseline (Boston ↔ Santiago)' value={`${Math.round(baselineKm).toLocaleString()} km`} />
          <Stat label='Moon distance' value={`${Math.round(moonKm).toLocaleString()} km`} />
          <Stat label='Parallax angle' value={`${parallaxDeg.toFixed(2)}°`} />
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)' }}>
          Human eyes sit ~6 cm apart and focus at ~25 cm — about 14° of stereo angle. From
          Earth, the Moon gets ~1°. That&apos;s why the two videos look almost identical.
        </div>
      </div>
    ),
  };
}

function page2Content(): PageContent {
  return {
    title: titleEl(
      <>
        A Head the
        <br />
        Size of Earth
      </>,
    ),
    body: (
      <div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-2)', marginBottom: 6 }}>
          The diagram behind this card is rendered in stereo as if your head were
          Earth-sized — about 2,500 km between the eyes.
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--text-3)' }}>
          At that scale the Moon is close enough to fuse, and the orbital geometry pops into
          actual depth. The Sun is much further away, so it sits flat on the horizon of
          infinity.
        </div>
      </div>
    ),
  };
}

function page3Content(): PageContent {
  return {
    title: titleEl('How to See It'),
    body: (
      <div style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--text-2)' }}>
        <div>
          <span style={{ color: 'var(--text)' }}>TAB</span> &nbsp;swap between the telescope
          videos and the simulation.
        </div>
        <div>
          <span style={{ color: 'var(--text)' }}>SPACE</span> &nbsp;play / pause.
        </div>
        <div>
          <span style={{ color: 'var(--text)' }}>H</span> &nbsp;flip the head — for
          upside-down headsets or lying on your back.
        </div>
        <div>
          <span style={{ color: 'var(--text)' }}>F</span> &nbsp;fullscreen.
        </div>
      </div>
    ),
  };
}

function pageContent(page: number): PageContent {
  switch (page) {
    case 0:
      return page0Content();
    case 1:
      return page1Content();
    case 2:
      return page2Content();
    case 3:
    default:
      return page3Content();
  }
}

function IntroductionCard({
  page,
  ready,
  progress,
  enterDisabled,
  isLast,
  stereoOn,
  cardWidth,
  measureHeight,
}: {
  page: number;
  ready: boolean;
  progress: number;
  enterDisabled: boolean;
  isLast: boolean;
  stereoOn: boolean;
  cardWidth: string;
  // When true, this card publishes its height to `introductionCardHeight`
  // so the camera framing can lift bodies above it. Only one card in the
  // stereo-duplicated layout should set this — both have identical
  // content, so one measurement is enough.
  measureHeight: boolean;
}) {
  // Two-column (title left, body right) when the card is wide enough —
  // i.e., the user is on a non-stereo single card on a desktop viewport.
  // Stereo mode duplicates the card per eye region (each is half the
  // viewport width), and narrow viewports collapse anyway, so both fall
  // back to a single column.
  const twoColumn = !stereoOn && !isNarrow.value;
  const { title, body } = pageContent(page);

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!measureHeight || !cardRef.current) return;
    const el = cardRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        introductionCardHeight.value = e.contentRect.height;
      }
    });
    ro.observe(el);
    introductionCardHeight.value = el.getBoundingClientRect().height;
    return () => {
      ro.disconnect();
      // Don't clear the signal on unmount — the next mount's measurement
      // takes over and clearing here would briefly drop the camera bias
      // during a remount.
    };
  }, [measureHeight]);

  return (
    <div
      ref={cardRef}
      style={{
        pointerEvents: 'auto',
        width: cardWidth,
        padding: '16px 22px 14px',
        background: 'rgba(0,0,0,0.78)',
        border: '1px solid var(--line)',
        boxShadow: '0 -10px 40px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: twoColumn ? 'row' : 'column',
          gap: twoColumn ? 22 : 10,
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            flex: twoColumn ? '0 0 200px' : '0 0 auto',
            paddingRight: twoColumn ? 22 : 0,
            borderRight: twoColumn ? '1px solid var(--line-2)' : 'none',
          }}
        >
          {title}
        </div>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>{body}</div>
      </div>

      <div style={{ paddingTop: 12, marginTop: 12, borderTop: '1px solid var(--line-2)' }}>
        {!ready && (
          <div
            style={{
              position: 'relative',
              height: 2,
              background: 'var(--line-2)',
              marginBottom: 12,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: '0 auto 0 0',
                width: `${Math.round(progress * 100)}%`,
                background: 'var(--text)',
                transition: 'width 120ms linear',
              }}
            />
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <PageDots count={INTRODUCTION_PAGE_COUNT} current={page} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              type='button'
              onClick={() => (introductionStereo.value = !stereoOn)}
              style={{
                padding: '6px 12px',
                fontSize: 10,
                letterSpacing: '0.18em',
                border: `1px solid ${stereoOn ? 'var(--text-2)' : 'var(--line)'}`,
                color: stereoOn ? 'var(--text)' : 'var(--text-3)',
                background: stereoOn ? 'var(--accent-fill)' : 'transparent',
              }}
              title='Render the orbital diagram in stereo (duplicates this card per eye)'
            >
              STEREO {stereoOn ? '·' : ''}
            </button>
            <button
              type='button'
              onClick={prevIntroductionPage}
              disabled={page === 0}
              style={{
                padding: '6px 14px',
                fontSize: 11,
                letterSpacing: '0.18em',
                border: `1px solid ${page === 0 ? 'var(--line-2)' : 'var(--line)'}`,
                color: page === 0 ? 'var(--text-3)' : 'var(--text-2)',
                cursor: page === 0 ? 'default' : 'pointer',
              }}
            >
              BACK
            </button>
            <button
              type='button'
              onClick={enterDisabled ? undefined : nextIntroductionPage}
              disabled={enterDisabled}
              style={{
                padding: '6px 18px',
                fontSize: 11,
                letterSpacing: '0.18em',
                border: `1px solid ${enterDisabled ? 'var(--line-2)' : 'var(--text-2)'}`,
                color: enterDisabled ? 'var(--text-3)' : 'var(--text)',
                cursor: enterDisabled ? 'default' : 'pointer',
              }}
            >
              {isLast
                ? ready
                  ? 'ENTER'
                  : progress >= 1
                    ? 'DECODING…'
                    : `LOADING ${Math.floor(progress * 100)}%`
                : 'NEXT'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Slot positioning. Each slot fixes a sub-region of the viewport that the
// card is centered into. Used to mirror the card per eye when the stereo
// pair splits the viewport into halves.
type Slot = {
  // CSS positioning style for the outer flex container.
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  height?: string;
  width?: string;
  // Card width inside that slot.
  cardWidth: string;
  // Vertical alignment within the slot — we want the card pinned to the
  // bottom of each eye region so the geometry above it stays unobstructed.
  alignItems: 'flex-end';
};

function slotsForPair(stereoOn: boolean): Slot[] {
  // Mono: single full-width slot, card pinned to the bottom of the screen.
  if (!stereoOn) {
    return [
      {
        left: '0',
        right: '0',
        bottom: '0',
        height: 'auto',
        cardWidth: 'min(720px, calc(100vw - 32px))',
        alignItems: 'flex-end',
      },
    ];
  }
  const enc = encoding.value;
  // Anaglyph and frame-seq don't split the viewport spatially — a single
  // card overlaid on top of the composite is still readable, so don't
  // duplicate.
  if (enc !== 'none') {
    return [
      {
        left: '0',
        right: '0',
        bottom: '0',
        height: 'auto',
        cardWidth: 'min(720px, calc(100vw - 32px))',
        alignItems: 'flex-end',
      },
    ];
  }
  const lay = layout.value;
  if (lay === 'sbs-half' || lay === 'sbs-full') {
    // Side-by-side: viewport split horizontally. Two cards pinned to the
    // bottom of each half.
    return [
      {
        left: '0',
        width: '50vw',
        bottom: '0',
        height: 'auto',
        cardWidth: 'min(360px, calc(50vw - 32px))',
        alignItems: 'flex-end',
      },
      {
        left: '50vw',
        width: '50vw',
        bottom: '0',
        height: 'auto',
        cardWidth: 'min(360px, calc(50vw - 32px))',
        alignItems: 'flex-end',
      },
    ];
  }
  // Top-bottom: viewport split vertically. Pin one card to the bottom of
  // the top half, one to the bottom of the bottom half.
  return [
    {
      left: '0',
      right: '0',
      top: '0',
      height: '50dvh',
      cardWidth: 'min(440px, calc(100vw - 32px))',
      alignItems: 'flex-end',
    },
    {
      left: '0',
      right: '0',
      top: '50dvh',
      height: '50dvh',
      cardWidth: 'min(440px, calc(100vw - 32px))',
      alignItems: 'flex-end',
    },
  ];
}

export function IntroductionView() {
  const active = view.value === 'introduction';
  const page = introductionPage.value;
  const ready = videosReady.value;
  const progress = loadProgress.value;
  const isLast = page >= INTRODUCTION_PAGE_COUNT - 1;
  const enterDisabled = isLast && !ready;
  const stereoOn = introductionStereo.value;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        view.value = 'stereo';
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (isLast && !ready) return;
        e.preventDefault();
        nextIntroductionPage();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevIntroductionPage();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, isLast, ready]);

  if (!active) return null;

  // Read layout/encoding inside render so stereo slot updates reactively.
  const slots = slotsForPair(stereoOn);

  return (
    <>
      {slots.map((slot, i) => (
        <div
          key={i}
          style={{
            position: 'fixed',
            zIndex: 100,
            pointerEvents: 'none',
            display: 'flex',
            justifyContent: 'center',
            alignItems: slot.alignItems,
            padding: '0 16px 80px',
            top: slot.top,
            bottom: slot.bottom,
            left: slot.left,
            right: slot.right,
            width: slot.width,
            height: slot.height,
          }}
        >
          <IntroductionCard
            page={page}
            ready={ready}
            progress={progress}
            enterDisabled={enterDisabled}
            isLast={isLast}
            stereoOn={stereoOn}
            cardWidth={slot.cardWidth}
            measureHeight={i === 0}
          />
        </div>
      ))}
    </>
  );
}
