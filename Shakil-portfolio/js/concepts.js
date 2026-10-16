/* =============================================================
   Alternative concepts for the Research sequence, for comparison
   with the point cloud (select with ?concept=patches|ink|lens).
   All three read the same scroll state as the point engine and
   draw into its canvas, before the points.
     patches  a Vision-Transformer mosaic: 16 × 12 tiles that flip,
              fly into an embedding, cluster and stack into species
     ink      a GPU fluid simulation; scenes settle as ink in water
     lens     a machine-vision scanner with an edge-detecting band
   ============================================================= */
window.SA = window.SA || {};

SA.concepts = (() => {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = (t) => t * t * (3 - 2 * t);
  const LAST = 7;                                      // research states are 1..7

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

  /* scene canvases (layers 0..6 = states 1..7, 1024 × 768 in the top of each layer) + atlas (layer 7) */
  function uploadScenes(gl, data, tex) {
    tex = tex || gl.createTexture();
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, 1024, 1024, 8, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (let s = 1; s <= LAST; s++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, s - 1, 1024, 768, 1, gl.RGBA, gl.UNSIGNED_BYTE, data.scenes[s]);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 7, 1024, 1024, 1, gl.RGBA, gl.UNSIGNED_BYTE, data.atlas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    return tex;
  }

  function quadVAO(gl) {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  /* the stage a scene lives in, and where a 4:3 image sits inside it */
  function stageOf(e, s) {
    const st = e.states[clamp(s, 0, LAST)];
    const el = st && st.anchor;
    return el ? el.getBoundingClientRect() : { left: 0, top: 0, width: e.w, height: e.h, right: e.w, bottom: e.h };
  }
  function viewport(gl, e, r) {
    const dpr = e.dpr, x = Math.round(r.left * dpr), y = Math.round(e.canvas.height - r.bottom * dpr);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    gl.viewport(x, y, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(Math.max(0, x), Math.max(0, y), Math.max(0, Math.min(w, e.canvas.width - x)), Math.max(0, h));
  }
  /* image (4:3) fitted inside the stage, in stage uv with y up: scale.xy, offset.xy */
  function fit(r, pad = 0.94) {
    const s = Math.min(r.width / 4, r.height / 3) * pad;
    const w = (s * 4) / r.width, h = (s * 3) / r.height;
    return [w, h, (1 - w) / 2, (1 - h) / 2];
  }
  const visibility = (st) => smooth(0.25, 0.85, st) * (1 - smooth(7.15, 7.75, st));

  /* ================================================================= patches */
  const P_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aCorner;
  layout(location=1) in vec4 a0;   // centre x, y (css px), half w, half h
  layout(location=2) in vec4 a1;   // flip angle, alpha, layer, highlight
  layout(location=3) in vec4 a2;   // uv rect
  layout(location=4) in vec4 a3;   // z rotation
  uniform vec2 uRes;
  out vec2 vUv, vLocal;
  out float vAlpha, vLayer, vHl, vShade;
  void main() {
    vec2 c = vec2(aCorner.x, -aCorner.y);
    float th = a1.x;
    float zp = c.x * a0.z * sin(th);
    float persp = 900.0 / (900.0 - zp);
    vec2 p = vec2(c.x * a0.z * cos(th), c.y * a0.w) * persp;
    float cr = cos(a3.x), sr = sin(a3.x);
    p = vec2(cr * p.x - sr * p.y, sr * p.x + cr * p.y);
    vec2 scr = a0.xy + p;
    gl_Position = vec4(scr.x / uRes.x * 2.0 - 1.0, 1.0 - scr.y / uRes.y * 2.0, 0.0, 1.0);
    vUv = a2.xy + (c * 0.5 + 0.5) * a2.zw;
    vLocal = c;
    vAlpha = a1.y; vLayer = a1.z; vHl = a1.w; vShade = abs(sin(th));
  }`;
  const P_FS = `#version 300 es
  precision highp float;
  precision highp sampler2DArray;
  uniform sampler2DArray uTex;
  uniform vec3 uAccent;
  in vec2 vUv, vLocal;
  in float vAlpha, vLayer, vHl, vShade;
  out vec4 o;
  void main() {
    vec4 c = texture(uTex, vec3(vUv, vLayer));
    vec2 q = abs(vLocal);
    float r = 0.1;
    vec2 d = max(q - (1.0 - r), 0.0);
    float mask = 1.0 - smoothstep(r - 0.03, r, length(d));
    c.rgb *= 1.0 - vShade * 0.4;
    float edge = smoothstep(0.86, 0.93, max(q.x, q.y)) * clamp(vHl, 0.0, 1.0);
    c = mix(c, vec4(uAccent, 1.0), edge);
    o = c * mask * vAlpha;
  }`;

  class Patches {
    constructor(engine, data, { desktop }) {
      this.e = engine; this.gl = engine.gl; this.desktop = desktop;
      const gl = this.gl;
      this.prog = program(gl, P_VS, P_FS);
      this.cols = 16; this.rows = 12; this.n = this.cols * this.rows;
      this.inst = new Float32Array(this.n * 16);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
      for (let a = 0; a < 4; a++) {
        gl.enableVertexAttribArray(1 + a);
        gl.vertexAttribPointer(1 + a, 4, gl.FLOAT, false, 64, a * 16);
        gl.vertexAttribDivisor(1 + a, 1);
      }
      gl.bindVertexArray(null);
      this.anyHover = 0;
      this.setData(data);
    }

    setData(data) {
      this.data = data;
      this.tex = uploadScenes(this.gl, data, this.tex);
      const { cols, rows, n } = this, r = SA.fields.rng(301), K = data.K;
      const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v); };
      const stats = [1, 2, 3].map((s) => SA.scenes.tileStats(data.scenes[s], cols, rows));
      const species = Array.from({ length: n }, (_, i) => i % K);
      for (let i = n - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [species[i], species[j]] = [species[j], species[i]]; }
      const count = new Array(K).fill(0);
      this.tiles = species.map((k, idx) => {
        const i = idx % cols, j = Math.floor(idx / cols), m = count[k]++;
        return {
          i, j, k, m, cell: k * data.PER + Math.floor(r() * data.PER),
          dDiag: (i + j) / (cols + rows - 2), dRand: r(),
          cov: stats.map((s) => s[idx].cov), rgb: stats.map((s) => s[idx].rgb),
          loose: [gauss() * 0.45, gauss() * 0.36, gauss() * 0.3],
          stack: [(r() - 0.5) * 0.03, (r() - 0.5) * 0.24],
          hl: 0,
        };
      });
      this.perSpecies = count;
      // nearest tiles by colour, per image scene (the "attention" shown on hover)
      this.similar = [0, 1, 2].map((L) => this.tiles.map((t, a) => {
        if (t.cov[L] < 0.1) return [];
        return this.tiles.map((u, b) => ({ b, d: u.cov[L] < 0.1 || a === b ? 1e9 : (t.rgb[L][0] - u.rgb[L][0]) ** 2 + (t.rgb[L][1] - u.rgb[L][1]) ** 2 + (t.rgb[L][2] - u.rgb[L][2]) ** 2 }))
          .sort((x, y) => x.d - y.d).slice(0, 14).filter((x) => x.d < 1e9).map((x) => x.b);
      }));
    }

    /* unit layout of every tile in every state */
    pose(t, s) {
      const { cols, rows } = this;
      const gx = -1 + (t.i + 0.5) * (2 / cols), gy = -0.75 + (t.j + 0.5) * (1.5 / rows);
      if (s <= 3) {
        const L = Math.max(0, s - 1);
        return { kind: 'img', x: gx, y: gy, z: 0, size: 2 / cols, layer: L, rect: [t.i / cols, (t.j / rows) * 0.75, 1 / cols, 0.75 / rows], cov: t.cov[L], ext: [1, 0.75], pad: 0.94, a: s === 0 ? 0 : 1, rot: 0 };
      }
      const rect = this.data.cellRect(t.cell);
      const [cx, cy] = this.data.centers[t.k];
      if (s === 4) return { kind: 'thumb', x: gx, y: gy, z: 0, size: 2 / cols, layer: 7, rect, cov: 1, ext: [1, 0.75], pad: 0.94, a: 1, rot: 0 };
      if (s === 5) return { kind: 'thumb', x: cx * 0.37 + t.loose[0], y: cy * 0.32 + t.loose[1], z: t.loose[2], size: 0.085, layer: 7, rect, cov: 1, ext: [1.2, 0.95], pad: 0.9, a: 1, rot: 0 };
      if (s === 6) {
        const a = t.m * 2.39996, d = 0.045 * Math.sqrt(t.m + 0.5);
        return { kind: 'thumb', x: cx * 1.15 + Math.cos(a) * d, y: cy * 1.05 + Math.sin(a) * d, z: -t.m * 0.002, size: 0.072, layer: 7, rect, cov: 1, ext: [1.45, 0.85], pad: 0.9, a: 1, rot: 0 };
      }
      const narrow = !this.desktop.matches;
      const slots = narrow
        ? [[-0.46, -1.24], [0.46, -1.24], [-0.46, -0.42], [0.46, -0.42], [-0.46, 0.4], [0.46, 0.4], [0, 1.22]]
        : [[-1.05, -0.46], [-0.35, -0.46], [0.35, -0.46], [1.05, -0.46], [-0.7, 0.42], [0, 0.42], [0.7, 0.42]];
      const scale = narrow ? 0.4 : 0.3, [sx, sy] = slots[t.k];
      const top = t.m === this.perSpecies[t.k] - 1;
      const st = this.e.states[LAST];
      return { kind: 'thumb', x: sx + (top ? 0 : t.stack[0]), y: sy - 0.02 - t.m * 0.0025, z: t.m * 0.004, size: scale * 0.82, layer: 7, rect, cov: 1,
        ext: this.e.ext[st.layer] || [1.4, 0.86], pad: st.pad || 0.92, a: s > LAST ? 0 : 1, rot: top ? 0 : t.stack[1] };
    }

    mapper(s, ext, pad) {
      const e = this.e, r = stageOf(e, s), st = e.states[clamp(s, 0, LAST)] || {};
      const k = Math.min(r.width / (2 * ext[0]), r.height / (2 * ext[1])) * pad;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const tilt = (st.tilt ?? 1) * (e.reduced ? 0 : 1);
      const ay = e.tilt.x * 0.3 * tilt, ax = -e.tilt.y * 0.22 * tilt;
      const ca = Math.cos(ax), sa = Math.sin(ax), cb = Math.cos(ay), sb = Math.sin(ay);
      return (x, y, z) => {
        const y1 = ca * y - sa * z, z1 = sa * y + ca * z;
        const x2 = cb * x + sb * z1, z2 = -sb * x + cb * z1;
        const persp = 1 / (1 - clamp(z2, -1.5, 1.5) * 0.25);
        return { x: cx + x2 * k * persp, y: cy + y1 * k * persp, s: k * persp, z: z2 };
      };
    }

    render(gl, e, dt) {
      const st = clamp(e.state, 0, LAST + 1);
      if (st < 0.02 || st > LAST + 0.98) return;
      const k0 = Math.floor(st), k1 = Math.min(k0 + 1, LAST + 1), f = st - k0;
      const flipPair = k0 >= 1 && k0 <= 3;                       // 1→2, 2→3, 3→4 flip in place
      const mouse = { x: e.mouse.tx, y: e.mouse.ty };
      const D = 0.5, maps = {};
      const map = (s, pose) => {
        const key = s + ':' + pose.ext.join(',');
        return (maps[key] ||= this.mapper(Math.min(s, LAST), pose.ext, pose.pad))(pose.x, pose.y, pose.z);
      };

      // pass 1: positions
      const drawn = [];
      for (const t of this.tiles) {
        const A = this.pose(t, k0), B = this.pose(t, k1);
        const delay = flipPair ? t.dDiag : t.dRand;
        const lt = ease(clamp((f - delay * D) / (1 - D)));
        const pa = map(k0, A), pb = map(k1, B);
        let theta, face;
        if (flipPair) { theta = lt < 0.5 ? lt * Math.PI : (lt - 1) * Math.PI; face = lt < 0.5 ? A : B; }
        else { theta = Math.sin(lt * Math.PI) * 0.7 * (t.dRand > 0.5 ? 1 : -1); face = lt < 0.5 ? A : B; }
        const lift = flipPair ? Math.sin(lt * Math.PI) * 18 : Math.sin(lt * Math.PI) * 40;
        const x = pa.x + (pb.x - pa.x) * lt, y = pa.y + (pb.y - pa.y) * lt - lift * 0.3;
        const half = (A.size * pa.s + (B.size * pb.s - A.size * pa.s) * lt) / 2;
        const alpha = clamp(face.cov * 10) * (A.a + (B.a - A.a) * lt);
        if (alpha < 0.01) { t.screen = null; continue; }
        t.screen = { x, y, half, theta, alpha, face, depth: pa.z + (pb.z - pa.z) * lt + lift * 0.002, rot: A.rot + (B.rot - A.rot) * lt };
        drawn.push(t);
      }

      // hover: the patch under the cursor, and the patches it attends to
      let hot = null;
      for (const t of drawn) {
        const s = t.screen;
        if (Math.abs(mouse.x - s.x) < s.half && Math.abs(mouse.y - s.y) < s.half && (!hot || s.depth > hot.screen.depth)) hot = t;
      }
      const sceneNow = Math.round(st);
      const related = new Set();
      if (hot) {
        if (hot.screen.face.kind === 'img' && sceneNow >= 1 && sceneNow <= 3) this.similar[sceneNow - 1][this.tiles.indexOf(hot)].forEach((b) => related.add(this.tiles[b]));
        else if (hot.screen.face.kind === 'thumb') this.tiles.forEach((u) => { if (u.k === hot.k) related.add(u); });
      }
      const k = 1 - Math.exp(-dt * 10);
      this.anyHover += ((hot ? 1 : 0) - this.anyHover) * k;

      // pass 2: instances, far to near
      drawn.sort((a, b) => a.screen.depth - b.screen.depth);
      const d = this.inst;
      let n = 0;
      for (const t of drawn) {
        const target = t === hot ? 1 : related.has(t) ? 0.6 : 0;
        t.hl += (target - t.hl) * k;
        const s = t.screen, grow = 1 + 0.14 * (t === hot ? t.hl : 0) + 0.06 * t.hl;
        const half = s.half * 0.94 * grow;
        const dim = 1 - 0.45 * this.anyHover * (1 - Math.min(1, t.hl * 1.6));
        d.set([s.x, s.y - t.hl * 6, half, half, s.theta, s.alpha * dim, s.face.layer, t.hl, ...s.face.rect, s.rot, 0, 0, 0], n * 16);
        n++;
      }
      if (!n) return;
      const u = this.prog.u;
      gl.viewport(0, 0, e.canvas.width, e.canvas.height);
      gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.prog.p);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, n * 16));
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.uniform1i(u.uTex, 4);
      gl.uniform2f(u.uRes, e.w, e.h);
      gl.uniform3fv(u.uAccent, e.dark ? [0.49, 0.77, 1.0] : [0.12, 0.37, 0.75]);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  /* ================================================================= ink */
  const BASE_VS = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  uniform vec2 texelSize;
  out vec2 vUv, vL, vR, vT, vB;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    vL = vUv - vec2(texelSize.x, 0.0); vR = vUv + vec2(texelSize.x, 0.0);
    vT = vUv + vec2(0.0, texelSize.y); vB = vUv - vec2(0.0, texelSize.y);
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;
  const FS = (body) => `#version 300 es
  precision highp float;
  precision highp sampler2D;
  precision highp sampler2DArray;
  in vec2 vUv, vL, vR, vT, vB;
  out vec4 o;
  ${body}`;
  const INK = {
    splat: FS(`uniform sampler2D uTarget; uniform float aspect; uniform vec3 color; uniform vec2 point; uniform float radius;
      void main() { vec2 p = vUv - point; p.x *= aspect; o = vec4(texture(uTarget, vUv).xyz + exp(-dot(p, p) / radius) * color, 1.0); }`),
    advect: FS(`uniform sampler2D uVelocity, uSource; uniform vec2 simTexel; uniform float dt, dissipation;
      void main() { vec2 c = vUv - dt * texture(uVelocity, vUv).xy * simTexel; o = texture(uSource, c) / (1.0 + dissipation * dt); }`),
    divergence: FS(`uniform sampler2D uVelocity;
      void main() {
        float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x, T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
        vec2 C = texture(uVelocity, vUv).xy;
        if (vL.x < 0.0) L = -C.x; if (vR.x > 1.0) R = -C.x; if (vT.y > 1.0) T = -C.y; if (vB.y < 0.0) B = -C.y;
        o = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
      }`),
    curl: FS(`uniform sampler2D uVelocity;
      void main() { o = vec4(0.5 * (texture(uVelocity, vR).y - texture(uVelocity, vL).y - texture(uVelocity, vT).x + texture(uVelocity, vB).x), 0.0, 0.0, 1.0); }`),
    vorticity: FS(`uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
      void main() {
        float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x, T = texture(uCurl, vT).x, B = texture(uCurl, vB).x, C = texture(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
        force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0;
        o = vec4(clamp(texture(uVelocity, vUv).xy + force * dt, -1000.0, 1000.0), 0.0, 1.0);
      }`),
    pressure: FS(`uniform sampler2D uPressure, uDivergence;
      void main() {
        float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
        o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * 0.25, 0.0, 0.0, 1.0);
      }`),
    gradient: FS(`uniform sampler2D uPressure, uVelocity;
      void main() {
        float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x, T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
        o = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B), 0.0, 1.0);
      }`),
    scale: FS(`uniform sampler2D uTexture; uniform float value; void main() { o = value * texture(uTexture, vUv); }`),
    relax: FS(`uniform sampler2D uDye; uniform sampler2DArray uScenes; uniform float layer, k; uniform vec4 fitR;
      void main() {
        vec2 iuv = (vUv - fitR.zw) / fitR.xy;
        vec4 t = vec4(0.0);
        if (iuv.x >= 0.0 && iuv.y >= 0.0 && iuv.x <= 1.0 && iuv.y <= 1.0) t = texture(uScenes, vec3(iuv.x, (1.0 - iuv.y) * 0.75, layer));
        o = mix(texture(uDye, vUv), t, k);
      }`),
    display: FS(`uniform sampler2D uDye; uniform float alpha;
      void main() { vec4 c = clamp(texture(uDye, vUv), 0.0, 1.0); c.rgb = min(c.rgb, vec3(c.a)); o = c * alpha; }`),
  };

  class Ink {
    constructor(engine, data) {
      this.e = engine; this.gl = engine.gl;
      const gl = this.gl;
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('ink needs EXT_color_buffer_float');
      this.vao = quadVAO(gl);
      this.p = {};
      for (const k in INK) this.p[k] = program(gl, BASE_VS, INK[k]);
      this.scene = -1; this.relaxBoost = 0; this.idle = 0; this.size = null;
      this.lastMouse = null;
      this.setData(data);
    }
    setData(data) { this.data = data; this.tex = uploadScenes(this.gl, data, this.tex); this.scene = -1; }

    fbo(w, h, internal, format) {
      const gl = this.gl, tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.HALF_FLOAT, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.activeTexture(gl.TEXTURE0);
      return { tex, fb, w, h };
    }
    double(w, h, internal, format) {
      const a = this.fbo(w, h, internal, format), b = this.fbo(w, h, internal, format);
      return { get read() { return a.r ? b : a; }, get write() { return a.r ? a : b; }, swap() { a.r = !a.r; }, w, h };
    }
    init(r) {
      const gl = this.gl, aspect = r.width / r.height;
      const simH = 128, simW = Math.round(simH * aspect);
      const dyeH = Math.round(clamp(r.height * this.e.dpr, 320, 1024)), dyeW = Math.round(dyeH * aspect);
      this.vel = this.double(simW, simH, gl.RG16F, gl.RG);
      this.dye = this.double(dyeW, dyeH, gl.RGBA16F, gl.RGBA);
      this.div = this.fbo(simW, simH, gl.R16F, gl.RED);
      this.curlT = this.fbo(simW, simH, gl.R16F, gl.RED);
      this.pres = this.double(simW, simH, gl.R16F, gl.RED);
      this.size = [r.width, r.height];
      this.scene = -1;
    }
    run(name, target, uniforms, textures = {}) {
      const gl = this.gl, pr = this.p[name];
      gl.useProgram(pr.p);
      let unit = 5;
      for (const [k, t] of Object.entries(textures)) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(k === 'uScenes' ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D, t);
        gl.uniform1i(pr.u[k], unit++);
      }
      for (const [k, v] of Object.entries(uniforms)) {
        if (!pr.u[k]) continue;
        if (Array.isArray(v)) (v.length === 2 ? gl.uniform2fv : v.length === 3 ? gl.uniform3fv : gl.uniform4fv).call(gl, pr.u[k], v);
        else gl.uniform1f(pr.u[k], v);
      }
      if (target) { gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb); gl.viewport(0, 0, target.w, target.h); }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    splat(x, y, dx, dy, radius = 0.004) {
      const v = this.vel;
      this.run('splat', v.write, { aspect: v.w / v.h, point: [x, y], color: [dx, dy, 0], radius, texelSize: [1 / v.w, 1 / v.h] }, { uTarget: v.read.tex });
      v.swap();
    }
    whirl(strength) {
      const r = SA.fields.rng((performance.now() | 0) % 9973);
      const n = 9, cx = 0.5 + (r() - 0.5) * 0.2, cy = 0.5 + (r() - 0.5) * 0.2, rad = 0.2 + r() * 0.1, dir = r() > 0.5 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.splat(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, -Math.sin(a) * strength * dir, Math.cos(a) * strength * dir, 0.006);
      }
    }

    render(gl, e, dt) {
      const st = clamp(e.state, 0, LAST + 1), vis = visibility(st);
      if (vis < 0.005) return;
      const scene = clamp(Math.round(st), 1, LAST);
      const r = stageOf(e, scene);
      if (r.bottom < 0 || r.top > e.h || r.width < 4) return;
      if (!this.size || Math.abs(this.size[0] - r.width) > 2 || Math.abs(this.size[1] - r.height) > 2) this.init(r);
      dt = clamp(dt, 0.008, 0.033);
      const motion = e.reduced ? 0 : 1;
      gl.disable(gl.BLEND);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindVertexArray(this.vao);
      const fitR = fit(r);
      const vel = this.vel, dye = this.dye, simTexel = [1 / vel.w, 1 / vel.h];

      // a new scene arrives with a whirlpool; the cursor and scrolling stir the water
      let k;
      if (scene !== this.scene) {
        const first = this.scene < 0;
        this.scene = scene;
        if (!first && motion) { this.whirl(320); this.relaxBoost = 1; }
        k = first ? 1 : 0;
      }
      this.relaxBoost = Math.max(0, this.relaxBoost - dt * 0.75);
      const m = e.mouse;
      if (motion && m.tx > r.left && m.tx < r.right && m.ty > r.top && m.ty < r.bottom) {
        const ux = (m.tx - r.left) / r.width, uy = 1 - (m.ty - r.top) / r.height;
        if (this.lastMouse) {
          const dx = ux - this.lastMouse[0], dy = uy - this.lastMouse[1];
          if (Math.abs(dx) + Math.abs(dy) > 0.0005) this.splat(ux, uy, dx * 5000, dy * 5000, 0.0025);
        }
        this.lastMouse = [ux, uy];
      } else this.lastMouse = null;
      const travel = Math.abs(e.target - e.state);
      this.idle -= dt;
      if (motion && (this.idle < 0 || travel > 0.05)) {
        const rr = Math.random, s = scene === 2 ? 40 : 14;
        this.splat(0.2 + rr() * 0.6, 0.2 + rr() * 0.6, (rr() - 0.5) * s * (1 + travel * 8), (rr() - 0.5) * s * (1 + travel * 8), 0.01);
        this.idle = scene === 2 ? 0.45 : 1.4;
      }

      // one step of the stable-fluids solver
      this.run('curl', this.curlT, { texelSize: simTexel }, { uVelocity: vel.read.tex });
      this.run('vorticity', vel.write, { texelSize: simTexel, curl: 22, dt }, { uVelocity: vel.read.tex, uCurl: this.curlT.tex }); vel.swap();
      this.run('divergence', this.div, { texelSize: simTexel }, { uVelocity: vel.read.tex });
      this.run('scale', this.pres.write, { texelSize: simTexel, value: 0.8 }, { uTexture: this.pres.read.tex }); this.pres.swap();
      for (let i = 0; i < 18; i++) { this.run('pressure', this.pres.write, { texelSize: simTexel }, { uPressure: this.pres.read.tex, uDivergence: this.div.tex }); this.pres.swap(); }
      this.run('gradient', vel.write, { texelSize: simTexel }, { uPressure: this.pres.read.tex, uVelocity: vel.read.tex }); vel.swap();
      this.run('advect', vel.write, { texelSize: simTexel, simTexel, dt, dissipation: 1.6 }, { uVelocity: vel.read.tex, uSource: vel.read.tex }); vel.swap();
      this.run('advect', dye.write, { texelSize: [1 / dye.w, 1 / dye.h], simTexel, dt, dissipation: 0 }, { uVelocity: vel.read.tex, uSource: dye.read.tex }); dye.swap();
      // calm water returns the image quickly and sharply; right after a whirl it lets the swirl show
      const rate = 6.5 - 5.8 * this.relaxBoost;
      this.run('relax', dye.write, { texelSize: [1 / dye.w, 1 / dye.h], layer: scene - 1, k: k ?? (1 - Math.exp(-dt * rate)), fitR }, { uDye: dye.read.tex, uScenes: this.tex }); dye.swap();

      // draw
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      viewport(gl, e, r);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.run('display', null, { texelSize: [1 / dye.w, 1 / dye.h], alpha: vis }, { uDye: dye.read.tex });
      gl.disable(gl.SCISSOR_TEST);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  /* ================================================================= lens */
  const LENS_FS = FS(`uniform sampler2DArray uScenes;
    uniform float layerA, layerB, prog, time, lensR, ready, alphaMul;
    uniform vec4 fitR;
    uniform vec2 res, mouse;
    uniform vec3 paper, accent, ink;
    vec4 img(float layer, vec2 uv) {
      vec2 iuv = (uv - fitR.zw) / fitR.xy;
      if (iuv.x < 0.0 || iuv.y < 0.0 || iuv.x > 1.0 || iuv.y > 1.0) return vec4(0.0);
      return texture(uScenes, vec3(iuv.x, (1.0 - iuv.y) * 0.75, layer));
    }
    float lum(float layer, vec2 uv) { vec4 c = img(layer, uv); vec3 col = c.rgb + paper * (1.0 - c.a); return dot(col, vec3(0.299, 0.587, 0.114)); }
    float edges(float layer, vec2 uv) {
      vec2 px = 1.4 / res;
      float tl = lum(layer, uv + vec2(-px.x, px.y)), t = lum(layer, uv + vec2(0.0, px.y)), tr = lum(layer, uv + px);
      float l = lum(layer, uv - vec2(px.x, 0.0)), r = lum(layer, uv + vec2(px.x, 0.0));
      float bl = lum(layer, uv - px), b = lum(layer, uv - vec2(0.0, px.y)), br = lum(layer, uv + vec2(px.x, -px.y));
      float gx = tr + 2.0 * r + br - tl - 2.0 * l - bl, gy = tl + 2.0 * t + tr - bl - 2.0 * b - br;
      return smoothstep(0.08, 0.5, length(vec2(gx, gy)));
    }
    float grid(vec2 uv) {
      vec2 iuv = (uv - fitR.zw) / fitR.xy;
      vec2 g = abs(fract(iuv * vec2(16.0, 12.0) + 0.5) - 0.5) / fwidth(iuv * vec2(16.0, 12.0));
      float inside = step(0.0, iuv.x) * step(0.0, iuv.y) * step(iuv.x, 1.0) * step(iuv.y, 1.0);
      return (1.0 - clamp(min(g.x, g.y), 0.0, 1.0)) * inside;
    }
    vec4 machine(float layer, vec2 uv) {        // what the model is shown: edges over a patch grid
      float e = edges(layer, uv);
      return vec4(accent, 1.0) * e + vec4(ink, 1.0) * grid(uv) * 0.18 * (1.0 - e);
    }
    void main() {
      vec2 uv = vUv;
      vec2 fragPx = vec2(uv.x * res.x, (1.0 - uv.y) * res.y);
      float w = 0.16, bx = mix(-w, 1.0 + w, prog), d = uv.x - bx;
      vec4 c;
      if (d < -w * 0.5) c = img(layerB, uv);
      else if (d > w * 0.5) c = img(layerA, uv);
      else {
        float fade = smoothstep(w * 0.5, 0.0, abs(d));
        c = mix(img(d < 0.0 ? layerB : layerA, uv) * 0.25, machine(layerB, uv), fade);
      }
      float lead = smoothstep(2.0 / res.x, 0.0, abs(d - w * 0.5)) * step(0.001, prog) * step(prog, 0.999);
      c = mix(c, vec4(accent, 1.0), lead);
      // a slow scan line keeps the model looking while the page is still
      float sy = fract(time * 0.07), dy = (1.0 - uv.y) - sy;
      float trail = smoothstep(-0.06, 0.0, dy) * step(dy, 0.0);
      float layerNow = prog < 0.5 ? layerA : layerB;
      c = mix(c, c + machine(layerNow, uv) * 0.6, trail * ready);
      c = mix(c, vec4(accent, 1.0), smoothstep(1.2 / res.y, 0.0, abs(dy)) * 0.5 * ready * step(0.002, img(layerNow, uv).a + 0.003));
      // the lens: the model's view under the cursor
      float r = length(fragPx - mouse);
      float inLens = smoothstep(lensR, lensR - 1.5, r) * ready;
      c = mix(c, machine(layerNow, uv) + vec4(paper, 1.0) * 0.0, inLens);
      float ring = smoothstep(1.5, 0.0, abs(r - lensR)) * ready;
      c = mix(c, vec4(ink, 1.0), ring * 0.7);
      o = c * alphaMul;
    }`);

  class Lens {
    constructor(engine, data) {
      this.e = engine; this.gl = engine.gl;
      this.vao = quadVAO(this.gl);
      this.prog = program(this.gl, BASE_VS, LENS_FS);
      this.lens = 0;
      this.setData(data);
    }
    setData(data) { this.data = data; this.tex = uploadScenes(this.gl, data, this.tex); }
    render(gl, e, dt) {
      const st = clamp(e.state, 0, LAST + 1), vis = visibility(st);
      if (vis < 0.005) return;
      const k0 = clamp(Math.floor(st), 1, LAST), k1 = clamp(Math.floor(st) + 1, 1, LAST);
      const f = st < 1 ? 0 : st >= LAST ? 0 : ease(clamp((st - Math.floor(st) - 0.1) / 0.8));
      const r = stageOf(e, Math.round(clamp(st, 1, LAST)));
      if (r.bottom < 0 || r.top > e.h || r.width < 4) return;
      const m = e.mouse, inside = m.tx > r.left && m.tx < r.right && m.ty > r.top && m.ty < r.bottom && !e.reduced;
      this.lens += ((inside ? 1 : 0) - this.lens) * (1 - Math.exp(-dt * 8));
      viewport(gl, e, r);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.prog.p);
      gl.bindVertexArray(this.vao);
      const u = this.prog.u;
      gl.activeTexture(gl.TEXTURE6);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.uniform1i(u.uScenes, 6);
      gl.uniform1f(u.layerA, k0 - 1); gl.uniform1f(u.layerB, k1 - 1); gl.uniform1f(u.prog, f);
      gl.uniform1f(u.time, e.time); gl.uniform1f(u.lensR, 95 * this.lens); gl.uniform1f(u.ready, e.reduced ? 0 : 1);
      gl.uniform4fv(u.fitR, fit(r));
      gl.uniform2f(u.res, r.width, r.height);
      gl.uniform2f(u.mouse, m.tx - r.left, m.ty - r.top);
      gl.uniform3fv(u.paper, e.bg);
      gl.uniform3fv(u.accent, e.dark ? [0.49, 0.77, 1.0] : [0.12, 0.37, 0.75]);
      gl.uniform3fv(u.ink, e.dark ? [0.93, 0.93, 0.9] : [0.09, 0.09, 0.11]);
      gl.uniform2f(u.texelSize, 0, 0);
      gl.uniform1f(u.alphaMul, vis);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.SCISSOR_TEST);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
    }
  }

  function create(name, engine, data, opts) {
    if (name === 'patches') return new Patches(engine, data, opts);
    if (name === 'ink') return new Ink(engine, data, opts);
    if (name === 'lens') return new Lens(engine, data, opts);
    return null;
  }
  return { create };
})();
