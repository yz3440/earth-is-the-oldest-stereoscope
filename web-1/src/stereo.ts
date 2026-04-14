// WebGL2 stereo compositor with multiple output modes for DLP / 3D viewing.

export type StereoMode =
  | 'sbs-full'
  | 'sbs-half'
  | 'tb-full'
  | 'tb-half'
  | 'frame-seq'
  | 'anaglyph-rc'
  | 'anaglyph-rc-dubois'
  | 'anaglyph-rb'
  | 'anaglyph-gm'
  | 'anaglyph-amber'
  | 'interlaced-row'
  | 'interlaced-col'
  | 'checkerboard'
  | 'mono-l'
  | 'mono-r';

export const MODE_LABELS: Record<StereoMode, string> = {
  'sbs-full': 'Side-by-side (full)',
  'sbs-half': 'Side-by-side (half / squeezed)',
  'tb-full': 'Top/bottom (full)',
  'tb-half': 'Top/bottom (half / squeezed)',
  'frame-seq': 'Frame sequential (DLP-Link)',
  'anaglyph-rc': 'Anaglyph red/cyan',
  'anaglyph-rc-dubois': 'Anaglyph red/cyan (Dubois)',
  'anaglyph-rb': 'Anaglyph red/blue',
  'anaglyph-gm': 'Anaglyph green/magenta',
  'anaglyph-amber': 'Anaglyph amber/blue (ColorCode)',
  'interlaced-row': 'Interlaced (rows)',
  'interlaced-col': 'Interlaced (columns)',
  'checkerboard': 'Checkerboard',
  'mono-l': 'Mono — left only',
  'mono-r': 'Mono — right only',
};

export const MODE_INDEX: Record<StereoMode, number> = {
  'sbs-full': 0,
  'sbs-half': 1,
  'tb-full': 2,
  'tb-half': 3,
  'frame-seq': 4,
  'anaglyph-rc': 5,
  'anaglyph-rc-dubois': 6,
  'anaglyph-rb': 7,
  'anaglyph-gm': 8,
  'anaglyph-amber': 9,
  'interlaced-row': 10,
  'interlaced-col': 11,
  'checkerboard': 12,
  'mono-l': 13,
  'mono-r': 14,
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

uniform vec2  u_canvas;       // canvas size in pixels
uniform vec2  u_left_size;    // left video size (px)
uniform vec2  u_right_size;   // right video size (px)
uniform int   u_mode;
uniform int   u_seq_eye;      // 0 = left, 1 = right (for frame-sequential)
uniform float u_parallax;     // horizontal shift (in source pixels)
uniform bool  u_swap;
uniform bool  u_left_ready;
uniform bool  u_right_ready;

// Sample one eye at the given uv (already in the eye's intended target rect),
// applying parallax shift in source pixels.
vec3 sampleEye(int eye, vec2 uv) {
  vec2 size = (eye == 0) ? u_left_size : u_right_size;
  if (size.x <= 0.0 || size.y <= 0.0) return vec3(0);
  if (eye == 0 && !u_left_ready) return vec3(0);
  if (eye == 1 && !u_right_ready) return vec3(0);

  // Half the parallax to each side, opposite signs.
  float pxShift = (eye == 0 ? -u_parallax : u_parallax) * 0.5;
  vec2 s = uv;
  s.x += pxShift / size.x;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return vec3(0);

  if (eye == 0) return texture(u_left, s).rgb;
  return texture(u_right, s).rgb;
}

// Letterbox the canvas to a target aspect ratio. Returns true if v_uv is
// inside the fit rect, and writes [0,1]^2 local coords there.
bool fitAspect(float targetAspect, out vec2 local) {
  float canvasAspect = u_canvas.x / u_canvas.y;
  float x0, y0, w, h;
  if (canvasAspect > targetAspect) {
    w = targetAspect / canvasAspect;
    h = 1.0;
    x0 = (1.0 - w) * 0.5;
    y0 = 0.0;
  } else {
    w = 1.0;
    h = canvasAspect / targetAspect;
    x0 = 0.0;
    y0 = (1.0 - h) * 0.5;
  }
  if (v_uv.x < x0 || v_uv.x > x0 + w || v_uv.y < y0 || v_uv.y > y0 + h) return false;
  local = vec2((v_uv.x - x0) / w, (v_uv.y - y0) / h);
  return true;
}

vec3 anaglyph(vec3 L, vec3 R) {
  if (u_mode == 5) {
    // Red/Cyan simple
    return vec3(L.r, R.g, R.b);
  } else if (u_mode == 6) {
    // Red/Cyan Dubois (optimized)
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
  } else if (u_mode == 7) {
    // Red/Blue
    return vec3(L.r, 0.0, R.b);
  } else if (u_mode == 8) {
    // Green/Magenta
    return vec3(R.r, L.g, R.b);
  } else if (u_mode == 9) {
    // Amber/Blue ColorCode-ish
    float Llum = dot(L, vec3(0.299, 0.587, 0.114));
    return vec3(Llum, Llum * 0.7, R.b);
  }
  return vec3(0);
}

void main() {
  int leftEye  = u_swap ? 1 : 0;
  int rightEye = u_swap ? 0 : 1;
  vec3 col = vec3(0);

  // Source aspect (assume both videos have the same aspect; fall back to 1.0).
  float srcAspect = (u_left_size.y > 0.0) ? u_left_size.x / u_left_size.y : 1.0;

  if (u_mode == 0) {
    // SBS_FULL: 2 * srcAspect : 1
    vec2 local;
    if (fitAspect(2.0 * srcAspect, local)) {
      if (local.x < 0.5) {
        col = sampleEye(leftEye, vec2(local.x * 2.0, local.y));
      } else {
        col = sampleEye(rightEye, vec2((local.x - 0.5) * 2.0, local.y));
      }
    }
  } else if (u_mode == 1) {
    // SBS_HALF: anamorphic, fills entire canvas
    if (v_uv.x < 0.5) {
      col = sampleEye(leftEye, vec2(v_uv.x * 2.0, v_uv.y));
    } else {
      col = sampleEye(rightEye, vec2((v_uv.x - 0.5) * 2.0, v_uv.y));
    }
  } else if (u_mode == 2) {
    // TB_FULL: srcAspect : 2
    vec2 local;
    if (fitAspect(srcAspect / 2.0, local)) {
      if (local.y < 0.5) {
        col = sampleEye(leftEye, vec2(local.x, local.y * 2.0));
      } else {
        col = sampleEye(rightEye, vec2(local.x, (local.y - 0.5) * 2.0));
      }
    }
  } else if (u_mode == 3) {
    // TB_HALF: anamorphic, fills entire canvas
    if (v_uv.y < 0.5) {
      col = sampleEye(leftEye, vec2(v_uv.x, v_uv.y * 2.0));
    } else {
      col = sampleEye(rightEye, vec2(v_uv.x, (v_uv.y - 0.5) * 2.0));
    }
  } else if (u_mode == 4) {
    // FRAME_SEQ: single eye, fit to source aspect
    int eye = (u_seq_eye == 0) ? leftEye : rightEye;
    vec2 local;
    if (fitAspect(srcAspect, local)) {
      col = sampleEye(eye, local);
    }
  } else if (u_mode >= 5 && u_mode <= 9) {
    // Anaglyph variants
    vec2 local;
    if (fitAspect(srcAspect, local)) {
      vec3 L = sampleEye(leftEye, local);
      vec3 R = sampleEye(rightEye, local);
      col = anaglyph(L, R);
    }
  } else if (u_mode == 10) {
    // Interlaced rows: even row = left, odd row = right (in screen pixels)
    vec2 local;
    if (fitAspect(srcAspect, local)) {
      int row = int(floor(gl_FragCoord.y));
      int eye = ((row & 1) == 0) ? leftEye : rightEye;
      col = sampleEye(eye, local);
    }
  } else if (u_mode == 11) {
    // Interlaced columns
    vec2 local;
    if (fitAspect(srcAspect, local)) {
      int colpx = int(floor(gl_FragCoord.x));
      int eye = ((colpx & 1) == 0) ? leftEye : rightEye;
      col = sampleEye(eye, local);
    }
  } else if (u_mode == 12) {
    // Checkerboard
    vec2 local;
    if (fitAspect(srcAspect, local)) {
      int x = int(floor(gl_FragCoord.x));
      int y = int(floor(gl_FragCoord.y));
      int eye = (((x + y) & 1) == 0) ? leftEye : rightEye;
      col = sampleEye(eye, local);
    }
  } else if (u_mode == 13) {
    vec2 local;
    if (fitAspect(srcAspect, local)) col = sampleEye(leftEye, local);
  } else if (u_mode == 14) {
    vec2 local;
    if (fitAspect(srcAspect, local)) col = sampleEye(rightEye, local);
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
    const log = gl.getShaderInfoLog(sh);
    throw new Error('shader compile: ' + log);
  }
  return sh;
}

function compileProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const v = compileShader(gl, gl.VERTEX_SHADER, vs);
  const f = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram failed');
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    throw new Error('program link: ' + log);
  }
  return p;
}

export class StereoRenderer {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private leftTex: WebGLTexture;
  private rightTex: WebGLTexture;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  private leftSize: [number, number] = [0, 0];
  private rightSize: [number, number] = [0, 0];
  private leftReady = false;
  private rightReady = false;
  private lastLeftTime = -1;
  private lastRightTime = -1;

  mode: StereoMode = 'sbs-half';
  swap = false;
  parallaxPx = 0;
  private seqEyeToggle = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.program = compileProgram(gl, VS, FS);

    // Fullscreen triangle pair
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    if (!buf) throw new Error('createBuffer failed');
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1,
         1, -1,
        -1,  1,
        -1,  1,
         1, -1,
         1,  1,
      ]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Textures
    const makeTex = (): WebGLTexture => {
      const t = gl.createTexture();
      if (!t) throw new Error('createTexture failed');
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Initialize with a 1x1 black pixel so sampling is well-defined.
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array([0, 0, 0, 255]),
      );
      return t;
    };
    this.leftTex = makeTex();
    this.rightTex = makeTex();

    const names = [
      'u_left', 'u_right', 'u_canvas', 'u_left_size', 'u_right_size',
      'u_mode', 'u_seq_eye', 'u_parallax', 'u_swap', 'u_left_ready', 'u_right_ready',
    ];
    for (const n of names) {
      this.uniforms[n] = gl.getUniformLocation(this.program, n);
    }
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  uploadVideo(slot: 'left' | 'right', video: HTMLVideoElement) {
    this.uploadSource(slot, video);
  }

  // Generalized upload. Accepts a real-footage video element OR a canvas
  // element (a Three.js telescope PIP rendered to a 2D canvas). Same
  // texImage2D code path works for both — the difference is how we gate
  // "ready" and how we dedupe repeated uploads.
  uploadSource(slot: 'left' | 'right', source: HTMLVideoElement | HTMLCanvasElement) {
    const gl = this.gl;

    let w = 0;
    let h = 0;
    let frameKey = NaN;

    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2 || source.videoWidth === 0) {
        if (slot === 'left') this.leftReady = false;
        else this.rightReady = false;
        return;
      }
      frameKey = source.currentTime;
      if (slot === 'left' && frameKey === this.lastLeftTime && this.leftReady) return;
      if (slot === 'right' && frameKey === this.lastRightTime && this.rightReady) return;
      w = source.videoWidth;
      h = source.videoHeight;
    } else {
      if (source.width === 0 || source.height === 0) {
        if (slot === 'left') this.leftReady = false;
        else this.rightReady = false;
        return;
      }
      w = source.width;
      h = source.height;
      // Canvas sources are re-uploaded every call — the caller owns freshness.
    }

    const tex = slot === 'left' ? this.leftTex : this.rightTex;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch {
      return;
    }

    if (slot === 'left') {
      this.leftSize = [w, h];
      this.leftReady = true;
      this.lastLeftTime = frameKey;
    } else {
      this.rightSize = [w, h];
      this.rightReady = true;
      this.lastRightTime = frameKey;
    }
  }

  setEyeBlank(slot: 'left' | 'right') {
    if (slot === 'left') this.leftReady = false;
    else this.rightReady = false;
  }

  render() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.leftTex);
    gl.uniform1i(this.uniforms.u_left!, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rightTex);
    gl.uniform1i(this.uniforms.u_right!, 1);

    gl.uniform2f(this.uniforms.u_canvas!, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uniforms.u_left_size!, this.leftSize[0], this.leftSize[1]);
    gl.uniform2f(this.uniforms.u_right_size!, this.rightSize[0], this.rightSize[1]);
    gl.uniform1i(this.uniforms.u_mode!, MODE_INDEX[this.mode]);
    gl.uniform1i(this.uniforms.u_seq_eye!, this.seqEyeToggle);
    gl.uniform1f(this.uniforms.u_parallax!, this.parallaxPx);
    gl.uniform1i(this.uniforms.u_swap!, this.swap ? 1 : 0);
    gl.uniform1i(this.uniforms.u_left_ready!, this.leftReady ? 1 : 0);
    gl.uniform1i(this.uniforms.u_right_ready!, this.rightReady ? 1 : 0);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (this.mode === 'frame-seq') {
      this.seqEyeToggle = 1 - this.seqEyeToggle;
    }
  }
}
