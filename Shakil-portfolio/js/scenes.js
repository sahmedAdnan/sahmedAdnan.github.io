/* =============================================================
   Scenes: the Research steps as real images (4:3, 1024 × 768),
   shared by the alternative concepts (patches, ink, lens).
   Also builds an atlas of moth "light-trap photos": seven species
   in natural colours on the pale screen of a light trap.
   ============================================================= */
window.SA = window.SA || {};

SA.scenes = (() => {
  const W = 1024, H = 768, CELL = 128, PER = 9;
  const TAU = Math.PI * 2;

  const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  function rounded(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function photo(g, img, x, y, w, h, r, line) {
    g.save(); rounded(g, x, y, w, h, r); g.clip(); g.drawImage(img, x, y, w, h); g.restore();
    rounded(g, x + 0.5, y + 0.5, w - 1, h - 1, r); g.strokeStyle = line; g.lineWidth = 1; g.stroke();
  }

  /* a light-trap photo: the moth resting on the trap's pale screen */
  function thumb(g, x, y, s, k, v, r) {
    const tone = 232 + Math.round((r() - 0.5) * 10);
    g.save();
    rounded(g, x, y, s, s, s * 0.06); g.clip();
    g.fillStyle = `rgb(${tone},${tone - 3},${tone - 9})`; g.fillRect(x, y, s, s);
    const vg = g.createRadialGradient(x + s / 2, y + s / 2, s * 0.2, x + s / 2, y + s / 2, s * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = vg; g.fillRect(x, y, s, s);
    const m = SA.fields.mothCanvas(k);
    const sc = (0.78 + r() * 0.16) * s / m.width;
    g.translate(x + s / 2 + (r() - 0.5) * s * 0.1, y + s / 2 + (r() - 0.5) * s * 0.1);
    g.rotate((r() - 0.5) * 0.9);
    g.globalAlpha = 0.92 + r() * 0.08;
    g.drawImage(m, -m.width * sc / 2, -m.height * sc / 2, m.width * sc, m.height * sc);
    g.restore();
  }

  /* ------------------------------------------------ build everything for one theme */
  async function build(theme) {
    const dark = theme === 'dark';
    const ink = dark ? '#eeece6' : '#17181c', ink3 = dark ? '#9c9b97' : '#6e6f75';
    const line = dark ? 'rgba(238,236,230,0.22)' : 'rgba(23,24,28,0.16)';
    const accent = dark ? '#7cc4ff' : '#1f5fbf';
    await Promise.all([document.fonts.load('400 58px Gambetta'), document.fonts.load('italic 400 24px Gambetta'), document.fonts.load('500 15px Switzer')]).catch(() => {});
    const [water, frames] = await Promise.all([load('assets/opt/scene-water.webp'), load('assets/opt/scene-frames.webp')]);
    const boxes = [[0, 0.3643, 0.2689, 0.7143, 0.7815], [1, 0.5071, 0.1429, 0.7643, 0.4202], [1, 0.3071, 0.6134, 0.5571, 0.8824]];
    const K = SA.fields.SPECIES.length;
    const rng = SA.fields.rng;

    // atlas: K species × PER variants, 128 px cells
    const atlas = canvas(1024, 1024), ga = atlas.getContext('2d');
    const ra = rng(211);
    for (let k = 0; k < K; k++) for (let v = 0; v < PER; v++) {
      const c = k * PER + v;
      thumb(ga, (c % 8) * CELL + 4, Math.floor(c / 8) * CELL + 4, CELL - 8, k, v, ra);
    }
    const cellRect = (c) => [(c % 8) * CELL / 1024 + 4 / 1024, Math.floor(c / 8) * CELL / 1024 + 4 / 1024, (CELL - 8) / 1024, (CELL - 8) / 1024];

    const out = [null];
    const fw = frames.width / 4 - 9, fh = frames.height;

    // 1 · three theses
    {
      const c = canvas(W, H), g = c.getContext('2d');
      const ph = 210;
      const plates = [
        { cx: 250, cy: 200, w: ph * (water.width / 2 - 18) / water.height, src: [water, 0, 0, water.width / 2 - 18, water.height], year: '2020' },
        { cx: 512, cy: 384, w: ph * fw / fh, src: [frames, 0, 0, fw, fh], year: '2021' },
        { cx: 774, cy: 568, w: ph * 1.2 },
      ];
      plates.forEach((p, i) => {
        const x = p.cx - p.w / 2, y = p.cy - ph / 2;
        if (p.src) {
          g.save(); rounded(g, x, y, p.w, ph, 8); g.clip(); g.drawImage(p.src[0], p.src[1], p.src[2], p.src[3], p.src[4], x, y, p.w, ph); g.restore();
          rounded(g, x + 0.5, y + 0.5, p.w - 1, ph - 1, 8); g.strokeStyle = line; g.stroke();
        } else {
          const r = rng(5);
          g.save(); rounded(g, x, y, p.w, ph, 8); g.clip();
          g.fillStyle = '#e8e4dc'; g.fillRect(x, y, p.w, ph);
          const m = SA.fields.mothCanvas(3), sc = (ph * 0.86) / m.height;
          g.drawImage(m, p.cx - m.width * sc / 2, p.cy - m.height * sc / 2, m.width * sc, m.height * sc);
          g.restore(); r();
          rounded(g, x + 0.5, y + 0.5, p.w - 1, ph - 1, 8); g.strokeStyle = line; g.stroke();
        }
        g.fillStyle = ink3; g.font = '500 15px Switzer, sans-serif'; g.textAlign = 'center';
        g.fillText(p.year || '2026', p.cx, y + ph + 26);
      });
      out.push(c);
    }
    // 2 · underwater, with the tracked objects boxed
    {
      const c = canvas(W, H), g = c.getContext('2d');
      const w = 960, h = w * water.height / water.width, x = (W - w) / 2, y = (H - h) / 2;
      const pw = (water.width - 36) / 2 * (w / water.width), gap = 36 * (w / water.width);
      [0, 1].forEach((i) => {
        const sx = i * (water.width / 2 + 18);
        g.save(); rounded(g, x + i * (pw + gap), y, pw, h, 8); g.clip();
        g.drawImage(water, sx, 0, water.width / 2 - 18, water.height, x + i * (pw + gap), y, pw, h); g.restore();
      });
      g.strokeStyle = accent; g.lineWidth = 2;
      boxes.forEach(([i, x0, y0, x1, y1]) => {
        const bx = x + i * (pw + gap) + x0 * pw - 6, by = y + y0 * h - 6, bw = (x1 - x0) * pw + 12, bh = (y1 - y0) * h + 12;
        g.strokeRect(bx, by, bw, bh);
        g.setLineDash([3, 5]); g.globalAlpha = 0.6; g.strokeRect(bx - 7, by - 7, bw + 14, bh + 14); g.setLineDash([]); g.globalAlpha = 1;
      });
      out.push(c);
    }
    // 3 · video in, sentence out
    {
      const c = canvas(W, H), g = c.getContext('2d');
      const gap = 14, w = (960 - gap * 3) / 4, h = w * fh / fw, y = 250;
      for (let i = 0; i < 4; i++) {
        const x = 32 + i * (w + gap);
        g.save(); rounded(g, x, y, w, h, 6); g.clip();
        g.drawImage(frames, i * (fw + 12), 0, fw, fh, x, y, w, h); g.restore();
      }
      g.fillStyle = ink; g.font = '400 58px Gambetta, Georgia, serif'; g.textAlign = 'center';
      g.fillText('a person is playing guitar', W / 2, y + h + 110);
      out.push(c);
    }
    // 4–7 · camera-trap photos, embedding, clusters, named species
    const r = rng(77);
    const species = Array.from({ length: 24 }, (_, i) => i % K);
    for (let i = species.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [species[i], species[j]] = [species[j], species[i]]; }
    {
      const c = canvas(W, H), g = c.getContext('2d'), s = 136, gap = 16;
      const x0 = (W - (6 * s + 5 * gap)) / 2, y0 = (H - (4 * s + 3 * gap)) / 2, rr = rng(91);
      species.forEach((k, i) => thumb(g, x0 + (i % 6) * (s + gap), y0 + Math.floor(i / 6) * (s + gap), s, k, 0, rr));
      out.push(c);
    }
    const centers = Array.from({ length: K }, (_, k) => { const a = (k / K) * TAU + 0.35; return [Math.cos(a), Math.sin(a) * 0.62]; });
    const N = 63, items = Array.from({ length: N }, (_, i) => ({ k: i % K, v: Math.floor(i / K) }));
    const gauss = () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
    {
      const c = canvas(W, H), g = c.getContext('2d'), s = 66, rr = rng(93);
      items.map((it) => ({ ...it, x: centers[it.k][0] * 0.32 + gauss() * 0.42, y: centers[it.k][1] * 0.32 + gauss() * 0.36 }))
        .forEach((it) => thumb(g, W / 2 + it.x * 360 - s / 2, H / 2 + it.y * 330 - s / 2, s, it.k, it.v, rr));
      out.push(c);
    }
    {
      const c = canvas(W, H), g = c.getContext('2d'), s = 58, rr = rng(95);
      const pal = dark ? ['#40d9ff', '#ff59bf', '#ffd94d', '#7394ff', '#ff7352', '#61ff94', '#c285ff'] : ['#0099db', '#e01e84', '#db9e0f', '#334dc2', '#d63d29', '#1f945c', '#7538b3'];
      centers.forEach(([cx, cy], k) => {
        const x = W / 2 + cx * 380, y = H / 2 + cy * 400;
        const halo = g.createRadialGradient(x, y, 10, x, y, 110);
        halo.addColorStop(0, pal[k] + '38'); halo.addColorStop(1, pal[k] + '00');
        g.fillStyle = halo; g.beginPath(); g.arc(x, y, 110, 0, TAU); g.fill();
      });
      const count = new Array(K).fill(0);
      items.forEach((it) => {
        const n = count[it.k]++, a = n * 2.39996, d = 26 * Math.sqrt(n + 0.5);
        const [cx, cy] = centers[it.k];
        thumb(g, W / 2 + cx * 380 + Math.cos(a) * d - s / 2, H / 2 + cy * 400 + Math.sin(a) * d - s / 2, s, it.k, it.v, rr);
      });
      out.push(c);
    }
    {
      const c = canvas(W, H), g = c.getContext('2d');
      const slots = [[150, 230], [390, 230], [634, 230], [874, 230], [270, 540], [512, 540], [754, 540]];
      SA.fields.SPECIES.forEach((sp, k) => {
        const [x, y] = slots[k], m = SA.fields.mothCanvas(k), sc = 190 / m.width;
        g.drawImage(m, x - 95, y - m.height * sc / 2 - 10, 190, m.height * sc);
        g.textAlign = 'center';
        g.fillStyle = ink; g.font = 'italic 400 22px Gambetta, Georgia, serif'; g.fillText(sp.name, x, y + 78);
        g.fillStyle = ink3; g.font = '500 14px Switzer, sans-serif'; g.fillText(sp.family, x, y + 100);
      });
      out.push(c);
    }

    return { W, H, scenes: out, atlas, cellRect, PER, K, centers, accent };
  }

  /* per-tile statistics of a scene, for the patches concept: coverage and mean colour */
  function tileStats(c, cols, rows) {
    const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const tw = c.width / cols, th = c.height / rows, out = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      let a = 0, R = 0, G = 0, B = 0, n = 0;
      for (let y = Math.floor(j * th); y < (j + 1) * th; y += 3) for (let x = Math.floor(i * tw); x < (i + 1) * tw; x += 3) {
        const o = (y * c.width + x) * 4, al = d[o + 3] / 255;
        a += al; R += d[o] * al; G += d[o + 1] * al; B += d[o + 2] * al; n++;
      }
      out.push({ cov: a / n, rgb: a > 0 ? [R / a, G / a, B / a] : [0, 0, 0] });
    }
    return out;
  }

  return { build, tileStats, W, H };
})();
