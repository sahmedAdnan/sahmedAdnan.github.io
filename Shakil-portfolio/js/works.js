/* =============================================================
   Publications pipeline
   ORCID decides WHICH works are mine (the record I maintain),
   OpenAlex adds authors, venues, citations and abstracts, and
   Crossref fills in new works OpenAlex has not indexed yet.
   A new work added to ORCID appears here, with its co-authors in
   the network, without touching the site.
   Works in the browser and in Node (tools/snapshot.mjs).
   ============================================================= */
(function (root) {
  'use strict';
  const SA = (root.SA = root.SA || {});

  const ORCID = '0000-0001-6366-4881';
  // Works that belong here but are not on the ORCID record (yet). Skipped automatically
  // once ORCID lists the same DOI or title.
  const EXTRA_DOIS = [];
  // Some repositories store names surname-first; show them the way the people write them.
  const ALIASES = {
    'pedersen christian nørgaard storm': 'Christian N. S. Pedersen',
    'christian nørgaard storm pedersen': 'Christian N. S. Pedersen',
    'helsing-nielsen flemming': 'Flemming Helsing-Nielsen',
  };
  const alias = (n) => ALIASES[(n || '').toLowerCase().trim()] || n;
  const ME_NAME = 'shakil ahmed';
  const CACHE_KEY = 'sa-works-v6';
  const CACHE_MS = 12 * 3600 * 1000;
  const SELECT = 'id,doi,display_name,publication_year,publication_date,type,cited_by_count,counts_by_year,authorships,primary_location,abstract_inverted_index';

  const TYPES = {
    article: 'Journal article', 'journal-article': 'Journal article',
    'conference-paper': 'Conference paper', 'proceedings-article': 'Conference paper',
    'book-chapter': 'Book chapter', dataset: 'Dataset', 'data-set': 'Dataset',
    preprint: 'Preprint', 'posted-content': 'Preprint', dissertation: 'Thesis', review: 'Review',
  };

  const cleanDoi = (d) => (d || '').toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '').trim();
  const normName = (n) => (n || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\b(md|mohammad|mohammed|muhammad)\b\.?/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const fixText = (s) => (s || '').replace(/�/g, '’').replace(/\s+/g, ' ').trim();

  function abstractFrom(inv) {
    if (!inv) return '';
    const words = [];
    for (const [w, ps] of Object.entries(inv)) for (const p of ps) words[p] = w;
    return fixText(words.join(' '));
  }

  /* --- ORCID: the list of works I claim --- */
  async function orcidWorks(fetchImpl) {
    const r = await fetchImpl(`https://pub.orcid.org/v3.0/${ORCID}/works`, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('ORCID ' + r.status);
    const j = await r.json();
    return (j.group || []).map((g) => {
      const s = g['work-summary'][0];
      const ids = ((s['external-ids'] || {})['external-id'] || []);
      const doi = ids.find((e) => e['external-id-type'] === 'doi');
      const pd = s['publication-date'] || {};
      return {
        doi: doi ? cleanDoi(doi['external-id-value']) : null,
        title: fixText(s.title && s.title.title && s.title.title.value),
        year: pd.year ? +pd.year.value : null,
        type: s.type,
        venue: fixText(s['journal-title'] && s['journal-title'].value),
      };
    });
  }

  /* --- OpenAlex: details for those DOIs --- */
  async function openAlexByDoi(dois, fetchImpl) {
    if (!dois.length) return [];
    const url = `https://api.openalex.org/works?filter=doi:${dois.join('|')}&per-page=100&select=${SELECT}&mailto=ahshakil.au@gmail.com`;
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error('OpenAlex ' + r.status);
    return (await r.json()).results || [];
  }

  /* A DOI on ORCID can differ from the one OpenAlex indexes (Zenodo version vs concept DOIs,
     for example). Then look the work up by title, limited to works by this ORCID. */
  async function openAlexByTitle(title, fetchImpl) {
    const q = (title || '').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 10).join(' ');
    if (!q) return null;
    const url = `https://api.openalex.org/works?filter=author.orcid:${ORCID},title.search:${encodeURIComponent(q)}&per-page=1&select=${SELECT}&mailto=ahshakil.au@gmail.com`;
    try {
      const r = await fetchImpl(url);
      return r.ok ? ((await r.json()).results || [])[0] || null : null;
    } catch (e) { return null; }
  }

  /* A new work can take OpenAlex days to index; the DOI registry has its authors from the day it
     is published. Free, with no daily budget (Zenodo's DataCite DOIs are not in it). */
  async function crossrefByDoi(doi, fetchImpl) {
    try {
      const r = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
      return r.ok ? (await r.json()).message || null : null;
    } catch (e) { return null; }
  }
  function fromCrossref(o, m) {
    const parts = ((m.posted || m['published-online'] || m['published-print'] || m.issued || {})['date-parts'] || [[]])[0];
    const date = parts && parts[0] ? [parts[0], parts[1] || 1, parts[2] || 1].map((v, i) => String(v).padStart(i ? 2 : 4, '0')).join('-') : '';
    return {
      doi: o.doi,
      doiAlt: null,
      url: `https://doi.org/${o.doi}`,
      title: fixText((m.title || [])[0] || o.title),
      year: parts && parts[0] ? +parts[0] : o.year,
      date: date || (o.year ? `${o.year}-01-01` : ''),
      type: TYPES[m.subtype || m.type] || TYPES[o.type] || 'Publication',
      venue: fixText((m['container-title'] || [])[0] || ((m.institution || [])[0] || {}).name || o.venue),
      authors: (m.author || []).map((a) => {
        const name = alias(fixText(a.name || [a.given, a.family].filter(Boolean).join(' ')));
        const orcid = a.ORCID ? a.ORCID.replace(/^https?:\/\/orcid\.org\//, '') : null;
        return { id: null, orcid, name, me: orcid === ORCID || normName(name) === ME_NAME };
      }),
      cites: m['is-referenced-by-count'] || 0,
      citesByYear: [],
      abstract: fixText((m.abstract || '').replace(/<[^>]+>/g, ' ').replace(/^\s*Abstract\s+/i, '')),
    };
  }

  /* when OpenAlex cannot be reached (it rate-limits), a work keeps what we knew about it before */
  function remembered(prev) {
    const m = new Map();
    ((prev && prev.works) || []).forEach((w) => { if (w.doi) m.set(w.doi, w); if (w.doiAlt) m.set(w.doiAlt, w); m.set('t:' + (w.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60), w); });
    return m;
  }
  const titleKey = (t) => (t || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
  const recall = (before, o) => (o.doi && before.get(o.doi)) || before.get('t:' + titleKey(o.title));
  function merge(orcid, oa, byTitle = new Map(), before = new Map(), byCrossref = new Map()) {
    const byDoi = new Map(oa.map((w) => [cleanDoi(w.doi), w]));
    const known = new Set(orcid.map((o) => o.doi).filter(Boolean));
    const knownTitles = new Set(orcid.map((o) => titleKey(o.title)));
    const extras = EXTRA_DOIS.map(cleanDoi)
      .filter((d) => !known.has(d) && byDoi.has(d) && !knownTitles.has(titleKey(byDoi.get(d).display_name)))
      .map((d) => ({ doi: d, title: '', year: null, type: null, venue: '' }));
    return orcid.concat(extras).map((o) => {
      const w = (o.doi && byDoi.get(o.doi)) || byTitle.get(o);
      const old = !w && recall(before, o);
      if (old) return { ...old, doi: o.doi || old.doi, url: o.doi ? `https://doi.org/${o.doi}` : old.url };
      if (!w && byCrossref.has(o)) return fromCrossref(o, byCrossref.get(o));
      const authors = w ? w.authorships.map((a) => ({
        id: a.author.id ? a.author.id.split('/').pop() : null,
        orcid: a.author.orcid ? a.author.orcid.replace(/^https?:\/\/orcid\.org\//, '') : null,
        name: alias(fixText(a.author.display_name)),
        me: (a.author.orcid || '').endsWith(ORCID) || normName(a.author.display_name) === ME_NAME,
      })) : [{ id: null, name: 'Shakil Ahmed', me: true }];
      const src = w && w.primary_location && w.primary_location.source;
      return {
        doi: o.doi,
        doiAlt: w && cleanDoi(w.doi) !== o.doi ? cleanDoi(w.doi) : null,
        url: o.doi ? `https://doi.org/${o.doi}` : null,
        title: fixText((w && w.display_name) || o.title),
        year: (w && w.publication_year) || o.year,
        date: (w && w.publication_date) || (o.year ? `${o.year}-01-01` : ''),
        type: TYPES[(w && w.type) || o.type] || 'Publication',
        venue: fixText((src && src.display_name) || o.venue),
        authors,
        cites: w ? w.cited_by_count || 0 : 0,
        citesByYear: w ? (w.counts_by_year || []).map((c) => [c.year, c.cited_by_count]).sort((a, b) => a[0] - b[0]) : [],
        abstract: w ? abstractFrom(w.abstract_inverted_index) : '',
      };
    }).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  async function fetchLive(fetchImpl = root.fetch.bind(root), prev = null) {
    const orcid = await orcidWorks(fetchImpl);
    const dois = orcid.map((o) => o.doi).filter(Boolean).concat(EXTRA_DOIS.map(cleanDoi));
    let oa = [], partial = false;
    try { oa = await openAlexByDoi(dois, fetchImpl); } catch (e) { partial = true; /* ORCID alone still lists the works */ }
    const found = new Set(oa.map((w) => cleanDoi(w.doi)));
    // works OpenAlex did not return: keep what we knew; otherwise ask the DOI registry, and only
    // then search OpenAlex by title (ten times the cost of the lookup above)
    const before = remembered(prev);
    const missing = orcid.filter((o) => (!o.doi || !found.has(o.doi)) && !recall(before, o));
    const byTitle = new Map(), byCrossref = new Map();
    await Promise.all(missing.map(async (o) => {
      const c = o.doi && (await crossrefByDoi(o.doi, fetchImpl));
      if (c) { byCrossref.set(o, c); return; }
      const w = partial ? null : await openAlexByTitle(o.title, fetchImpl);
      if (w) byTitle.set(o, w);
    }));
    return { fetchedAt: Date.now(), partial, works: merge(orcid, oa, byTitle, before, byCrossref) };
  }

  /* --- Co-author graph: me, my papers, and the people on them --- */
  function graph(works) {
    const nodes = [{ key: 'me', kind: 'me', name: 'Shakil Ahmed', papers: [] }];
    // one node per person: matched by ORCID first, since sources spell names differently
    const byOrcid = new Map(), byName = new Map();
    const links = [];
    let people = 0;
    works.forEach((w, wi) => {
      const pk = 'w' + wi;
      nodes.push({ key: pk, kind: 'paper', work: w, name: w.title, year: w.year });
      links.push({ a: 'me', b: pk });
      nodes[0].papers.push(w);
      w.authors.forEach((a) => {
        if (a.me) return;
        const nk = normName(a.name);
        let n = (a.orcid && byOrcid.get(a.orcid)) || byName.get(nk);
        if (!n) {
          n = { key: 'p:' + nk, kind: 'person', name: a.name, papers: [] };
          nodes.push(n);
          people++;
        }
        if (a.orcid) byOrcid.set(a.orcid, n);
        byName.set(nk, n);
        if (n.papers.includes(w)) return;
        n.papers.push(w);
        n.orcid = n.orcid || a.orcid; n.id = n.id || a.id;
        links.push({ a: n.key, b: pk });
      });
    });
    return { nodes, links, people };
  }

  /* --- Browser loader: snapshot → cache → live --- */
  function readCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return c && c.works ? c : null;
    } catch (e) { return null; }
  }

  async function load(onData) {
    const snap = SA.worksSnapshot;
    const cached = readCache();
    const first = cached && (!snap || cached.fetchedAt >= snap.fetchedAt) ? cached : snap;
    if (first) onData(first, 'cache');
    if (cached && Date.now() - cached.fetchedAt < CACHE_MS) return;
    try {
      const live = await fetchLive(undefined, first);
      if (!live.works.length) return;
      // a partial answer (OpenAlex unreachable) is shown, but never kept
      if (!live.partial) try { localStorage.setItem(CACHE_KEY, JSON.stringify(live)); } catch (e) { /* private mode */ }
      const sig = (d) => d && d.works.map((w) => w.doi + w.cites + w.authors.length).join();
      if (sig(live) !== sig(first)) onData(live, 'live');
      else onData(live, 'fresh');
    } catch (e) { /* keep the snapshot */ }
  }

  SA.works = { ORCID, fetchLive, load, graph, normName };
})(typeof window !== 'undefined' ? window : globalThis);
