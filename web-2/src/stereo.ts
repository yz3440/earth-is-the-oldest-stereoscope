// WebGL2 stereo compositor — SBS-half only. Left eye fills the left half of
// the canvas, right eye fills the right half. Both eyes are anamorphically
// squeezed (standard for 3D displays expecting SBS input).

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

uniform sampler2D u_left;       // current-frame texture, left eye
uniform sampler2D u_right;      // current-frame texture, right eye
uniform sampler2D u_left_prev;  // previous-frame snapshot, left eye
uniform sampler2D u_right_prev; // previous-frame snapshot, right eye
uniform bool u_left_ready;
uniform bool u_right_ready;
uniform float u_left_angle_rad;
uniform float u_right_angle_rad;
// 0 → show prev only (just after a frame transition);
// 1 → show current only (stable on the new frame).
uniform float u_left_alpha;
uniform float u_right_alpha;
uniform float u_eye_aspect;

vec2 rotateUV(vec2 uv, float angle) {
  vec2 p = uv - 0.5;
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
}

vec3 sampleTex(int eye, vec2 uv, float alpha) {
  if (eye == 0 && !u_left_ready) return vec3(0);
  if (eye == 1 && !u_right_ready) return vec3(0);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0);
  if (alpha >= 0.999) {
    return eye == 0 ? texture(u_left, uv).rgb : texture(u_right, uv).rgb;
  }
  vec3 prev = eye == 0 ? texture(u_left_prev, uv).rgb : texture(u_right_prev, uv).rgb;
  vec3 cur  = eye == 0 ? texture(u_left,      uv).rgb : texture(u_right,      uv).rgb;
  return mix(prev, cur, alpha);
}

vec3 sampleEye(int eye, vec2 eyeUV, float angle, float alpha) {
  vec2 scale = vec2(max(u_eye_aspect, 1.0), max(1.0 / u_eye_aspect, 1.0));
  vec2 srcUV = (eyeUV - 0.5) * scale + 0.5;
  if (srcUV.x < 0.0 || srcUV.x > 1.0 || srcUV.y < 0.0 || srcUV.y > 1.0) return vec3(0);
  srcUV = rotateUV(srcUV, angle);
  return sampleTex(eye, srcUV, alpha);
}

void main() {
  vec3 col = vec3(0);
  if (v_uv.x < 0.5) {
    col = sampleEye(0, vec2(v_uv.x * 2.0, v_uv.y), u_left_angle_rad, u_left_alpha);
  } else {
    col = sampleEye(1, vec2((v_uv.x - 0.5) * 2.0, v_uv.y), u_right_angle_rad, u_right_alpha);
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
  private lastLeftTime = -1;
  private lastRightTime = -1;

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

    for (const n of [
      'u_left', 'u_right', 'u_left_prev', 'u_right_prev',
      'u_left_ready', 'u_right_ready',
      'u_left_angle_rad', 'u_right_angle_rad',
      'u_left_alpha', 'u_right_alpha',
      'u_eye_aspect',
    ]) {
      this.u[n] = gl.getUniformLocation(this.program, n);
    }
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  private eyeAspect(): number {
    return (this.canvas.width / 2) / this.canvas.height;
  }

  uploadSource(slot: 'left' | 'right', source: HTMLVideoElement | HTMLCanvasElement) {
    const gl = this.gl;
    let frameKey = NaN;

    // `ready` is sticky — once we've uploaded one valid frame to this slot,
    // we keep the flag true even if later ticks land mid-seek (video going
    // briefly non-ready). This keeps the texture holding the last good frame
    // so the shader has something to sample instead of returning vec3(0).
    if (source instanceof HTMLVideoElement) {
      if (source.readyState < 2 || source.videoWidth === 0) return;
      frameKey = source.currentTime;
      if (slot === 'left' && frameKey === this.lastLeftTime && this.leftReady) return;
      if (slot === 'right' && frameKey === this.lastRightTime && this.rightReady) return;
    } else {
      if (source.width === 0 || source.height === 0) return;
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
      this.leftReady = true;
      this.lastLeftTime = frameKey;
    } else {
      this.rightReady = true;
      this.lastRightTime = frameKey;
    }
  }

  // Upload a previous-frame snapshot for cross-fade blending. No dedup —
  // the caller (main.ts) only calls this on detected frame transitions.
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
      /* swallow — tex keeps last good frame */
    }
  }

  render(
    leftAngleRad: number = 0,
    rightAngleRad: number = 0,
    leftAlpha: number = 1,
    rightAlpha: number = 1,
  ) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.leftTex);
    gl.uniform1i(this.u.u_left!, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rightTex);
    gl.uniform1i(this.u.u_right!, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.leftPrevTex);
    gl.uniform1i(this.u.u_left_prev!, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.rightPrevTex);
    gl.uniform1i(this.u.u_right_prev!, 3);

    gl.uniform1i(this.u.u_left_ready!, this.leftReady ? 1 : 0);
    gl.uniform1i(this.u.u_right_ready!, this.rightReady ? 1 : 0);
    gl.uniform1f(this.u.u_left_angle_rad!, leftAngleRad);
    gl.uniform1f(this.u.u_right_angle_rad!, rightAngleRad);
    gl.uniform1f(this.u.u_left_alpha!, leftAlpha);
    gl.uniform1f(this.u.u_right_alpha!, rightAlpha);
    gl.uniform1f(this.u.u_eye_aspect!, this.eyeAspect());

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
