import { useEffect, useRef } from 'preact/hooks';
import type { PlanetaryScene } from '../scene';
import { view, flipHead, simStereo } from '../state';

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
  // host is hidden via display:none when the stereo (videos) view is
  // active. The introduction view also uses this host as its background,
  // so it stays visible there too.
  const hidden = view.value === 'stereo';
  const flipped = flipHead.value;
  // When `simStereo` is on the sibling sim-stereo-canvas (mounted by main.tsx)
  // covers the Three.js canvas; we hide the underlying canvas via display:none
  // so the user only sees the stereo composite. The OrbitControls target is
  // swapped to whichever canvas is visible (handled in main.tsx).
  const simStereoOn = simStereo.value;
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
      data-stereo={simStereoOn ? 'on' : 'off'}
    />
  );
}
