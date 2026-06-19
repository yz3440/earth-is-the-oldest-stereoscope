import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AU_TO_ER } from './astronomy';
import type { FrameData, Vec3 } from './astronomy';
import { celestialVertexShader, moonFragmentShader, earthFragmentShader } from './shaders';

export type EyeSide = 'boston' | 'santiago';
export type PIPKind = 'raw' | 'corrected';

const MOON_RADIUS_ER = 1737.4 / 6371.0;
const SUN_RADIUS_ER = 696000.0 / 6371.0;
const SHADOW_CONE_LENGTH = 80;

function toThree(v: Vec3, scale: number): THREE.Vector3 {
  return new THREE.Vector3(v.x * scale, v.z * scale, -v.y * scale);
}

export class PlanetaryScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls | null = null;

  private earth: THREE.Mesh;
  private moon: THREE.Mesh;
  private bostonMarker: THREE.Mesh;
  private santiagoMarker: THREE.Mesh;
  private gazeBostonLine: THREE.Line;
  private gazeSantiagoLine: THREE.Line;
  private baselineLine: THREE.Line;
  private umbraCone: THREE.Mesh;
  private penumbraCone: THREE.Mesh;
  private sunMarker: THREE.Mesh;

  private moonMat: THREE.ShaderMaterial;
  private earthMat: THREE.ShaderMaterial;

  private bostonRawCam: THREE.PerspectiveCamera;
  private bostonCorrectedCam: THREE.PerspectiveCamera;
  private santiagoRawCam: THREE.PerspectiveCamera;
  private santiagoCorrectedCam: THREE.PerspectiveCamera;

  // Camera tween state. Drives a smooth interpolation of `this.camera.position`,
  // `this.controls.target`, and `this.camera.up` between two keyframes;
  // updated each render. The `up` interpolation lets keyframes roll the
  // camera (e.g. to align Boston/Santiago with the viewer's eye axis on the
  // introduction's parallax pages) and tween smoothly back to world up.
  private cameraTween: {
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
    fromUp: THREE.Vector3;
    toUp: THREE.Vector3;
    start: number;
    duration: number;
  } | null = null;

  private pipCanvases: Record<string, HTMLCanvasElement> = {};
  private pipCtxs: Record<string, CanvasRenderingContext2D> = {};
  private pipImageData: Record<string, ImageData> = {};
  private pipCanvasSize = 512;
  private pipOutputsEnabled = false;
  private pipPixelBuffer: Uint8Array | null = null;
  private pipRenderTarget: THREE.WebGLRenderTarget | null = null;
  private pipRenderTargetSize = 0;

  constructor() {
    const loader = new THREE.TextureLoader();
    const moonColorTex = loader.load('/textures/moon_color_2k.jpg');
    const earthDayTex = loader.load('/textures/earth_daymap_2k.jpg');
    const earthNightTex = loader.load('/textures/earth_nightmap_2k.jpg');
    moonColorTex.colorSpace = THREE.SRGBColorSpace;
    earthDayTex.colorSpace = THREE.SRGBColorSpace;
    earthNightTex.colorSpace = THREE.SRGBColorSpace;

    // logarithmicDepthBuffer lets us span Earth-radius scale (~1) up to 1 AU
    // (~23k ER) for the Sun without z-fighting on close objects.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(1, 1);
    this.renderer.setClearColor(0x000000);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    this.camera.position.set(30, 50, 80);

    const earthGeo = new THREE.SphereGeometry(1, 64, 48);
    this.earthMat = new THREE.ShaderMaterial({
      vertexShader: celestialVertexShader,
      fragmentShader: earthFragmentShader,
      uniforms: {
        uSunPos: { value: new THREE.Vector3() },
        uBaseColor: { value: new THREE.Vector3(0.13, 0.27, 0.67) },
        uDayMap: { value: earthDayTex },
        uNightMap: { value: earthNightTex },
        uHasTexture: { value: true },
      },
    });
    this.earth = new THREE.Mesh(earthGeo, this.earthMat);
    this.scene.add(this.earth);

    // Parent the wireframe and rotation-axis to `this.earth` so they
    // inherit Earth's scale (introduction view scales Earth up for
    // diagrammatic visibility) and rotation (axis stays on the pole).
    const wireGeo = new THREE.SphereGeometry(1.002, 36, 18);
    this.earth.add(new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({
      color: 0x666666, wireframe: true, transparent: true, opacity: 0.12,
    })));

    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -1.5, 0),
      new THREE.Vector3(0, 1.5, 0),
    ]);
    this.earth.add(new THREE.Line(axisGeo, new THREE.LineBasicMaterial({
      color: 0x888888, transparent: true, opacity: 0.3,
    })));

    const moonGeo = new THREE.SphereGeometry(MOON_RADIUS_ER * 4, 32, 24);
    this.moonMat = new THREE.ShaderMaterial({
      vertexShader: celestialVertexShader,
      fragmentShader: moonFragmentShader,
      uniforms: {
        uSunPos: { value: new THREE.Vector3() },
        uSunRadius: { value: SUN_RADIUS_ER },
        uEarthRadius: { value: 1.0 },
        uBaseColor: { value: new THREE.Vector3(0.67, 0.67, 0.67) },
        uDiffuseMap: { value: moonColorTex },
        uHasTexture: { value: true },
      },
    });
    this.moon = new THREE.Mesh(moonGeo, this.moonMat);
    this.scene.add(this.moon);

    const markerGeo = new THREE.SphereGeometry(0.08, 16, 12);
    this.bostonMarker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xdddddd }));
    this.santiagoMarker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xdddddd }));
    this.scene.add(this.bostonMarker);
    this.scene.add(this.santiagoMarker);

    const lineGeoB = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const lineGeoS = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.gazeBostonLine = new THREE.Line(lineGeoB, new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.5, depthTest: false }));
    this.gazeSantiagoLine = new THREE.Line(lineGeoS, new THREE.LineBasicMaterial({ color: 0xaaaaaa, transparent: true, opacity: 0.5, depthTest: false }));
    this.gazeBostonLine.renderOrder = 10;
    this.gazeSantiagoLine.renderOrder = 10;
    this.scene.add(this.gazeBostonLine);
    this.scene.add(this.gazeSantiagoLine);

    const baseGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.baselineLine = new THREE.Line(baseGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthTest: false }));
    this.baselineLine.renderOrder = 10;
    this.scene.add(this.baselineLine);

    const umbraTaper = (SUN_RADIUS_ER - 1) / AU_TO_ER;
    const umbraEndRadius = Math.max(0, 1 - SHADOW_CONE_LENGTH * umbraTaper);
    const umbraGeo = new THREE.CylinderGeometry(umbraEndRadius, 1, SHADOW_CONE_LENGTH, 32, 1, true);
    umbraGeo.translate(0, -SHADOW_CONE_LENGTH / 2, 0);
    this.umbraCone = new THREE.Mesh(umbraGeo, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.2, side: THREE.DoubleSide,
    }));
    this.scene.add(this.umbraCone);

    const penumbraTaper = (SUN_RADIUS_ER + 1) / AU_TO_ER;
    const penumbraEndRadius = 1 + SHADOW_CONE_LENGTH * penumbraTaper;
    const penumbraGeo = new THREE.CylinderGeometry(penumbraEndRadius, 1, SHADOW_CONE_LENGTH, 32, 1, true);
    penumbraGeo.translate(0, -SHADOW_CONE_LENGTH / 2, 0);
    this.penumbraCone = new THREE.Mesh(penumbraGeo, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.08, side: THREE.DoubleSide,
    }));
    this.scene.add(this.penumbraCone);

    // Physically sized Sun (~109 ER radius) at 1 AU. MeshBasicMaterial keeps
    // the disk fully bright regardless of scene lighting. The halo Sprite is
    // an additive radial gradient that gives the bright-source feel without
    // breaking physical scale — the disk underneath stays angularly correct.
    this.sunMarker = new THREE.Mesh(
      new THREE.SphereGeometry(SUN_RADIUS_ER, 64, 32),
      new THREE.MeshBasicMaterial({ color: 0xfff5e0 }),
    );
    const haloMat = new THREE.SpriteMaterial({
      map: createGlowTexture(),
      color: 0xffd766,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(SUN_RADIUS_ER * 8, SUN_RADIUS_ER * 8, 1);
    this.sunMarker.add(halo);
    this.scene.add(this.sunMarker);

    // Place stars on a shell well outside 1 AU so the Sun disk is never
    // occluded by foreground star points. Sized so they read as pinpoints
    // regardless of camera distance.
    const starsGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(3000);
    const STAR_SHELL = 80000;
    for (let i = 0; i < 1000; i++) {
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      starPositions[i * 3 + 0] = Math.cos(t) * r * STAR_SHELL;
      starPositions[i * 3 + 1] = Math.sin(t) * r * STAR_SHELL;
      starPositions[i * 3 + 2] = u * STAR_SHELL;
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 80, sizeAttenuation: true })));

    const TEL_FOV = 3;
    this.bostonRawCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 100000);
    this.bostonCorrectedCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 100000);
    this.santiagoRawCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 100000);
    this.santiagoCorrectedCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 100000);
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  attachControls(target: HTMLElement) {
    if (this.controls) return;
    this.controls = new OrbitControls(this.camera, target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 50000;
  }

  // Externally settable lock for OrbitControls input. Used by the welcome
  // flow to keep the keyframed camera under tween control.
  setControlsEnabled(enabled: boolean) {
    if (this.controls) this.controls.enabled = enabled;
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  applyFrameState(frame: FrameData) {
    const s = AU_TO_ER;
    const realSunPos = toThree(frame.sunPos, s);
    const moonScene = toThree(frame.moonPos, s);
    this.moon.position.copy(moonScene);

    const sunDir = realSunPos.clone().normalize();
    this.sunMarker.position.copy(realSunPos);

    const bostonScene = toThree(frame.bostonPos, s);
    const santiagoScene = toThree(frame.santiagoPos, s);
    this.bostonMarker.position.copy(bostonScene);
    this.santiagoMarker.position.copy(santiagoScene);

    updateLine(this.gazeBostonLine, bostonScene, moonScene);
    updateLine(this.gazeSantiagoLine, santiagoScene, moonScene);
    updateLine(this.baselineLine, bostonScene, santiagoScene);

    const antiSun = sunDir.clone().negate();
    const coneRef = new THREE.Vector3(0, -1, 0);
    this.umbraCone.position.set(0, 0, 0);
    this.umbraCone.quaternion.setFromUnitVectors(coneRef, antiSun);
    this.penumbraCone.position.set(0, 0, 0);
    this.penumbraCone.quaternion.setFromUnitVectors(coneRef, antiSun);

    this.earth.rotation.y = frame.gastRad;
    this.moonMat.uniforms.uSunPos.value.copy(realSunPos);
    this.earthMat.uniforms.uSunPos.value.copy(realSunPos);

    const baseline = new THREE.Vector3().subVectors(santiagoScene, bostonScene);

    const orientTelescope = (
      cam: THREE.PerspectiveCamera,
      observerPos: THREE.Vector3,
      target: THREE.Vector3,
      corrected: boolean,
    ) => {
      cam.position.copy(observerPos);
      const gaze = new THREE.Vector3().subVectors(target, observerPos).normalize();
      const zenith = observerPos.clone().normalize();
      const upRaw = zenith.clone().addScaledVector(gaze, -zenith.dot(gaze)).normalize();
      if (!corrected) {
        cam.up.copy(upRaw);
      } else {
        const baseProj = baseline.clone().addScaledVector(gaze, -baseline.dot(gaze));
        const rightStereo = baseProj.normalize();
        const upStereo = new THREE.Vector3().crossVectors(rightStereo, gaze);
        cam.up.copy(upStereo);
      }
      cam.lookAt(target);
    };

    orientTelescope(this.bostonRawCam, bostonScene, moonScene, false);
    orientTelescope(this.bostonCorrectedCam, bostonScene, moonScene, true);
    orientTelescope(this.santiagoRawCam, santiagoScene, moonScene, false);
    orientTelescope(this.santiagoCorrectedCam, santiagoScene, moonScene, true);
  }

  renderMain() {
    this.updateCameraTween();
    if (this.controls) this.controls.update();
    const el = this.renderer.domElement;
    const w = el.clientWidth || el.width;
    const h = el.clientHeight || el.height;
    this.renderer.setViewport(0, 0, w, h);
    this.renderer.setScissor(0, 0, w, h);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);
    // Telescope views are displayed via the DOM TelescopeGrid component
    // (scene.getPIPCanvas() feeds it) — no viewport inset overlay here.
  }

  // Animate `this.camera.position`, `this.controls.target`, and
  // `this.camera.up` from their current state to the given keyframe over
  // `durationMs`. The tween steps forward at the top of every render call;
  // pass `durationMs = 0` to jump. `toUp` defaults to world Y so existing
  // call sites keep their conventional orientation.
  tweenCameraTo(
    toPos: THREE.Vector3,
    toTarget: THREE.Vector3,
    durationMs = 900,
    toUp: THREE.Vector3 = new THREE.Vector3(0, 1, 0),
  ) {
    if (!this.controls) return;
    const upTarget = toUp.clone().normalize();
    if (durationMs <= 0) {
      this.camera.position.copy(toPos);
      this.controls.target.copy(toTarget);
      this.camera.up.copy(upTarget);
      this.cameraTween = null;
      return;
    }
    this.cameraTween = {
      fromPos: this.camera.position.clone(),
      toPos: toPos.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: toTarget.clone(),
      fromUp: this.camera.up.clone(),
      toUp: upTarget,
      start: performance.now(),
      duration: durationMs,
    };
  }

  // Snap `this.camera.up` to a new vector and cancel any in-flight tween's
  // up interpolation. Position and target are left untouched. Used when
  // exiting the introduction so the free-look sim view always starts
  // right-side-up regardless of where the introduction left the camera.
  snapCameraUp(toUp: THREE.Vector3) {
    const target = toUp.clone().normalize();
    this.camera.up.copy(target);
    if (this.cameraTween) {
      this.cameraTween.fromUp.copy(target);
      this.cameraTween.toUp.copy(target);
    }
  }

  private updateCameraTween() {
    if (!this.cameraTween || !this.controls) return;
    const tw = this.cameraTween;
    const t = (performance.now() - tw.start) / tw.duration;
    if (t >= 1) {
      this.camera.position.copy(tw.toPos);
      this.controls.target.copy(tw.toTarget);
      this.camera.up.copy(tw.toUp);
      this.cameraTween = null;
      return;
    }
    const e = 1 - Math.pow(1 - t, 3); // cubic ease-out
    this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    // Lerp + normalize is visually indistinguishable from slerp at the
    // angles in play here (≤ 90°) and avoids a quaternion intermediate.
    this.camera.up.lerpVectors(tw.fromUp, tw.toUp, e).normalize();
  }

  focusEarth() {
    this.camera.position.set(3, 3, 3);
    if (this.controls) this.controls.target.set(0, 0, 0);
  }

  focusMoon(frame: FrameData) {
    const moonScene = toThree(frame.moonPos, AU_TO_ER);
    const offset = new THREE.Vector3(5, 5, 5);
    this.camera.position.copy(moonScene.clone().add(offset));
    if (this.controls) this.controls.target.copy(moonScene);
  }

  focusSystem() {
    this.camera.position.set(30, 50, 80);
    if (this.controls) this.controls.target.set(0, 0, 0);
  }

  setTelescopesVisible(_visible: boolean) {
    // Kept for API compatibility. The DOM TelescopeGrid handles visibility
    // via the `showTelescopes` signal directly.
  }

  // --- Label projection for DOM overlays (SceneLabels) ---
  //
  // Project each body's world position into screen-space pixels. When a body
  // is out of the camera frame (or behind it), the result is clamped to the
  // viewport edge with a margin, and `dir` reports which edge the label is
  // stuck to — the overlay uses that to draw a pointer.

  projectLabels(): LabelPos[] {
    const el = this.renderer.domElement;
    const w = el.clientWidth || el.width;
    const h = el.clientHeight || el.height;
    const bodies: Array<{ name: string; pos: THREE.Vector3 }> = [
      { name: 'EARTH',    pos: new THREE.Vector3(0, 0, 0) },
      { name: 'SUN',      pos: this.sunMarker.position },
      { name: 'MOON',     pos: this.moon.position },
      { name: 'BOSTON',   pos: this.bostonMarker.position },
      { name: 'SANTIAGO', pos: this.santiagoMarker.position },
    ];
    return bodies.map((b) => projectOne(b.name, b.pos, this.camera, w, h));
  }

  setPIPOutputsEnabled(on: boolean) {
    this.pipOutputsEnabled = on;
    if (on && Object.keys(this.pipCanvases).length === 0) {
      for (const k of PIP_KEYS) {
        const c = document.createElement('canvas');
        c.width = this.pipCanvasSize;
        c.height = this.pipCanvasSize;
        this.pipCanvases[k] = c;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('PIP canvas 2d context failed');
        this.pipCtxs[k] = ctx;
        this.pipImageData[k] = ctx.createImageData(this.pipCanvasSize, this.pipCanvasSize);
      }
    }
  }

  // Adaptive body scaling for the introduction view.
  //
  // Astronomy diagrams universally exaggerate body sizes vs. distances —
  // an Earth/Moon at true scale is invisible against ~60 ER of space.
  // When `active` is true we project each body onto the main camera,
  // measure its on-screen radius, and scale the body mesh up just enough
  // to hit `MIN_BODY_RADIUS_PX`. Bodies that are already comfortably big
  // (e.g., Earth on the page-2 close-up) get scale 1 and aren't touched.
  //
  // The Earth wireframe and rotation-axis line are children of `this.earth`
  // (see constructor), so they scale with it. When `active` is false,
  // scales reset to 1 — sim/stereo views see physically accurate sizes.
  updateBodyScales(active: boolean) {
    if (!active) {
      this.earth.scale.setScalar(1);
      this.moon.scale.setScalar(1);
      return;
    }
    const w = this.renderer.domElement.clientWidth || this.renderer.domElement.width;
    if (w === 0) return;
    this.camera.updateMatrixWorld();
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const MIN_BODY_RADIUS_PX = 36;

    const calcScale = (worldPos: THREE.Vector3, baseRadius: number): number => {
      const v = worldPos.clone().project(this.camera);
      if (v.z > 1) return 1; // behind camera — don't scale
      const edge = worldPos.clone().addScaledVector(cameraRight, baseRadius);
      const ev = edge.project(this.camera);
      const screenRadiusPx = Math.abs((ev.x - v.x) * 0.5) * w;
      if (screenRadiusPx < 0.5) return 1;
      return Math.max(1, MIN_BODY_RADIUS_PX / screenRadiusPx);
    };

    this.earth.scale.setScalar(calcScale(new THREE.Vector3(0, 0, 0), 1));
    this.moon.scale.setScalar(
      calcScale(this.moon.position, MOON_RADIUS_ER * 4),
    );
  }

  getPIPCanvas(camera: EyeSide, kind: PIPKind = 'corrected'): HTMLCanvasElement {
    const k = `${camera}_${kind}`;
    if (!this.pipCanvases[k]) this.setPIPOutputsEnabled(true);
    return this.pipCanvases[k];
  }

  renderPIPOutputs() {
    if (!this.pipOutputsEnabled) return;
    const size = this.pipCanvasSize;
    if (this.pipPixelBuffer === null || this.pipPixelBuffer.length !== size * size * 4) {
      this.pipPixelBuffer = new Uint8Array(size * size * 4);
    }
    this.renderOnePIP('boston', 'raw');
    this.renderOnePIP('boston', 'corrected');
    this.renderOnePIP('santiago', 'raw');
    this.renderOnePIP('santiago', 'corrected');
  }

  private renderOnePIP(camera: EyeSide, kind: PIPKind) {
    const size = this.pipCanvasSize;
    const cam =
      camera === 'boston'
        ? kind === 'raw' ? this.bostonRawCam : this.bostonCorrectedCam
        : kind === 'raw' ? this.santiagoRawCam : this.santiagoCorrectedCam;

    if (this.pipRenderTarget === null || this.pipRenderTargetSize !== size) {
      if (this.pipRenderTarget !== null) this.pipRenderTarget.dispose();
      this.pipRenderTarget = new THREE.WebGLRenderTarget(size, size, {
        depthBuffer: true,
        stencilBuffer: false,
      });
      this.pipRenderTargetSize = size;
    }
    const target = this.pipRenderTarget;

    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(0x000000);

    const pixels = this.pipPixelBuffer!;
    this.renderer.readRenderTargetPixels(target, 0, 0, size, size, pixels);

    const k = `${camera}_${kind}`;
    const img = this.pipImageData[k];
    const rowBytes = size * 4;
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * rowBytes;
      const dst = y * rowBytes;
      img.data.set(pixels.subarray(src, src + rowBytes), dst);
    }
    this.pipCtxs[k].putImageData(img, 0, 0);
  }
}

const PIP_KEYS = [
  'boston_raw',
  'boston_corrected',
  'santiago_raw',
  'santiago_corrected',
] as const;

function createGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255, 245, 220, 1.0)');
  g.addColorStop(0.15, 'rgba(255, 220, 140, 0.55)');
  g.addColorStop(0.4, 'rgba(255, 180, 80, 0.18)');
  g.addColorStop(1.0, 'rgba(255, 180, 80, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function updateLine(line: THREE.Line, from: THREE.Vector3, to: THREE.Vector3) {
  const positions = line.geometry.attributes.position as THREE.BufferAttribute;
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
}

export interface LabelPos {
  name: string;
  x: number;               // screen px (top-left origin)
  y: number;
  inFrame: boolean;
  dir: 'up' | 'down' | 'left' | 'right' | 'none';
}

function projectOne(
  name: string,
  worldPos: THREE.Vector3,
  camera: THREE.PerspectiveCamera,
  w: number,
  h: number,
): LabelPos {
  const v = worldPos.clone().project(camera);
  // `z > 1` means the point is behind the camera. Its NDC x/y then point
  // toward the "wrong" edge — flip them so the clamp lands on the correct
  // side (the side the body lies beyond the back of the frustum).
  const behind = v.z > 1;
  if (behind) { v.x = -v.x; v.y = -v.y; }

  const inFrame = !behind && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && Math.abs(v.z) <= 1;
  let sx = (v.x * 0.5 + 0.5) * w;
  let sy = (-v.y * 0.5 + 0.5) * h;

  const margin = 20;
  let dir: LabelPos['dir'] = 'none';
  if (!inFrame) {
    // Clamp to the inset rectangle; the furthest-out axis wins the arrow.
    const overLeft  = sx < margin;
    const overRight = sx > w - margin;
    const overTop   = sy < margin;
    const overBot   = sy > h - margin;
    // Pick the side whose overshoot is largest (dominant direction).
    const dx = Math.max(margin - sx, sx - (w - margin), 0);
    const dy = Math.max(margin - sy, sy - (h - margin), 0);
    if (dx >= dy) {
      dir = overLeft ? 'left' : overRight ? 'right' : (sy < h / 2 ? 'up' : 'down');
    } else {
      dir = overTop  ? 'up'   : overBot   ? 'down'  : (sx < w / 2 ? 'left' : 'right');
    }
    sx = Math.max(margin, Math.min(w - margin, sx));
    sy = Math.max(margin, Math.min(h - margin, sy));
  }
  return { name, x: sx, y: sy, inFrame, dir };
}
