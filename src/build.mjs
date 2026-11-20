#!/usr/bin/env node
// Nightly build: Spotify library -> Last.fm similarity -> 3D map pages in dist/.
//   node src/build.mjs                 real run, reads secrets from env
//   node src/build.mjs --fixture FILE  offline run from a fixture (tests and previews)
// Logs only counts. Secret values are masked in GitHub Actions and checked against the output before it is written.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGraph, keyOf } from './graph.mjs';
import { extraLayouts } from './layouts.mjs';
import { spotifyToken, spotifyLibrary, lastfmData } from './sources.mjs';
import { assertPublicSafe, assertNoSecrets } from './privacy.mjs';
import { renderMap, renderSetup, renderCallback, renderYou } from './page.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const loadConfig = () => JSON.parse(readFileSync(join(ROOT, 'config/artist_map.json'), 'utf8'));
const mask = (v) => { if (v && process.env.GITHUB_ACTIONS) console.log(`::add-mask::${v}`); };
const daysSince = (iso, now) => Math.floor((now - new Date(`${iso}T00:00:00Z`)) / 864e5);
const addDays = (iso, n) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

export function reconnectState(connectedAt, cfg, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(connectedAt || '')) return { state: 'unknown', by: null };
  const age = daysSince(connectedAt, now);
  const by = addDays(connectedAt, cfg.spotify.reconnect_due_days);
  return { state: age >= cfg.spotify.reconnect_due_days ? 'due' : age >= cfg.spotify.reconnect_warn_days ? 'soon' : 'ok', by };
}

export function writeSite(outDir, pages, secrets) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, html] of Object.entries(pages)) writeFileSync(join(outDir, name), assertNoSecrets(html, secrets));
  writeFileSync(join(outDir, '.nojekyll'), '');
}

export async function build({ env = process.env, fetchFn = fetch, fixture = null, outDir = join(ROOT, 'dist'), now = Date.now(), pause } = {}) {
  const cfg = loadConfig();
  const secrets = [env.SPOTIFY_CLIENT_SECRET, env.SPOTIFY_REFRESH_TOKEN, env.LASTFM_API_KEY];
  secrets.forEach(mask);
  const callback = renderCallback(cfg, env.SPOTIFY_CLIENT_ID);
  const connectPage = renderSetup(env.SPOTIFY_CLIENT_ID, cfg);
  // The visitor page carries its own Last.fm key, separate from the nightly one, so abuse can only break that page.
  let pageKey = (env.LASTFM_PAGE_KEY || '').trim();
  if (pageKey && pageKey === (env.LASTFM_API_KEY || '').trim()) { console.log('::warning::LASTFM_PAGE_KEY must be a different key from LASTFM_API_KEY; visitor maps stay closed.'); pageKey = ''; }
  const extra = cfg.visitor.enabled ? { 'you.html': renderYou(cfg, env.SPOTIFY_CLIENT_ID, pageKey) } : {};

  let library, lf;
  if (fixture) {
    library = fixture.library;
    lf = { similar: fixture.similar, tags: fixture.tags };
  } else {
    if (!env.SPOTIFY_REFRESH_TOKEN) {
      writeSite(outDir, { 'index.html': connectPage, 'connect.html': connectPage, 'callback.html': callback, ...extra }, secrets);
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'connected=false\n');
      console.log('not connected yet: published the connect page');
      return { connected: false };
    }
    const tok = await spotifyToken({ clientId: env.SPOTIFY_CLIENT_ID, clientSecret: env.SPOTIFY_CLIENT_SECRET, refreshToken: env.SPOTIFY_REFRESH_TOKEN }, cfg, fetchFn);
    mask(tok.accessToken); mask(tok.newRefreshToken);
    secrets.push(tok.accessToken, tok.newRefreshToken);
    if (tok.newRefreshToken && env.NEW_REFRESH_FILE) writeFileSync(env.NEW_REFRESH_FILE, tok.newRefreshToken, { mode: 0o600 });
    library = await spotifyLibrary(tok.accessToken, cfg, fetchFn);
    const top = [...library].sort((a, b) => b.weight - a.weight).slice(0, cfg.graph.max_library_nodes);
    lf = await lastfmData(top.map((a) => ({ key: keyOf(a.name), name: a.name })), env.LASTFM_API_KEY, cfg, fetchFn, pause);
  }

  const g = buildGraph({ library, similar: lf.similar, tags: lf.tags }, cfg);
  const alt = extraLayouts(g, lf, cfg);
  if (alt.layouts) g.layouts = alt.layouts;
  const rc = reconnectState(env.SPOTIFY_CONNECTED_AT, cfg, now);
  const data = assertPublicSafe({ ...g, built: new Intl.DateTimeFormat('en-CA', { timeZone: cfg.page.time_zone }).format(new Date(now)), ...(rc.by ? { reconnect_by: rc.by } : {}) });
  writeSite(outDir, { 'index.html': renderMap(data, cfg, Boolean(pageKey)), 'connect.html': connectPage, 'callback.html': callback, ...extra }, secrets);
  console.log(`built: ${library.length} artists in library, ${g.nodes.length} on the map, ${g.edges.length} links, ${g.because.length} to try`);
  // Numbers only: which layout, its neighbour setting, seconds, share of each artist's 10 closest kept close, genre separation.
  for (const r of alt.report) console.log(`layout ${r.name}: neighbors ${r.neighbors}, ${(r.ms / 1000).toFixed(1)}s, kept ${Math.round(r.kept * 100)}% of closest artists close, genre separation ${r.separation.toFixed(2)}`);
  if (rc.state === 'soon') console.log(`::warning::Spotify sign-in expires around ${rc.by}. Reconnect at https://leftbrain847.github.io/artist_map/connect.html before then.`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `connected=true\nreconnect=${rc.state}\nreconnect_by=${rc.by ?? ''}\n`);
  return { connected: true, data, reconnect: rc };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--fixture');
  const fixture = i > 0 ? JSON.parse(readFileSync(process.argv[i + 1], 'utf8')) : null;
  build({ fixture }).catch((e) => { console.error(`build failed: ${e.message}`); process.exit(1); });
}
