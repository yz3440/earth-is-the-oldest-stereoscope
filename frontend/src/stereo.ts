// WebGL2 stereo compositor.
//
// Four layouts (sbs-half | sbs-full | tb-half | tb-full) determine the
// spatial placement of the two eyes when encoding=none. Six encodings
// (none + four anaglyph variants + frame-seq) control how the two eyes
// are combined into the final color. Anaglyph/frame-seq ignore the layout.

export type Layout = 'sbs-half' | 'sbs-full' | 'tb-half' | 'tb-full';
export type Encoding =
  | 'none'
  | 'anaglyph-rc'
  | 'anaglyph-rc-dubois'
  | 'anaglyph-gm'
  | 'anaglyph-amber'
  | 'frame-seq';

const LAYOUT_ID: Record<Layout, number> = {
  'sbs-half': 0,
  'sbs-full': 1,
  'tb-half':  2,
  'tb-full':  3,
};

const ENCODING_ID: Record<Encoding, number> = {
  'none':              0,
  'anaglyph-rc':       1,
  'anaglyph-rc-dubois':2,
  'anaglyph-gm':       3,
  'anaglyph-amber':    4,
  'frame-seq':         5,
};

const VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FS = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 o;

uniform sampler2D u_left;
uniform sampler2D u_right;
uniform sampler2D u_left_prev;
uniform sampler2D u_right_prev;
uniform bool u_left_ready;
uniform bool u_right_ready;
uniform float u_left_angle_rad;
uniform float u_right_angle_rad;
uniform float u_left_alpha;
uniform float u_right_alpha;

uniform float u_canvas_aspect; // width/height of full canvas
uniform int   u_layout;        // 0 sbs-half, 1 sbs-full, 2 tb-half, 3 tb-full
uniform int   u_encoding;      // 0 none, 1 rc, 2 rc-dubois, 3 gm, 4 amber, 5 frame-seq
uniform float u_parallax;      // uv offset per eye (L: -, R: +)
uniform float u_squeeze;       // per-eye horizontal scale (>1 squeezes, <1 stretches)
uniform bool  u_swap;
uniform int   u_frame_parity;  // for frame-seq: 0 left, 1 right

vec2 rotateUV(vec2 uv, float angle) {
  vec2 p = uv - 0.5;
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
}

// Sample one eye texture at a normalized eye-UV, with aspect letterbox so
// the square source fits without horizontal squash (aspect = eye-region-aspect).
// Applies roll rotation, parallax shift, and prev-frame cross-fade blend.
vec3 sampleEye(int eye, vec2 eyeUV, float eyeAspect, float angle, float alpha, float parallax) {
  if (eye == 0 && !u_left_ready) return vec3(0);
  if (eye == 1 && !u_right_ready) return vec3(0);

  // Pre-squeeze: scale eye-x around the eye-region center. >1 narrows
  // displayed content (compensates for downstream anamorphic stretch on
  // half-SBS 3D TVs); <1 widens it. Applied before letterbox so rotation
  // still operates on a square source-UV space.
  eyeUV.x = (eyeUV.x - 0.5) * u_squeeze + 0.5;

  // Letterbox: scale UV away from center along the shorter axis so the
  // square source doesn't squash when the eye region is not square.
  vec2 scale = vec2(max(eyeAspect, 1.0), max(1.0 / eyeAspect, 1.0));
  vec2 srcUV = (eyeUV - 0.5) * scale + 0.5;
  // Parallax: left eye shifts right, right eye shifts left.
  float sign = (eye == 0) ? -1.0 : 1.0;
  srcUV.x += sign * parallax;

  if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) return vec3(0);
  srcUV = rotateUV(srcUV, angle);
  if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) return vec3(0);

  if (alpha >= 0.999) {
    return eye == 0 ? texture(u_left, srcUV).rgb : texture(u_right, srcUV).rgb;
  }
  vec3 prev = eye == 0 ? texture(u_left_prev, srcUV).rgb : texture(u_right_prev, srcUV).rgb;
  vec3 cur  = eye == 0 ? texture(u_left,      srcUV).rgb : texture(u_right,      srcUV).rgb;
  return mix(prev, cur, alpha);
}

// Map 0/1 (eye index) to the actual texture slot after swap.
int swappedEye(int eye) {
  if (u_swap) return 1 - eye;
  return eye;
}

float angleFor(int eye) {
  int slot = swappedEye(eye);
  return slot == 0 ? u_left_angle_rad : u_right_angle_rad;
}

float alphaFor(int eye) {
  int slot = swappedEye(eye);
  return slot == 0 ? u_left_alpha : u_right_alpha;
}

vec3 sampleForEye(int eye, vec2 eyeUV, float eyeAspect) {
  int slot = swappedEye(eye);
  return sampleEye(slot, eyeUV, eyeAspect, angleFor(eye), alphaFor(eye), u_parallax);
}

// Dubois red-cyan anaglyph matrix (Dubois 2001 approximation).
vec3 anaglyphDubois(vec3 L, vec3 R) {
  mat3 ML = mat3(
     0.437, -0.062, -0.048,
     0.449, -0.062, -0.050,
     0.164, -0.024, -0.017
  );
  mat3 MR = mat3(
    -0.011,  0.377, -0.026,
    -0.032,  0.761, -0.093,
    -0.007,  0.009,  1.234
  );
  return clamp(ML * L + MR * R, 0.0, 1.0);
}

void main() {
  vec3 col = vec3(0);
  float cAspect = u_canvas_aspect;

  // Encoding dispatch
  if (u_encoding == 0) {
    // Split-layout (no chromatic mixing)
    if (u_layout == 0 || u_layout == 1) {
      // Side-by-side. Eye region aspect = (canvasW/2) / canvasH
      float eyeAspect = cAspect * 0.5;
      bool onLeft = v_uv.x < 0.5;
      vec2 eyeUV = onLeft
        ? vec2(v_uv.x * 2.0, v_uv.y)
        : vec2((v_uv.x - 0.5) * 2.0, v_uv.y);
      // sbs-full: no aspect correction — eye fills its half (may stretch).
      if (u_layout == 1) eyeAspect = 1.0;
      col = sampleForEye(onLeft ? 0 : 1, eyeUV, eyeAspect);
    } else {
      // Top-bottom. Eye region aspect = canvasW / (canvasH/2)
      float eyeAspect = cAspect * 2.0;
      // Top half is v_uv.y >= 0.5 — top is left eye by convention.
      bool onTop = v_uv.y >= 0.5;
      vec2 eyeUV = onTop
        ? vec2(v_uv.x, (v_uv.y - 0.5) * 2.0)
        : vec2(v_uv.x, v_uv.y * 2.0);
      if (u_layout == 3) eyeAspect = 1.0;
      col = sampleForEye(onTop ? 0 : 1, eyeUV, eyeAspect);
    }
  } else if (u_encoding == 5) {
    // Frame-sequential (DLP-Link): alternate full-frame each refresh.
    int eye = u_frame_parity;
    col = sampleForEye(eye, v_uv, cAspect);
  } else {
    // Anaglyph: sample both eyes at full canvas, combine by channel.
    vec3 L = sampleForEye(0, v_uv, cAspect);
    vec3 R = sampleForEye(1, v_uv, cAspect);
    if (u_encoding == 1) {
      // Simple red-cyan
      col = vec3(L.r, R.g, R.b);
    } else if (u_encoding == 2) {
      col = anaglyphDubois(L, R);
    } else if (u_encoding == 3) {
      // Green-magenta
      col = vec3(R.r, L.g, R.b);
    } else if (u_encoding == 4) {
      // Amber-blue (ColorCode 3D approx): L gets R+G, R gets B
      col = vec3(L.r, L.g, R.b);
    }
  }

  o = vec4(col, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader compile: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function compileProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram failed');
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export interface RenderOptions {
  leftAngleRad: number;
  rightAngleRad: number;
  leftAlpha: number;
  rightAlpha: number;
  layout: Layout;
  encoding: Encoding;
  parallaxPx: number;
  squeeze: number; // per-eye horizontal scale; 1.0 = no change, >1 squeezes, <1 stretches
  swap: boolean;
  frameParity: number; // 0 or 1
}

export class StereoRenderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  private program: WebGLProgram;
  private leftTex: WebGLTexture;
  private rightTex: WebGLTexture;
  private leftPrevTex: WebGLTexture;
  private rightPrevTex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};

  private leftReady = false;
  private rightReady = false;
  // Track the *actual* kind of the texture currently bound to each slot.
  // uploadSource silently no-ops when a video isn't paintable (readyState<2),
  // which means the slot may still hold the previously uploaded source — e.g.
  // a NO SIGNAL canvas — even though the caller intended to upload a video.
  // Callers use this to decide whether to apply a rotation: rotating a stale
  // NO SIGNAL canvas by a stereo correction angle was the "rotated NO SIGNAL"
  // bug.
  private leftKind: 'video' | 'canvas' | 'none' = 'none';
  private rightKind: 'video' | 'canvas' | 'none' = 'none';

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.program = compileProgram(gl, VS, FS);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const makeTex = (): WebGLTexture => {
      const t = gl.createTexture();
      if (!t) throw new Error('createTexture failed');
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255]));
      return t;
    };
    this.leftTex = makeTex();
    this.rightTex = makeTex();
    this.leftPrevTex = makeTex();
    this.rightPrevTex = makeTex();

    const UNIFORM_NAMES = [
      'u_left', 'u_right', 'u_left_prev', 'u_right_prev',
      'u_left_ready', 'u_right_ready',
      'u_left_angle_rad', 'u_right_angle_rad',
      'u_left_alpha', 'u_right_alpha',
      'u_canvas_aspect', 'u_layout', 'u_encoding',
      'u_parallax', 'u_squeeze', 'u_swap', 'u_frame_parity',
    ];
    for (const n of UNIFORM_NAMES) this.u[n] = gl.getUniformLocation(this.program, n);
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  private canvasAspect(): number {
    return this.canvas.width / this.canvas.height;
  }

  uploadSource(slot: 'left' | 'right', source: HTMLVideoElement | HTMLCanvasElement): boolean {
    const gl = this.gl;
    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2 || source.videoWidth === 0) return false;
    } else {
      if (source.width === 0 || source.height === 0) return false;
    }

    const tex = slot === 'left' ? this.leftTex : this.rightTex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return false;
    }

    const kind: 'video' | 'canvas' = source instanceof HTMLVideoElement ? 'video' : 'canvas';
    if (slot === 'left') {
      this.leftReady = true;
      this.leftKind = kind;
    } else {
      this.rightReady = true;
      this.rightKind = kind;
    }
    return true;
  }

  // Returns the kind of source currently sitting in the texture for the
  // given slot. 'none' before any successful upload.
  getSlotKind(slot: 'left' | 'right'): 'video' | 'canvas' | 'none' {
    return slot === 'left' ? this.leftKind : this.rightKind;
  }

  uploadPrevSource(slot: 'left' | 'right', source: HTMLVideoElement | HTMLCanvasElement) {
    const gl = this.gl;
    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2 || source.videoWidth === 0) return;
    } else if (source.width === 0 || source.height === 0) {
      return;
    }
    const tex = slot === 'left' ? this.leftPrevTex : this.rightPrevTex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      /* swallow */
    }
  }

  render(opts: RenderOptions) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.leftTex);      gl.uniform1i(this.u.u_left!, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.rightTex);     gl.uniform1i(this.u.u_right!, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.leftPrevTex);  gl.uniform1i(this.u.u_left_prev!, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.rightPrevTex); gl.uniform1i(this.u.u_right_prev!, 3);

    gl.uniform1i(this.u.u_left_ready!, this.leftReady ? 1 : 0);
    gl.uniform1i(this.u.u_right_ready!, this.rightReady ? 1 : 0);
    gl.uniform1f(this.u.u_left_angle_rad!, opts.leftAngleRad);
    gl.uniform1f(this.u.u_right_angle_rad!, opts.rightAngleRad);
    gl.uniform1f(this.u.u_left_alpha!, opts.leftAlpha);
    gl.uniform1f(this.u.u_right_alpha!, opts.rightAlpha);
    gl.uniform1f(this.u.u_canvas_aspect!, this.canvasAspect());
    gl.uniform1i(this.u.u_layout!, LAYOUT_ID[opts.layout]);
    gl.uniform1i(this.u.u_encoding!, ENCODING_ID[opts.encoding]);
    // Parallax is specified in source pixels. Our textures are normalized
    // 0..1 in UV; assume ~1080-px source width as in web-2. This is an
    // approximation — exact pixel-accurate shift requires knowing source
    // width, but ±200px / ~1080 ≈ ±0.19 UV which is visually right.
    gl.uniform1f(this.u.u_parallax!, opts.parallaxPx / 1080.0);
    gl.uniform1f(this.u.u_squeeze!, opts.squeeze);
    gl.uniform1i(this.u.u_swap!, opts.swap ? 1 : 0);
    gl.uniform1i(this.u.u_frame_parity!, opts.frameParity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
