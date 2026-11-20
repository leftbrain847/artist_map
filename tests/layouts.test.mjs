import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGraph, rng } from '../src/graph.mjs';
import { umap, curveParams, cosineKnn, fuzzyGraph, neighboursKept, separation } from '../src/umap.mjs';
import { extraLayouts, artistVectors } from '../src/layouts.mjs';
import { assertPublicSafe } from '../src/privacy.mjs';
import { build, loadConfig } from '../src/build.mjs';

const cfg = loadConfig();
const fixture = JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url)));
const lf = { similar: fixture.similar, tags: fixture.tags };

// Four made-up groups in 8 dimensions: each point leans hard on its group's two axes.
function groups(perGroup = 15, seed = 4) {
  const r = rng(seed), vecs = [], labels = [];
  for (let gI = 0; gI < 4; gI++) for (let k = 0; k < perGroup; k++) {
    const v = new Map();
    for (let d = 0; d < 8; d++) v.set(d, r() * 0.15);
    v.set(gI * 2, 1); v.set(gI * 2 + 1, 0.6 + r() * 0.4);
    vecs.push(v); labels.push(gI);
  }
  return { vecs, labels };
}

test('umap: curve settings match umap-learn for min_dist 0.1 (a 1.577, b 0.895)', () => {
  const { a, b } = curveParams(0.1);
  assert.ok(Math.abs(a - 1.577) < 0.02 && Math.abs(b - 0.895) < 0.02, `got a ${a}, b ${b}`);
});

test('umap: same input, same layout; groups stay apart and neighbours stay close', () => {
  const { vecs, labels } = groups();
  const kn = cosineKnn(vecs, 8, rng(1));
  const one = umap(kn.idx, kn.dist, { random: rng(2), epochs: 200 });
  const two = umap(kn.idx, kn.dist, { random: rng(2), epochs: 200 });
  assert.deepStrictEqual(one, two);
  assert.ok(separation(one, labels) > 0.5, 'the four groups sit apart');
  assert.ok(neighboursKept(cosineKnn(vecs, 5, rng(1)).idx, one, 5) > 0.5, 'most nearest neighbours stay nearest');
});

test('umap: a big map does not overflow the call stack', () => {
  const r = rng(9), n = 3000;
  const vecs = Array.from({ length: n }, () => new Map(Array.from({ length: 6 }, () => [Math.floor(r() * 400), r()])));
  const kn = cosineKnn(vecs, 60, rng(1));
  assert.ok(fuzzyGraph(kn.idx, kn.dist).length > n, 'the graph has an edge per point at least');
  const Y = umap(kn.idx, kn.dist, { random: rng(2), epochs: 1 });
  assert.strictEqual(Y.length, n);
});

test('layouts: every configured layout gives each artist one finite spot within radius 110; the helix stays the main layout', () => {
  const g = buildGraph({ library: fixture.library, similar: fixture.similar, tags: fixture.tags }, cfg);
  const before = JSON.stringify(g.nodes.map((n) => n.p));
  const { layouts, report } = extraLayouts(g, lf, cfg);
  assert.strictEqual(cfg.graph.layout, 'worm', 'the helix is still the default view');
  assert.strictEqual(JSON.stringify(g.nodes.map((n) => n.p)), before, 'main positions are untouched');
  assert.deepStrictEqual(Object.keys(layouts), Object.keys(cfg.graph.extra_layouts));
  for (const pos of Object.values(layouts)) {
    assert.strictEqual(pos.length, g.nodes.length);
    assert.ok(pos.every((p) => p.length === 3 && p.every(Number.isFinite) && Math.hypot(...p) <= 110.01));
  }
  assert.strictEqual(report.length, Object.keys(layouts).length);
  for (const r of report) assert.ok(r.kept >= 0 && r.kept <= 1 && r.separation >= -1 && r.separation <= 1 && r.ms >= 0);
  assert.deepStrictEqual(extraLayouts(g, lf, cfg).layouts, layouts, 'same input, same layouts');
});

test('layouts: artists to try are placed by their links into the library; tags count only as configured', () => {
  const g = buildGraph({ library: fixture.library, similar: fixture.similar, tags: fixture.tags }, cfg);
  const v = artistVectors(g, lf, cfg);
  const rec = g.because[0];
  const keys = [...v[rec.i].keys()];
  assert.ok(keys.every((k) => k.startsWith('a:')), 'an artist to try has no tags of its own');
  assert.strictEqual(keys.length, 1 + rec.from.length, 'itself plus one entry per library link');
  const tagged = v.findIndex((m, i) => !g.nodes[i].r && [...m.keys()].some((k) => k.startsWith('t:')));
  const tagShare = Math.hypot(...[...v[tagged].entries()].filter(([k]) => k.startsWith('t:')).map(([, x]) => x));
  assert.ok(Math.abs(tagShare - cfg.graph.umap.tag_weight) < 1e-9, 'tags carry exactly tag_weight');
});

test('layouts: bad names and unknown kinds are refused', () => {
  const g = buildGraph({ library: fixture.library, similar: fixture.similar, tags: fixture.tags }, cfg);
  const with_ = (extra) => ({ ...cfg, graph: { ...cfg.graph, extra_layouts: extra } });
  assert.throws(() => extraLayouts(g, lf, with_({ 'Bad Name': { kind: 'umap', neighbors: 5 } })), /lowercase/);
  assert.throws(() => extraLayouts(g, lf, with_({ tsne: { kind: 'tsne', neighbors: 5 } })), /unknown kind/);
  assert.strictEqual(extraLayouts(g, lf, with_({})).layouts, null, 'no extra layouts configured, none added');
});

test('privacy: layouts may carry positions only, one per artist, under a short lowercase name', () => {
  const g = buildGraph({ library: fixture.library, similar: fixture.similar, tags: fixture.tags }, cfg);
  const ok = g.nodes.map(() => [1, 2, 3]);
  assert.doesNotThrow(() => assertPublicSafe({ ...g, layouts: { umap: ok } }));
  assert.throws(() => assertPublicSafe({ ...g, layouts: { umap: ok.slice(1) } }), /one \[x, y, z\] per artist/);
  assert.throws(() => assertPublicSafe({ ...g, layouts: { umap: ok.map(() => [1, 2, 'Nixbra Glass']) } }), /one \[x, y, z\] per artist/);
  assert.throws(() => assertPublicSafe({ ...g, layouts: { umap: ok.map(() => [1, 2, NaN]) } }), /one \[x, y, z\] per artist/);
  assert.throws(() => assertPublicSafe({ ...g, layouts: { 'Nixbra Glass': ok } }), /short lowercase word/);
  assert.throws(() => assertPublicSafe({ ...g, layouts: [ok] }), /not an object/);
});

test('build: the page carries the extra layouts, every inline script still parses, and the log has numbers, not names', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'am-'));
  const lines = [];
  const log = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { await build({ fixture, outDir: dir, env: {} }); } finally { console.log = log; }
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const data = JSON.parse(html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepStrictEqual(Object.keys(data.layouts), Object.keys(cfg.graph.extra_layouts));
  assert.ok(html.includes("get('layout')"), 'the page reads ?layout=');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const page = readFileSync(join(dir, f), 'utf8');
    for (const [, code] of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) assert.doesNotThrow(() => new Function(code), `${f}: an inline script no longer parses`);
  }
  const layoutLines = lines.filter((l) => l.startsWith('layout '));
  assert.strictEqual(layoutLines.length, Object.keys(cfg.graph.extra_layouts).length);
  const names = fixture.library.map((a) => a.name);
  for (const l of layoutLines) assert.ok(!names.some((n) => l.includes(n)), 'no artist name in the build log');
});
