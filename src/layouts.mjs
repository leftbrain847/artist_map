// Extra layouts for the same map, built after buildGraph from its output and the Last.fm data.
// The page shows the main layout; ?layout=<name> swaps in one of these. Pure functions: no network, no secrets.
import { keyOf, rng } from './graph.mjs';
import { umap, cosineKnn, neighboursKept, separation } from './umap.mjs';

export const LAYOUT_NAME = /^[a-z0-9_]{1,24}$/;

// Each artist as a sparse vector: itself, the artists Last.fm calls similar (weighted by match), and its tags by rank.
// Library artists use their own similar list; artists to try use their links into the library.
export function artistVectors(g, { similar, tags }, cfg) {
  const u = cfg.graph.umap;
  const skip = new Set(cfg.lastfm.tag_skip.map(keyOf));
  const from = new Map(g.because.map((b) => [b.i, b.from]));
  return g.nodes.map((nd, i) => {
    const key = keyOf(nd.n);
    const sim = new Map([[`a:${key}`, 1]]);
    if (nd.r) for (const [j, m] of from.get(i) ?? []) sim.set(`a:${keyOf(g.nodes[j].n)}`, m);
    else for (const s of similar[key] ?? []) if (s.match > 0) { const k = `a:${keyOf(s.name)}`; sim.set(k, Math.max(sim.get(k) ?? 0, s.match)); }
    const tag = new Map();
    (tags[key] ?? []).map(keyOf).filter((t) => t && t.length <= 40 && !skip.has(t)).slice(0, u.tag_rank_weights.length)
      .forEach((t, r) => tag.set(`t:${t}`, u.tag_rank_weights[r]));
    return blend(sim, tag, u.tag_weight);
  });
}

const size = (m) => Math.sqrt([...m.values()].reduce((s, x) => s + x * x, 0)) || 1;
function blend(a, b, w) {
  const out = new Map();
  const na = size(a), nb = size(b);
  for (const [k, x] of a) out.set(k, ((b.size ? 1 - w : 1) * x) / na);
  for (const [k, x] of b) out.set(k, (w * x) / nb);
  return out;
}

// Centre on the middle, scale so 95% of artists sit within radius 100, and pull far stragglers in to 110.
export function fitToMap(Y) {
  const n = Y.length;
  if (!n) return [];
  const c = [0, 1, 2].map((d) => Y.reduce((s, p) => s + p[d], 0) / n);
  const r = Y.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2])).sort((a, b) => a - b);
  const scale = 100 / (r[Math.min(n - 1, Math.floor(n * 0.95))] || 1);
  return Y.map((p) => {
    const v = p.map((x, d) => (x - c[d]) * scale);
    const len = Math.hypot(...v);
    const k = len > 110 ? 110 / len : 1;
    return v.map((x) => Math.round(x * k * 1000) / 1000);
  });
}

export function umapPositions(vectors, neighbors, cfg) {
  const g = cfg.graph, u = g.umap;
  if (vectors.length < 4) return vectors.map(() => [0, 0, 0]);
  const k = Math.max(2, Math.min(neighbors, vectors.length - 1));
  const kn = cosineKnn(vectors, k, rng(g.seed));
  return fitToMap(umap(kn.idx, kn.dist, { minDist: u.min_dist, epochs: u.epochs, negativeSamples: u.negative_samples, random: rng(g.seed + 1) }));
}

// Every configured extra layout, plus numbers for the build log: how long each took, how many of each library
// artist's 10 closest artists it kept close on the map, and how far apart the genres sit. Counts only, never names.
export function extraLayouts(g, lf, cfg, now = () => Date.now()) {
  const wanted = Object.entries(cfg.graph.extra_layouts ?? {});
  if (!wanted.length) return { layouts: null, report: [] };
  const vectors = artistVectors(g, lf, cfg);
  const lib = g.nodes.map((nd, i) => i).filter((i) => !g.nodes[i].r);
  const close = cosineKnn(lib.map((i) => vectors[i]), 10, rng(cfg.graph.seed)).idx; // among library artists only
  const labels = g.nodes.map((nd) => (nd.r ? -1 : nd.t));
  const layouts = {}, report = [];
  for (const [name, spec] of wanted) {
    if (!LAYOUT_NAME.test(name)) throw new Error(`layout name "${name}" must be lowercase letters, digits or _`);
    if (spec.kind !== 'umap') throw new Error(`layout "${name}": unknown kind "${spec.kind}"`);
    const t = now();
    layouts[name] = umapPositions(vectors, spec.neighbors, cfg);
    report.push({ name, neighbors: spec.neighbors, ms: now() - t, kept: neighboursKept(close, lib.map((i) => layouts[name][i])), separation: separation(layouts[name], labels) });
  }
  return { layouts, report };
}
