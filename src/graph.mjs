// Pure functions: library + similarity lists in, a public-safe map out. No network, no secrets.

export const keyOf = (name) => String(name).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

// library: [{ name, weight }]; similar: { [key]: [{ name, match }] }; tags: { [key]: [tag, ...] }
export function buildGraph({ library, similar, tags }, cfg) {
  const g = cfg.graph;
  const minMatch = cfg.lastfm.min_match;
  const lib = [...library].sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name)).slice(0, g.max_library_nodes);
  const maxW = Math.max(1, ...lib.map((a) => a.weight));
  const nodes = lib.map((a) => ({ name: a.name, key: keyOf(a.name), w: a.weight / maxW, rec: false }));
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

  const recs = [...cand.entries()]
    .filter(([, c]) => c.from.size >= g.recommend_min_links)
    .sort((a, b) => b[1].score - a[1].score || a[1].name.localeCompare(b[1].name))
    .slice(0, g.recommend_count);
  const because = [];
  for (const [k, c] of recs) {
    const i = nodes.length;
    nodes.push({ name: c.name, key: k, w: 0.35, rec: true });
    index.set(k, i);
    for (const [j, m] of c.from) addEdge(i, j, m);
    because.push({ i, from: [...c.from.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([j]) => j) });
  }

  // Colour by each artist's leading Last.fm tag; the most common tags get colours, the rest are "other".
  const skip = new Set(cfg.lastfm.tag_skip.map(keyOf));
  const first = nodes.map((n) => (tags[n.key] ?? []).map(keyOf).find((t) => t && !skip.has(t)) ?? null);
  const counts = new Map();
  first.forEach((t) => t && counts.set(t, (counts.get(t) ?? 0) + 1));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, g.max_tags).map(([t]) => t);
  const tagIndex = new Map(top.map((t, i) => [t, i]));
  nodes.forEach((n, i) => { n.t = tagIndex.has(first[i]) ? tagIndex.get(first[i]) : -1; });

  const edgeList = [...edges.entries()].map(([k, m]) => { const [i, j] = k.split('|').map(Number); return [i, j, m]; });
  const pos = layout(nodes, edgeList, g);
  return {
    nodes: nodes.map((n, i) => ({ n: n.name, w: round(n.w), t: n.t, r: n.rec, p: pos[i].map(round) })),
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
