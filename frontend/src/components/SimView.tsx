import { useEffect, useRef } from 'preact/hooks';
import type { PlanetaryScene } from '../scene';
import { view, flipHead } from '../state';

export function SimView({ scene }: { scene: PlanetaryScene }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    const el = scene.getDomElement();
    host.appendChild(el);
    scene.attachControls(el);
    const resize = () => scene.resize(host.clientWidth, host.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    return () => {
      ro.disconnect();
      if (el.parentElement === host) host.removeChild(el);
    };
  }, []);

  // The sim canvas stays mounted (so its WebGL context persists) but its
  // host is hidden via display:none when the stereo view is active. This
  // avoids re-initializing Three.js on every tab switch.
  const hidden = view.value !== 'sim';
  const flipped = flipHead.value;
  return (
    <div
      id="sim-canvas-host"
      ref={hostRef}
      class="absolute inset-0"
      style={{
        display: hidden ? 'none' : 'block',
        zIndex: 1,
        pointerEvents: hidden ? 'none' : 'auto',
        // Flip the 3D canvas in place. Three.js and OrbitControls keep their
        // native coordinate frame; only the visual output is rotated.
        transform: flipped ? 'rotate(180deg)' : undefined,
      }}
    />
  );
}
