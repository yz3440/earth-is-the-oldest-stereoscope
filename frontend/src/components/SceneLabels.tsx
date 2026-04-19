// DOM labels floating over the 3D sim view. Each frame, project EARTH / SUN
// / MOON world positions to screen space via `scene.projectLabels()`. When a
// body is in frame, the label sits just above-right of it; when out of
// frame, it clamps to the viewport edge with a directional chevron pointing
// toward where the body actually is.
//
// Updates happen imperatively in a RAF loop (no Preact re-renders per frame)
// so camera motion from OrbitControls stays smooth.

import { useEffect, useRef } from 'preact/hooks';
import type { PlanetaryScene, LabelPos } from '../scene';
import { flipHead } from '../state';

// Celestial bodies — shown always with edge clamping.
const BODIES = ['EARTH', 'SUN', 'MOON'] as const;
// Observer markers — only meaningful when Earth is visible; hidden
// otherwise so they don't cluster at the same viewport edge as EARTH.
const OBSERVERS = ['BOSTON', 'SANTIAGO'] as const;

const ARROW: Record<LabelPos['dir'], string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  none: '',
};

const INVERT_DIR: Record<LabelPos['dir'], LabelPos['dir']> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
  none: 'none',
};

export function SceneLabels({ scene }: { scene: PlanetaryScene }) {
  const wrapRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const arrowRefs = useRef<Record<string, HTMLSpanElement | null>>({});

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const canvas = scene.getDomElement();
      const w = canvas.clientWidth || canvas.width;
      const h = canvas.clientHeight || canvas.height;
      const positions = scene.projectLabels();
      // When the sim host is CSS-rotated 180° (flipHead), body positions in
      // screen space mirror around the center, and chevron directions invert.
      const flipped = flipHead.value;
      if (flipped) {
        for (const p of positions) {
          p.x = w - p.x;
          p.y = h - p.y;
          p.dir = INVERT_DIR[p.dir];
        }
      }
      const earth = positions.find((p) => p.name === 'EARTH');
      const showObservers = !!earth && earth.inFrame;
      for (const p of positions) {
        const wrap = wrapRefs.current[p.name];
        if (!wrap) continue;

        // Observer markers (BOSTON/SANTIAGO) only shown when Earth itself is
        // in view. When Earth is off-frame they'd clamp to the same edge.
        const isObserver = p.name === 'BOSTON' || p.name === 'SANTIAGO';
        if (isObserver && !showObservers) {
          wrap.style.opacity = '0';
          continue;
        }

        // Compose the transform from a pixel offset (`px, py`) and a
        // self-size translation (`ax, ay` in %). The %-translate shifts by
        // the label's own measured dimensions — this is how we right-anchor
        // or bottom-anchor without measuring text width in JS.
        let px = p.x;
        let py = p.y;
        let ax = '0';       // x self-shift: 0 | -50% | -100%
        let ay = '0';

        if (p.inFrame) {
          // Body visible — float above-right of it, but flip to above-left
          // when the body is near the right edge so the label stays inside.
          if (p.x > w * 0.7) {
            px -= 10;
            ax = '-100%';   // right edge of label sits at (px, py)
          } else {
            px += 10;
          }
          py -= 18;         // sit just above the body
        } else {
          // Clamped to an edge — anchor the near edge of the label to the
          // clamp point and center the orthogonal axis.
          if (p.dir === 'right')      { ax = '-100%'; ay = '-50%'; }
          else if (p.dir === 'left')  { ax = '0';     ay = '-50%'; }
          else if (p.dir === 'up')    { ax = '-50%';  ay = '0';    }
          else if (p.dir === 'down')  { ax = '-50%';  ay = '-100%'; }
        }

        wrap.style.transform = `translate(${px}px, ${py}px) translate(${ax}, ${ay})`;
        wrap.style.opacity = p.inFrame ? '0.9' : '1';

        const arrow = arrowRefs.current[p.name];
        if (arrow) arrow.textContent = p.inFrame ? '' : ' ' + ARROW[p.dir];
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [scene]);

  return (
    <div class="absolute inset-0 pointer-events-none" style={{ zIndex: 8 }}>
      {BODIES.map((name) => (
        <div
          key={name}
          ref={(el) => { wrapRefs.current[name] = el; }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            padding: '2px 6px',
            fontSize: 10,
            letterSpacing: '0.22em',
            color: 'var(--text)',
            textShadow: '0 0 3px #000, 0 0 6px #000, 0 0 10px #000',
            whiteSpace: 'nowrap',
            transform: 'translate(-1000px, -1000px)',
            willChange: 'transform',
          }}
        >
          {name}
          <span
            ref={(el) => { arrowRefs.current[name] = el; }}
            style={{ opacity: 0.7 }}
          />
        </div>
      ))}
      {OBSERVERS.map((name) => {
        // Match EyeOverlay / TelescopeGrid convention: flipHead swaps which
        // station feeds which eye (Boston=L by default; Boston=R when
        // flipped). Accessing the signal here makes the label reactive.
        const flipped = flipHead.value;
        const eye: 'L' | 'R' =
          name === 'BOSTON' ? (flipped ? 'R' : 'L') : (flipped ? 'L' : 'R');
        return (
          <div
            key={name}
            ref={(el) => { wrapRefs.current[name] = el; }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              padding: '1px 5px',
              fontSize: 9,
              letterSpacing: '0.18em',
              color: 'var(--text-2)',
              textShadow: '0 0 3px #000, 0 0 6px #000',
              whiteSpace: 'nowrap',
              transform: 'translate(-1000px, -1000px)',
              willChange: 'transform, opacity',
              transition: 'opacity 0.2s',
              opacity: 0,
            }}
          >
            {name}
            <span style={{ opacity: 0.6, letterSpacing: 0, marginLeft: 4 }}>
              ({eye})
            </span>
            <span
              ref={(el) => { arrowRefs.current[name] = el; }}
              style={{ opacity: 0.6 }}
            />
          </div>
        );
      })}
    </div>
  );
}
