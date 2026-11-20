// UMAP (McInnes, Healy and Melville, 2018), small and dependency-free so the pages stay self-contained.
// In: each point's k nearest neighbours (indices and distances). Out: positions in `dims` dimensions.
// Follows umap-learn's steps: smooth kNN distances -> fuzzy graph -> symmetrise -> SGD with negative sampling.
// Seeded through `random`, so the same input always lands in the same shape.

const clip = (x) => (x > 4 ? 4 : x < -4 ? -4 : x);

// a, b for the curve 1 / (1 + a d^(2b)), fitted so it is ~1 inside minDist and decays like exp(-(d - minDist) / spread) beyond.
export function curveParams(minDist, spread = 1) {
  const xs = Array.from({ length: 300 }, (_, i) => ((i + 1) / 300) * spread * 3);
  const ys = xs.map((x) => (x < minDist ? 1 : Math.exp(-(x - minDist) / spread)));
  const err = (a, b) => xs.reduce((s, x, i) => s + (1 / (1 + a * x ** (2 * b)) - ys[i]) ** 2, 0);
  let best = [1, 1], e = err(1, 1);
  for (let step = 0.5; step > 1e-4; step /= 2) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const [da, db] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const a = best[0] + da, b = best[1] + db;
        if (a <= 0 || b <= 0) continue;
        const v = err(a, b);
        if (v < e) { e = v; best = [a, b]; moved = true; }
      }
    }
  }
  return { a: best[0], b: best[1] };
}

// Per point: rho = distance to its nearest neighbour, sigma chosen so the neighbour weights sum to log2(k).
export function smoothKnn(dists) {
  return dists.map((row) => {
    const k = row.length;
    const target = Math.log2(Math.max(2, k));
    const pos = row.filter((d) => d > 0);
    const rho = pos.length ? pos.reduce((m, d) => (d < m ? d : m), Infinity) : 0;
    let lo = 0, hi = Infinity, sigma = 1;
    for (let it = 0; it < 64; it++) {
      let s = 0;
      for (const d of row) s += d - rho > 0 ? Math.exp(-(d - rho) / sigma) : 1;
      if (Math.abs(s - target) < 1e-5) break;
      if (s > target) { hi = sigma; sigma = (lo + hi) / 2; } else { lo = sigma; sigma = hi === Infinity ? sigma * 2 : (lo + hi) / 2; }
    }
    const mean = row.reduce((a, d) => a + d, 0) / Math.max(1, k);
    return { rho, sigma: Math.max(sigma, 1e-3 * mean) };
  });
}

// Fuzzy union of the directed neighbour graphs: w_ij + w_ji - w_ij * w_ji. Returns undirected edges [i, j, w].
export function fuzzyGraph(knnIdx, knnDist) {
  const s = smoothKnn(knnDist);
  const w = new Map();
  knnIdx.forEach((row, i) => row.forEach((j, c) => {
    if (j === i) return;
    const d = knnDist[i][c] - s[i].rho;
    w.set(`${i}|${j}`, d > 0 ? Math.exp(-d / s[i].sigma) : 1);
  }));
  const out = [];
  for (const [key, a] of w) {
    const [i, j] = key.split('|').map(Number);
    const b = w.get(`${j}|${i}`) ?? 0;
    if (b && j < i) continue; // the pair is counted once, from its smaller end
    out.push([i, j, a + b - a * b]);
  }
  return out;
}

export function umap(knnIdx, knnDist, { dims = 3, minDist = 0.5, spread = 1, epochs = 300, negativeSamples = 5, random = Math.random } = {}) {
  const n = knnIdx.length;
  const { a, b } = curveParams(minDist, spread);
  const edges = fuzzyGraph(knnIdx, knnDist);
  const wMax = edges.reduce((m, e) => (e[2] > m ? e[2] : m), 0); // not Math.max(...): big maps overflow the call stack
  // Both directions, as umap-learn does; edges too weak to be sampled even once are dropped.
  const head = [], tail = [], every = [];
  for (const [i, j, w] of edges) {
    if (w < wMax / epochs) continue;
    for (const [h, t] of [[i, j], [j, i]]) { head.push(h); tail.push(t); every.push(wMax / w); }
  }
  const Y = Array.from({ length: n }, () => Array.from({ length: dims }, () => random() * 20 - 10));
  const next = every.slice();
  const everyNeg = every.map((x) => x / negativeSamples);
  const nextNeg = everyNeg.slice();
  for (let ep = 0; ep < epochs; ep++) {
    const alpha = 1 - ep / epochs;
    for (let e = 0; e < head.length; e++) {
      if (next[e] > ep) continue;
      const cur = Y[head[e]], oth = Y[tail[e]];
      let d2 = 0;
      for (let k = 0; k < dims; k++) d2 += (cur[k] - oth[k]) ** 2;
      const ga = d2 > 0 ? (-2 * a * b * d2 ** (b - 1)) / (a * d2 ** b + 1) : 0;
      for (let k = 0; k < dims; k++) {
        const g = clip(ga * (cur[k] - oth[k])) * alpha;
        cur[k] += g; oth[k] -= g;
      }
      next[e] += every[e];
      const negs = Math.floor((ep - nextNeg[e]) / everyNeg[e]);
      for (let p = 0; p < negs; p++) {
        const r = Math.floor(random() * n);
        if (r === head[e]) continue;
        const o = Y[r];
        let q2 = 0;
        for (let k = 0; k < dims; k++) q2 += (cur[k] - o[k]) ** 2;
        const gr = q2 > 0 ? (2 * b) / ((0.001 + q2) * (a * q2 ** b + 1)) : 0;
        for (let k = 0; k < dims; k++) cur[k] += (gr > 0 ? clip(gr * (cur[k] - o[k])) : 4) * alpha;
      }
      nextNeg[e] += negs * everyNeg[e];
    }
  }
  return Y;
}

// Exact k nearest neighbours by cosine distance over sparse vectors (Map key -> weight).
// Points that share nothing with enough others are padded with seeded far neighbours (distance 1).
export function cosineKnn(vectors, k, random = Math.random) {
  const n = vectors.length;
  const norm = vectors.map((v) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1);
  const post = new Map();
  vectors.forEach((v, i) => { for (const [key, x] of v) { const l = post.get(key) ?? []; l.push([i, x]); post.set(key, l); } });
  const idx = [], dist = [];
  for (let i = 0; i < n; i++) {
    const dot = new Map();
    for (const [key, x] of vectors[i]) for (const [j, y] of post.get(key)) if (j !== i) dot.set(j, (dot.get(j) ?? 0) + x * y);
    const near = [...dot.entries()].map(([j, d]) => [j, Math.max(0, 1 - d / (norm[i] * norm[j]))]).sort((p, q) => p[1] - q[1] || p[0] - q[0]).slice(0, k);
    const have = new Set(near.map(([j]) => j));
    for (let tries = 0; near.length < Math.min(k, n - 1) && tries < 50 * k; tries++) {
      const j = Math.floor(random() * n);
      if (j !== i && !have.has(j)) { have.add(j); near.push([j, 1]); }
    }
    idx.push(near.map(([j]) => j));
    dist.push(near.map(([, d]) => d));
  }
  return { idx, dist };
}

// How well a layout keeps each point's neighbours: the share of its `m` nearest in the data that are among its `m` nearest on the map.
export function neighboursKept(knnIdx, pos, m = 10) {
  const n = pos.length;
  let kept = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const want = knnIdx[i].slice(0, m);
    if (!want.length) continue;
    const near = new Set(pos.map((p, j) => [j, (p[0] - pos[i][0]) ** 2 + (p[1] - pos[i][1]) ** 2 + (p[2] - pos[i][2]) ** 2])
      .filter(([j]) => j !== i).sort((p, q) => p[1] - q[1]).slice(0, want.length).map(([j]) => j));
    kept += want.filter((j) => near.has(j)).length;
    total += want.length;
  }
  return total ? kept / total : 0;
}

// Mean silhouette of the labelled points (label >= 0): near 1 = groups sit apart, near 0 = they blur together.
export function separation(pos, labels) {
  const ids = labels.map((l, i) => [l, i]).filter(([l]) => l >= 0).map(([, i]) => i);
  const groups = [...new Set(ids.map((i) => labels[i]))];
  if (groups.length < 2) return 0;
  const d = (i, j) => Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1], pos[i][2] - pos[j][2]);
  let s = 0, c = 0;
  for (const i of ids) {
    const mean = new Map();
    for (const j of ids) if (j !== i) { const m = mean.get(labels[j]) ?? [0, 0]; m[0] += d(i, j); m[1]++; mean.set(labels[j], m); }
    const own = mean.get(labels[i]);
    if (!own) continue;
    const a = own[0] / own[1];
    let b = Infinity;
    for (const [g, [t, k]] of mean) if (g !== labels[i]) b = Math.min(b, t / k);
    s += (b - a) / Math.max(a, b); c++;
  }
  return c ? s / c : 0;
}
