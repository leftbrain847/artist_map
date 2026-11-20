// Pure functions: library + similarity lists in, a public-safe map out. No network, no secrets.

export const keyOf = (name) => String(name).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

// library: [{ name, weight }]; similar: { [key]: [{ name, match }] }; tags: { [key]: [tag, ...] }
export function buildGraph({ library, similar, tags }, cfg) {
  const g = cfg.graph;
  const minMatch = cfg.lastfm.min_match;
  const lib = [...library].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, g.max_library_nodes);
  const maxW = Math.max(1, ...lib.map((a) => a.weight));
  const nodes = lib.map((a) => ({ name: a.name, key: keyOf(a.name), w: a.weight / maxW, rec: false, songs: a.songs ?? 0, first: a.first ?? null }));
  const index = new Map(nodes.map((n, i) => [n.key, i]));

  const edges = new Map(); // "i|j" -> match
  const addEdge = (i, j, m) => {
    if (i === j) return;
    const k = i < j ? `${i}|${j}` : `${j}|${i}`;
    if ((edges.get(k) ?? 0) < m) edges.set(k, m);
  };

  // Library-to-library links, and scores for artists not in the library.
  const cand = new Map(); // key -> { name, score, from: Set<i> }
  nodes.forEach((n, i) => {
    for (const s of similar[n.key] ?? []) {
      if (!(s.match >= minMatch)) continue;
      const k = keyOf(s.name);
      if (index.has(k)) { addEdge(i, index.get(k), s.match); continue; }
      const c = cand.get(k) ?? { name: s.name, score: 0, from: new Map() };
      c.score += s.match * (0.5 + n.w / 2);
      c.from.set(i, Math.max(c.from.get(i) ?? 0, s.match));
      cand.set(k, c);
    }
  });

  // Keep a pool of candidates; the page picks which to suggest for whatever genres or artist are selected.
  const ranked = [...cand.entries()]
    .filter(([, c]) => c.from.size >= g.candidate_min_links)
    .sort((a, b) => b[1].score - a[1].score || a[1].name.localeCompare(b[1].name));
  // The best overall, plus each artist's own closest few, so tapping any artist has something new near it.
  const keep = new Set(ranked.slice(0, g.candidate_pool).map(([k]) => k));
  const best = new Map();
  for (const [k, c] of ranked) for (const [i, m] of c.from) { const l = best.get(i) ?? []; l.push([m, k]); best.set(i, l); }
  for (const l of best.values()) l.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1])).slice(0, g.per_artist_candidates).forEach(([, k]) => keep.add(k));
  const pool = ranked.filter(([k]) => keep.has(k)).slice(0, g.candidate_cap);
  const because = [];
  for (const [k, c] of pool) {
    const i = nodes.length;
    nodes.push({ name: c.name, key: k, w: 0.3, rec: true });
    index.set(k, i);
    for (const [j, m] of c.from) addEdge(i, j, m);
    because.push({ i, from: [...c.from.entries()].sort((a, b) => b[1] - a[1]).map(([j, m]) => [j, round(m)]) });
  }

  // Colour by genre: each artist takes the first of its Last.fm tags that is among the most common ones.
  const skip = new Set(cfg.lastfm.tag_skip.map(keyOf));
  const own = nodes.map((n) => (tags[n.key] ?? []).map(keyOf).filter((t) => t && t.length <= 40 && !skip.has(t)));
  const counts = new Map();
  own.forEach((ts) => ts[0] && counts.set(ts[0], (counts.get(ts[0]) ?? 0) + 1));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, g.max_tags).map(([t]) => t);
  const tagIndex = new Map(top.map((t, i) => [t, i]));
  nodes.forEach((n, i) => { const t = own[i].find((x) => tagIndex.has(x)); n.t = t === undefined ? -1 : tagIndex.get(t); });

  const edgeList = [...edges.entries()].map(([k, m]) => { const [i, j] = k.split('|').map(Number); return [i, j, m]; });
  // Untagged library artists borrow the genre most of their linked artists have.
  for (let pass = 0; pass < 2; pass++) {
    const votes = nodes.map(() => new Map());
    for (const [i, j, m] of edgeList) {
      if (nodes[j].t >= 0 && !nodes[j].rec) votes[i].set(nodes[j].t, (votes[i].get(nodes[j].t) ?? 0) + m);
      if (nodes[i].t >= 0 && !nodes[i].rec) votes[j].set(nodes[i].t, (votes[j].get(nodes[i].t) ?? 0) + m);
    }
    nodes.forEach((n, i) => { if (n.t < 0 && !n.rec && votes[i].size) n.t = [...votes[i].entries()].sort((a, b) => b[1] - a[1])[0][0]; });
  }

  const pos = g.layout === 'worm' ? wormLayout(nodes, edgeList, top.length, g) : layout(nodes, edgeList, g);
  return {
    nodes: nodes.map((n, i) => ({ n: n.name, w: round(n.w), t: n.t, r: n.rec, p: pos[i].map(round), ...(n.rec ? {} : { s: n.songs, ...(n.first ? { d: n.first } : {}) }) })),
    edges: edgeList.map(([i, j, m]) => [i, j, round(m)]),
    tags: top,
    because,
  };
}

const round = (x) => Math.round(x * 1000) / 1000;

// Seeded so the same library always lands in the same shape.
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Small 3D force layout: nodes repel, links pull, same-tag nodes drift toward their tag's centre.
export function layout(nodes, edges, g) {
  const rand = rng(g.seed);
  const n = nodes.length;
  const p = nodes.map(() => [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1].map((x) => x * 50));
  for (let it = 0; it < g.layout_iterations; it++) {
    const cool = 1 - it / g.layout_iterations;
    const f = p.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = [0, 1, 2].map((k) => p[i][k] - p[j][k]);
      const r2 = Math.max(1, d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
      const s = 400 / r2;
      for (let k = 0; k < 3; k++) { f[i][k] += d[k] * s / Math.sqrt(r2); f[j][k] -= d[k] * s / Math.sqrt(r2); }
    }
    for (const [i, j, m] of edges) {
      const d = [0, 1, 2].map((k) => p[j][k] - p[i][k]);
      const r = Math.hypot(...d) || 1;
      const s = (r - 18) * 0.04 * (0.5 + m);
      for (let k = 0; k < 3; k++) { f[i][k] += d[k] / r * s; f[j][k] -= d[k] / r * s; }
    }
    const centre = new Map();
    nodes.forEach((nd, i) => { if (nd.t >= 0) { const c = centre.get(nd.t) ?? [0, 0, 0, 0]; for (let k = 0; k < 3; k++) c[k] += p[i][k]; c[3]++; centre.set(nd.t, c); } });
    for (let i = 0; i < n; i++) {
      const c = nodes[i].t >= 0 ? centre.get(nodes[i].t) : null;
      for (let k = 0; k < 3; k++) {
        f[i][k] -= p[i][k] * 0.01;
        if (c) f[i][k] += (c[k] / c[3] - p[i][k]) * 0.03;
        p[i][k] += Math.max(-6, Math.min(6, f[i][k])) * (0.2 + cool);
      }
    }
  }
  const scale = Math.max(1, ...p.map((v) => Math.hypot(...v)));
  return p.map((v) => v.map((x) => (x / scale) * 100));
}

// The worm: genres laid end to end along a winding 3D tube, neighbouring genres next to each other,
// so you can follow how one sound shades into the next. Links then pull related artists together a little.
export function wormLayout(nodes, edges, nTags, g) {
  const rand = rng(g.seed);
  const lib = nodes.map((n, i) => i).filter((i) => !nodes[i].rec);
  // Order genres so each one sits next to the genre it shares the most links with.
  const link = Array.from({ length: nTags + 1 }, () => new Array(nTags + 1).fill(0));
  const tg = (i) => (nodes[i].t >= 0 ? nodes[i].t : nTags);
  for (const [i, j, m] of edges) if (!nodes[i].rec && !nodes[j].rec && tg(i) !== tg(j)) { link[tg(i)][tg(j)] += m; link[tg(j)][tg(i)] += m; }
  const size = new Array(nTags + 1).fill(0);
  lib.forEach((i) => size[tg(i)]++);
  const order = [];
  const left = new Set(size.map((c, t) => t).filter((t) => size[t] > 0));
  let cur = [...left].sort((a, b) => size[b] - size[a])[0];
  while (cur !== undefined) {
    order.push(cur); left.delete(cur);
    cur = [...left].sort((a, b) => link[cur][b] - link[cur][a] || size[b] - size[a])[0];
  }
  // Each genre gets a stretch of the tube in proportion to its size.
  const total = lib.length || 1;
  const span = new Map();
  let at = 0;
  for (const t of order) { span.set(t, [at, at + size[t] / total]); at += size[t] / total; }
  const turns = g.worm_turns, len = 200, amp = g.worm_amplitude, tube = g.worm_tube;
  const spine = (u) => [amp * Math.sin(u * Math.PI * 2 * turns), (u - 0.5) * len, amp * 0.7 * Math.cos(u * Math.PI * 2 * turns * 0.8)];
  const u = nodes.map(() => 0.5);
  const p = nodes.map(() => [0, 0, 0]);
  const home = nodes.map(() => [0, 0, 0]);
  const placed = new Map(order.map((t) => [t, 0]));
  lib.sort((a, b) => nodes[b].w - nodes[a].w).forEach((i) => {
    const t = tg(i), [a, b] = span.get(t), k = placed.get(t);
    placed.set(t, k + 1);
    u[i] = a + (b - a) * ((k + 0.5 + (rand() - 0.5) * 0.8) / size[t]);
    const c = spine(u[i]), ang = rand() * Math.PI * 2, rad = tube * Math.sqrt(rand());
    home[i] = [c[0] + Math.cos(ang) * rad, c[1] + (rand() - 0.5) * 3, c[2] + Math.sin(ang) * rad];
    p[i] = home[i].slice();
  });
  // Suggestions sit between the artists that lead to them, a little outside the tube.
  const src = nodes.map(() => []);
  for (const [i, j, m] of edges) { if (nodes[i].rec && !nodes[j].rec) src[i].push([j, m]); if (nodes[j].rec && !nodes[i].rec) src[j].push([i, m]); }
  nodes.forEach((n, i) => {
    if (!n.rec) return;
    const s = src[i].length ? src[i] : [[lib[0], 1]];
    const wsum = s.reduce((a, [, m]) => a + m, 0) || 1;
    const c = [0, 1, 2].map((d) => s.reduce((a, [j, m]) => a + home[j][d] * m, 0) / wsum);
    const ang = rand() * Math.PI * 2;
    home[i] = [c[0] + Math.cos(ang) * tube * 0.6, c[1], c[2] + Math.sin(ang) * tube * 0.6];
    p[i] = home[i].slice();
  });
  // A light relaxation: links pull, each artist is tethered to its spot on the tube.
  // Pull is divided by each artist's total link strength so a well-linked artist can't fly off.
  const deg = nodes.map(() => 0);
  for (const [i, j, m] of edges) { deg[i] += m; deg[j] += m; }
  for (let it = 0; it < g.worm_iterations; it++) {
    const f = p.map(() => [0, 0, 0]);
    for (const [i, j, m] of edges) {
      for (let d = 0; d < 3; d++) { const x = (p[j][d] - p[i][d]) * 0.02 * m; f[i][d] += x; f[j][d] -= x; }
    }
    p.forEach((v, i) => { for (let d = 0; d < 3; d++) v[d] += f[i][d] * 4 / Math.max(4, deg[i]) + (home[i][d] - v[d]) * 0.12; });
  }
  return p;
}
