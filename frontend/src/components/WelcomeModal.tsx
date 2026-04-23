import { useEffect } from 'preact/hooks';
import {
  welcomeOpen,
  dismissWelcome,
  videosReady,
  loadProgress,
} from '../state';

export function WelcomeModal() {
  const open = welcomeOpen.value;
  const ready = videosReady.value;
  const progress = loadProgress.value;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (!ready) return;
      if (e.key === 'Escape' || e.key === 'Enter') dismissWelcome();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, ready]);

  if (!open) return null;

  return (
    <div
      class='fixed inset-0 flex items-center justify-center'
      style={{
        zIndex: 100,
        background: 'rgba(0,0,0,0.82)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
      onClick={() => {
        if (ready) dismissWelcome();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, calc(100vw - 32px))',
          padding: '36px 36px 28px',
          background: 'rgba(0,0,0,0.92)',
          border: '1px solid var(--line)',
          boxShadow: '0 0 40px rgba(255,255,255,0.04)',
        }}
      >
        <h1
          style={{
            fontFamily: '"Redaction 35", ui-serif, Georgia, serif',
            fontWeight: 400,
            fontSize: 'clamp(28px, 5vw, 44px)',
            lineHeight: 1.05,
            letterSpacing: '-0.01em',
            margin: '0 0 20px',
            color: 'var(--text)',
          }}
        >
          Earth is the Oldest
          <br />
          Stereoscope
        </h1>

        <div
          style={{
            fontSize: 12,
            lineHeight: 1.6,
            color: 'var(--text-2)',
            marginBottom: 22,
          }}
        >
          <p style={{ margin: '0 0 12px' }}>
            Two telescopes, <span style={{ color: 'var(--text)' }}>Boston</span>{' '}
            and <span style={{ color: 'var(--text)' }}>Santiago</span>, filmed
            the Moon simultaneously through the lunar eclipse of
            2026&#8209;03&#8209;03.
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

        <div
          style={{
            paddingTop: 16,
            borderTop: '1px solid var(--line-2)',
          }}
        >
          <div
            style={{
              position: 'relative',
              height: 2,
              background: 'var(--line-2)',
              marginBottom: 14,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: '0 auto 0 0',
                width: `${Math.round((ready ? 1 : progress) * 100)}%`,
                background: 'var(--text)',
                transition: 'width 120ms linear',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-3)',
                letterSpacing: '0.08em',
              }}
            >
              TAB · VIEW &nbsp;&nbsp; SPACE · PLAY &nbsp;&nbsp; H · FLIP &nbsp;&nbsp; F · FULL
            </span>
            <button
              type='button'
              onClick={ready ? dismissWelcome : undefined}
              disabled={!ready}
              style={{
                padding: '6px 18px',
                fontSize: 11,
                letterSpacing: '0.18em',
                border: `1px solid ${ready ? 'var(--text-2)' : 'var(--line-2)'}`,
                color: ready ? 'var(--text)' : 'var(--text-3)',
                cursor: ready ? 'pointer' : 'default',
              }}
            >
              {ready
                ? 'ENTER'
                : progress >= 1
                  ? 'DECODING…'
                  : `LOADING ${Math.floor(progress * 100)}%`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
