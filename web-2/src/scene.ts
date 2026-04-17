// Minimal Three.js scene for web-2. Unlike web-1, this scene is never shown
// directly — it only exists to feed two off-screen PIP canvases (Boston &
// Santiago corrected telescope views) that the stereo compositor uses as a
// fallback when real footage isn't loaded.
//
// Scope: just the Moon mesh + eclipse shader. Telescope FOV is narrow (3°),
// so Earth, Sun, markers, stars, etc. from web-1 are not needed — they'd be
// off-frame anyway.

import * as THREE from 'three';
import { AU_TO_ER } from './astronomy';
import type { FrameData, Vec3 } from './astronomy';
import { celestialVertexShader, moonFragmentShader } from './shaders';

const MOON_RADIUS_ER = 1737.4 / 6371.0;
const SUN_RADIUS_ER = 696000.0 / 6371.0;
// Widened so the sim moon matches the apparent size of the real telescope
// footage in the stereo view (post-crop / post-warp effective FOV is ~6°).
const TEL_FOV = 6;
const PIP_SIZE = 512;

function toThree(v: Vec3, scale: number): THREE.Vector3 {
  return new THREE.Vector3(v.x * scale, v.z * scale, -v.y * scale);
}

export type EyeSide = 'boston' | 'santiago';

export class PlanetaryScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private moon: THREE.Mesh;
  private moonMat: THREE.ShaderMaterial;

  private bostonCam: THREE.PerspectiveCamera;
  private santiagoCam: THREE.PerspectiveCamera;

  private pipCanvases: Record<EyeSide, HTMLCanvasElement>;
  private pipCtxs: Record<EyeSide, CanvasRenderingContext2D>;
  private pipImageData: Record<EyeSide, ImageData>;
  private pipPixelBuffer: Uint8Array;
  private pipRenderTarget: THREE.WebGLRenderTarget;

  constructor() {
    const loader = new THREE.TextureLoader();
    const moonColorTex = loader.load('/textures/moon_color_2k.jpg');
    moonColorTex.colorSpace = THREE.SRGBColorSpace;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PIP_SIZE, PIP_SIZE);
    this.renderer.setClearColor(0x000000, 1);

    this.scene = new THREE.Scene();

    const moonGeo = new THREE.SphereGeometry(MOON_RADIUS_ER * 3, 32, 24);
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

    this.bostonCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 200);
    this.santiagoCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 200);

    const makeCanvas = (): [HTMLCanvasElement, CanvasRenderingContext2D, ImageData] => {
      const c = document.createElement('canvas');
      c.width = PIP_SIZE;
      c.height = PIP_SIZE;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('canvas 2d context failed');
      return [c, ctx, ctx.createImageData(PIP_SIZE, PIP_SIZE)];
    };
    const [bc, bctx, bimg] = makeCanvas();
    const [sc, sctx, simg] = makeCanvas();
    this.pipCanvases = { boston: bc, santiago: sc };
    this.pipCtxs = { boston: bctx, santiago: sctx };
    this.pipImageData = { boston: bimg, santiago: simg };

    this.pipPixelBuffer = new Uint8Array(PIP_SIZE * PIP_SIZE * 4);
    this.pipRenderTarget = new THREE.WebGLRenderTarget(PIP_SIZE, PIP_SIZE, {
      depthBuffer: true,
      stencilBuffer: false,
    });
  }

  getPIPCanvas(side: EyeSide): HTMLCanvasElement {
    return this.pipCanvases[side];
  }

  applyFrameState(frame: FrameData) {
    const s = AU_TO_ER;

    const realSunPos = toThree(frame.sunPos, s);
    const moonScene = toThree(frame.moonPos, s);
    this.moon.position.copy(moonScene);

    const bostonScene = toThree(frame.bostonPos, s);
    const santiagoScene = toThree(frame.santiagoPos, s);

    this.moonMat.uniforms.uSunPos.value.copy(realSunPos);

    // Shared baseline direction for stereo roll correction — both cameras must
    // use the same baseline vector or the rotated images flip relative to
    // each other. See astronomy.ts for the math.
    const baseline = new THREE.Vector3().subVectors(santiagoScene, bostonScene);

    orientCorrectedTelescope(this.bostonCam, bostonScene, moonScene, baseline);
    orientCorrectedTelescope(this.santiagoCam, santiagoScene, moonScene, baseline);
  }

  renderPIPOutputs() {
    this.renderOne('boston', this.bostonCam);
    this.renderOne('santiago', this.santiagoCam);
  }

  private renderOne(side: EyeSide, cam: THREE.PerspectiveCamera) {
    this.renderer.setRenderTarget(this.pipRenderTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null);

    this.renderer.readRenderTargetPixels(
      this.pipRenderTarget, 0, 0, PIP_SIZE, PIP_SIZE, this.pipPixelBuffer,
    );

    // WebGL framebuffer is y-up; canvas ImageData is y-down. Flip rows.
    const img = this.pipImageData[side];
    const rowBytes = PIP_SIZE * 4;
    for (let y = 0; y < PIP_SIZE; y++) {
      const src = (PIP_SIZE - 1 - y) * rowBytes;
      const dst = y * rowBytes;
      img.data.set(this.pipPixelBuffer.subarray(src, src + rowBytes), dst);
    }
    this.pipCtxs[side].putImageData(img, 0, 0);
  }
}

function orientCorrectedTelescope(
  cam: THREE.PerspectiveCamera,
  observerPos: THREE.Vector3,
  target: THREE.Vector3,
  baseline: THREE.Vector3,
) {
  cam.position.copy(observerPos);
  const gaze = new THREE.Vector3().subVectors(target, observerPos).normalize();
  const baseProj = baseline.clone().addScaledVector(gaze, -baseline.dot(gaze));
  const rightStereo = baseProj.normalize();
  const upStereo = new THREE.Vector3().crossVectors(rightStereo, gaze);
  cam.up.copy(upStereo);
  cam.lookAt(target);
}
