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

uniform sampler2D u_left;
uniform sampler2D u_right;
uniform bool u_left_ready;
uniform bool u_right_ready;
uniform float u_left_brightness;
uniform float u_right_brightness;

vec3 sampleEye(int eye, vec2 uv) {
  if (eye == 0 && !u_left_ready) return vec3(0);
  if (eye == 1 && !u_right_ready) return vec3(0);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0);
  if (eye == 0) return texture(u_left, uv).rgb;
  return texture(u_right, uv).rgb;
}

void main() {
  vec3 col = vec3(0);
  if (v_uv.x < 0.5) {
    col = sampleEye(0, vec2(v_uv.x * 2.0, v_uv.y)) * u_left_brightness;
  } else {
    col = sampleEye(1, vec2((v_uv.x - 0.5) * 2.0, v_uv.y)) * u_right_brightness;
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

    for (const n of ['u_left', 'u_right', 'u_left_ready', 'u_right_ready', 'u_left_brightness', 'u_right_brightness']) {
      this.u[n] = gl.getUniformLocation(this.program, n);
    }
  }

  resize(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  uploadSource(slot: 'left' | 'right', source: HTMLVideoElement | HTMLCanvasElement) {
    const gl = this.gl;
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
    } else {
      if (source.width === 0 || source.height === 0) {
        if (slot === 'left') this.leftReady = false;
        else this.rightReady = false;
        return;
      }
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

  render(leftBrightness: number = 1, rightBrightness: number = 1) {
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

    gl.uniform1i(this.u.u_left_ready!, this.leftReady ? 1 : 0);
    gl.uniform1i(this.u.u_right_ready!, this.rightReady ? 1 : 0);
    gl.uniform1f(this.u.u_left_brightness!, leftBrightness);
    gl.uniform1f(this.u.u_right_brightness!, rightBrightness);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
