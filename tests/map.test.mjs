import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGraph, keyOf } from '../src/graph.mjs';
import { assertPublicSafe, assertNoSecrets } from '../src/privacy.mjs';
import { spotifyToken, spotifyLibrary, lastfm, SourceError } from '../src/sources.mjs';
import { build, loadConfig, reconnectState } from '../src/build.mjs';
import { connect } from '../src/connect.mjs';

const cfg = loadConfig();
const fixture = JSON.parse(readFileSync(new URL('./fixtures/sample.json', import.meta.url)));
const out = () => mkdtempSync(join(tmpdir(), 'am-'));
const res = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body });

test('graph: same input, same map; suggestions come only from artists you have, never ones you already have', () => {
  const a = buildGraph(fixture, cfg), b = buildGraph(fixture, cfg);
  assert.deepEqual(a, b);
  assert.ok(a.because.length > 0 && a.because.length <= cfg.graph.candidate_pool);
  for (const r of a.because) {
    assert.ok(a.nodes[r.i].r);
    assert.ok(r.from.length >= cfg.graph.candidate_min_links);
    assert.ok(r.from.every(([j, m]) => !a.nodes[j].r && m >= cfg.lastfm.min_match));
  }
  const lib = new Set(fixture.library.map((x) => keyOf(x.name)));
  assert.ok(a.nodes.filter((n) => n.r).every((n) => !lib.has(keyOf(n.n))), 'never suggests what is already saved');
  assert.ok(!a.tags.includes('seen live'), 'junk tags are skipped');
  assert.ok(a.nodes.filter((n) => !n.r).every((n) => n.t >= 0), 'linked artists without a common tag borrow their neighbours\' genre');
});

test('worm layout: genres run end to end along the tube', () => {
  const g = buildGraph(fixture, cfg);
  const ys = g.tags.map((t, k) => { const v = g.nodes.filter((n) => !n.r && n.t === k).map((n) => n.p[1]); return v.reduce((a, x) => a + x, 0) / v.length; });
  const spreadY = Math.max(...ys) - Math.min(...ys);
  assert.ok(spreadY > 80, 'genre centres are spread along the worm, not piled in the middle');
});

test('privacy: only allowed fields, nothing token-shaped', () => {
  const g = buildGraph(fixture, cfg);
  assert.doesNotThrow(() => assertPublicSafe({ ...g, built: '2026-11-19' }));
  assert.throws(() => assertPublicSafe({ ...g, playcount: 3 }), /unexpected field/);
  assert.throws(() => assertPublicSafe({ ...g, nodes: [{ ...g.nodes[0], id: '4Z8W4fKeB5YxbusRsdQVPb' }] }), /unexpected node field/);
  assert.throws(() => assertPublicSafe({ ...g, nodes: [{ ...g.nodes[0], p: ['BQDa8f7s9d8f7as9d8f7as9d8f7a9s8d7f9a8s7df', 0, 0] }] }), /token-shaped/);
  assert.doesNotThrow(() => assertPublicSafe({ ...g, nodes: [{ ...g.nodes[0], n: 'Supercalifragilisticexpialidocious_and_more_letters_here' }] }), 'a long artist name alone is not a leak');
  assert.throws(() => assertPublicSafe({ ...g, tags: ['x'.repeat(41)] }), /tag is not a short string/);
  assert.throws(() => assertNoSecrets('page with s3cr3t-value inside', ['s3cr3t-value']), /secret value/);
});

test('build: fixture run writes self-contained pages with no outside loads', async () => {
  const dir = out();
  const r = await build({ fixture, outDir: dir, env: { SPOTIFY_CONNECTED_AT: '2026-11-19' }, now: Date.parse('2026-11-20T03:00:00Z') });
  assert.deepEqual(readdirSync(dir).sort(), ['.nojekyll', 'callback.html', 'connect.html', 'index.html', 'you.html']);
  assert.equal(r.data.built, '2026-11-19', 'dated in Eastern time');
  for (const f of ['index.html', 'connect.html', 'callback.html']) {
    const html = readFileSync(join(dir, f), 'utf8');
    assert.ok(!/<(script|link|img)[^>]+(src|href)=["']?https?:/i.test(html), `${f} loads nothing from outside`);
    if (f !== 'callback.html') assert.ok(!/fetch\(|XMLHttpRequest/.test(html), `${f} makes no network calls`);
  }
});

test('build: a hostile artist name stays text inside the data block', async () => {
  const dir = out();
  const evil = '</script><img src=x onerror=alert(1)>';
  const f = { ...fixture, library: [...fixture.library, { name: evil, weight: 99 }] };
  await build({ fixture: f, outDir: dir, env: {} });
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.ok(!html.includes(evil));
  const block = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.ok(JSON.parse(block).nodes.some((n) => n.n === evil), 'the name survives as data');
});

test('build: not connected publishes the connect page only, with no secret in it', async () => {
  const dir = out();
  const r = await build({ outDir: dir, env: { SPOTIFY_CLIENT_ID: 'abc123publicid', SPOTIFY_CLIENT_SECRET: 'supersecretvalue', LASTFM_API_KEY: 'lastfmkeyvalue' } });
  assert.equal(r.connected, false);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  assert.ok(html.includes('abc123publicid'));
  assert.ok(!html.includes('supersecretvalue') && !html.includes('lastfmkeyvalue'));
});

test('reconnect: warns at 150 days, due at 170', () => {
  const at = (d) => Date.parse('2026-11-19T12:00:00Z') + d * 864e5;
  assert.equal(reconnectState('2026-11-19', cfg, at(10)).state, 'ok');
  assert.equal(reconnectState('2026-11-19', cfg, at(155)).state, 'soon');
  assert.equal(reconnectState('2026-11-19', cfg, at(171)).state, 'due');
  assert.equal(reconnectState('', cfg).state, 'unknown');
});

test('spotify: reports a rotated token, pages through the library, never echoes bodies in errors', async () => {
  const tok = await spotifyToken({ clientId: 'a', clientSecret: 'b', refreshToken: 'old' }, cfg, async () => res({ access_token: 'acc', refresh_token: 'new' }));
  assert.deepEqual(tok, { accessToken: 'acc', newRefreshToken: 'new' });
  const same = await spotifyToken({ clientId: 'a', clientSecret: 'b', refreshToken: 'old' }, cfg, async () => res({ access_token: 'acc' }));
  assert.equal(same.newRefreshToken, null);

  const pages = {
    '/me/tracks?limit=50': { items: [{ track: { artists: [{ name: 'A' }, { name: 'B' }] } }], next: 'https://api.spotify.com/v1/me/tracks?offset=50' },
    '/me/tracks?offset=50': { items: [{ track: { artists: [{ name: 'A' }] } }], next: null },
    '/me/following?type=artist&limit=50': { artists: { items: [{ name: 'C' }], next: null } },
  };
  const f = async (url) => {
    const u = new URL(url); const path = u.pathname.replace('/v1', '') + u.search;
    return res(pages[path] ?? { items: path.includes('long_term') ? [{ name: 'A' }] : [] });
  };
  const lib = Object.fromEntries((await spotifyLibrary('acc', cfg, f)).map((a) => [a.name, a.weight]));
  assert.deepEqual(lib, { A: 2 + cfg.weights.top.long_term, B: 1, C: cfg.weights.followed });

  await assert.rejects(spotifyToken({ clientId: 'a', clientSecret: 'b', refreshToken: 'r' }, cfg, async () => res({ error: 'invalid_grant', secret: 'zzz' }, 400)),
    (e) => e instanceof SourceError && !e.message.includes('zzz') && !e.message.includes('invalid_grant'));
});

test('last.fm: unknown artists are skipped, the key never appears in an error', async () => {
  assert.equal(await lastfm('artist.getsimilar', 'Nobody', 'KEY', cfg, async () => res({ error: 6 })), null);
  await assert.rejects(lastfm('artist.getsimilar', 'X', 'MYKEY123', { ...cfg, lastfm: { ...cfg.lastfm, max_retries: 0 } }, async () => res({}, 403)),
    (e) => !e.message.includes('MYKEY123'));
});

test('connect: rejects junk codes before calling Spotify', async () => {
  let called = false;
  await assert.rejects(connect({ CODE: 'not a code!', OUT_FILE: '/tmp/x' }, async () => { called = true; }), /does not look like/);
  assert.equal(called, false);
});

test('visitor page: talks only to Spotify and Last.fm, carries only the page key, never a secret', async () => {
  const dir = out();
  const env = { SPOTIFY_CLIENT_ID: 'publicclientid123', SPOTIFY_CLIENT_SECRET: 'supersecretvalue', LASTFM_API_KEY: 'nightlykeyvalue', LASTFM_PAGE_KEY: 'pagekeyvalue' };
  await build({ fixture, outDir: dir, env });
  const html = readFileSync(join(dir, 'you.html'), 'utf8');
  assert.ok(html.includes('pagekeyvalue') && html.includes('publicclientid123'));
  assert.ok(!html.includes('supersecretvalue') && !html.includes('nightlykeyvalue'));
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /connect-src https:\/\/api\.spotify\.com https:\/\/ws\.audioscrobbler\.com;/);
  assert.match(html, /code_challenge_method: 'S256'/, 'PKCE, not a secret');
  for (const f of ['index.html', 'connect.html']) assert.match(readFileSync(join(dir, f), 'utf8'), /connect-src 'none'/);
  const cb = readFileSync(join(dir, 'callback.html'), 'utf8');
  assert.match(cb, /connect-src https:\/\/accounts\.spotify\.com;/);
  assert.ok(!cb.includes('supersecretvalue'));
});

test('visitor page: stays closed when the page key is missing or reuses the nightly key', async () => {
  const dir = out();
  await build({ fixture, outDir: dir, env: { SPOTIFY_CLIENT_ID: 'id', LASTFM_API_KEY: 'samekey123', LASTFM_PAGE_KEY: 'samekey123' } });
  assert.ok(!readFileSync(join(dir, 'you.html'), 'utf8').includes('samekey123'));
});

test('song counts and first-liked months reach the page, and nothing finer than a month', async () => {
  const cfgPages = { ...cfg };
  const pages = {
    '/me/tracks?limit=50': { items: [
      { added_at: '2024-03-09T21:14:00Z', track: { artists: [{ name: 'A' }] } },
      { added_at: '2019-11-30T08:00:00Z', track: { artists: [{ name: 'A' }, { name: 'B' }] } },
    ], next: null },
    '/me/following?type=artist&limit=50': { artists: { items: [{ name: 'C' }], next: null } },
  };
  const f = async (url) => { const u = new URL(url); return res(pages[u.pathname.replace('/v1', '') + u.search] ?? { items: [] }); };
  const lib = Object.fromEntries((await spotifyLibrary('acc', cfgPages, f)).map((a) => [a.name, a]));
  assert.equal(lib.A.songs, 2); assert.equal(lib.A.first, '2019-11');
  assert.equal(lib.C.songs, 0); assert.equal(lib.C.first, null);
  const g = buildGraph({ library: Object.values(lib), similar: {}, tags: {} }, cfg);
  const a = g.nodes.find((n) => n.n === 'A');
  assert.deepEqual([a.s, a.d], [2, '2019-11']);
  assert.ok(!JSON.stringify(g).includes('T21:14'), 'no day or time');
  assert.throws(() => assertPublicSafe({ ...g, nodes: [{ ...a, d: '2019-11-30' }] }), /not a month/);
});

test('worm layout: a hub artist linked by 200 others stays on the map', () => {
  const library = [{ name: 'Hub', weight: 50 }, ...Array.from({ length: 200 }, (_, k) => ({ name: 'Spoke ' + k, weight: 1 }))];
  const similar = Object.fromEntries(library.slice(1).map((a) => [keyOf(a.name), [{ name: 'Hub', match: 1 }]]));
  const g = buildGraph({ library, similar, tags: {} }, cfg);
  const r = Math.max(...g.nodes.map((n) => Math.hypot(...n.p)));
  assert.ok(Number.isFinite(r) && r < 150, 'max radius ' + r);
});
