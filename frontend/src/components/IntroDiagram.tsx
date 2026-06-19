// A small, self-contained interactive 3D diagram for intro page 0: the
// Earth–Moon system seen "as a head" — the Boston→Santiago baseline horizontal
// on screen, Boston on the LEFT, Santiago on the RIGHT, with the two gaze lines
// fanning toward the Moon. It owns its OWN WebGL context (Three.js GPU
// resources are context-bound, so we can't share the full-screen PlanetaryScene
// here) and builds a stylized, basic-material version of the scene. Mounted
// only inside the page-0 card, so it lives and dies with that page; the effect
// cleanup disposes everything to keep repeated open/close from leaking contexts.

import { useEffect, useRef } from 'preact/hooks';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeFrame, AU_TO_ER } from '../astronomy';
import { currentTime } from '../state';

// J2000 (AU) → scene axes, matching scene.ts `toThree`: (x, z, -y).
function swiz(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.z, -v.y);
}

export function IntroDiagram() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return; // WebGL unavailable → leave the empty bordered box
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 1);
    const w0 = host.clientWidth || 320;
    const h0 = host.clientHeight || 220;
    renderer.setSize(w0, h0, false);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    const scene = new THREE.Scene();
    const VFOV = 40;
    const camera = new THREE.PerspectiveCamera(VFOV, w0 / h0, 0.1, 5000);

    // Track every GPU resource so cleanup can dispose all of them.
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    // --- positions: snapshot once (peek, no clock subscription) ---
    const frame = computeFrame(new Date(currentTime.peek()));
    const bostonP = swiz(frame.bostonPos).multiplyScalar(AU_TO_ER); // ~1 ER (surface)
    const santiagoP = swiz(frame.santiagoPos).multiplyScalar(AU_TO_ER);
    // The true Moon sits ~60 ER away with radius ~0.27 ER — a sub-pixel dot at
    // any framing that also shows the Earth. We compress the distance along the
    // true direction (keeps the baseline/gaze story, exaggerates the ~1° vergence
    // into something legible) but keep the Moon clearly SMALLER than the Earth
    // (radius 1) so it reads realistically rather than cartoonishly large.
    const MOON_VIS_DIST = 16; // Earth→Moon distance in the diagram (true ≈ 60)
    const MOON_VIS_R = 0.5; //   Moon mesh radius, Earth = 1 (true ratio ≈ 0.27)
    const moonP = swiz(frame.moonPos).normalize().multiplyScalar(MOON_VIS_DIST);

    // --- Earth wireframe + rotation axis ---
    const earthGeo = new THREE.SphereGeometry(1, 28, 18);
    const earthMat = new THREE.MeshBasicMaterial({
      color: 0x6a7ba5,
      wireframe: true,
      transparent: true,
      opacity: 0.45,
    });
    geometries.push(earthGeo);
    materials.push(earthMat);
    const earth = new THREE.Mesh(earthGeo, earthMat);
    earth.rotation.y = frame.gastRad;
    scene.add(earth);

    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -1.4, 0),
      new THREE.Vector3(0, 1.4, 0),
    ]);
    const axisMat = new THREE.LineBasicMaterial({ color: 0x8899bb, transparent: true, opacity: 0.3 });
    geometries.push(axisGeo);
    materials.push(axisMat);
    earth.add(new THREE.Line(axisGeo, axisMat));

    // --- Moon ---
    const moonGeo = new THREE.SphereGeometry(MOON_VIS_R, 28, 20);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xb9bdc6 });
    geometries.push(moonGeo);
    materials.push(moonMat);
    const moon = new THREE.Mesh(moonGeo, moonMat);
    moon.position.copy(moonP);
    scene.add(moon);

    // --- observer markers (shared geometry) ---
    const markerGeo = new THREE.SphereGeometry(0.07, 14, 10);
    geometries.push(markerGeo);
    const bostonMat = new THREE.MeshBasicMaterial({ color: 0xbcd2ff });
    const santiagoMat = new THREE.MeshBasicMaterial({ color: 0xffd8b0 });
    materials.push(bostonMat, santiagoMat);
    const bostonMk = new THREE.Mesh(markerGeo, bostonMat);
    const santiagoMk = new THREE.Mesh(markerGeo, santiagoMat);
    bostonMk.position.copy(bostonP);
    santiagoMk.position.copy(santiagoP);
    scene.add(bostonMk, santiagoMk);

    // --- gaze lines (observer→Moon) + baseline (Boston↔Santiago) ---
    const gazeMat = new THREE.LineBasicMaterial({
      color: 0xaaaaaa,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });
    const baseMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.75,
      depthTest: false,
    });
    materials.push(gazeMat, baseMat);
    const addLine = (a: THREE.Vector3, b: THREE.Vector3, mat: THREE.LineBasicMaterial) => {
      const g = new THREE.BufferGeometry().setFromPoints([a.clone(), b.clone()]);
      geometries.push(g);
      const line = new THREE.Line(g, mat);
      line.renderOrder = 10;
      scene.add(line);
    };
    addLine(bostonP, moonP, gazeMat);
    addLine(santiagoP, moonP, gazeMat);
    addLine(bostonP, santiagoP, baseMat);

    // --- starfield ---
    // NOTE: these stars are FAKE — uniformly-random points on a shell, not real
    // star positions or constellations (the main sim does the same). Per-point
    // brightness (skewed dim) just makes the field read more like a real sky.
    // To make them real, sample a bright-star catalog (RA/Dec + magnitude).
    const STAR_N = 500;
    const STAR_SHELL = 600;
    const starPos = new Float32Array(STAR_N * 3);
    const starCol = new Float32Array(STAR_N * 3);
    for (let i = 0; i < STAR_N; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPos[i * 3 + 0] = Math.cos(t) * r * STAR_SHELL;
      starPos[i * 3 + 1] = u * STAR_SHELL;
      starPos[i * 3 + 2] = Math.sin(t) * r * STAR_SHELL;
      const b = 0.35 + Math.random() * Math.random() * 0.65; // skew toward dim
      starCol[i * 3 + 0] = b;
      starCol[i * 3 + 1] = b;
      starCol[i * 3 + 2] = b;
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({
      size: 1.4,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
    });
    geometries.push(starGeo);
    materials.push(starMat);
    scene.add(new THREE.Points(starGeo, starMat));

    // --- camera: hand-tuned pose (dialed in interactively). The numbers are in
    // the diagram's own scene units; the intro always opens at the same fixed
    // instant, so the Earth/Moon geometry — and this framing — reproduce exactly.
    // A three-quarter view from behind the Earth looking toward the Moon.
    camera.up.set(0.884, 0.02, -0.467); // set up BEFORE controls
    camera.position.set(5.183, -2.21, -2.856);
    const target = new THREE.Vector3(-6.061, 1.315, -0.231);
    const D = camera.position.distanceTo(target);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.rotateSpeed = 0.6;
    controls.minDistance = D * 0.5;
    controls.maxDistance = D * 2.2;
    controls.target.copy(target);
    controls.update();

    controls.update();

    // --- labels (imperative; reprojected each frame, no Preact re-render) ---
    const labelLayer = document.createElement('div');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
    host.appendChild(labelLayer);
    const makeLabel = (text: string, suffix?: string) => {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;top:0;left:0;font-size:9px;letter-spacing:0.16em;' +
        'color:var(--text-2);text-shadow:0 0 3px #000,0 0 6px #000;' +
        'white-space:nowrap;will-change:transform,opacity;';
      el.textContent = text;
      if (suffix) {
        const s = document.createElement('span');
        s.style.cssText = 'opacity:0.6;margin-left:4px;';
        s.textContent = suffix;
        el.appendChild(s);
      }
      labelLayer.appendChild(el);
      return el;
    };
    const labels: { el: HTMLDivElement; pos: THREE.Vector3 }[] = [
      { el: makeLabel('EARTH'), pos: new THREE.Vector3(0, 0, 0) },
      { el: makeLabel('MOON'), pos: moonP },
      { el: makeLabel('BOSTON', '(L)'), pos: bostonP },
      { el: makeLabel('SANTIAGO', '(R)'), pos: santiagoP },
    ];

    // --- render loop ---
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
      const cw = canvas.clientWidth || w0;
      const ch = canvas.clientHeight || h0;
      for (const l of labels) {
        const v = l.pos.clone().project(camera);
        const off = v.z > 1 || Math.abs(v.x) > 1.15 || Math.abs(v.y) > 1.15;
        if (off) {
          l.el.style.opacity = '0';
          continue;
        }
        const sx = (v.x * 0.5 + 0.5) * cw;
        const sy = (-v.y * 0.5 + 0.5) * ch;
        l.el.style.opacity = '0.9';
        l.el.style.transform = `translate(${sx + 8}px, ${sy - 6}px)`;
      }
    };
    tick();

    const ro = new ResizeObserver(() => {
      const cw = host.clientWidth || w0;
      const ch = host.clientHeight || h0;
      renderer.setSize(cw, ch, false);
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
    });
    ro.observe(host);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      renderer.forceContextLoss();
      renderer.dispose();
      if (canvas.parentElement) canvas.parentElement.removeChild(canvas);
      if (labelLayer.parentElement) labelLayer.parentElement.removeChild(labelLayer);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      style={{
        position: 'relative',
        width: '100%',
        height: 220,
        margin: '0 0 14px',
        border: '1px solid var(--line)',
        background: '#000',
        overflow: 'hidden',
        touchAction: 'none',
        cursor: 'grab',
      }}
    />
  );
}
