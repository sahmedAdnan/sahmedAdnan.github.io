/* =============================================================
   Page orchestration.
   The scroll position is mapped continuously onto the sequence of
   scenes, so the point cloud is scrubbed by the reader, not timed.
   Heavy set-up work waits until the opening animation has finished,
   so the first seconds stay smooth.
   ============================================================= */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const desktop = matchMedia('(min-width: 900px)');
  const phone = matchMedia('(max-width: 639px)');          // the ending runs down the screen
  const hasGsap = !!(window.gsap && window.ScrollTrigger && window.SplitText);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const smoother = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ------------------------------------------------------------ deferred work */
  const queue = [];
  let released = false, pumping = false;
  const idle = window.requestIdleCallback ? (fn) => requestIdleCallback(fn, { timeout: 400 }) : (fn) => setTimeout(fn, 30);
  function later(fn) { queue.push(fn); pump(); }
  function release() { if (engine) engine.playIntro(); if (!released) { released = true; pump(); } }
  function pump() {
    if (!released || pumping) return;
    pumping = true;
    const next = () => {
      const fn = queue.shift();
      if (!fn) { pumping = false; return; }
      Promise.resolve().then(fn).catch((e) => console.error(e)).then(() => idle(next));
    };
    idle(next);
  }

  /* ------------------------------------------------------------ theme */
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  const theme = () => root.dataset.theme || (darkMQ.matches ? 'dark' : 'light');

  $('#year').textContent = new Date().getFullYear();

  /* ------------------------------------------------------------ concept under test (?concept=patches|ink|lens) */
  const params = new URLSearchParams(location.search);
  const CONCEPT = ['patches', 'ink', 'lens'].includes(params.get('concept')) ? params.get('concept') : 'points';
  root.dataset.concept = CONCEPT;
  let concept = null;

  /* ------------------------------------------------------------ engine */
  const L = { terrain: 0, tri: 1, water: 2, caption: 3, grid: 4, embed: 5, clusters: 6, annot: 7, plot: 8, net: 9, map: 10, end: 11 };
  const T = innerWidth < 760 ? 9000 : 22000;
  let engine = null;
  try {
    engine = new SA.Engine($('#field'), { triplets: T, layers: 12, reduced });
  } catch (e) {
    console.error(e);
    root.classList.add('no-gl');
  }

  const stageHeroEl = $('#stageHero');
  const stageHero = stageHeroEl, stageResearch = $('#stageResearch'), stageNet = $('#stageNetwork');
  const heroImg = $('#heroImg'), heroText = $('.hero__text');
  /* one cloud of points travels down the whole page; each entry is where it rests along the way */
  const STATES = [
    { layer: L.terrain, anchor: stageHeroEl, alpha: 0.9, size: 1.45, anim: 8, tilt: 0.25, repel: 0.3, pad: 1 },              // 0 a lens around the portrait
    { layer: L.tri, anchor: stageResearch, alpha: 0.95, size: 1.8, color: 5, anim: 6, tilt: 0.8, pad: 0.92 },                   // 1 three theses
    { layer: L.water, anchor: stageResearch, alpha: 0.95, size: 2.1, anim: 1, pad: 0.92 },                                      // 2 underwater
    { layer: L.caption, anchor: stageResearch, alpha: 0.95, size: 1.9, anim: 12, pad: 0.94 },                                   // 3 video → sentence
    { layer: L.grid, anchor: stageResearch, alpha: 0.95, size: 1.8, color: 5, anim: 13, repel: 0, pad: 0.94 },                  // 4 light trap → camera-trap images
    { layer: L.embed, anchor: stageResearch, alpha: 0.95, size: 1.9, color: 5, anim: 3, pad: 0.88 },                            // 5 embeddings
    { layer: L.clusters, anchor: stageResearch, alpha: 1, size: 2.2, color: 1, anim: 3, pad: 0.86 },                            // 6 clusters
    { layer: L.annot, anchor: stageResearch, alpha: 1, size: 1.9, color: 1, anim: 11, tilt: 0.35, pad: 0.92 },                  // 7 named species
    { layer: L.plot, anchor: $('#stagePlot'), alpha: 0.95, size: 1.7, color: 2, tilt: 0.25, repel: 0.4, split: 0, pad: 0.96 },   // 8 one bead per citation
    { layer: L.net, anchor: stageNet, alpha: 0.9, size: 1.7, color: 2, tilt: 0, repel: 0.25, split: 0, pad: 0.94 },              // 9 co-authors
    { layer: L.map, anchor: $('#stageMap'), alpha: 0.9, size: 1.6, color: 6, tilt: 0.3, repel: 0.5, split: 0, pad: 0.97 },       // 10 Dhaka to Aarhus
    { layer: L.end, anchor: $('#stageEnd'), alpha: 0.95, size: 1.55, anim: 14, tilt: 0, repel: 0, split: 0, pad: 0.98 },           // 11 from seeing to understanding
  ];
  const S = { hero: 0, tri: 1, water: 2, caption: 3, trap: 4, annot: 7, plot: 8, net: 9, map: 10, end: 11 };
  const BASE_ALPHA = STATES.map((s) => s.alpha);
  if (CONCEPT !== 'points') for (let s = 1; s <= 7; s++) STATES[s].alpha = 0;
  let labStatus = () => {};
  function placeResearchAnchors() {
    if (!engine) return;
    const small = $$('.step[data-state] .step__stage');
    for (let s = 1; s <= 7; s++) engine.setAnchor(s, desktop.matches ? stageResearch : small[s - 1]);
  }
  if (engine) {
    engine.setStates(STATES);
    placeResearchAnchors();
    desktop.addEventListener('change', () => {
      placeResearchAnchors();
      engine.setVertical(!desktop.matches);
      later(async () => { await buildEnd(); if (lastWorks) buildNetwork(lastWorks); else chain(); });
      measure();
    });
    engine.setVertical(!desktop.matches);
    engine.setTheme(theme() === 'dark');
    const q = new URLSearchParams(location.search);
    engine.setStyle(q.get('points'), q.get('flow'));
  }

  /* scenes that depend on the theme (photographs print differently on paper and screen) */
  const fontReady = document.fonts.load('400 70px Gambetta').catch(() => {});
  async function themeFields(t) {
    const water = await SA.fields.underwater(T, t);
    await fontReady;
    const caption = await SA.fields.caption(T, t, 'Gambetta, Georgia, serif');
    const tri = await SA.fields.triptych(T, t);
    return { water, caption, tri };
  }
  /* the end: from seeing to understanding */
  let endNet = null;
  async function buildEnd() {
    endNet = raw.end = SA.fields.visionScene(T, { down: phone.matches });
    engine.setVision(endNet.nf, endNet.ne, phone.matches);
  }
  if (engine) phone.addEventListener('change', () => later(async () => { await buildEnd(); chain(); }));
  /* the closing band shares the screen with the contact details: never taller than the room they leave */
  function fitEnd() {
    const band = $('#stageEnd'), grid = $('.contact__grid');
    if (!band || !grid) return;
    if (phone.matches) { band.style.maxHeight = ''; return; }
    const nav = parseFloat(getComputedStyle(root).getPropertyValue('--nav-h')) || 64;
    const gap = parseFloat(getComputedStyle(band).marginTop) || 0;
    band.style.maxHeight = `${Math.max(220, innerHeight - nav - grid.offsetHeight - gap - 16)}px`;
  }
  fitEnd();
  addEventListener('resize', fitEnd);
  document.fonts.ready.then(fitEnd);
  /* ------------------------------------------------------------ the chain of scenes
     Every scene is generated on its own (raw), then reordered to follow the spatial
     order of the scene before it (SA.fields.align), so each morph flows from one
     shape into the next instead of scattering. Re-run whenever an input changes. */
  const raw = {};
  // reorder each scene to follow the one before (morphs stay local). Off: the points pair up at
  // random, so between two scenes the swarm crosses over, which is the motion he preferred
  const COHERENT = false;
  const copy = (f) => ({ ...f, data: f.data.slice(), screen: f.screen && f.screen.slice() });
  let chainRun = 0, water = null, tri = null, annot = null;
  async function chain() {
    if (!engine) return;
    const run = ++chainRun, pause = () => new Promise((r) => idle(r));
    let prev = null;
    const step = async (name, layer, { triplets = true, carry, after } = {}) => {
      if (!raw[name]) return null;
      const f = copy(raw[name]);
      if (prev && COHERENT) {
        const carried = SA.fields.align(f, prev, { triplets, carry: carry ? carry(f) : [] });
        if (after) after(f, carried);
      }
      engine.upload(layer, f);
      prev = f;
      await pause();
      return run === chainRun ? f : false;
    };
    if ((await step('terrain', L.terrain)) === false) return;
    const t1 = await step('tri', L.tri, { triplets: false }); if (t1 === false) return; if (t1) tri = t1;
    const w1 = await step('water', L.water, { triplets: false }); if (w1 === false) return; if (w1) water = w1;
    if ((await step('caption', L.caption, { triplets: false })) === false) return;
    if (raw.grid) {
      const g = copy(raw.grid);
      let cid = raw.grid.cid, colorW = raw.grid.colorW;
      if (prev && COHERENT) [cid, colorW] = SA.fields.align(g, prev, { carry: [cid, colorW] });
      engine.upload(L.grid, g);
      engine.upload(L.embed, SA.fields.embedding(T, cid, g.K, false, colorW));
      const clusters = SA.fields.embedding(T, cid, g.K, true);
      engine.upload(L.clusters, clusters);
      engine.setCentres(clusters.centers);
      annot = SA.fields.annotation(T, cid, { narrow: !desktop.matches });
      engine.setSlots(annot.slots.map(([x, y]) => [x, y, annot.scale, 0]));
      engine.upload(L.annot, annot);
      buildLabels();
      prev = annot;
      await pause(); if (run !== chainRun) return;
    }
    if ((await step('plot', L.plot)) === false) return;
    const n1 = await step('net', L.net, { carry: (f) => [f.owner], after: (f, [owner]) => { f.owner = owner; } });
    if (n1 === false) return;
    if (n1 && net) { net.field = n1; hot = -1; pinned = -1; detail.classList.remove('is-on'); }
    if ((await step('map', L.map)) === false) return;
    await step('end', L.end);
  }
  async function seedScenes() {
    raw.terrain = SA.fields.aperture(T);
    if (SA.geo) { raw.map = SA.fields.worldMap(T, SA.geo); buildMapLabels(raw.map); }
    chain();
  }

  /* the alternative concepts live in their own files, fetched only when asked for */
  function loadConceptScripts() {
    const tpl = $('#conceptScripts');
    const srcs = tpl ? [...tpl.content.querySelectorAll('script')].map((s) => s.getAttribute('src')) : [];
    return srcs.reduce((p, src) => p.then(() => new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = res;
      el.onerror = () => rej(new Error('could not load ' + src));
      document.head.appendChild(el);
    })), Promise.resolve());
  }
  let conceptStarted = false;
  async function startConcept() {
    if (conceptStarted) return;
    conceptStarted = true;
    labStatus('loading…');
    try {
      if (!SA.concepts) await loadConceptScripts();
      const data = await SA.scenes.build(theme());
      concept = SA.concepts.create(CONCEPT, engine, data, { desktop });
      let failed = false;
      engine.beforePoints((gl, e, dt) => {
        if (!concept || failed) return;
        try { concept.render(gl, e, dt); } catch (err) { failed = true; conceptFailed(err); }
      });
      labStatus('ready · scroll through Research');
    } catch (err) { conceptFailed(err); }
  }
  /* a concept that cannot run hands the Research section back to the point cloud */
  function conceptFailed(err) {
    console.error('concept unavailable', err);
    concept = null;
    root.dataset.concept = 'points';
    for (let s = 1; s <= 7; s++) engine.setAlpha(s, BASE_ALPHA[s]);
    labStatus('failed: ' + (err && err.message ? err.message : String(err)), true);
  }

  /* ------------------------------------------------------------ the photograph and its generator */
  let gen = null, heroView = null;
  async function startGenerator() {
    try {
      gen = await new SA.Generator(engine, { src: 'assets/opt/portrait-cut.webp', reduced }).load();
    } catch (e) {
      console.warn('generator unavailable', e);
      gen = null;
      heroImg.classList.add('is-ready');
      return;
    }
    heroView = gen.addView({ stage: stageHero, alpha: 1 });
    engine.beforePoints((gl, e, dt) => gen.render(gl, e, dt));
  }
  /* once the network has finished, the real <img> takes over: identical pixels, native scrolling */
  function handOver() {
    heroImg.classList.add('is-ready');
    if (engine) engine.playIntro();
    setTimeout(() => { if (heroView) heroView.alpha = 0; }, 700);
  }

  /* ------------------------------------------------------------ theme switching */
  let switching = false;
  async function applyTheme(next, origin) {
    if (switching) return;
    switching = true;
    const fields = engine && released ? await themeFields(next) : null;
    const apply = () => {
      if (origin) { root.dataset.theme = next; try { localStorage.setItem('sa-theme', next); } catch (e) { /* private */ } }
      if (engine) { if (fields) { Object.assign(raw, fields); chain(); } engine.setTheme(next === 'dark'); }
      if (concept) SA.scenes.build(next).then((d) => concept.setData(d));
    };
    if (origin && document.startViewTransition && !reduced) {
      root.classList.add('vt-theme');
      const vt = document.startViewTransition(apply);
      vt.ready.then(() => {
        const r = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
        root.animate({ clipPath: [`circle(0 at ${origin.x}px ${origin.y}px)`, `circle(${r}px at ${origin.x}px ${origin.y}px)`] },
          { duration: 750, easing: 'cubic-bezier(.7,0,.2,1)', pseudoElement: '::view-transition-new(root)' });
      });
      await vt.finished.catch(() => {});
      root.classList.remove('vt-theme');
    } else apply();
    switching = false;
  }
  $('#themeToggle').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    applyTheme(theme() === 'dark' ? 'light' : 'dark', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });
  darkMQ.addEventListener('change', () => { if (!root.dataset.theme) applyTheme(theme()); });

  /* ------------------------------------------------------------ scroll → scene */
  let marks = [];
  function measure() {
    const maxCenter = document.documentElement.scrollHeight - innerHeight / 2;
    marks = $$('[data-state]')
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const target = el.matches('.step') && !desktop.matches ? el.querySelector('.step__stage') || el : el;
        const r = target.getBoundingClientRect();
        return { s: +el.dataset.state, y: Math.min(r.top + scrollY + r.height / 2, maxCenter) };
      })
      .sort((a, b) => a.y - b.y);
    onScroll(scrollY);
  }
  function stateAt(scroll) {
    if (!marks.length) return 0;
    const y = scroll + innerHeight / 2;
    if (y <= marks[0].y) return marks[0].s;
    for (let i = 0; i < marks.length - 1; i++) {
      const a = marks[i], b = marks[i + 1];
      if (y < b.y) return a.s + (b.s - a.s) * smoother(0.1, 0.9, (y - a.y) / (b.y - a.y));
    }
    return marks[marks.length - 1].s;
  }

  const nav = $('#nav');
  const navLinks = $$('.nav__links a');
  const sectionFor = ['', 'research', 'research', 'research', 'research', 'research', 'research', 'research', 'publications', 'publications', 'about', 'contact'];
  let lastY = 0, menuOpen = false;
  function onScroll(y) {
    const s = stateAt(y);
    if (engine) engine.setTarget(s);
    if (y > innerHeight * 0.15) release();
    nav.classList.toggle('is-scrolled', y > 20);
    if (!menuOpen) nav.classList.toggle('is-hidden', y > lastY + 2 && y > innerHeight * 0.7);
    if (y < lastY - 2) nav.classList.remove('is-hidden');
    lastY = y;
    const current = sectionFor[Math.round(s)];
    navLinks.forEach((a) => a.classList.toggle('is-active', a.dataset.nav === current));
  }

  /* ------------------------------------------------------------ overlays that sit on the points */
  const ovTracks = $('#ovTracks'), ovTaxa = $('#ovTaxa'), ovNet = $('#ovNet'), ovTri = $('#ovTri');
  const ovPlot = $('#ovPlot'), ovMap = $('#ovMap');
  let plotLabels = [], mapLabels = [];
  const makeLabels = (box, items, cls) => { box.innerHTML = ''; return items.map((it) => { const el = document.createElement('span'); el.className = cls; el.innerHTML = it.html; box.appendChild(el); return { el, ...it }; }); };
  function buildPlotLabels(f) {
    plotLabels = makeLabels(ovPlot, f.labels.map((l) => ({ x: l.x, y: l.y, html: esc(l.text), kind: l.kind })), 'plot-label');
    plotLabels.forEach((l) => l.el.classList.add('plot-label--' + l.kind));
  }
  function buildMapLabels(f) {
    mapLabels = makeLabels(ovMap, f.cities.map((c) => ({ x: c.x, y: c.y, html: `${esc(c.name)}` })), 'map-label');
  }
  const triLabels = ['2020', '2021', '2026'].map((y) => { const el = document.createElement('span'); el.className = 'tri-label'; el.textContent = y; ovTri.appendChild(el); return el; });

  // species names from the DK-Moth class list, set under each moth once its cluster is named
  let labels = [];
  function buildLabels() {
    ovTaxa.innerHTML = '';
    labels = SA.fields.SPECIES.map((sp, k) => {
      const el = document.createElement('span');
      el.className = 'taxon';
      el.style.setProperty('--i', k);
      el.innerHTML = `<i>${esc(sp.name)}</i><span>${esc(sp.family)}</span>`;
      ovTaxa.appendChild(el);
      return { el, slot: annot.slots[k] };
    });
  }
  let tracks = [];

  const near = (e, s, w = 0.34) => clamp(1 - Math.abs(e.state - s) / w, 0, 1);
  function frame(e) {
    // years under the three thesis plates
    const yv = near(e, S.tri, 0.35);
    ovTri.style.opacity = yv;
    if (yv > 0.01 && tri) tri.plates.forEach((pl, i) => {
      const p = e.project(S.tri, pl.x, pl.y + 0.025, pl.z);
      triLabels[i].style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translateX(-50%)`;
    });
    // tracking boxes on the underwater scene
    const tv = near(e, S.water, 0.25);
    ovTracks.style.opacity = tv;
    if (tv > 0.01 && water) {
      if (tracks.length !== water.boxes.length) {
        ovTracks.innerHTML = '';
        tracks = water.boxes.map(() => { const d = document.createElement('div'); d.className = 'trk'; ovTracks.appendChild(d); return d; });
      }
      // the boxes ride with their objects, and shake when the water turns murky
      const ws = SA.fields.waterState(e.clockOf(S.water)), mo = reduced ? 0 : 1;
      water.boxes.forEach((bx, i) => {
        const [sx, sy] = SA.fields.waterSway(i, e.time).map((d) => d * mo);
        const shake = (ws.turb * 0.012 * Math.sin(e.time * 7.3 + i * 3) + ws.bub * 0.008 * Math.sin(e.time * 11.1 + i)) * mo;
        const a = e.project(S.water, bx[0] - 0.02 + sx + shake, bx[1] - 0.03 + sy), b = e.project(S.water, bx[2] + 0.02 + sx + shake, bx[3] + 0.03 + sy);
        Object.assign(tracks[i].style, { transform: `translate3d(${a.x}px, ${a.y}px, 0)`, width: `${b.x - a.x}px`, height: `${b.y - a.y}px` });
        tracks[i].classList.toggle('is-unsure', ws.turb + ws.bub > 0.5);
      });
    }
    // species names under the moths
    const av = near(e, S.annot, 0.3);
    ovTaxa.classList.toggle('is-on', av > 0.6);
    ovTaxa.style.opacity = av > 0.01 ? 1 : 0;
    if (av > 0.01 && annot) labels.forEach(({ el, slot }) => {
      const p = e.project(S.annot, slot[0], slot[1] + annot.scale * 0.66);
      el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translateX(-50%)`;
    });
    // years and counts under the citation dots
    const pv = near(e, S.plot, 0.3);
    ovPlot.style.opacity = pv;
    if (pv > 0.01) plotLabels.forEach((l) => {
      const p = e.project(S.plot, l.x, l.y);
      l.el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) translate(-50%, -50%)`;
    });
    // the two cities on the map
    const mv = near(e, S.map, 0.3);
    ovMap.style.opacity = mv;
    if (mv > 0.01) mapLabels.forEach((l) => {
      const p = e.project(S.map, l.x, l.y);
      l.el.style.transform = `translate3d(${p.x + 16}px, ${p.y}px, 0) translateY(-50%)`;
    });
    // network labels: the more central a name, the more right it has to its place
    const nv = near(e, S.net, 0.3);
    ovNet.style.opacity = nv;
    if (nv > 0.01 && net) {
      const placed = [];
      net.order.forEach((l) => {
        const n = net.field.nodes[l.i];
        const p = e.project(S.net, n.x, n.y + n.r);
        const x = p.x, y = p.y + 6;
        l.el.style.transform = `translate3d(${x}px, ${y}px, 0) translateX(-50%)`;
        const box = [x - l.w / 2 - 4, y - 2, x + l.w / 2 + 4, y + 16];
        const clash = placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
        const show = !clash || l.kind !== 'person' || l.i === hot;
        l.el.classList.toggle('is-hidden', !show);
        if (show) placed.push(box);
      });
    }
  }
  if (engine) engine.onFrame(frame);

  /* ------------------------------------------------------------ publications + network from ORCID/OpenAlex */
  const NUM = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const num = (n) => NUM[n] || String(n);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const KINDS = ['Journal article', 'Conference paper', 'Book chapter', 'Preprint', 'Dataset', 'Thesis', 'Review', 'Publication'];
  const PLURAL = { 'Journal article': 'Journal articles', 'Conference paper': 'Conference papers', 'Book chapter': 'Book chapters', Preprint: 'Preprints', Dataset: 'Datasets', Thesis: 'Theses', Review: 'Reviews', Publication: 'Other work' };
  const story = (w) => SA.stories[w.doi] || (w.doiAlt && SA.stories[w.doiAlt]) || {};
  const shortTitle = (w) => story(w).short || w.title.split(':')[0].split(' ').slice(0, 4).join(' ');
  const firstSentences = (t, max = 320) => (t.match(/[^.!?]+[.!?]+/g) || [t]).reduce((acc, x) => (acc.length + x.length <= max || !acc ? acc + x : acc), '').trim();
  const initials = (name) => {
    const parts = name.replace(/\./g, '').split(/\s+/).filter(Boolean);
    const last = parts.pop();
    return parts.map((p) => p[0].toUpperCase() + '.').join(' ') + (parts.length ? ' ' : '') + last;
  };

  let pubKind = 'all';
  function renderPubs(works) {
    const total = works.reduce((a, w) => a + w.cites, 0);
    const first = Math.min(...works.map((w) => w.year || 9999));
    const datasets = works.filter((w) => w.type === 'Dataset').length, papers = works.length - datasets;
    const parts = [papers ? `${num(papers)} ${papers === 1 ? 'paper' : 'papers'}` : '', datasets ? `${num(datasets)} ${datasets === 1 ? 'dataset' : 'datasets'}` : ''].filter(Boolean);
    $('#pubsNote').textContent = `${cap(parts.join(' and '))} since ${first}, cited ${total} ${total === 1 ? 'time' : 'times'}.`;

    const kinds = KINDS.filter((k) => works.some((w) => w.type === k));
    if (!kinds.includes(pubKind)) pubKind = 'all';
    const btn = (k, label, n) => `<button type="button" data-kind="${esc(k)}" aria-pressed="${k === pubKind}">${esc(label)}<sup>${n}</sup></button>`;
    $('#pubsFilter').innerHTML = (kinds.length > 1 ? btn('all', 'All', works.length) + kinds.map((k) => btn(k, PLURAL[k], works.filter((w) => w.type === k).length)).join('') : '') + '<span class="pubs__ink" aria-hidden="true"></span>';

    $('#pubsList').innerHTML = works.map((w, i) => {
      const st = story(w);
      const authors = w.authors.map((a) => (a.me ? `<b>${esc(a.name)}</b>` : esc(a.name))).join(', ');
      const meta = [st.venue || w.venue, st.note, w.cites ? `${w.cites} citation${w.cites === 1 ? '' : 's'}` : null].filter(Boolean).map(esc).join(' · ');
      const text = st.story || firstSentences(w.abstract || '');
      const href = w.url ? ` href="${esc(w.url)}" target="_blank" rel="noopener"` : '';
      const fig = st.figure
        ? `<figure class="pub__fig"><img src="${esc(st.figure)}" alt="${esc(st.alt || '')}" loading="lazy"></figure>`
        : st.plate ? `<figure class="pub__fig"><canvas data-plate="${esc(st.plate)}" width="840" height="560" role="img" aria-label="${esc(st.alt || '')}"></canvas></figure>` : '<div></div>';
      return `<article class="pub" data-kind="${esc(w.type)}" style="view-transition-name: pub-${i}">
        <div class="pub__when"><span class="pub__year">${esc(w.year || '')}</span><span class="pub__kind">${esc(w.type)}</span></div>
        <div class="pub__body">
          <h3 class="pub__title"><a${href}>${esc(w.title)}</a></h3>
          <p class="pub__authors">${authors}</p>
          <p class="pub__meta">${meta}</p>
          ${text ? `<p class="pub__story">${esc(text)}</p>` : ''}
        </div>
        ${fig}
      </article>`;
    }).join('');

    // specimen plates are drawn when they come into view
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      later(() => SA.fields.drawSpecimens(en.target));
      release();
    }), { rootMargin: '400px' });
    $$('#pubsList canvas[data-plate]').forEach((c) => io.observe(c));

    $$('#pubsFilter button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
    applyKind();
  }
  function applyKind() {
    $$('#pubsList .pub').forEach((el) => { el.hidden = pubKind !== 'all' && el.dataset.kind !== pubKind; });
    const btns = $$('#pubsFilter button');
    btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === pubKind)));
    const on = btns.find((b) => b.dataset.kind === pubKind), ink = $('#pubsFilter .pubs__ink');
    if (on && ink) Object.assign(ink.style, { transform: `translate(${on.offsetLeft}px, ${on.offsetTop + on.offsetHeight}px)`, width: `${on.offsetWidth}px` });
  }
  function setKind(k) {
    if (k === pubKind) return;
    pubKind = k;
    const after = () => { measure(); if (hasGsap) ScrollTrigger.refresh(); };
    if (document.startViewTransition && !reduced) document.startViewTransition(applyKind).finished.then(after, after);
    else { applyKind(); after(); }
  }
  addEventListener('resize', applyKind);

  let net = null, hot = -1;
  function buildNetwork(works) {
    const g = SA.works.graph(works);
    $('#netNote').textContent = `${g.people} people across ${works.length} ${works.length === 1 ? 'work' : 'works'}.`;
    $('#netList').innerHTML = g.nodes.filter((n) => n.kind === 'person').map((n) => `<li>${esc(n.name)}: ${n.papers.map((w) => esc(shortTitle(w))).join(', ')}</li>`).join('');
    if (!engine) return;
    const field = SA.fields.network(T, g, { vertical: !desktop.matches });
    raw.net = field;
    ovNet.innerHTML = '';
    const labels = g.nodes.map((n, i) => {
      const el = document.createElement('span');
      el.className = `node node--${n.kind}`;
      el.textContent = n.kind === 'paper' ? `${shortTitle(n.work)}, ${n.year}` : n.kind === 'me' ? 'Shakil Ahmed' : initials(n.name);
      ovNet.appendChild(el);
      return { el, i, kind: n.kind, weight: n.kind === 'me' ? 99 : n.kind === 'paper' ? 50 : n.papers.length };
    });
    labels.forEach((l) => { l.w = l.el.offsetWidth; });
    net = { g, field, labels, order: labels.slice().sort((a, b) => b.weight - a.weight) };
    hot = -1; pinned = -1;
    detail.classList.remove('is-on');
    chain();
  }
  const profile = (p) => (p.orcid ? `https://orcid.org/${p.orcid}` : p.id ? `https://openalex.org/authors/${p.id}` : null);
  const link = (href, text, cls = '') => (href ? `<a href="${esc(href)}" target="_blank" rel="noopener"${cls ? ` class="${cls}"` : ''}>${esc(text)}</a>` : `<span${cls ? ` class="${cls}"` : ''}>${esc(text)}</span>`);
  function describe(n) {
    if (n.kind === 'me') {
      const works = net.g.nodes[0].papers.length;
      return `<p class="nd__kicker">${works} works · ${net.g.people} co-authors</p>
        <h4 class="nd__title">${link('https://orcid.org/' + SA.works.ORCID, 'Shakil Ahmed')}</h4>`;
    }
    if (n.kind === 'paper') {
      const w = n.work;
      const people = w.authors.map((p) => (p.me ? `<span class="is-me">${esc(p.name)}</span>` : link(profile(p), p.name))).join('');
      return `<p class="nd__kicker">${esc([w.type, (story(w).venue || w.venue || '').split(' · ')[0], w.year].filter(Boolean).join(' · '))}</p>
        <h4 class="nd__title">${link(w.url, w.title)}</h4>
        <div class="nd__people">${people}</div>`;
    }
    const items = n.papers.map((w) => `<li>${link(w.url, w.title)}<span>${esc(w.year)}</span></li>`).join('');
    return `<p class="nd__kicker">Co-author${n.papers.length > 1 ? ` on ${num(n.papers.length)} works` : ''}</p>
      <h4 class="nd__title">${link(profile(n), n.name)}</h4>
      <ul class="nd__list">${items}</ul>`;
  }
  const detail = $('#netDetail');
  let pinned = -1;
  function setHot(i) {
    if (!net || i === hot) return;
    hot = i;
    SA.fields.highlight(net.field, i);
    engine.upload(L.net, net.field);
    const adj = new Set([i]);
    if (i >= 0) net.field.links.forEach(([a, b]) => { if (a === i) adj.add(b); if (b === i) adj.add(a); });
    net.labels.forEach((l) => { l.el.classList.toggle('is-hot', l.i === i); l.el.classList.toggle('is-dim', i >= 0 && !adj.has(l.i)); });
    if (i >= 0) detail.innerHTML = describe(net.g.nodes[i]);
    detail.classList.toggle('is-on', i >= 0);
  }
  function nodeAt(ev) {
    let best = -1, bd = Infinity;
    net.field.nodes.forEach((n, i) => {
      const p = engine.project(S.net, n.x, n.y);
      const d = Math.hypot(p.x - ev.clientX, p.y - ev.clientY);
      const r = Math.max(22, n.r * engine.anchorOf(S.net)[2] + 10);
      if (d < r && d < bd) { bd = d; best = i; }
    });
    return best;
  }
  stageNet.addEventListener('pointermove', (ev) => {
    if (!net || !engine || pinned >= 0 || detail.contains(ev.target)) return;
    if (ev.pointerType === 'mouse') setHot(nodeAt(ev));
  });
  stageNet.addEventListener('click', (ev) => {
    if (!net || !engine || detail.contains(ev.target)) return;
    const i = nodeAt(ev);
    pinned = i >= 0 && i !== pinned ? i : -1;
    setHot(pinned >= 0 ? pinned : (ev.pointerType === 'mouse' ? i : -1));
    stageNet.classList.toggle('is-pinned', pinned >= 0);
  });
  stageNet.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && pinned < 0) setHot(-1); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && pinned >= 0) { pinned = -1; stageNet.classList.remove('is-pinned'); setHot(-1); } });

  let lastWorks = null;
  function onWorks(data) {
    if (!data || !data.works || !data.works.length) return;
    lastWorks = data.works;
    renderPubs(data.works);
    later(() => {
      const plot = SA.fields.citePlot(T, data.works);
      if (plot) { raw.plot = plot; buildPlotLabels(plot); }
      buildNetwork(data.works);
    });
    if (hasGsap) revealPubs();
    requestAnimationFrame(measure);
  }

  /* ------------------------------------------------------------ honours lightbox */
  const dlg = $('#lightbox');
  $$('.honours button').forEach((b) => b.addEventListener('click', () => {
    const d = b.dataset;
    $('#lbImg').src = `assets/opt/${d.img}.webp`;
    $('#lbImg').alt = d.title;
    $('#lbDate').textContent = d.date;
    $('#lbTitle').textContent = d.title;
    $('#lbDesc').textContent = d.desc;
    $('#lbOrig').href = `assets/${d.img}.jpg`;
    dlg.showModal();
  }));
  $('#lbClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  /* ------------------------------------------------------------ menu */
  const menu = $('#menu'), menuBtn = $('#menuBtn');
  let lenis = null;
  const setMenu = (open) => {
    menuOpen = open;
    menu.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.textContent = open ? 'Close' : 'Menu';
    if (lenis) open ? lenis.stop() : lenis.start();
  };
  menuBtn.addEventListener('click', () => setMenu(!menuOpen));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuOpen) setMenu(false); });

  /* ------------------------------------------------------------ the hero: nothing is drawn over the face */
  if (engine) engine.onFrame((e) => {
    if (e.state > 1.2) return;
    const r = heroImg.getBoundingClientRect(), txt = heroText.getBoundingClientRect();
    e.setHead(r.left + r.width * 0.5, r.top + r.height * 0.27, r.width * 0.2, txt.right);
  });

  /* ------------------------------------------------------------ the lamp in the light trap, and the kernel at the end
     In the thesis scene the lamp follows the pointer (or a finger) over the picture and the
     moths follow it, each a moment behind. */
  const endSec = $('#contact');

  let lampHeld = false, touchPt = null, touchTimer = 0;
  const steerAt = { x: 0, y: 0, mode: -1 }, trail = [];
  const touch = (e) => {
    if (e.pointerType === 'mouse') return;
    touchPt = [e.clientX, e.clientY];
    clearTimeout(touchTimer);
    touchTimer = setTimeout(() => { touchPt = null; }, 2500);
  };
  addEventListener('pointerdown', touch, { passive: true });
  addEventListener('pointermove', touch, { passive: true });
  const pointerAt = (e) => (e.mouse.tx > -1e3 ? [e.mouse.tx, e.mouse.ty] : touchPt);
  const smallStages = $$('.step[data-state] .step__stage');
  function steer(e, dt) {
    lampHeld = false;
    let target, lags, rate, mode;
    const pt = pointerAt(e);
    if (Math.abs(e.state - S.trap) < 1.2) {
      mode = 0; lags = [0, 0.18, 0.42, 0.8]; rate = 4;
      const A = e.anchorOf(S.trap), r = (desktop.matches ? stageResearch : smallStages[S.trap - 1]).getBoundingClientRect();
      if (pt && pt[0] >= r.left && pt[0] <= r.right && pt[1] >= r.top && pt[1] <= r.bottom) {
        target = [clamp((pt[0] - A[0]) / A[2], -1.5, 1.5), clamp((pt[1] - A[1]) / A[3], -1.6, 1.4)];
        lampHeld = true;
      } else {
        const g = SA.fields.GRID.lamp;
        target = [g[0] + 0.25 * Math.sin(e.time * 0.31), g[1] + 0.06 * Math.sin(e.time * 0.53)];
      }
    } else if (Math.abs(e.state - S.end) < 1.2 && endNet) {
      const A = e.anchorOf(S.end), r = endSec.getBoundingClientRect();
      const on = pt && pt[1] >= r.top && pt[1] <= r.bottom && !reduced;   // anywhere in the contact section
      if (on) { eyeAt[0] = (pt[0] - A[0]) / A[2]; eyeAt[1] = (pt[1] - A[1]) / A[3]; }
      eyeOn += ((on ? 1 : 0) - eyeOn) * (1 - Math.exp(-dt * 3));
      eyeLook[0] += (eyeAt[0] - eyeLook[0]) * (1 - Math.exp(-dt * 6));
      eyeLook[1] += (eyeAt[1] - eyeLook[1]) * (1 - Math.exp(-dt * 6));
      e.setTrail([eyeLook[0], eyeLook[1], eyeOn, 0, 0, 0, 0, 0]);
      return;
    } else return;
    if (mode !== steerAt.mode) { steerAt.x = target[0]; steerAt.y = target[1]; steerAt.mode = mode; trail.length = 0; }
    const k = reduced ? 1 : 1 - Math.exp(-dt * rate);
    steerAt.x += (target[0] - steerAt.x) * k;
    steerAt.y += (target[1] - steerAt.y) * k;
    // each layer, or each moth, follows where it was a moment ago
    const now = performance.now() / 1000;
    trail.push([now, steerAt.x, steerAt.y]);
    while (trail.length > 2 && now - trail[0][0] > 1.2) trail.shift();
    const at = (lag) => { for (let i = trail.length - 1; i >= 0; i--) if (trail[i][0] <= now - lag) return trail[i]; return trail[0]; };
    e.setTrail(lags.flatMap((lag) => { const p = at(lag); return [p[1], p[2]]; }));
  }

  const eyeAt = [0, 0], eyeLook = [0, 0];
  let eyeOn = 0;
  if (engine) engine.onFrame(steer);

  /* ------------------------------------------------------------ cursor: a convolution kernel
     A 3 × 3 kernel follows the pointer, its weights shimmering. Over a link it closes in on it
     as four focus corners, like a camera locking on; in the light trap it becomes the lamp. */
  if (fine && !reduced) {
    root.classList.add('has-kern');
    const kern = $('#kern'), box = $('.kern__box', kern), dot = $('.kern__dot', kern), cells = $$('.kern__box i', kern);
    cells.forEach((c, i) => { c.style.left = `${(i % 3) * 50}%`; c.style.top = `${Math.floor(i / 3) * 50}%`; });
    const K = 20, cur = { x: -100, y: -100, w: K, h: K };
    let px = -100, py = -100, lock = null, down = false;
    addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; px = e.clientX; py = e.clientY; kern.style.opacity = 1; }, { passive: true });
    document.addEventListener('pointerleave', () => { kern.style.opacity = 0; });
    addEventListener('pointerdown', () => { down = true; });
    addEventListener('pointerup', () => { down = false; });
    document.addEventListener('pointerover', (e) => { lock = e.target.closest('a, button, [role="button"]'); });
    new MutationObserver(() => root.classList.toggle('has-kern', !dlg.open)).observe(dlg, { attributes: true, attributeFilter: ['open'] });
    const tick = (now) => {
      const t = now / 1000;
      let target = lock && lock.isConnected ? lock.getBoundingClientRect() : null;
      // a hovered person or paper in the co-author network is detected too
      if (!target && net && hot >= 0 && engine && Math.abs(engine.state - S.net) < 0.3) {
        const n = net.field.nodes[hot], p = engine.project(S.net, n.x, n.y), rr = Math.max(9, n.r * engine.anchorOf(S.net)[2] + 7);
        target = { left: p.x - rr, top: p.y - rr, width: rr * 2, height: rr * 2 };
      }
      let tx, ty, tw, th, k;
      if (target) { const pad = 6; tx = target.left - pad; ty = target.top - pad; tw = target.width + pad * 2; th = target.height + pad * 2; k = 0.24; }
      else { const s = down ? K * 0.65 : K; tx = px - s / 2; ty = py - s / 2; tw = th = s; k = 0.32; }
      cur.x += (tx - cur.x) * k; cur.y += (ty - cur.y) * k; cur.w += (tw - cur.w) * k; cur.h += (th - cur.h) * k;
      box.style.transform = `translate3d(${cur.x}px, ${cur.y}px, 0)`;
      box.style.width = `${cur.w}px`; box.style.height = `${cur.h}px`;
      dot.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      kern.classList.toggle('is-locked', !!target);
      kern.classList.toggle('is-light', lampHeld && !target);

      cells.forEach((c, i) => {
        c.style.opacity = target ? (i % 2 === 0 && i !== 4 ? 1 : 0) : i === 4 ? 1 : (0.22 + 0.78 * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 2.1))).toFixed(2);
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------ smooth scroll + text */
  function setupScroll() {
    if (hasGsap) gsap.registerPlugin(ScrollTrigger, SplitText);
    if (hasGsap && window.Lenis && !reduced) {
      lenis = new Lenis({ lerp: 0.1 });
      lenis.on('scroll', ({ scroll }) => { onScroll(scroll); ScrollTrigger.update(); });
      gsap.ticker.add((t) => lenis.raf(t * 1000));
      gsap.ticker.lagSmoothing(0);
    } else addEventListener('scroll', () => onScroll(scrollY), { passive: true });

    $$('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      const t = id.length > 1 && $(id);
      if (!t) return;
      e.preventDefault();
      setMenu(false);
      release();
      if (lenis) lenis.scrollTo(id === '#top' ? 0 : t, { duration: 1.8 });
      else t.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    }));
    dlg.addEventListener('close', () => lenis && lenis.start());
    new MutationObserver(() => { if (dlg.open && lenis) lenis.stop(); }).observe(dlg, { attributes: true, attributeFilter: ['open'] });
  }

  function revealPubs() {
    if (reduced) return;
    gsap.utils.toArray('.pub').forEach((el) => gsap.from(el, {
      y: 40, opacity: 0, duration: 1.1, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
    }));
  }

  function reveals() {
    if (!hasGsap || reduced) return;
    $$('[data-split]').forEach((el) => SplitText.create(el, {
      type: 'lines', mask: 'lines', autoSplit: true, linesClass: 'split-line',
      onSplit: (self) => gsap.from(self.lines, { yPercent: 105, duration: 1.2, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: el, start: 'top 88%', once: true } }),
    }));
    $$('.step > :not(.step__stage):not([data-split]), .about__story p, .about__record div, .honours li, .contact > *:not(.section-head), .contact .section-head > p').forEach((el) => gsap.from(el, {
      y: 28, opacity: 0, duration: 1, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
    }));
  }

  function intro() {
    if (engine && !gen) engine.playIntro();
    if (gen) {
      gen.play();
      const wait = () => {
        if (!gen.done) { requestAnimationFrame(wait); return; }
        handOver();
        setTimeout(release, 900);
      };
      wait();
    } else release();
    if (!hasGsap || reduced) return;
    const name = SplitText.create('.hero__name', { type: 'lines', mask: 'lines', linesClass: 'split-line' });
    gsap.timeline()
      .from(name.lines, { yPercent: 110, duration: 1.4, ease: 'expo.out', stagger: 0.1 }, 0.1)
      .from('.hero__lede, .hero__links li, .hero__where', { y: 20, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.05 }, 0.4)
      .from('.nav > *', { opacity: 0, duration: 1 }, 0.3);
  }

  /* ------------------------------------------------------------ lab: compare concepts (only with ?lab in the address) */
  function lab() {
    let back = null;
    try { back = sessionStorage.getItem('sa-lab-scroll'); sessionStorage.removeItem('sa-lab-scroll'); } catch (e) { /* private */ }
    if (back !== null) {
      release();
      const y = +back;
      setTimeout(() => { if (lenis) lenis.scrollTo(y, { immediate: true }); else scrollTo(0, y); measure(); }, 50);
    }
    if (!params.has('lab')) return;
    const opts = [
      ['concept', ['points', 'patches', 'ink', 'lens'], CONCEPT],
      ...(CONCEPT === 'points' ? [['points', ['dots', 'pixels', 'marks', 'hatch'], params.get('points') || 'dots'], ['flow', ['swirl', 'diffuse', 'scan'], params.get('flow') || 'swirl']] : []),
    ];
    const el = document.createElement('div');
    el.className = 'lab';
    el.innerHTML = opts.map(([key, values, cur]) => `<div class="lab__row"><span>${key}</span>${values.map((v) => `<button type="button" data-k="${key}" data-v="${v}" aria-pressed="${v === cur}">${v}</button>`).join('')}</div>`).join('')
      + `<div class="lab__row"><span>status</span><em class="lab__status">${CONCEPT === 'points' ? 'ready' : 'waiting…'}</em><button type="button" class="lab__go">Research ↓</button></div>`;
    const status = el.querySelector('.lab__status');
    labStatus = (text, bad) => { status.textContent = text; status.classList.toggle('is-bad', !!bad); };
    if (conceptStarted) labStatus(concept ? 'ready · scroll through Research' : 'loading…');
    addEventListener('error', (ev) => labStatus('error: ' + ev.message, true));
    addEventListener('unhandledrejection', (ev) => labStatus('error: ' + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason), true));
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.lab__go')) {
        release();
        const t = $('#research');
        if (lenis) lenis.scrollTo(t, { duration: 1.6 }); else t.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      const b = ev.target.closest('button');
      if (!b) return;
      const q = new URLSearchParams(location.search);
      q.set(b.dataset.k, b.dataset.v);
      if (b.dataset.k === 'concept' && b.dataset.v !== 'points') { q.delete('points'); q.delete('flow'); }
      try { sessionStorage.setItem('sa-lab-scroll', String(scrollY)); } catch (e) { /* private */ }
      location.search = q.toString().replace(/=(&|$)/g, '$1');
    });
    document.body.appendChild(el);
  }

  /* ------------------------------------------------------------ boot */
  async function boot() {
    setupScroll();
    if (engine) {
      await startGenerator();
      engine.start();
      if (CONCEPT !== 'points') { if (params.has('lab')) startConcept(); else later(startConcept); }
      await seedScenes();
      later(async () => { Object.assign(raw, await themeFields(theme())); chain(); });
      later(() => { raw.grid = SA.fields.trapGrid(T); chain(); });
      later(async () => { await buildEnd(); chain(); });
    } else heroImg.classList.add('is-ready');
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2000))]);
    intro();
    reveals();
    SA.works.load(onWorks);
    measure();
    lab();
    if (params.has('debug')) SA.debug = { engine, stateAt, marks: () => marks, lenis: () => lenis, S, L, raw };
    new ResizeObserver(() => measure()).observe($('main'));
    addEventListener('resize', measure);
    addEventListener('load', () => { measure(); hasGsap && ScrollTrigger.refresh(); });
  }
  boot();
})();
