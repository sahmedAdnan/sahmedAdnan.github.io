/* =============================================================
   Generator: a convolutional decoder, drawn in 3D, that builds the
   portrait. A noise vector z passes through feature maps of growing
   resolution (4×5 → 8×10 → … → 64×80), then three colour channels
   at 128×160, then the photograph itself. The camera finishes head-on
   to the output, so the hero rests on the real, sharp photo
   (a cut-out, so it sits on the page rather than on a dark box).
   Every feature map is computed from the photograph at that
   resolution (brightness, edges, local contrast, colour opponents),
   so what the layers show is the image taking shape.
   Draws into the engine's WebGL context, before the points.
   ============================================================= */
window.SA = window.SA || {};

(() => {
  const DEG = Math.PI / 180;
  const LAYERS = [
    { z: true, cells: 16, h: 1.5, x: 0 },
    { res: [4, 5], ch: ['lum', 'edge', 'dx', 'dy', 'rg', 'by'], h: 0.78, x: 1.0 },
    { res: [8, 10], ch: ['lum', 'edge', 'dx', 'dy', 'cs'], h: 1.08, x: 2.3 },
    { res: [16, 20], ch: ['lum', 'edge', 'cs', 'dy'], h: 1.42, x: 3.65 },
    { res: [32, 40], ch: ['lum', 'edge', 'cs'], h: 1.76, x: 5.1 },
    { res: [64, 80], ch: ['lum', 'edge', 'dx'], h: 2.1, x: 6.65 },
    { res: [128, 160], ch: ['r', 'g', 'b'], h: 2.44, x: 8.25, rgb: true },
  ];
  const OUT_X = 8.95, GAP = 0.15, FOV = 28 * DEG;

  /* timeline, seconds */
  const T = {
    appear: (i) => 0.05 + i * 0.07,
    zFreeze: 0.8,
    layer: (i) => [0.8 + (i - 1) * 0.42, 0.8 + (i - 1) * 0.42 + 0.6],
    merge: [3.35, 3.95],
    outIn: [3.4, 3.85],
    refine: [3.7, 6.0],
    dolly: [3.9, 6.0],
    fade: [4.5, 5.6],
    done: 6.1,
  };

  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);     // smootherstep: no jolt at either end
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------ tiny mat4 */
  const M = {
    persp(fovy, aspect, n, f) {
      const q = 1 / Math.tan(fovy / 2), nf = 1 / (n - f);
      return new Float32Array([q / aspect, 0, 0, 0, 0, q, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]);
    },
    lookAt(e, a, up = [0, 1, 0]) {
      const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
      const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
      const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      const z = norm(sub(e, a)), x = norm(cross(up, z)), y = cross(z, x);
      return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1]);
    },
    mul(a, b) {
      const o = new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return o;
    },
    apply(m, p) {
      const [x, y, z] = p;
      return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14], m[3] * x + m[7] * y + m[11] * z + m[15]];
    },
  };

  /* ------------------------------------------------ feature maps from the photo */
  function downsample(img, w, h) {
    let src = img, sw = img.naturalWidth, sh = img.naturalHeight;
    while (sw / 2 >= w && sh / 2 >= h) {
      const c = document.createElement('canvas');
      c.width = Math.max(w, Math.round(sw / 2)); c.height = Math.max(h, Math.round(sh / 2));
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, c.width, c.height);
      src = c; sw = c.width; sh = c.height;
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  }

  function maps(px, w, h) {
    const N = w * h;
    const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N), L = new Float32Array(N), A = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      R[i] = px[i * 4] / 255; G[i] = px[i * 4 + 1] / 255; B[i] = px[i * 4 + 2] / 255; A[i] = px[i * 4 + 3] / 255;
      L[i] = 0.2126 * R[i] + 0.7152 * G[i] + 0.0722 * B[i];
    }
    const at = (a, x, y) => a[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)];
    const dx = new Float32Array(N), dy = new Float32Array(N), edge = new Float32Array(N), cs = new Float32Array(N);
    const rg = new Float32Array(N), by = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = at(L, x + 1, y - 1) + 2 * at(L, x + 1, y) + at(L, x + 1, y + 1) - at(L, x - 1, y - 1) - 2 * at(L, x - 1, y) - at(L, x - 1, y + 1);
      const gy = at(L, x - 1, y + 1) + 2 * at(L, x, y + 1) + at(L, x + 1, y + 1) - at(L, x - 1, y - 1) - 2 * at(L, x, y - 1) - at(L, x + 1, y - 1);
      dx[i] = Math.max(0, gx); dy[i] = Math.max(0, -gy); edge[i] = Math.hypot(gx, gy);
      let blur = 0;
      for (let v = -1; v <= 1; v++) for (let u = -1; u <= 1; u++) blur += at(L, x + u, y + v);
      cs[i] = Math.abs(L[i] - blur / 9);
      rg[i] = Math.max(0, R[i] - G[i]);
      by[i] = Math.max(0, B[i] - (R[i] + G[i]) / 2);
    }
    const norm = (a, gamma = 1) => {
      let lo = Infinity, hi = -Infinity;
      for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const s = hi - lo || 1;
      for (let i = 0; i < a.length; i++) a[i] = Math.pow((a[i] - lo) / s, gamma);
      return a;
    };
    return {
      alpha: A, lum: L, r: R, g: G, b: B,
      edge: norm(edge, 0.7), dx: norm(dx, 0.7), dy: norm(dy, 0.7), cs: norm(cs, 0.6), rg: norm(rg, 0.8), by: norm(by, 0.8),
    };
  }

  /* pack every map into one 512×512 atlas */
  function buildAtlas(img) {
    const S = 512, data = new Uint8Array(S * S * 4);
    let x = 1, y = 1, rowH = 0;
    LAYERS.forEach((L) => {
      if (L.z) return;
      const [w, h] = L.res;
      const m = maps(downsample(img, w, h), w, h);
      L.rects = L.ch.map((name) => {
        if (x + w + 1 > S) { x = 1; y += rowH + 2; rowH = 0; }
        const src = m[name];
        for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
          const o = ((y + j) * S + (x + i)) * 4;
          data[o] = data[o + 2] = Math.round(clamp(src[j * w + i]) * 255);
          data[o + 1] = Math.round(clamp(m.alpha[j * w + i]) * 255);
          data[o + 3] = 255;
        }
        const rect = [x / S, y / S, w / S, h / S];
        x += w + 2; rowH = Math.max(rowH, h);
        return { rect, name };
      });
    });
    return { S, data };
  }

  /* ------------------------------------------------ shaders */
  const PLANE_VS = `#version 300 es
  layout(location=0) in vec2 aCorner;
  uniform mat4 uVP;
  uniform vec3 uCenter;
  uniform vec2 uSize;
  out vec2 vUV;
  void main() {
    vec3 p = uCenter + vec3(0.0, -aCorner.y * uSize.y, -aCorner.x * uSize.x);
    vUV = aCorner + 0.5;
    gl_Position = uVP * vec4(p, 1.0);
  }`;

  const PLANE_FS = `#version 300 es
  precision highp float;
  in vec2 vUV;
  uniform int   uKind;            // 0 feature map · 1 noise vector · 2 photograph
  uniform sampler2D uAtlas;
  uniform sampler2D uPhoto;
  uniform vec4  uRect;
  uniform vec2  uRes;
  uniform float uReveal, uAlpha, uSeed, uInvert, uTime;
  uniform float uRefine, uSteps;
  uniform vec2  uBase;
  uniform vec3  uFill, uInk, uLine, uHl, uTint;
  uniform float uBorder;
  out vec4 o;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  vec4 photoAt(vec2 res) {                 // premultiplied
    if (res.x >= 1100.0) return texture(uPhoto, vUV);
    vec2 q = (floor(vUV * res) + 0.5) / res;
    return textureLod(uPhoto, q, max(0.0, log2(1122.0 / res.x)));
  }

  void main() {
    vec3 col;
    if (uKind == 2) {
      float r = clamp(uRefine, 0.0, 1.0);
      float lvl = r * uSteps;
      float k = floor(lvl), f = smoothstep(0.0, 1.0, fract(lvl));
      vec2 r0 = uBase * exp2(k);
      vec4 c = mix(photoAt(r0), photoAt(r0 * 2.0), f);
      float g = hash(floor(vUV * r0) + floor(uTime * 24.0)) - 0.5;
      c.rgb = clamp(c.rgb + g * 0.14 * (1.0 - r) * c.a, 0.0, 1.0);
      o = c * uAlpha;
      return;
    } else {
      vec2 cell = floor(vUV * uRes);
      float v;
      if (uKind == 1) v = hash(vec2(cell.y, uSeed));
      else {
        vec2 s = texture(uAtlas, uRect.xy + (cell + 0.5) / uRes * uRect.zw).rg;
        v = mix(s.r, 1.0 - s.r, uInvert) * s.g;
      }
      float idx = cell.y * uRes.x + cell.x;
      float head = uReveal * uRes.x * uRes.y;
      float shown = uKind == 1 ? 1.0 : step(idx + 0.5, head);
      col = mix(uFill, uTint, v * shown);
      if (uKind == 0 && uReveal > 0.0 && uReveal < 1.0) {
        float row = floor(head / uRes.x);
        col = mix(col, uHl, (cell.y == row ? 0.18 : 0.0) + (abs(idx - floor(head)) < 0.5 ? 0.7 : 0.0));
      }
      if (uKind == 1) {
        float gy = abs(fract(vUV.y * uRes.y) - 0.5) * 2.0;
        col = mix(col, uLine, smoothstep(0.86, 1.0, gy) * 0.5);
      }
      vec2 d = min(vUV, 1.0 - vUV) / fwidth(vUV);
      col = mix(col, uLine, (1.0 - smoothstep(0.5, 1.5, min(d.x, d.y))) * uBorder);
    }
    o = vec4(col * uAlpha, uAlpha);
  }`;

  const LINE_VS = `#version 300 es
  layout(location=0) in vec4 aP;
  uniform mat4 uVP;
  out float vA;
  void main() { vA = aP.w; gl_Position = uVP * vec4(aP.xyz, 1.0); }`;
  const LINE_FS = `#version 300 es
  precision mediump float;
  in float vA;
  uniform vec3 uColor;
  out vec4 o;
  void main() { o = vec4(uColor * vA, vA); }`;

  function program(gl, vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }

  const THEME = {
    light: {
      fill: [0.985, 0.982, 0.975], ink: [0.09, 0.09, 0.11], line: [0.09, 0.09, 0.11], border: 0.5,
      hl: [0.1, 0.36, 0.74], rgb: [[0.0, 0.66, 0.92], [0.93, 0.05, 0.56], [1.0, 0.88, 0.0]], invertRGB: 1,
    },
    dark: {
      fill: [0.07, 0.075, 0.08], ink: [0.93, 0.93, 0.9], line: [0.93, 0.93, 0.9], border: 0.32,
      hl: [0.45, 0.72, 1.0], rgb: [[1.0, 0.16, 0.1], [0.12, 1.0, 0.3], [0.16, 0.36, 1.0]], invertRGB: 0,
    },
  };

  class Generator {
    constructor(engine, { src, reduced = false }) {
      this.engine = engine;
      this.gl = engine.gl;
      this.src = src;
      this.reduced = reduced;
      this.t = reduced ? T.done + 1 : -1;     // −1: not started
      this.aspect = 1122 / 1402;
      this.views = [];
      this.fitCache = {};
      this.lineData = new Float32Array(64 * 4);
    }

    async load() {
      const img = new Image();
      img.src = this.src;
      await img.decode();
      this.aspect = img.naturalWidth / img.naturalHeight;
      const gl = this.gl;
      this.photo = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.photo);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);   // throws if the image is cross-origin
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const atlas = buildAtlas(img);
      this.atlas = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.atlas);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, atlas.S, atlas.S, 0, gl.RGBA, gl.UNSIGNED_BYTE, atlas.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.plane = program(gl, PLANE_VS, PLANE_FS);
      this.line = program(gl, LINE_VS, LINE_FS);
      this.quadVAO = gl.createVertexArray();
      gl.bindVertexArray(this.quadVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.lineVAO = gl.createVertexArray();
      gl.bindVertexArray(this.lineVAO);
      this.lineBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.lineData.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);

      // planes in drawing order (back to front along x)
      this.planes = [];
      LAYERS.forEach((L, li) => {
        if (L.z) { this.planes.push({ li, j: 0, x: L.x, w: 0.13, h: L.h, kind: 1 }); return; }
        L.rects.forEach((r, j) => this.planes.push({ li, j, x: L.x + j * GAP, w: L.h * this.aspect, h: L.h, kind: 0, rect: r.rect, name: r.name }));
      });
      this.outH = 2.6;
      return this;
    }

    play() { if (!this.playing) { this.playing = true; this.t = Math.max(0, this.t); } }
    get done() { return this.t >= T.done; }
    get progress() { return this.t; }

    /* where the finished photo sits inside a stage, in px relative to the stage */
    photoBox(stage) {
      const W = stage.clientWidth, H = stage.clientHeight;
      const h = Math.min(H * 0.94, (W * 0.96) / this.aspect), w = h * this.aspect;
      return { left: (W - w) / 2, top: (H - h) / 2, width: w, height: h };
    }

    /* view: { stage, mode: 'network' | 'develop', alpha, develop } */
    addView(view) { this.views.push(view); return view; }

    camera(aspect, t, tilt) {
      const key = aspect.toFixed(3);
      if (!this.fitCache[key]) this.fitCache[key] = this.fit(aspect);
      const F = this.fitCache[key];
      const k = ease(smooth(T.dolly[0], T.dolly[1], t));
      const wob = (1 - k) * (this.reduced ? 0 : 1);
      const az = lerp(F.az, 90 * DEG, k) + (tilt.x * 4 + Math.sin(this.engine.time * 0.3) * 1.5) * DEG * wob;
      const el = lerp(F.el, 0, k) + tilt.y * -3 * DEG * wob;
      const d = F.d * Math.pow(F.dEnd / F.d, k);
      const tg = [lerp(F.target[0], OUT_X, k), lerp(F.target[1], 0, k), lerp(F.target[2], 0, k)];
      const eye = [tg[0] + d * Math.sin(az) * Math.cos(el), tg[1] + d * Math.sin(el), tg[2] + d * Math.cos(az) * Math.cos(el)];
      return M.mul(M.persp(FOV, aspect, 0.1, 200), M.lookAt(eye, tg));
    }

    /* frame the whole network in a 3/4 view for this aspect ratio */
    fit(aspect) {
      const az = 58 * DEG, el = 22 * DEG;
      const pts = [];
      const corners = (x, w, h) => { for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) pts.push([x, -v * h, -u * w]); };
      this.planes.forEach((p) => corners(p.x, p.w, p.h));
      corners(OUT_X, this.outH * this.aspect, this.outH);
      let target = [OUT_X / 2 + 0.3, 0, 0], d = 20;
      const P = M.persp(FOV, aspect, 0.1, 200);
      for (let it = 0; it < 6; it++) {
        const eye = [target[0] + d * Math.sin(az) * Math.cos(el), target[1] + d * Math.sin(el), target[2] + d * Math.cos(az) * Math.cos(el)];
        const vp = M.mul(P, M.lookAt(eye, target));
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const p of pts) { const c = M.apply(vp, p); const x = c[0] / c[3], y = c[1] / c[3]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const s = Math.max((x1 - x0) / 2 / 0.92, (y1 - y0) / 2 / 0.9);
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        const half = d * Math.tan(FOV / 2);
        const right = [Math.cos(az), 0, -Math.sin(az)];
        target = [target[0] + right[0] * cx * half * aspect, target[1] + cy * half, target[2] + right[2] * cx * half * aspect];
        d *= s;
      }
      // head-on distance at which the output fills the photo box
      const f = Math.min(0.94, (0.96 * aspect) / this.aspect);
      const dEnd = this.outH / (2 * f * Math.tan(FOV / 2));
      return { az, el, d, dEnd, target };
    }

    render(gl, engine, dt) {
      if (!this.plane) return;
      if (this.playing && !this.reduced) this.t += Math.max(0, dt) * 1.55;
      const theme = THEME[engine.dark ? 'dark' : 'light'];
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const v of this.views) {
        if (v.alpha <= 0.002) continue;
        const r = v.stage.getBoundingClientRect();
        if (r.bottom < 0 || r.top > innerHeight || r.width < 2) continue;
        this.drawNetwork(gl, engine, theme, r, v.alpha);
      }
      gl.disable(gl.SCISSOR_TEST);
      gl.bindVertexArray(null);
    }

    setViewport(gl, engine, r) {
      const dpr = engine.dpr, H = engine.canvas.height;
      const x = Math.round(r.left * dpr), y = Math.round(H - r.bottom * dpr), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      gl.viewport(x, y, w, h);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(Math.max(0, x), Math.max(0, y), Math.max(0, Math.min(w, engine.canvas.width - x)), Math.max(0, h));
    }

    usePlane(gl, theme, vp) {
      const u = this.plane.u;
      gl.useProgram(this.plane.p);
      gl.bindVertexArray(this.quadVAO);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.atlas); gl.uniform1i(u.uAtlas, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.photo); gl.uniform1i(u.uPhoto, 3);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniformMatrix4fv(u.uVP, false, vp);
      gl.uniform3fv(u.uFill, theme.fill); gl.uniform3fv(u.uLine, theme.line); gl.uniform3fv(u.uHl, theme.hl);
      gl.uniform1f(u.uTime, this.engine.time);
    }

    drawNetwork(gl, engine, theme, stageRect, alpha) {
      const t = Math.max(0, this.t);
      const aspect = stageRect.width / stageRect.height;
      this.setViewport(gl, engine, stageRect);
      const vp = this.camera(aspect, t, engine.reduced ? { x: 0, y: 0 } : engine.tilt);
      this.usePlane(gl, theme, vp);
      const u = this.plane.u;
      const fadeNet = 1 - smooth(T.fade[0], T.fade[1], t);

      // the output plane is drawn last (front-most)
      const reveal = (li) => (li === 0 ? 1 : smooth(T.layer(li)[0], T.layer(li)[1], t));
      let lastLi = -1;
      for (const p of this.planes) {
        if (p.li !== lastLi) { if (lastLi > 0) this.drawKernel(gl, theme, vp, lastLi, t, alpha * fadeNet); lastLi = p.li; this.usePlane(gl, theme, vp); }
        const L = LAYERS[p.li];
        let a = smooth(T.appear(p.li), T.appear(p.li) + 0.45, t) * fadeNet;
        let x = p.x;
        if (L.rgb) {
          const mk = ease(smooth(T.merge[0], T.merge[1], t));
          x = lerp(p.x, OUT_X - 0.02 * (3 - p.j), mk);
          a *= 1 - smooth(T.merge[0] + 0.25, T.merge[1], t);
        }
        if (a <= 0.003) continue;
        gl.uniform1i(u.uKind, p.kind);
        gl.uniform3f(u.uCenter, x, 0, 0);
        gl.uniform2f(u.uSize, p.w, p.h);
        gl.uniform1f(u.uAlpha, a * alpha);
        gl.uniform1f(u.uBorder, theme.border);
        if (p.kind === 1) {
          gl.uniform2f(u.uRes, 1, L.cells);
          gl.uniform1f(u.uSeed, t < T.zFreeze ? Math.floor(t * 14) : 7);
          gl.uniform3fv(u.uTint, theme.ink);
          gl.uniform1f(u.uReveal, 1);
        } else {
          gl.uniform4fv(u.uRect, p.rect);
          gl.uniform2f(u.uRes, L.res[0], L.res[1]);
          gl.uniform1f(u.uReveal, clamp(reveal(p.li) * 1.12 - p.j * 0.04));
          const c = L.rgb ? 'rgb' : p.name;
          gl.uniform3fv(u.uTint, L.rgb ? theme.rgb[p.j] : theme.ink);
          gl.uniform1f(u.uInvert, c === 'rgb' ? theme.invertRGB : c === 'lum' && !engine.dark ? 1 : 0);
        }
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      if (lastLi > 0) this.drawKernel(gl, theme, vp, lastLi, t, alpha * fadeNet);

      // output
      const outA = smooth(T.outIn[0], T.outIn[1], t);
      if (outA > 0.003) {
        this.usePlane(gl, theme, vp);
        gl.uniform1i(u.uKind, 2);
        gl.uniform3f(u.uCenter, OUT_X, 0, 0);
        gl.uniform2f(u.uSize, this.outH * this.aspect, this.outH);
        gl.uniform1f(u.uAlpha, outA * alpha);
        gl.uniform1f(u.uRefine, smooth(T.refine[0], T.refine[1], t));
        gl.uniform2f(u.uBase, 128, 160);
        gl.uniform1f(u.uSteps, 4);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    /* the kernel window on layer li−1 and the four rays to the pixel being written on layer li */
    drawKernel(gl, theme, vp, li, t, alpha) {
      const [t0, t1] = T.layer(li);
      if (t <= t0 || t >= t1 || alpha <= 0.01) return;
      const p = (t - t0) / (t1 - t0);
      const L = LAYERS[li], P = LAYERS[li - 1];
      const n = L.res[0] * L.res[1], idx = Math.min(n - 1, Math.floor(p * n));
      const cu = ((idx % L.res[0]) + 0.5) / L.res[0], cv = (Math.floor(idx / L.res[0]) + 0.5) / L.res[1];
      const front = (layer) => layer.x + (layer.z ? 0 : (layer.ch.length - 1) * GAP);
      const onPlane = (layer, u, v) => {
        const h = layer.h, w = layer.z ? 0.13 : layer.h * this.aspect;
        return [front(layer), (0.5 - v) * h, -(u - 0.5) * w];
      };
      const apex = onPlane(L, cu, cv);
      const a = Math.sin(p * Math.PI) ** 0.5 * alpha;
      const d = this.lineData;
      let k = 0;
      const push = (q, al) => { d.set([q[0], q[1], q[2], al], k * 4); k++; };
      if (P.z) {
        for (const zc of [0.05, 0.3, 0.55, 0.8, 0.95]) { push(onPlane(P, 0.5, zc), a * 0.9); push(apex, a * 0.9); }
      } else {
        const hu = 1.5 / P.res[0], hv = 1.5 / P.res[1];
        const c = [[cu - hu, cv - hv], [cu + hu, cv - hv], [cu + hu, cv + hv], [cu - hu, cv + hv]].map(([u, v]) => onPlane(P, clamp(u), clamp(v)));
        for (let i = 0; i < 4; i++) { push(c[i], a); push(c[(i + 1) % 4], a); }
        for (let i = 0; i < 4; i++) { push(c[i], a * 0.85); push(apex, a * 0.85); }
      }
      gl.useProgram(this.line.p);
      gl.bindVertexArray(this.lineVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, k * 4));
      gl.uniformMatrix4fv(this.line.u.uVP, false, vp);
      gl.uniform3fv(this.line.u.uColor, theme.hl);
      gl.drawArrays(gl.LINES, 0, k);
    }

  }

  Generator.T = T;
  SA.Generator = Generator;
})();
