import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AU_TO_ER } from './astronomy';
import type { FrameData, Vec3 } from './astronomy';
import { celestialVertexShader, moonFragmentShader, earthFragmentShader } from './shaders';

const MOON_RADIUS_ER = 1737.4 / 6371.0; // ~0.273
const SUN_RADIUS_ER = 696000.0 / 6371.0; // ~109.2
const SHADOW_CONE_LENGTH = 80; // ER

function toThree(v: Vec3, scale: number): THREE.Vector3 {
  return new THREE.Vector3(v.x * scale, v.z * scale, -v.y * scale);
  // Mapping: astro x->scene x, astro z->scene y (up), astro y->scene -z
}

export class PlanetaryScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;

  // Meshes
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

  // Shader materials
  private moonMat: THREE.ShaderMaterial;
  private earthMat: THREE.ShaderMaterial;

  // Telescope PIP cameras
  private bostonRawCam: THREE.PerspectiveCamera;
  private bostonCorrectedCam: THREE.PerspectiveCamera;
  private santiagoRawCam: THREE.PerspectiveCamera;
  private santiagoCorrectedCam: THREE.PerspectiveCamera;
  private telescopesVisible = true;
  private insetSize = 200;
  private timelineHeight = 70;

  constructor(container: HTMLElement) {
    // Load textures
    const loader = new THREE.TextureLoader();
    const moonColorTex = loader.load('/textures/moon_color_2k.jpg');
    const earthDayTex = loader.load('/textures/earth_daymap_2k.jpg');
    const earthNightTex = loader.load('/textures/earth_nightmap_2k.jpg');
    // sRGB for color textures
    moonColorTex.colorSpace = THREE.SRGBColorSpace;
    earthDayTex.colorSpace = THREE.SRGBColorSpace;
    earthNightTex.colorSpace = THREE.SRGBColorSpace;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0a0a0f);
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      500
    );
    this.camera.position.set(30, 50, 80);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 300;

    // Earth - custom shader
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

    // Earth wireframe overlay
    const wireGeo = new THREE.SphereGeometry(1.002, 36, 18);
    this.scene.add(new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({
      color: 0x4466aa,
      wireframe: true,
      transparent: true,
      opacity: 0.15,
    })));

    // Earth axis line
    const axisGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -1.5, 0),
      new THREE.Vector3(0, 1.5, 0),
    ]);
    this.scene.add(new THREE.Line(axisGeo, new THREE.LineBasicMaterial({
      color: 0x666688, transparent: true, opacity: 0.3,
    })));

    // Moon - custom shader with per-fragment eclipse shadow
    const moonGeo = new THREE.SphereGeometry(MOON_RADIUS_ER * 3, 32, 24); // 3x exaggerated
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

    // Site markers
    const markerGeo = new THREE.SphereGeometry(0.08, 16, 12);
    this.bostonMarker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0xff4444 }));
    this.santiagoMarker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: 0x44ff44 }));
    this.scene.add(this.bostonMarker);
    this.scene.add(this.santiagoMarker);

    // Gaze lines
    const lineGeoB = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const lineGeoS = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.gazeBostonLine = new THREE.Line(lineGeoB, new THREE.LineBasicMaterial({ color: 0xff6666, transparent: true, opacity: 0.6 }));
    this.gazeSantiagoLine = new THREE.Line(lineGeoS, new THREE.LineBasicMaterial({ color: 0x66ff66, transparent: true, opacity: 0.6 }));
    this.scene.add(this.gazeBostonLine);
    this.scene.add(this.gazeSantiagoLine);

    // Baseline line
    const baseGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.baselineLine = new THREE.Line(baseGeo, new THREE.LineBasicMaterial({ color: 0xffff44, transparent: true, opacity: 0.8 }));
    this.scene.add(this.baselineLine);

    // Shadow cones (visual guides only — actual shadow is computed in Moon shader)
    const umbraTaper = (SUN_RADIUS_ER - 1) / AU_TO_ER;
    const umbraEndRadius = Math.max(0, 1 - SHADOW_CONE_LENGTH * umbraTaper);
    const umbraGeo = new THREE.CylinderGeometry(umbraEndRadius, 1, SHADOW_CONE_LENGTH, 32, 1, true);
    umbraGeo.translate(0, -SHADOW_CONE_LENGTH / 2, 0);
    this.umbraCone = new THREE.Mesh(umbraGeo, new THREE.MeshBasicMaterial({
      color: 0x110000, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
    }));
    this.scene.add(this.umbraCone);

    const penumbraTaper = (SUN_RADIUS_ER + 1) / AU_TO_ER;
    const penumbraEndRadius = 1 + SHADOW_CONE_LENGTH * penumbraTaper;
    const penumbraGeo = new THREE.CylinderGeometry(penumbraEndRadius, 1, SHADOW_CONE_LENGTH, 32, 1, true);
    penumbraGeo.translate(0, -SHADOW_CONE_LENGTH / 2, 0);
    this.penumbraCone = new THREE.Mesh(penumbraGeo, new THREE.MeshBasicMaterial({
      color: 0x110000, transparent: true, opacity: 0.05, side: THREE.DoubleSide,
    }));
    this.scene.add(this.penumbraCone);

    // Sun marker
    this.sunMarker = new THREE.Mesh(
      new THREE.SphereGeometry(2, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffdd44 }),
    );
    this.scene.add(this.sunMarker);

    // Stars
    const starsGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(3000);
    for (let i = 0; i < 3000; i++) {
      starPositions[i] = (Math.random() - 0.5) * 800;
    }
    starsGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    this.scene.add(new THREE.Points(starsGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.3 })));

    // Telescope PIP cameras (narrow FOV to frame the 3x-exaggerated moon)
    const TEL_FOV = 3;
    this.bostonRawCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 200);
    this.bostonCorrectedCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 200);
    this.santiagoRawCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 200);
    this.santiagoCorrectedCam = new THREE.PerspectiveCamera(TEL_FOV, 1, 1, 200);

    // Resize
    window.addEventListener('resize', () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  update(frame: FrameData) {
    const s = AU_TO_ER;

    // Real Sun position in scene coords (ER) — used by shaders
    const realSunPos = toThree(frame.sunPos, s);

    // Moon position
    const moonScene = toThree(frame.moonPos, s);
    this.moon.position.copy(moonScene);

    // Sun marker at visual distance, correct direction
    const sunDir = realSunPos.clone().normalize();
    this.sunMarker.position.copy(sunDir.clone().multiplyScalar(200));

    // Observer positions
    const bostonScene = toThree(frame.bostonPos, s);
    const santiagoScene = toThree(frame.santiagoPos, s);
    this.bostonMarker.position.copy(bostonScene);
    this.santiagoMarker.position.copy(santiagoScene);

    // Gaze lines
    updateLine(this.gazeBostonLine, bostonScene, moonScene);
    updateLine(this.gazeSantiagoLine, santiagoScene, moonScene);

    // Baseline
    updateLine(this.baselineLine, bostonScene, santiagoScene);

    // Shadow cones orientation
    const antiSun = sunDir.clone().negate();
    const coneRef = new THREE.Vector3(0, -1, 0);
    this.umbraCone.position.set(0, 0, 0);
    this.umbraCone.quaternion.setFromUnitVectors(coneRef, antiSun);
    this.penumbraCone.position.set(0, 0, 0);
    this.penumbraCone.quaternion.setFromUnitVectors(coneRef, antiSun);

    // Earth texture orientation: rotate mesh so geographic features align with site markers.
    // Mesh local frame: (ECEF_X, ECEF_Z, -ECEF_Y) — from SphereGeometry UV mapping.
    // observerJ2000 rotates ECEF→J2000 by GAST around Z.
    // toThree maps J2000→scene as (X, Z, -Y).
    // Combined: scene = Ry(+GAST) * mesh_local. No obliquity needed since
    // observerJ2000 treats the geographic pole as J2000 Z.
    this.earth.rotation.y = frame.gastRad;

    // Shader uniforms — pass real Sun position for correct shadow math
    this.moonMat.uniforms.uSunPos.value.copy(realSunPos);
    this.earthMat.uniforms.uSunPos.value.copy(realSunPos);

    // Orient telescope cameras
    if (this.telescopesVisible) {
      // Shared baseline direction (Boston→Santiago) — same for both cameras
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
        // Project zenith perpendicular to gaze → horizon-leveled "up"
        const upRaw = zenith.clone().addScaledVector(gaze, -zenith.dot(gaze)).normalize();

        if (!corrected) {
          cam.up.copy(upRaw);
        } else {
          // Project the shared baseline onto the image plane (perp to gaze)
          const baseProj = baseline.clone().addScaledVector(gaze, -baseline.dot(gaze));
          const rightStereo = baseProj.normalize();
          // up = cross(gaze, right) — perpendicular to both gaze and baseline
          const upStereo = new THREE.Vector3().crossVectors(gaze, rightStereo);
          cam.up.copy(upStereo);
        }

        cam.lookAt(target);
      };

      orientTelescope(this.bostonRawCam, bostonScene, moonScene, false);
      orientTelescope(this.bostonCorrectedCam, bostonScene, moonScene, true);
      orientTelescope(this.santiagoRawCam, santiagoScene, moonScene, false);
      orientTelescope(this.santiagoCorrectedCam, santiagoScene, moonScene, true);
    }

    this.controls.update();

    // Main render
    const fullW = this.renderer.domElement.clientWidth;
    const fullH = this.renderer.domElement.clientHeight;
    this.renderer.setViewport(0, 0, fullW, fullH);
    this.renderer.setScissor(0, 0, fullW, fullH);
    this.renderer.setScissorTest(false);
    this.renderer.render(this.scene, this.camera);

    // Telescope insets
    if (this.telescopesVisible) {
      const SIZE = this.insetSize;
      const GAP = 8;
      const MARGIN = 16;
      const baseY = this.timelineHeight + MARGIN;
      const baseX = MARGIN;

      this.renderer.setScissorTest(true);
      this.renderer.autoClear = false;

      const insets: [THREE.PerspectiveCamera, number, number][] = [
        [this.bostonRawCam,          baseX,              baseY],
        [this.santiagoRawCam,        baseX + SIZE + GAP, baseY],
        [this.bostonCorrectedCam,    baseX,              baseY + SIZE + GAP],
        [this.santiagoCorrectedCam,  baseX + SIZE + GAP, baseY + SIZE + GAP],
      ];

      for (const [cam, x, y] of insets) {
        this.renderer.setViewport(x, y, SIZE, SIZE);
        this.renderer.setScissor(x, y, SIZE, SIZE);
        this.renderer.render(this.scene, cam);
      }

      this.renderer.autoClear = true;
      this.renderer.setScissorTest(false);
    }
  }

  focusEarth() {
    this.camera.position.set(3, 3, 3);
    this.controls.target.set(0, 0, 0);
  }

  focusMoon(frame: FrameData) {
    const moonScene = toThree(frame.moonPos, AU_TO_ER);
    const offset = new THREE.Vector3(5, 5, 5);
    this.camera.position.copy(moonScene.clone().add(offset));
    this.controls.target.copy(moonScene);
  }

  focusSystem() {
    this.camera.position.set(30, 50, 80);
    this.controls.target.set(0, 0, 0);
  }

  setInsetConfig(size: number, timelineHeight: number) {
    this.insetSize = size;
    this.timelineHeight = timelineHeight;
  }

  setTelescopesVisible(visible: boolean) {
    this.telescopesVisible = visible;
  }
}

function updateLine(line: THREE.Line, from: THREE.Vector3, to: THREE.Vector3) {
  const positions = line.geometry.attributes.position as THREE.BufferAttribute;
  positions.setXYZ(0, from.x, from.y, from.z);
  positions.setXYZ(1, to.x, to.y, to.z);
  positions.needsUpdate = true;
}
