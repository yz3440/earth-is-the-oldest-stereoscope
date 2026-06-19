import { useEffect } from 'preact/hooks';
import {
  showIntro,
  closeIntroduction,
  introductionPage,
  INTRODUCTION_PAGE_COUNT,
  nextIntroductionPage,
  prevIntroductionPage,
  videosReady,
  loadProgress,
  currentTime,
  isNarrow,
} from '../state';
import { computeFrame, AU_TO_KM } from '../astronomy';
import type { JSX } from 'preact';

const HEADING_FONT = '"Redaction 35", ui-serif, Georgia, serif';
const ROOFTOP_BOSTON = '/images/rooftop-boston.jpg';
const ROOFTOP_SANTIAGO = '/images/rooftop-santiago.jpg';

// Reference links, sourced from the project writeup on yufengzhao.com.
const PAIK_URL = 'https://njpart.ggcf.kr/collections/215';
const ECLIPSE_URL = 'https://www.timeanddate.com/eclipse/lunar/2026-march-3';
const PIPELINE_URL =
  'https://github.com/yz3440/earth-is-the-oldeest-stereoscope/tree/main/video-processing';

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

function titleEl(text: JSX.Element | string): JSX.Element {
  return (
    <div
      style={{
        fontFamily: HEADING_FONT,
        fontWeight: 400,
        fontSize: 'clamp(22px, 3vw, 30px)',
        lineHeight: 1.08,
        letterSpacing: '-0.01em',
        color: 'var(--text)',
      }}
    >
      {text}
    </div>
  );
}

function Figure({ src, caption }: { src: string; caption: string }) {
  return (
    <figure style={{ margin: 0 }}>
      <img
        src={src}
        alt={caption}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          border: '1px solid var(--line)',
        }}
      />
      <figcaption
        style={{
          fontSize: 10,
          letterSpacing: '0.04em',
          color: 'var(--text-3)',
          marginTop: 4,
        }}
      >
        {caption}
      </figcaption>
    </figure>
  );
}

// Compact live readout of the one tangible number — how small the Moon's
// stereo angle is across an Earth-scale baseline. Computed from the current
// frame so it stays correct wherever the playhead sits.
function StatRow() {
  const frame = computeFrame(new Date(currentTime.value));
  const baselineKm =
    vecLengthAU({
      x: frame.bostonPos.x - frame.santiagoPos.x,
      y: frame.bostonPos.y - frame.santiagoPos.y,
      z: frame.bostonPos.z - frame.santiagoPos.z,
    }) * AU_TO_KM;
  const moonKm = vecLengthAU(frame.moonPos) * AU_TO_KM;
  const parallaxDeg = frame.parallax;
  const cell = (label: string, value: string) => (
    <span style={{ whiteSpace: 'nowrap' }}>
      {label} <span style={{ color: 'var(--text)' }}>{value}</span>
    </span>
  );
  return (
    <div
      style={{
        display: 'flex',
        gap: 18,
        flexWrap: 'wrap',
        fontSize: 11,
        color: 'var(--text-3)',
        borderTop: '1px solid var(--line-2)',
        paddingTop: 8,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {cell('Baseline', `${Math.round(baselineKm).toLocaleString()} km`)}
      {cell('Moon', `${Math.round(moonKm).toLocaleString()} km`)}
      {cell('Parallax', `${parallaxDeg.toFixed(2)}°`)}
    </div>
  );
}

const bodyText = { fontSize: 13, lineHeight: 1.6, color: 'var(--text-2)' } as const;
function em(t: string): JSX.Element {
  return <span style={{ color: 'var(--text)' }}>{t}</span>;
}
function A({
  href,
  children,
  italic,
}: {
  href: string;
  children: JSX.Element | string;
  italic?: boolean;
}): JSX.Element {
  return (
    <a
      href={href}
      target='_blank'
      rel='noreferrer noopener'
      style={{
        color: 'var(--text)',
        textDecoration: 'underline',
        textUnderlineOffset: 2,
        fontStyle: italic ? 'italic' : undefined,
      }}
    >
      {children}
    </a>
  );
}

type PageContent = { title: JSX.Element; body: JSX.Element };

// Page 0 — the concept. The Paik reframe and the homology that gives the
// piece its title: two people far apart, one Moon, a planet-scale stereoscope.
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
      <div style={bodyText}>
        <p style={{ margin: '0 0 10px' }}>
          A reframe of Nam June Paik's{' '}
          <A href={PAIK_URL} italic>
            Moon is the Oldest TV
          </A>{' '}
          (1965), a natural object used as a technical medium.
        </p>
        <p style={{ margin: 0 }}>
          When two people are far apart and miss each other, they look up at the
          same Moon. In that moment they become a pair of eyes separated by half
          a planet, and the Moon is what their two gazes agree on. {em('Two viewpoints, one subject, and that is a stereoscope.')}
        </p>
      </div>
    ),
  };
}

// Page 1 — the concept made literal: two rooftops, two seasons, one Moon.
// The photographs carry the human story (and the real imperfection — clouds,
// snow, a season apart) better than any diagram.
function page1Content(): PageContent {
  return {
    title: titleEl(
      <>
        Two Rooftops,
        <br />
        One Moon
      </>,
    ),
    body: (
      <div style={bodyText}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isNarrow.value ? '1fr' : '1fr 1fr',
            gap: 8,
            margin: '0 0 12px',
          }}
        >
          <Figure src={ROOFTOP_BOSTON} caption='Boston, end of winter — 42.36°N' />
          <Figure src={ROOFTOP_SANTIAGO} caption='Santiago, late summer — 33.45°S' />
        </div>
        <p style={{ margin: '0 0 10px' }}>
          During the{' '}
          <A href={ECLIPSE_URL}>lunar eclipse of March 2–3, 2026</A>, Carlos and I
          were separated by a season. His rooftop was summer. Mine was still
          snowed in. We pointed
          the same telescope at the same Moon at the same second, about{' '}
          {em('7,800 km')} apart, and brought the two images back together.
        </p>
        <p style={{ margin: '0 0 12px' }}>
          Your left eye sees what Boston saw. Your right eye sees what Santiago
          saw. A version of the Moon {em('that no single observer on Earth can see')}.
        </p>
        <p style={{ margin: '0 0 12px' }}>
          Your eyes sit about {em('6 cm')} apart. Boston and Santiago sit{' '}
          {em('7,800 km')} apart. For these few minutes, you are looking at the
          Moon as if your head were the size of the Earth.
        </p>
        <StatRow />
      </div>
    ),
  };
}

// Page 2 — the implementation, briefly, and how to actually see the depth.
function page2Content(): PageContent {
  return {
    title: titleEl(
      <>
        How It's Made,
        <br />
        How to See It
      </>,
    ),
    body: (
      <div style={bodyText}>
        <p style={{ margin: '0 0 10px' }}>
          Each telescope is on an alt-azimuth mount, so the Moon rotates through
          the frame as the sky turns. The two mounts see different rotation
          because they are in different hemispheres. Every frame is{' '}
          <A href={PIPELINE_URL}>stabilized, derotated, and aligned</A> to a
          single shared {em('Boston–Santiago baseline')},
          the only condition under which two eyes can fuse the pair. The browser
          recomputes the alignment live, in a shader.
        </p>
        <p style={{ margin: '0 0 10px' }}>
          By default the two views {em('alternate a few times a second')}, a
          wiggle. Your eye reads the back-and-forth as depth, with no glasses and
          no special screen.
        </p>
        <div style={{ marginBottom: 4 }}>
          {em('TAB')} simulation &nbsp;·&nbsp; {em('SPACE')} play / pause
          &nbsp;·&nbsp; {em('F')} fullscreen
        </div>
        <p style={{ margin: '8px 0 0', color: 'var(--text-3)' }}>
          Open {em('CONTROLS')} for red/cyan anaglyph, a stereoscope side-by-side,
          or shutter-glasses modes.
        </p>
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
    default:
      return page2Content();
  }
}

function IntroductionCard({
  page,
  ready,
  progress,
  isLast,
}: {
  page: number;
  ready: boolean;
  progress: number;
  isLast: boolean;
}) {
  const { title, body } = pageContent(page);

  return (
    <div
      style={{
        position: 'relative',
        pointerEvents: 'auto',
        width: 'min(600px, calc(100vw - 32px))',
        maxHeight: 'calc(100dvh - 132px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: '22px 24px 16px',
        background: 'rgba(0,0,0,0.82)',
        border: '1px solid var(--line)',
        boxShadow: '0 12px 50px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {title}
      <div style={{ borderTop: '1px solid var(--line-2)' }} />
      {body}

      <div style={{ paddingTop: 12, marginTop: 'auto', borderTop: '1px solid var(--line-2)' }}>
        {/* Ambient load progress — never blocks ENTER. Entering before the
            videos finish just shows the loading placeholder in the stereo
            view, then auto-plays once ready. */}
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
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <PageDots count={INTRODUCTION_PAGE_COUNT} current={page} />
            <button
              type='button'
              onClick={closeIntroduction}
              style={{
                padding: '4px 8px',
                fontSize: 10,
                letterSpacing: '0.18em',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-3)',
                cursor: 'pointer',
              }}
              title='Skip the intro (Esc)'
            >
              SKIP
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
              onClick={nextIntroductionPage}
              style={{
                padding: '6px 18px',
                fontSize: 11,
                letterSpacing: '0.18em',
                border: '1px solid var(--text-2)',
                color: 'var(--text)',
                cursor: 'pointer',
              }}
            >
              {isLast ? 'ENTER' : 'NEXT'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function IntroductionView() {
  const active = showIntro.value;
  const page = introductionPage.value;
  const ready = videosReady.value;
  const progress = loadProgress.value;
  const isLast = page >= INTRODUCTION_PAGE_COUNT - 1;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeIntroduction();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
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
  }, [active]);

  if (!active) return null;

  // Centered modal card over the stereo video. A faint scrim lifts text
  // contrast over the Moon footage without hiding it; the card itself scrolls
  // if the content is taller than the viewport (e.g. the rooftops page on a
  // short screen).
  return (
    <div
      style={{
        position: 'fixed',
        zIndex: 100,
        inset: 0,
        pointerEvents: 'none',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '24px 16px 72px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0.55), rgba(0,0,0,0.32))',
          pointerEvents: 'none',
        }}
      />
      <IntroductionCard page={page} ready={ready} progress={progress} isLast={isLast} />
    </div>
  );
}
