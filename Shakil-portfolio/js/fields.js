/* =============================================================
   Fields: every scene the point cloud can become.
   Vertex v belongs to colour channel v % 3 and to triplet v / 3.
   Photographs are reproduced as a colour halftone: in light mode
   cyan / magenta / yellow ink dots sampled from (1 − R, G, B),
   in dark mode red / green / blue light sampled from (R, G, B).
   Line art and diagrams use whole triplets, which print as black
   ink (or white light) until something pulls the channels apart.
   Each builder returns { data: Float32Array(nV*4), ext: [ex, ey] }
   in a unit space where x → right, y → down, z → viewer.
   w: −2 hidden · 0 plain · other values are scene-specific tags.
   ============================================================= */
window.SA = window.SA || {};

SA.fields = (() => {
  const TAU = Math.PI * 2;
  const HIDDEN = -2;

  const rng = (a) => () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = (r) => {
    let u = 0, v = 0;
    while (!u) u = r();
    while (!v) v = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };

  async function image(src) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  }
  function pixels(src, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (typeof src === 'function') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); src(g, w, h); }
    else g.drawImage(src, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  }

  /* cumulative density over pixels, for O(log n) sampling */
  function cdf(px, w, h, density) {
    const n = w * h, acc = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) { sum += Math.max(0, density(px, i * 4)); acc[i] = sum; }
    return { acc, sum, w, h };
  }
  function draw(c, r) {
    const u = r() * c.sum;
    let lo = 0, hi = c.acc.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (c.acc[m] < u) lo = m + 1; else hi = m; }
    return [(lo % c.w) + r(), ((lo / c.w) | 0) + r()];
  }

  /* Colour halftone of an image into triplets [t0, t0 + count), done the way
     print does it. The achromatic part (black ink, K, on paper; white light on
     screen) is drawn with whole triplets and carries the picture. The remaining
     chroma is added with single-channel dots whose counts follow each channel's
     total, so colour balance survives. Unused vertices are hidden but parked on
     real points so they morph cleanly. */
  function halftone(out, px, w, h, theme, t0, count, r, { box = [-1, -1, 1, 1], floor = 0, z = 0.04, kShare = 0.64, gamma = 1.25, edges = 0, focus = null } = {}) {
    const light = theme === 'light';
    const rgb = (p, i) => [p[i] / 255, p[i + 1] / 255, p[i + 2] / 255, p[i + 3] / 255];
    // Sobel edges on luminance, so features (glasses, eyes, lapels) get their share of dots
    const edge = new Float32Array(w * h);
    if (edges) {
      const lum = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255 * (px[i * 4 + 3] / 255);
      let max = 1e-6;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const L = (dx, dy) => lum[(y + dy) * w + x + dx];
        const gx = L(1, -1) + 2 * L(1, 0) + L(1, 1) - L(-1, -1) - 2 * L(-1, 0) - L(-1, 1);
        const gy = L(-1, 1) + 2 * L(0, 1) + L(1, 1) - L(-1, -1) - 2 * L(0, -1) - L(1, -1);
        const m = Math.hypot(gx, gy);
        edge[y * w + x] = m;
        if (m > max) max = m;
      }
      for (let i = 0; i < edge.length; i++) edge[i] = Math.min(1, edge[i] / (max * 0.45));
    }
    const weight = (i) => {
      if (!focus) return 1;
      const x = (i % w) - focus[0], y = ((i / w) | 0) - focus[1];
      return 0.5 + focus[4] * Math.exp(-(x * x) / (2 * focus[2] ** 2) - (y * y) / (2 * focus[3] ** 2));
    };
    const mK = cdf(px, w, h, (p, i) => {
      const [R, G, B, a] = rgb(p, i);
      if (a < 0.03) return 0;
      const k = light ? 1 - Math.max(R, G, B) : Math.min(R, G, B);
      return (k ** gamma + floor + edges * edge[i / 4]) * a * weight(i / 4);
    });
    const chroma = [0, 1, 2].map((ch) => cdf(px, w, h, (p, i) => {
      const c = rgb(p, i), a = c[3];
      if (a < 0.03) return 0;
      if (light) {
        const K = 1 - Math.max(c[0], c[1], c[2]);
        return K < 0.999 ? ((1 - c[ch] - K) / (1 - K)) * (1 - K) * a : 0;
      }
      return (c[ch] - Math.min(c[0], c[1], c[2])) * a;
    }));
    const sx = (box[2] - box[0]) / w, sy = (box[3] - box[1]) / h;
    const place = (o, [x, y], w4) => { out[o] = box[0] + x * sx; out[o + 1] = box[1] + y * sy; out[o + 2] = (r() - 0.5) * z; out[o + 3] = w4; };

    const tK = mK.sum > 0 ? Math.round(count * kShare) : 0;
    for (let k = 0; k < tK; k++) {
      const pos = draw(mK, r), zz = (r() - 0.5) * z;
      for (let ch = 0; ch < 3; ch++) { const o = ((t0 + k) * 3 + ch) * 4; place(o, pos, 0); out[o + 2] = zz; }
    }
    const tC = count - tK;
    const max = Math.max(...chroma.map((m) => m.sum), 1e-6);
    const fallback = mK.sum > 0 ? mK : chroma.find((m) => m.sum > 0);
    for (let ch = 0; ch < 3; ch++) {
      const m = chroma[ch].sum > 0 ? chroma[ch] : fallback;
      const shown = Math.round(tC * Math.min(1, chroma[ch].sum / max) * 0.9);
      for (let k = 0; k < tC; k++) {
        place(((t0 + tK + k) * 3 + ch) * 4, m ? draw(m, r) : [w / 2, h / 2], k < shown ? 0 : HIDDEN);
      }
    }
  }

  /* Monochrome stipple of a drawing into whole triplets (black ink / white light). */
  function stipple(out, px, w, h, t0, count, r, { box = [-1, -1, 1, 1], z = 0.04, tag = () => 0, gamma = 1.1 } = {}) {
    const m = cdf(px, w, h, (p, i) => (1 - p[i] / 255) ** gamma);
    const sx = (box[2] - box[0]) / w, sy = (box[3] - box[1]) / h;
    for (let k = 0; k < count; k++) {
      const [x, y] = draw(m, r);
      const X = box[0] + x * sx, Y = box[1] + y * sy, Z = (r() - 0.5) * z, W = tag(x, y);
      for (let ch = 0; ch < 3; ch++) out.set([X, Y, Z, W], ((t0 + k) * 3 + ch) * 4);
    }
  }
  const setTriplet = (out, t, x, y, z, w) => { for (let ch = 0; ch < 3; ch++) out.set([x, y, z, w], (t * 3 + ch) * 4); };

  /* ------------------------------------------------ underwater (BSc thesis figure)
     The tank is filmed in clear, turbid and bubbling water in turn (engine.js anim 1).
     Dots of the coloured objects are tagged 10 + box, found the way the thesis found
     them: a saturation and hue threshold, so the shader can sway them and show the mask. */
  async function underwater(nT, theme) {
    const img = await image(SA.plates.underwater[theme]);
    const out = new Float32Array(nT * 12);
    const r = rng(23);
    const W = 294, Hp = 119, H = Hp / W;
    const px = pixels(img, W, Hp);
    const photo = Math.round(nT * 0.84);
    halftone(out, px, W, Hp, theme, 0, photo, r, { box: [-1, -H, 1, H], z: 0.05 });
    const boxes = SA.plates.underwater.boxes;
    const objectAt = (x, y) => {
      const fx = (x + 1) / 2, fy = (y + H) / (2 * H);
      const b = boxes.findIndex(([x0, y0, x1, y1]) => fx > x0 - 0.02 && fx < x1 + 0.02 && fy > y0 - 0.04 && fy < y1 + 0.04);
      if (b < 0) return -1;
      const o = (Math.min(Hp - 1, (fy * Hp) | 0) * W + Math.min(W - 1, (fx * W) | 0)) * 4;
      const R = px[o], G = px[o + 1], B = px[o + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      return mx > 50 && (mx - mn) / mx > 0.3 && (G === mx || B === mx) ? b : -1;
    };
    for (let v = 0; v < photo * 3; v++) {
      const o = v * 4;
      if (out[o + 3] < -1) continue;
      const b = objectAt(out[o], out[o + 1]);
      if (b >= 0) out[o + 3] = 10 + b;
    }
    // particles: half of them sediment that hangs in turbid water, half bubbles (tag 3)
    for (let t = photo; t < nT; t++) setTriplet(out, t, (r() - 0.5) * 2, (r() - 0.5) * 2 * H, (r() - 0.5) * 0.3, 3);
    return { data: out, ext: [1, H], boxes: boxes.map(([a, b, c, d]) => [-1 + a * 2, -H + b * 2 * H, -1 + c * 2, -H + d * 2 * H]) };
  }
  /* the same sway and conditions as the shader, for the tracking boxes (keep in step with anim 1) */
  const WATER_CYCLE = 15;
  function waterState(clock) {
    const cyc = clock % WATER_CYCLE;
    const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    return { turb: ss(4.4, 5.4, cyc) * (1 - ss(9.4, 10.4, cyc)), bub: ss(9.4, 10.4, cyc) * (1 - ss(14.2, 15, cyc)), local: cyc % 5 };
  }
  const waterSway = (b, t) => [Math.sin(t * 0.7 + b * 2.1) * 0.014, Math.cos(t * 0.9 + b * 1.3) * 0.01];

  /* ------------------------------------------------ video → sentence (Att-BiL-SL figure) */
  const CAPTION = ['a', 'person', 'is', 'playing', 'guitar'];
  async function caption(nT, theme, font) {
    const img = await image(SA.plates.frames);
    const out = new Float32Array(nT * 12);
    const r = rng(31);
    const W = 888, FH = 150;
    const frames = Math.round(nT * 0.74);
    const top = -0.36, fh = (FH / W) * 2;
    halftone(out, pixels(img, W, FH), W, FH, theme, 0, frames, r, { box: [-1, top, 1, top + fh], z: 0.04, edges: 0.9, gamma: 1.4 });

    // the generated sentence, one tag per word so it can be written out word by word
    const TW = 888, TH = 110, size = 70;
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `400 ${size}px ${font}`;
    const space = ctx.measureText(' ').width;
    const widths = CAPTION.map((w) => ctx.measureText(w).width);
    const total = widths.reduce((a, b) => a + b, 0) + space * (CAPTION.length - 1);
    const starts = [];
    let x0 = (TW - total) / 2;
    widths.forEach((w) => { starts.push(x0); x0 += w + space; });
    const px = pixels((g) => {
      g.fillStyle = '#000';
      g.font = `400 ${size}px ${font}`;
      g.textBaseline = 'middle';
      CAPTION.forEach((w, i) => g.fillText(w, starts[i], TH / 2));
    }, TW, TH);
    const ty = top + fh + 0.1;
    stipple(out, px, TW, TH, frames, nT - frames, r, {
      box: [-1, ty, 1, ty + (TH / TW) * 2], z: 0.02,
      tag: (x) => { let i = 0; while (i < starts.length - 1 && x > starts[i + 1] - space / 2) i++; return 1 + i; },
    });
    return { data: out, ext: [1, Math.max(-top, ty + (TH / TW) * 2)], words: CAPTION.length };
  }

  /* ------------------------------------------------ moths, for the thesis
     Seven real species from the DK-Moth class list, one per family, drawn
     as spread specimens. Wing outlines follow each family's shape:
     narrow hawk-moth wings, broad geometrid wings, a hooked tip, and so on. */
  const SPECIES = [
    { name: 'Deilephila elpenor', nat: { fw: [142, 122, 72], hw: [226, 132, 162], mark: [214, 104, 150], light: [236, 202, 212], line: [74, 62, 42], body: [142, 122, 72] }, family: 'Sphingidae', apex: [1.2, -0.36], tornus: [0.64, 0.04], lead: [0.56, -0.4], marg: [1.0, -0.12], trail: [0.34, 0.07], hw: [0.5, 0.3], hwBase: 0.55, body: [0.64, 0.08], base: 0.4, pattern: 'bands' },
    { name: 'Biston betularia', nat: { fw: [234, 232, 224], hw: [236, 234, 228], mark: [34, 34, 34], light: [250, 250, 248], line: [70, 70, 70], body: [205, 202, 194] }, family: 'Geometridae', apex: [0.98, -0.52], tornus: [0.82, 0.14], lead: [0.42, -0.58], marg: [1.02, -0.16], trail: [0.42, 0.12], hw: [0.84, 0.62], hwBase: 0.2, body: [0.5, 0.05], base: 0.16, pattern: 'pepper' },
    { name: 'Autographa gamma', nat: { fw: [130, 114, 98], hw: [164, 148, 128], mark: [80, 66, 54], light: [236, 233, 226], line: [62, 52, 42], body: [112, 97, 82] }, family: 'Noctuidae', apex: [1.02, -0.42], tornus: [0.72, 0.1], lead: [0.45, -0.48], marg: [0.98, -0.14], trail: [0.38, 0.1], hw: [0.68, 0.5], hwBase: 0.3, body: [0.56, 0.065], base: 0.5, pattern: 'gamma' },
    { name: 'Arctia caja', nat: { fw: [98, 62, 40], hw: [232, 110, 54], mark: [36, 42, 72], light: [240, 232, 212], line: [48, 36, 30], body: [112, 62, 42] }, family: 'Erebidae', apex: [1.0, -0.46], tornus: [0.78, 0.14], lead: [0.44, -0.52], marg: [1.02, -0.14], trail: [0.4, 0.12], hw: [0.82, 0.62], hwBase: 0.28, body: [0.56, 0.075], base: 0.82, pattern: 'tiger' },
    { name: 'Drepana falcataria', nat: { fw: [222, 190, 140], hw: [236, 216, 178], mark: [122, 82, 52], light: [246, 236, 212], line: [112, 82, 56], body: [192, 162, 118] }, family: 'Drepanidae', apex: [1.06, -0.52], tornus: [0.74, 0.1], lead: [0.5, -0.5], marg: [0.72, -0.26], trail: [0.4, 0.1], hw: [0.74, 0.56], hwBase: 0.18, body: [0.44, 0.045], base: 0.2, pattern: 'hook' },
    { name: 'Phalera bucephala', nat: { fw: [152, 152, 146], hw: [216, 206, 182], mark: [72, 72, 70], light: [232, 206, 142], line: [62, 62, 60], body: [172, 152, 112] }, family: 'Notodontidae', apex: [1.14, -0.28], tornus: [1.0, 0.03], lead: [0.5, -0.34], marg: [1.16, -0.1], trail: [0.52, 0.08], hw: [0.62, 0.42], hwBase: 0.3, body: [0.62, 0.075], base: 0.5, pattern: 'buff' },
    { name: 'Tortrix viridana', nat: { fw: [152, 190, 112], hw: [192, 192, 182], mark: [108, 140, 80], light: [216, 226, 176], line: [92, 112, 72], body: [142, 160, 112] }, family: 'Tortricidae', apex: [0.82, -0.44], tornus: [0.8, 0.12], lead: [0.4, -0.5], marg: [0.88, -0.16], trail: [0.38, 0.12], hw: [0.56, 0.44], hwBase: 0.22, body: [0.42, 0.05], base: 0.32, pattern: 'plain' },
  ];

  const MOTH_W = 600, MOTH_H = 400;
  function drawMoth(sp, seed, nat = false) {
    const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
    const N = sp.nat;
    const dark = (al) => (nat ? rgb(N.mark) : `rgba(0,0,0,${al})`);
    const pale = (al) => (nat ? rgb(N.light) : `rgba(255,255,255,${al})`);
    const line = (al) => (nat ? rgb(N.line) : `rgba(0,0,0,${al})`);
    return (g, w, h) => {
      const u = w * 0.39, cx = w / 2, cy = h * 0.47;
      const P = (x, y) => [cx + x * u, cy + y * u];
      const r = rng(seed);
      g.lineCap = 'round'; g.lineJoin = 'round';
      for (const side of [1, -1]) {
        g.save();
        g.translate(cx, 0); g.scale(side, 1); g.translate(-cx, 0);

        const [hx, hy] = sp.hw;
        const hw = new Path2D();
        hw.moveTo(...P(0.05, -0.02));
        hw.quadraticCurveTo(...P(hx * 1.02, -0.06), ...P(hx * 0.92, hy * 0.5));
        hw.quadraticCurveTo(...P(hx * 0.72, hy * 1.08), ...P(0.07, hy * 0.78));
        hw.closePath();
        g.save(); g.clip(hw);
        g.fillStyle = nat ? rgb(N.hw) : `rgba(0,0,0,${sp.hwBase})`; g.fillRect(0, 0, w, h);
        if (sp.pattern === 'tiger') {
          g.fillStyle = dark(0.92);
          [[0.35, 0.2], [0.58, 0.32], [0.3, 0.44]].forEach(([x, y]) => { g.beginPath(); g.arc(...P(x * hx / 0.82, y), 0.075 * u, 0, TAU); g.fill(); });
        }
        if (sp.pattern === 'bands') { g.fillStyle = line(0.75); g.beginPath(); g.ellipse(...P(0.22, 0.12), 0.18 * u, 0.1 * u, 0.3, 0, TAU); g.fill(); }
        g.restore();
        g.lineWidth = 1.6; g.strokeStyle = line(0.85); g.stroke(hw);

        const fw = new Path2D();
        fw.moveTo(...P(0.05, -0.13));
        fw.quadraticCurveTo(...P(...sp.lead), ...P(...sp.apex));
        fw.quadraticCurveTo(...P(...sp.marg), ...P(...sp.tornus));
        fw.quadraticCurveTo(...P(...sp.trail), ...P(0.05, 0.03));
        fw.closePath();
        g.save(); g.clip(fw);
        g.fillStyle = nat ? rgb(N.fw) : `rgba(0,0,0,${sp.base})`; g.fillRect(0, 0, w, h);
        const [ax, ay] = sp.apex;
        switch (sp.pattern) {
          case 'bands':
            g.strokeStyle = dark(0.85); g.lineWidth = 0.07 * u;
            g.beginPath(); g.moveTo(...P(0.12, 0.02)); g.lineTo(...P(ax * 0.98, ay * 0.92)); g.stroke();
            g.lineWidth = 0.035 * u;
            g.beginPath(); g.moveTo(...P(0.3, 0.06)); g.lineTo(...P(ax * 0.92, ay * 0.55)); g.stroke();
            break;
          case 'pepper':
            g.fillStyle = dark(0.9);
            for (let i = 0; i < 260; i++) {
              const x = 0.08 + r() * 0.95, y = -0.55 + r() * 0.7;
              g.beginPath(); g.arc(...P(x, y), (0.006 + r() * 0.014) * u, 0, TAU); g.fill();
            }
            g.strokeStyle = dark(0.8); g.lineWidth = 0.014 * u;
            [[0.32, 0.5], [0.66, 0.84]].forEach(([a, b]) => {
              g.beginPath(); g.moveTo(...P(a, -0.5));
              for (let k = 1; k <= 6; k++) g.lineTo(...P(a + (b - a) * (k / 6) + (k % 2 ? 0.03 : -0.03), -0.5 + k * 0.1));
              g.stroke();
            });
            break;
          case 'gamma':
            g.fillStyle = dark(0.78);
            g.beginPath(); g.ellipse(...P(0.5, -0.18), 0.26 * u, 0.16 * u, -0.35, 0, TAU); g.fill();
            g.strokeStyle = pale(0.97); g.lineWidth = 0.035 * u;
            g.beginPath(); g.moveTo(...P(0.38, -0.3)); g.lineTo(...P(0.47, -0.17)); g.lineTo(...P(0.58, -0.29));
            g.moveTo(...P(0.47, -0.17)); g.lineTo(...P(0.44, -0.04)); g.stroke();
            break;
          case 'tiger':
            g.strokeStyle = pale(0.97); g.lineWidth = 0.055 * u;
            g.beginPath(); g.moveTo(...P(0.1, -0.16)); g.lineTo(...P(0.3, -0.38)); g.lineTo(...P(0.46, -0.16)); g.lineTo(...P(0.66, -0.4)); g.lineTo(...P(0.82, -0.18)); g.lineTo(...P(0.98, -0.42)); g.stroke();
            g.beginPath(); g.moveTo(...P(0.18, 0.02)); g.lineTo(...P(0.4, -0.06)); g.lineTo(...P(0.58, 0.04)); g.lineTo(...P(0.78, -0.04)); g.stroke();
            break;
          case 'hook':
            g.strokeStyle = dark(0.85); g.lineWidth = 0.016 * u;
            g.beginPath(); g.moveTo(...P(ax * 0.96, ay * 0.94)); g.quadraticCurveTo(...P(0.62, -0.2), ...P(0.5, 0.07)); g.stroke();
            g.beginPath(); g.moveTo(...P(0.3, -0.42)); g.quadraticCurveTo(...P(0.34, -0.2), ...P(0.26, 0.05)); g.stroke();
            g.fillStyle = dark(0.9); g.beginPath(); g.arc(...P(0.48, -0.26), 0.022 * u, 0, TAU); g.fill();
            break;
          case 'buff':
            g.fillStyle = pale(0.97);
            g.beginPath(); g.ellipse(...P(ax - 0.13, ay + 0.15), 0.14 * u, 0.12 * u, 0, 0, TAU); g.fill();
            g.strokeStyle = dark(0.7); g.lineWidth = 0.014 * u;
            g.beginPath(); g.moveTo(...P(0.4, -0.32)); g.lineTo(...P(0.42, 0.05)); g.stroke();
            g.beginPath(); g.moveTo(...P(0.7, -0.3)); g.lineTo(...P(0.72, 0.04)); g.stroke();
            break;
          default:
            g.strokeStyle = pale(0.9); g.lineWidth = 0.03 * u;
            g.beginPath(); g.moveTo(...P(0.1, -0.16)); g.quadraticCurveTo(...P(...sp.lead), ...P(ax * 0.95, ay * 0.95)); g.stroke();
            g.strokeStyle = dark(0.55); g.lineWidth = 0.014 * u;
            g.beginPath(); g.moveTo(...P(0.42, -0.42)); g.lineTo(...P(0.5, 0.08)); g.stroke();
        }
        g.restore();
        g.lineWidth = 1.8; g.strokeStyle = line(0.9); g.stroke(fw);

        // antenna
        g.lineWidth = sp.pattern === 'bands' ? 3 : 1.8;
        g.beginPath(); g.moveTo(...P(0.02, -0.22)); g.quadraticCurveTo(...P(0.08, -0.42), ...P(0.24, -0.56)); g.stroke();
        g.restore();
      }
      // body
      const [len, bw] = sp.body;
      g.fillStyle = nat ? rgb(N.body) : dark(0.95);
      g.beginPath(); g.ellipse(...P(0, -0.19), bw * 0.8 * u, bw * 0.8 * u, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(...P(0, -0.07), bw * u, 0.11 * u, 0, 0, TAU); g.fill();
      g.beginPath(); g.ellipse(...P(0, 0.04 + len * 0.42), bw * 0.85 * u, len * 0.42 * u, 0, 0, TAU); g.fill();
    };
  }

  /* natural colours travel inside the w channel: 100 + 15-bit RGB */
  const pack = (r, g, b) => 100 + ((r >> 3) << 10) + ((g >> 3) << 5) + (b >> 3);
  const INK = 50;

  /* point banks for the seven species, built once: positions plus each point's natural colour */
  let bank = null;
  function mothBank() {
    if (bank) return bank;
    const n = 4000, ar = MOTH_H / MOTH_W;
    bank = SPECIES.map((sp, k) => {
      const mono = pixels(drawMoth(sp, 300 + k), MOTH_W, MOTH_H);
      const nat = pixels(drawMoth(sp, 300 + k, true), MOTH_W, MOTH_H);
      const m = cdf(mono, MOTH_W, MOTH_H, (q, i) => (1 - q[i] / 255) ** 1.05);
      const r = rng(100 + k);
      const pos = new Float32Array(n * 2), col = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const [x, y] = draw(m, r);
        const o = ((y | 0) * MOTH_W + (x | 0)) * 4;
        pos[i * 2] = (x / MOTH_W) * 2 - 1;
        pos[i * 2 + 1] = ((y / MOTH_H) * 2 - 1) * ar;
        col[i] = pack(nat[o], nat[o + 1], nat[o + 2]);
      }
      return { pos, col, n };
    });
    return bank;
  }

  /* one species in natural colours on a transparent canvas (vector, so it stays crisp) */
  const mothCache = {};
  function mothCanvas(k) {
    if (mothCache[k]) return mothCache[k];
    const c = document.createElement('canvas');
    c.width = MOTH_W; c.height = MOTH_H;
    drawMoth(SPECIES[k], 300 + k, true)(c.getContext('2d'), MOTH_W, MOTH_H);
    return (mothCache[k] = c);
  }

  /* a small specimen plate in natural colours, for the dataset entry */
  function drawSpecimens(canvas) {
    const B = mothBank();
    const W = canvas.width, H = canvas.height, g = canvas.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const slots = [[0.14, 0.3], [0.38, 0.3], [0.62, 0.3], [0.86, 0.3], [0.26, 0.72], [0.5, 0.72], [0.74, 0.72]];
    const s = W * 0.1, d = Math.max(1, W / 420);
    B.forEach((b, k) => {
      for (let i = 0; i < b.n; i++) {
        const c = b.col[i] - 100;
        g.fillStyle = `rgb(${((c >> 10) & 31) << 3},${((c >> 5) & 31) << 3},${(c & 31) << 3})`;
        g.fillRect(slots[k][0] * W + b.pos[i * 2] * s, slots[k][1] * H + b.pos[i * 2 + 1] * s, d, d);
      }
    });
  }

  /* Research opening: one plate per thesis, set in a diagonal from 2020 to 2026.
     Each plate sits at its own depth (z −0.4, 0, 0.4), which the shader also uses
     to tell the plates apart and animate them. Keep TRI in step with engine.js. */
  const TRI = [
    { c: [-0.56, -0.56], z: -0.4 },    // 2020 · underwater
    { c: [0, 0], z: 0 },               // 2021 · video
    { c: [0.56, 0.56], z: 0.4 },       // 2026 · moths
  ];
  async function triptych(nT, theme) {
    const out = new Float32Array(nT * 12);
    const r = rng(131);
    const light = theme === 'light';
    const crop = (img, sx, sy, sw, sh, w, h) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = light ? '#fff' : '#000';
      g.fillRect(0, 0, w, h);
      g.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      return g.getImageData(0, 0, w, h).data;
    };
    const water = await image(SA.plates.underwater[theme]);
    const frames = await image(SA.plates.frames);
    const H = 0.25;                                            // half height of every plate
    const boxes = [
      { w: H * (132 / 119), img: crop(water, 4, 0, 132, 119, 264, 238), pw: 264, ph: 238 },
      { w: H * (210 / 150), img: crop(frames, 0, 0, 210, 150, 280, 200), pw: 280, ph: 200 },
      { w: H * 1.2 },
    ].map((b, i) => ({ ...b, ...TRI[i], box: [TRI[i].c[0] - b.w, TRI[i].c[1] - H, TRI[i].c[0] + b.w, TRI[i].c[1] + H] }));

    const share = [0.31, 0.31, 0.26];
    let t = 0;
    const counts = share.map((s) => Math.round(nT * s));
    const shiftZ = (t0, n, dz) => { for (let k = t0 * 3; k < (t0 + n) * 3; k++) out[k * 4 + 2] += dz; };
    // the two photographs, as halftones
    for (let i = 0; i < 2; i++) {
      const b = boxes[i];
      halftone(out, b.img, b.pw, b.ph, theme, t, counts[i], r, { box: b.box, z: 0.02, edges: 0.8, gamma: 1.3 });
      shiftZ(t, counts[i], b.z);
      t += counts[i];
    }
    // the moth, in its natural colours, on a pale camera-trap background
    const B = mothBank()[3], b = boxes[2], GREY = pack(196, 194, 188);
    for (let k = 0; k < counts[2]; k++, t++) {
      if (r() < 0.86) {
        const j = (r() * B.n) | 0;
        setTriplet(out, t, b.c[0] + B.pos[j * 2] * b.w * 0.82, b.c[1] + B.pos[j * 2 + 1] * b.w * 0.82, b.z + (r() - 0.5) * 0.02, B.col[j]);
      } else setTriplet(out, t, b.box[0] + r() * (b.box[2] - b.box[0]), b.box[1] + r() * (b.box[3] - b.box[1]), b.z, GREY);
    }
    // frames around all three
    const per = Math.floor((nT - t) / 3);
    boxes.forEach((bx, i) => {
      const n = i === 2 ? nT - t : per;
      const [x0, y0, x1, y1] = bx.box, W = x1 - x0, Hh = y1 - y0;
      for (let k = 0; k < n; k++, t++) {
        const u = r() * 2 * (W + Hh);
        const [x, y] = u < W ? [x0 + u, y0] : u < W + Hh ? [x1, y0 + u - W] : u < 2 * W + Hh ? [x1 - (u - W - Hh), y1] : [x0, y1 - (u - 2 * W - Hh)];
        setTriplet(out, t, x + (r() - 0.5) * 0.004, y + (r() - 0.5) * 0.004, bx.z, INK);
      }
    });
    return { data: out, ext: [0.9, 0.86], plates: boxes.map((bx) => ({ x: bx.c[0], y: bx.box[3], z: bx.z })) };
  }

  /* ------------------------------------------------ the light trap, for the thesis
     Moths circle a lamp at night and are photographed one after another: each drops
     into the next tile of a contact sheet, which fills far faster than anyone could
     name what is in it. Every point keeps its final place on the sheet in x, y (so the
     next scenes can follow it); z holds its tile and role: k + 0.25 moth, k + 0.5 tile
     frame, k + 0.75 background, −1 the lamp. engine.js (anim 13) flies, lands and lifts
     the moths; keep GRID in step with it. */
  const GRID = { cols: 6, rows: 4, tile: 0.44, gap: 0.1, cy: 0.58, lamp: [0, -1.0] };
  function trapGrid(nT) {
    const { cols, rows, tile: T, gap: G } = GRID;
    const out = new Float32Array(nT * 12), screen = new Float32Array(nT * 2);
    const r = rng(41);
    const K = SPECIES.length, tiles = cols * rows;
    const species = Array.from({ length: tiles }, (_, t) => t % K);
    for (let i = tiles - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [species[i], species[j]] = [species[j], species[i]]; }
    const B = mothBank();
    const Wd = cols * T + (cols - 1) * G, Hd = rows * T + (rows - 1) * G;
    const cid = new Uint8Array(nT), colorW = new Float32Array(nT);
    const GREY = pack(186, 184, 178);
    const lampT = Math.round(nT * 0.05);
    let t = 0;
    for (; t < lampT; t++) {
      const core = r() < 0.55, sd = core ? 0.03 : 0.09;
      const x = gauss(r) * sd, y = gauss(r) * sd * 0.92, w = core ? pack(120, 150, 255) : pack(178, 186, 255);
      setTriplet(out, t, x, y, -1, w);
      screen[t * 2] = GRID.lamp[0] + x; screen[t * 2 + 1] = GRID.lamp[1] + y;
      cid[t] = (r() * K) | 0; colorW[t] = w;
    }
    for (let i = 0; t < nT; t++, i++) {
      const tile = i % tiles, col = tile % cols, row = (tile / cols) | 0;
      const x0 = -Wd / 2 + col * (T + G) + T / 2, y0 = GRID.cy - Hd / 2 + row * (T + G) + T / 2;
      const sp = species[tile];
      cid[t] = sp;
      let x, y, w, role;
      const roll = r();
      if (roll < 0.16) {
        const e = r() * 4, q = (r() - 0.5) * T, half = T / 2;
        [x, y] = e < 1 ? [q, -half] : e < 2 ? [half, q] : e < 3 ? [q, half] : [-half, q];
        w = INK; role = 0.5;
      } else if (roll < 0.9) {
        const src = B[sp], j = (r() * src.n) | 0;
        x = src.pos[j * 2] * T * 0.45; y = src.pos[j * 2 + 1] * T * 0.45; w = src.col[j]; role = 0.25;
      } else { x = (r() - 0.5) * T * 0.9; y = (r() - 0.5) * T * 0.9; w = GREY; role = 0.75; }
      colorW[t] = w;
      setTriplet(out, t, x0 + x, y0 + y, tile + role, w);
      screen[t * 2] = x0 + x; screen[t * 2 + 1] = y0 + y;
    }
    return { data: out, ext: [Wd / 2 + 0.06, 1.7], cid, K, colorW, screen };
  }

  /* annotation: every cluster becomes its species, laid out like a specimen drawer */
  function annotation(nT, cid, { narrow = false } = {}) {
    const out = new Float32Array(nT * 12);
    const r = rng(97);
    const B = mothBank();
    const slots = narrow
      ? [[-0.46, -1.24], [0.46, -1.24], [-0.46, -0.42], [0.46, -0.42], [-0.46, 0.4], [0.46, 0.4], [0, 1.22]]
      : [[-1.05, -0.46], [-0.35, -0.46], [0.35, -0.46], [1.05, -0.46], [-0.7, 0.42], [0, 0.42], [0.7, 0.42]];
    const scale = narrow ? 0.4 : 0.3;
    for (let t = 0; t < nT; t++) {
      const sp = cid[t], src = B[sp], j = (r() * src.n) | 0;
      const [sx, sy] = slots[sp];
      setTriplet(out, t, sx + src.pos[j * 2] * scale, sy + src.pos[j * 2 + 1] * scale, (r() - 0.5) * 0.03, sp);
    }
    const ext = narrow ? [0.9, 1.66] : [1.4, 0.86];
    return { data: out, ext, slots, scale };
  }

  /* embeddings: a loose cloud in the images' own colours, then tight clusters in cluster colours */
  function embedding(nT, cid, K, tight, colorW) {
    const out = new Float32Array(nT * 12);
    const r = rng(53);
    const cr = rng(59);
    // laid out like a 2-D projection of feature space, with a little depth
    const centers = Array.from({ length: K }, (_, k) => {
      const a = (k / K) * TAU + 0.35 + (cr() - 0.5) * 0.3, rad = 0.9 + (cr() - 0.5) * 0.25;
      return [Math.cos(a) * rad * 1.3, Math.sin(a) * rad * 0.62, (cr() - 0.5) * 0.5];
    });
    const spread = Array.from({ length: K }, () => 0.07 + cr() * 0.05);
    for (let t = 0; t < nT; t++) {
      const c = centers[cid[t]];
      const pull = tight ? 1 : 0.32, s = tight ? spread[cid[t]] : 0.46;
      setTriplet(out, t, c[0] * pull + gauss(r) * s, c[1] * pull + gauss(r) * s * 0.9, c[2] * pull + gauss(r) * s, tight || !colorW ? cid[t] : colorW[t]);
    }
    return { data: out, ext: tight ? [1.42, 0.78] : [1.1, 0.9], centers };
  }

  function dust(nT, seed = 61) {
    const out = new Float32Array(nT * 12);
    const r = rng(seed);
    for (let t = 0; t < nT; t++) setTriplet(out, t, r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r() < 0.94 ? HIDDEN : 0);
    return { data: out, ext: [1, 1] };
  }

  /* ------------------------------------------------ co-author network */
  function layout(g) {
    const r = rng(71);
    const idx = new Map(g.nodes.map((n, i) => [n.key, i]));
    const P = g.nodes.map((n, i) => {
      if (n.kind === 'me') return { x: 0, y: 0, vx: 0, vy: 0, fixed: true };
      const a = (i / g.nodes.length) * TAU;
      const rad = n.kind === 'paper' ? 0.5 : 1;
      return { x: Math.cos(a) * rad + (r() - 0.5) * 0.1, y: Math.sin(a) * rad * 0.7 + (r() - 0.5) * 0.1, vx: 0, vy: 0 };
    });
    const L = g.links.map((l) => [idx.get(l.a), idx.get(l.b)]);
    for (let it = 0; it < 600; it++) {
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const dx = P[i].x - P[j].x, dy = P[i].y - P[j].y, d2 = dx * dx + dy * dy + 1e-4, f = 0.0025 / d2;
        P[i].vx += dx * f; P[i].vy += dy * f; P[j].vx -= dx * f; P[j].vy -= dy * f;
      }
      for (const [a, b] of L) {
        const rest = g.nodes[a].kind === 'me' || g.nodes[b].kind === 'me' ? 0.62 : 0.34;
        const dx = P[b].x - P[a].x, dy = P[b].y - P[a].y, d = Math.hypot(dx, dy) + 1e-4, f = (d - rest) * 0.05;
        P[a].vx += (dx / d) * f; P[a].vy += (dy / d) * f; P[b].vx -= (dx / d) * f; P[b].vy -= (dy / d) * f;
      }
      for (const p of P) {
        p.vy -= p.y * 0.004;               // flatten into a wide band
        p.vx *= 0.82; p.vy *= 0.82;
        if (!p.fixed) { p.x += p.vx; p.y += p.vy; }
      }
    }
    return { P, L };
  }

  function network(nT, g, { vertical = false } = {}) {
    const { P, L } = layout(g);
    if (vertical) P.forEach((p) => { [p.x, p.y] = [p.y * 1.15, p.x * 0.95]; });
    const out = new Float32Array(nT * 12);
    const r = rng(83);
    const owner = new Int32Array(nT);          // node index (≥0) or −(link index + 1)
    const R = g.nodes.map((n) => (n.kind === 'me' ? 0.085 : n.kind === 'paper' ? 0.05 : 0.022 + 0.006 * n.papers.length));
    const nodeShare = 0.36;
    const area = R.map((x) => x * x), areaSum = area.reduce((a, b) => a + b, 0);
    let t = 0;
    g.nodes.forEach((_n, i) => {
      const count = Math.round(nT * nodeShare * (area[i] / areaSum));
      for (let k = 0; k < count && t < nT; k++, t++) {
        const a = r() * TAU, d = Math.sqrt(r()) * R[i];
        setTriplet(out, t, P[i].x + Math.cos(a) * d, P[i].y + Math.sin(a) * d, (r() - 0.5) * 0.05, 0);
        owner[t] = i;
      }
    });
    const lens = L.map(([a, b]) => Math.hypot(P[a].x - P[b].x, P[a].y - P[b].y));
    const lenSum = lens.reduce((a, b) => a + b, 0);
    const linkT0 = t;
    L.forEach(([a, b], li) => {
      const count = li === L.length - 1 ? nT - t : Math.round((nT - linkT0) * (lens[li] / lenSum));
      for (let k = 0; k < count && t < nT; k++, t++) {
        const s = r(), j = (r() - 0.5) * 0.003;
        setTriplet(out, t, P[a].x + (P[b].x - P[a].x) * s + j, P[a].y + (P[b].y - P[a].y) * s + j, (r() - 0.5) * 0.02, 0);
        owner[t] = -(li + 1);
      }
    });
    let ex = 0, ey = 0;
    P.forEach((p, i) => { ex = Math.max(ex, Math.abs(p.x) + R[i]); ey = Math.max(ey, Math.abs(p.y) + R[i]); });
    return { data: out, ext: [ex + 0.05, ey + 0.08], nodes: P.map((p, i) => ({ x: p.x, y: p.y, r: R[i] })), owner, links: L };
  }

  /* ------------------------------------------------ the hero: a lens around the portrait
     A camera's iris, drawn in points like a technical drawing: the opening the portrait
     stands in, the curved edges of nine blades, their fine shading, the focus rings and the
     scale on the barrel. The opening breathes and the focus ring turns (engine.js anim 8).
     Each point stores x: where along its line, y: a second coordinate, z: the part
     (0 opening, 1 blade edge, 2 blade shading, 3 ring, 4 tick), w: 0 or hidden. */
  function aperture(nT, { density = 1 } = {}) {
    const out = new Float32Array(nT * 12), r = rng(171), k = (nT < 15000 ? 0.45 : 1) * density;
    let t = 0;
    const add = (n, f) => { for (let i = 0; i < Math.round(n * k) && t < nT; i++, t++) { const [a, b, part] = f(i, Math.round(n * k)); setTriplet(out, t, a, b, part, 0); } };
    add(1100, (i, n) => [i / n, r(), 0]);
    add(2700, (i, n) => [(i % 9) / 9, r(), 1]);
    add(5200, () => [r(), Math.sqrt(r()), 2]);
    add(2400, (i, n) => [i / n, i % 2, 3]);
    add(1100, (i) => [((i % 72) + 0.5) / 72, r(), 4]);
    for (; t < nT; t++) setTriplet(out, t, 0, 0, 0, HIDDEN);
    return { data: out, ext: [1.08, 1.08] };
  }

  /* ------------------------------------------------ citations as dots: one bead per citation over each paper's year */
  function citePlot(nT, works) {
    const out = new Float32Array(nT * 12);
    const r = rng(151);
    const items = works.filter((w) => w.year).map((w) => ({ year: w.year, cites: w.cites || 0 }));
    if (!items.length) return null;
    const y0 = Math.min(...items.map((w) => w.year)), y1 = Math.max(...items.map((w) => w.year));
    const X = (y) => (y1 === y0 ? 0 : -1 + (2 * (y - y0)) / (y1 - y0));
    const maxC = Math.max(1, ...items.map((w) => w.cites));
    const spacing = Math.min(0.09, 0.95 / maxC), rad = spacing * 0.36, base = 0.45;
    const perYear = {};
    items.forEach((w) => { (perYear[w.year] ||= []).push(w); });
    const beads = [], labels = [];
    Object.entries(perYear).forEach(([year, list]) => {
      list.forEach((w, k) => {
        const x = X(+year) + (k - (list.length - 1) / 2) * Math.max(spacing * 1.15, 0.12);   // room for both counts
        if (!w.cites) beads.push({ x, y: base - spacing * 0.8, r: rad * 0.75, w: 1 });
        for (let c = 0; c < w.cites; c++) beads.push({ x, y: base - spacing * (c + 0.8), r: rad, w: 2 });
        if (w.cites) labels.push({ x, y: base - spacing * (w.cites + 0.8) - rad - 0.035, text: String(w.cites), kind: 'count' });
      });
    });
    for (let y = y0; y <= y1; y++) labels.push({ x: X(y), y: base + 0.1, text: String(y), kind: 'year' });
    const axisT = Math.round(nT * 0.12), tickT = Math.round(nT * 0.03);
    let t = 0;
    for (; t < axisT; t++) setTriplet(out, t, -1.1 + r() * 2.2, base + (r() - 0.5) * 0.005, 0, 0);
    const years = y1 - y0 + 1;
    for (let k = 0; k < tickT; k++, t++) setTriplet(out, t, X(y0 + (k % years)) + (r() - 0.5) * 0.004, base + r() * 0.035, 0, 0);
    const per = (nT - t) / beads.length;
    beads.forEach((b, i) => {
      const end = i === beads.length - 1 ? nT : Math.round(axisT + tickT + per * (i + 1));
      for (; t < end; t++) {
        const a = r() * TAU, d = Math.sqrt(r()) * b.r;
        setTriplet(out, t, b.x + Math.cos(a) * d, b.y + Math.sin(a) * d, (r() - 0.5) * 0.02, b.w);
      }
    });
    const top = Math.min(...beads.map((b) => b.y - b.r)) - 0.08;
    return { data: out, ext: [1.14, Math.max(Math.abs(top), base + 0.16)], labels };
  }

  /* ------------------------------------------------ dotted map, Dhaka to Aarhus */
  function worldMap(nT, geo) {
    const out = new Float32Array(nT * 12);
    const r = rng(181);
    const land = [];
    geo.rowsHex.forEach((hex, j) => {
      const bits = BigInt('0x' + hex);
      for (let i = 0; i < geo.cols; i++) if ((bits >> BigInt(i)) & 1n) land.push([i + (j % 2) * 0.5, j * geo.hex]);
    });
    const W = geo.cols, H = geo.rows * geo.hex, s = 2 / W;
    const P = ([x, y]) => [(x - W / 2) * s, (y - H / 2) * s];
    const dhaka = P([geo.cities.Dhaka[0], geo.cities.Dhaka[1] * geo.hex]);
    const aarhus = P([geo.cities.Aarhus[0], geo.cities.Aarhus[1] * geo.hex]);
    // the route bows north, like a flight path
    const mid = [(dhaka[0] + aarhus[0]) / 2, (dhaka[1] + aarhus[1]) / 2];
    const dx = aarhus[0] - dhaka[0], dy = aarhus[1] - dhaka[1], len = Math.hypot(dx, dy);
    let nx = -dy / len, ny = dx / len;
    if (ny > 0) { nx = -nx; ny = -ny; }
    const ctrl = [mid[0] + nx * len * 0.32, mid[1] + ny * len * 0.32];
    const arcT = Math.round(nT * 0.08), cityT = Math.round(nT * 0.035);
    let t = 0;
    for (; t < arcT; t++) {
      const q = t / arcT, u = 1 - q;
      const x = u * u * dhaka[0] + 2 * u * q * ctrl[0] + q * q * aarhus[0];
      const y = u * u * dhaka[1] + 2 * u * q * ctrl[1] + q * q * aarhus[1];
      setTriplet(out, t, x + (r() - 0.5) * s * 0.12, y + (r() - 0.5) * s * 0.12, 0.02, 1 + q * 0.99);
    }
    [dhaka, aarhus].forEach((c, k) => {
      const end = k ? arcT + cityT : arcT + Math.round(cityT / 2);
      for (; t < end; t++) {
        const ring = r() < 0.55, a = r() * TAU, d = ring ? s * (1.3 + (r() - 0.5) * 0.15) : Math.sqrt(r()) * s * 0.45;
        setTriplet(out, t, c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, 0.03, 3);
      }
    });
    const dotR = s * 0.27;
    for (let k = 0; t < nT; t++, k++) {
      const [lx, ly] = P(land[k % land.length]);
      const a = r() * TAU, d = Math.sqrt(r()) * dotR;
      setTriplet(out, t, lx + Math.cos(a) * d, ly + Math.sin(a) * d, 0, 0);
    }
    return { data: out, ext: [1.02, (H / 2) * s + 0.04], cities: [{ name: 'Dhaka', x: dhaka[0], y: dhaka[1] }, { name: 'Aarhus', x: aarhus[0], y: aarhus[1] }] };
  }

  /* ------------------------------------------------ the end: from seeing to understanding
     A large mechanical eye, seen at an angle so we can look into it. Nine subjects (animals,
     plants, made objects) float in front of it; its scan sweeps over them and their points are
     drawn in through the iris. Inside, they travel back through the eye and change on the way
     (a pixel grid of the subject, then its outline, then the rings of a network), leave at the
     back and form the answer on a display beside it. The display moves through four tasks in
     turn: grouping similar subjects, detecting objects with boxes, segmenting their regions, and
     estimating depth as a turning point cloud. An illustration, not a model's output.
     A point's three vertices carry its data: vertex 0 (role, a, b, c), vertex 1 (d, e, f, g).
     Subjects come first, each as NF fill points then NE edge points with their positions in
     its own frame; the layers and the grouped copies borrow those positions. engine.js anim 14
     plays it; keep VISION in step with the shader. */
  const VISION = { subjects: ['bird', 'gear', 'leaf', 'flower', 'fish', 'wrench', 'bulb', 'fern', 'moth'], group: [0, 2, 1, 1, 0, 2, 2, 1, 0] };
  function subjectDrawer(name) {
    return (g) => {
      g.fillStyle = '#000'; g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineJoin = 'round';
      const E = (x, y, rx, ry, a = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, a, 0, TAU); g.fill(); };
      const white = () => { g.fillStyle = '#fff'; g.strokeStyle = '#fff'; };
      switch (name) {
        case 'bird':
          E(108, 122, 58, 32, -0.18); E(166, 86, 23, 21);
          g.beginPath(); g.moveTo(186, 80); g.lineTo(210, 89); g.lineTo(186, 96); g.fill();
          g.beginPath(); g.moveTo(58, 128); g.lineTo(14, 104); g.lineTo(22, 150); g.fill();
          g.lineWidth = 4; g.beginPath(); g.moveTo(100, 150); g.lineTo(94, 186); g.moveTo(118, 150); g.lineTo(122, 186); g.stroke();
          white(); g.lineWidth = 4; g.beginPath(); g.moveTo(70, 112); g.quadraticCurveTo(110, 90, 145, 120); g.stroke(); E(172, 82, 4, 4);
          break;
        case 'fish':
          E(118, 110, 72, 40);
          g.beginPath(); g.moveTo(52, 110); g.lineTo(10, 74); g.lineTo(16, 110); g.lineTo(10, 146); g.fill();
          g.beginPath(); g.moveTo(100, 72); g.quadraticCurveTo(122, 40, 146, 76); g.fill();
          white(); E(160, 100, 7, 7); g.lineWidth = 3; g.beginPath(); g.moveTo(140, 82); g.quadraticCurveTo(128, 110, 140, 138); g.stroke();
          break;
        case 'moth': {
          const c = document.createElement('canvas'); c.width = MOTH_W; c.height = MOTH_H;
          drawMoth(SPECIES[1], 301, false)(c.getContext('2d'), MOTH_W, MOTH_H);
          g.fillStyle = '#fff'; g.fillRect(0, 0, 220, 220); g.drawImage(c, 0, 37, 220, 147);
          break;
        }
        case 'leaf':
          g.beginPath(); g.moveTo(34, 186); g.bezierCurveTo(30, 90, 120, 26, 192, 30); g.bezierCurveTo(192, 110, 120, 190, 34, 186); g.fill();
          white(); g.lineWidth = 4; g.beginPath(); g.moveTo(40, 180); g.quadraticCurveTo(110, 110, 186, 36); g.stroke();
          g.lineWidth = 2.5; for (let k = 1; k <= 5; k++) { const x = 50 + k * 22, y = 168 - k * 22; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 14, y - 30); g.moveTo(x, y); g.lineTo(x + 30, y + 12); g.stroke(); }
          break;
        case 'flower':
          for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU; E(110 + Math.cos(a) * 36, 86 + Math.sin(a) * 36, 26, 13, a); }
          g.lineWidth = 7; g.beginPath(); g.moveTo(110, 120); g.quadraticCurveTo(100, 170, 112, 212); g.stroke();
          E(132, 176, 20, 8, -0.6);
          white(); E(110, 86, 15, 15); g.fillStyle = '#000'; E(110, 86, 9, 9);
          break;
        case 'fern':
          g.lineWidth = 5; g.beginPath(); g.moveTo(112, 212); g.quadraticCurveTo(96, 110, 128, 12); g.stroke();
          for (let k = 0; k < 9; k++) {
            const q = k / 9, y = 196 - q * 176, x = 110 - Math.sin(q * 2.2) * 10, len = 46 * (1 - q * 0.7);
            E(x - len * 0.55, y - 4, len * 0.55, 6, -0.35); E(x + len * 0.55, y - 10, len * 0.55, 6, 0.35);
          }
          break;
        case 'gear':
          g.beginPath(); g.arc(110, 110, 62, 0, TAU); g.fill();
          for (let k = 0; k < 12; k++) { g.save(); g.translate(110, 110); g.rotate((k / 12) * TAU); g.fillRect(-11, -84, 22, 26); g.restore(); }
          white(); g.beginPath(); g.arc(110, 110, 22, 0, TAU); g.fill();
          for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU; E(110 + Math.cos(a) * 42, 110 + Math.sin(a) * 42, 9, 9); }
          break;
        case 'wrench':
          g.save(); g.translate(110, 110); g.rotate(-0.78);
          g.beginPath(); g.roundRect(-14, -18, 28, 120, 10); g.fill();
          E(0, -46, 36, 36);
          white(); g.fillRect(-12, -96, 24, 50); E(0, 84, 7, 7);
          g.restore();
          break;
        case 'bulb':
          E(110, 82, 56, 58);
          g.beginPath(); g.moveTo(82, 124); g.lineTo(138, 124); g.lineTo(130, 160); g.lineTo(90, 160); g.fill();
          g.fillRect(88, 164, 44, 10); g.fillRect(88, 178, 44, 10); g.fillRect(96, 192, 28, 12);
          white(); g.lineWidth = 3.5; g.beginPath(); g.moveTo(96, 124); g.lineTo(100, 92); g.quadraticCurveTo(110, 76, 120, 92); g.lineTo(124, 124); g.stroke();
          g.beginPath(); g.arc(88, 62, 18, 3.6, 4.6); g.stroke();
          break;
      }
    };
  }
  /* a subject as points: nf scattered over its body, ne along its outline, in a frame of [-0.5, 0.5] */
  function subjectPoints(name, nf, ne, r) {
    const S = 220, px = pixels(subjectDrawer(name), S, S);
    const fill = cdf(px, S, S, (p, i) => (1 - p[i] / 255) ** 1.2);
    const ink = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : 1 - px[(y * S + x) * 4] / 255);
    const edge = cdf(px, S, S, (p, i) => {
      const q = i / 4, x = q % S, y = (q / S) | 0, a = ink(x, y);
      return Math.max(0, Math.abs(a - ink(x + 2, y)) + Math.abs(a - ink(x, y + 2)) - 0.3);
    });
    const take = (c, n) => { const o = new Float32Array(n * 2); for (let k = 0; k < n; k++) { const [x, y] = draw(c, r); o[k * 2] = x / S - 0.5; o[k * 2 + 1] = y / S - 0.5; } return o; };
    return { fill: take(fill, nf), edge: take(edge, ne) };
  }
  function visionScene(nT, { down = false } = {}) {
    const narrow = down, k = narrow ? 0.6 : 1, r = rng(251), out = new Float32Array(nT * 12);
    const NF = Math.round(150 * k), NE = Math.round(130 * k);
    let t = 0;
    const put = (v0, v1 = [0, 0, 0, 0]) => { if (t >= nT) return; out.set(v0, t * 12); out.set(v1, t * 12 + 4); out.set([0, 0, 0, 0], t * 12 + 8); t++; };
    const n = (x) => Math.round(x * k);
    VISION.subjects.forEach((name, s) => {
      const sh = subjectPoints(name, NF, NE, r);
      for (let j = 0; j < NF; j++) put([0, s, sh.fill[j * 2], sh.fill[j * 2 + 1]]);
      for (let j = 0; j < NE; j++) put([1, s, sh.edge[j * 2], sh.edge[j * 2 + 1]]);
    });
    // the eye: its front rim (two rings and a scale), the rings along the barrel, the struts
    for (let i = 0; i < n(420); i++) put([2, 0, i / n(420), i % 2]);
    for (let i = 0; i < n(160); i++) put([2, 3, ((i % 72) + 0.5) / 72, r()]);
    for (let i = 0; i < n(700); i++) put([2, 1, r(), (i % 5)]);
    for (let i = 0; i < n(480); i++) put([2, 2, (i % 12) / 12, r()]);
    // the iris at the front: blade edges, shading, the pupil's rim
    for (let i = 0; i < n(320); i++) put([3, 0, (i % 9) / 9, r()]);
    for (let i = 0; i < n(900); i++) put([3, 1, r(), Math.sqrt(r())]);
    for (let i = 0; i < n(160); i++) put([3, 2, i / n(160), r()]);
    // inside: the pixel plane's grid, the network's rings of nodes, links and signals, the groups' halos
    for (let i = 0; i < 121; i++) if (Math.hypot((i % 11) - 5, Math.floor(i / 11) - 5) <= 5.2) put([9, i % 11, Math.floor(i / 11), 0]);
    const rings = narrow ? [8, 6, 4] : [10, 8, 6];
    rings.forEach((N, l) => { for (let a = 0; a < N; a++) for (let i = 0; i < 8; i++) put([4, l, a, r()]); });
    for (let l = 0; l < 2; l++) for (let a = 0; a < rings[l]; a++) for (const d of [0, 1]) {
      const b = (Math.floor((a * rings[l + 1]) / rings[l]) + d) % rings[l + 1];
      for (let i = 0; i < 5; i++) put([5, l, a, b], [(i + 0.5) / 5, r(), 0, 0]);
    }
    for (let i = 0; i < n(500); i++) { const l = (r() * 3) | 0; put([6, l, (r() * rings[l]) | 0, 0], [r(), r(), 0, 0]); }
    for (let g = 0; g < 3; g++) for (let i = 0; i < n(110); i++) put([10, g, i / n(110), r()]);
    // the display's corner marks (box 3) and a box round each detected object (boxes 0-2)
    for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) for (let a = 0; a < 2; a++) for (let i = 0; i < 10; i++) put([13, b, c, a], [i / 9, 0, 0, 0]);
    // the scan, and the points travelling through the eye
    for (let i = 0; i < n(300); i++) put([7, r(), r(), r()]);
    for (let i = 0; i < n(6200); i++) put([8, (r() * 9) | 0, (r() * NF) | 0, r()], [r(), r(), 0, 0]);
    while (t < nT) put([15, 0, 0, 0]);
    // a wide band, or on a phone a tall column (the camera rolled a quarter turn): measured so that
    // subjects, eye and display never meet under any sway or pointer turn
    return { data: out, ext: down ? [1.38, 2.78] : [3.2, 1.16], nf: NF, ne: NE };
  }

  /* ------------------------------------------------ coherent morphs
     Every scene is built independently, so point i of one scene and point i of the
     next sit in unrelated places and a morph looks like an explosion. align() reorders
     scene B so that its points follow scene A's spatial order (both walked along a
     Hilbert curve): the top-left of one shape flows into the top-left of the next.
     triplets: keep each point's three colour channels together (whole-ink scenes);
     otherwise each channel is ordered on its own (photographic halftones).
     carry: per-triplet arrays (species, owner…) that must travel with their points. */
  function hilbert(x, y, n) {
    let d = 0;
    for (let s = n >> 1; s > 0; s >>= 1) {
      const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
      d += s * s * ((3 * rx) ^ ry);
      if (ry === 0) {
        if (rx === 1) { x = n - 1 - x; y = n - 1 - y; }
        const tmp = x; x = y; y = tmp;
      }
    }
    return d;
  }
  function keyer(field) {
    const n = field.data.length / 4;
    const at = field.screen
      ? (v) => [field.screen[((v / 3) | 0) * 2], field.screen[((v / 3) | 0) * 2 + 1]]
      : (v) => [field.data[v * 4], field.data[v * 4 + 1]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let v = 0; v < n; v += 3) {
      const [x, y] = at(v);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const sx = 1023 / Math.max(1e-6, x1 - x0), sy = 1023 / Math.max(1e-6, y1 - y0);
    return (v) => { const [x, y] = at(v); return hilbert(((x - x0) * sx) | 0, ((y - y0) * sy) | 0, 1024); };
  }
  function ordered(field, c, step) {
    const key = keyer(field), n = field.data.length / 4;
    const idx = [], keys = new Float64Array(n);
    for (let v = c; v < n; v += step) { idx.push(v); keys[v] = key(v); }
    return Int32Array.from(idx).sort((a, b) => keys[a] - keys[b]);
  }
  function align(B, A, { triplets = true, carry = [] } = {}) {
    const out = new Float32Array(B.data.length);
    const screen = B.screen ? new Float32Array(B.screen.length) : null;
    const carried = carry.map((c) => new c.constructor(c.length));
    if (triplets) {
      const oa = ordered(A, 0, 3), ob = ordered(B, 0, 3);
      for (let k = 0; k < oa.length; k++) {
        const ta = oa[k] / 3, tb = ob[k] / 3;
        out.set(B.data.subarray(tb * 12, tb * 12 + 12), ta * 12);
        if (screen) { screen[ta * 2] = B.screen[tb * 2]; screen[ta * 2 + 1] = B.screen[tb * 2 + 1]; }
        carry.forEach((c, i) => { carried[i][ta] = c[tb]; });
      }
    } else {
      for (let c = 0; c < 3; c++) {
        const oa = ordered(A, c, 3), ob = ordered(B, c, 3);
        for (let k = 0; k < oa.length; k++) out.set(B.data.subarray(ob[k] * 4, ob[k] * 4 + 4), oa[k] * 4);
      }
    }
    B.data = out;
    if (screen) B.screen = screen;
    return carried;
  }

  /* recolour network points for a hovered node: its blob and its links light up */
  function highlight(net, nodeIndex) {
    const d = net.data;
    const hotLinks = new Set();
    if (nodeIndex >= 0) net.links.forEach(([a, b], li) => { if (a === nodeIndex || b === nodeIndex) hotLinks.add(li); });
    const nearNodes = new Set([nodeIndex]);
    hotLinks.forEach((li) => { nearNodes.add(net.links[li][0]); nearNodes.add(net.links[li][1]); });
    for (let t = 0; t < net.owner.length; t++) {
      const o = net.owner[t];
      const hot = nodeIndex < 0 ? 0 : o >= 0 ? (o === nodeIndex ? 2 : nearNodes.has(o) ? 1 : -1) : (hotLinks.has(-o - 1) ? 1 : -1);
      for (let ch = 0; ch < 3; ch++) d[(t * 3 + ch) * 4 + 3] = hot;
    }
  }

  return { HIDDEN, SPECIES, GRID, rng, aperture, underwater, waterState, waterSway, caption, triptych, trapGrid, annotation, embedding, dust, network, highlight, drawSpecimens, mothCanvas, citePlot, worldMap, visionScene, align };
})();
