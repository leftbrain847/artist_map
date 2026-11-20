// Network calls to Spotify and Last.fm. fetch is passed in so tests run on fixtures.
// Nothing here logs a response body or a credential: errors carry only the HTTP status and the endpoint path.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SourceError extends Error {}

async function getJson(fetchFn, url, init, retries) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(url, init);
    if (res.status === 429 && attempt < retries) {
      const wait = Math.min(30, Number(res.headers?.get?.('retry-after')) || 2 ** attempt);
      await sleep(wait * 1000);
      continue;
    }
    if (res.status >= 500 && attempt < retries) { await sleep(1000 * 2 ** attempt); continue; }
    if (!res.ok) throw new SourceError(`${res.status} from ${new URL(url).host}${new URL(url).pathname}`);
    return res.json();
  }
}

// ---------- Spotify ----------

const basic = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');

export async function spotifyToken({ clientId, clientSecret, refreshToken }, cfg, fetchFn = fetch) {
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken });
  const j = await getJson(fetchFn, cfg.spotify.token_url, {
    method: 'POST', headers: { Authorization: basic(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, cfg.spotify.max_retries);
  if (!j.access_token) throw new SourceError('Spotify returned no access token');
  return { accessToken: j.access_token, newRefreshToken: j.refresh_token && j.refresh_token !== refreshToken ? j.refresh_token : null };
}

export async function exchangeCode({ clientId, clientSecret, code }, cfg, fetchFn = fetch) {
  const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: cfg.spotify.redirect_uri });
  const j = await getJson(fetchFn, cfg.spotify.token_url, {
    method: 'POST', headers: { Authorization: basic(clientId, clientSecret), 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, 0);
  if (!j.refresh_token) throw new SourceError('Spotify returned no refresh token');
  return j.refresh_token;
}

export function authorizeUrl(clientId, state, cfg) {
  const u = new URL(cfg.spotify.authorize_url);
  u.search = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: cfg.spotify.redirect_uri, scope: cfg.spotify.scopes.join(' '), state }).toString();
  return u.toString();
}

// Artists from saved songs, followed artists and top artists, weighted by config.
export async function spotifyLibrary(accessToken, cfg, fetchFn = fetch) {
  const s = cfg.spotify;
  const w = cfg.weights;
  const init = { headers: { Authorization: `Bearer ${accessToken}` } };
  const get = (path) => getJson(fetchFn, path.startsWith('http') ? path : s.api + path, init, s.max_retries);
  const lib = new Map();
  // songs = saved songs by this artist; first = month of the earliest save (YYYY-MM).
  const add = (a, weight, addedAt = null) => {
    if (!a?.name) return;
    const cur = lib.get(a.name) ?? { name: a.name, weight: 0, songs: 0, first: null };
    cur.weight += weight;
    if (addedAt) {
      cur.songs += 1;
      const m = String(addedAt).slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(m) && (!cur.first || m < cur.first)) cur.first = m;
    }
    lib.set(a.name, cur);
  };

  let next = `/me/tracks?limit=${s.page_size}`;
  let seen = 0;
  while (next && seen < s.saved_tracks_max) {
    const page = await get(next);
    for (const item of page.items ?? []) for (const a of item.track?.artists ?? []) add(a, w.saved_track, item.added_at);
    seen += page.items?.length ?? 0;
    next = page.next;
  }

  next = `/me/following?type=artist&limit=${s.page_size}`;
  while (next) {
    const page = (await get(next)).artists ?? {};
    for (const a of page.items ?? []) add(a, w.followed);
    next = page.next;
  }

  for (const range of s.top_ranges) {
    const page = await get(`/me/top/artists?time_range=${range}&limit=${s.page_size}`);
    for (const a of page.items ?? []) add(a, w.top[range] ?? 1);
  }
  return [...lib.values()];
}

// ---------- Last.fm ----------

export async function lastfm(method, artist, apiKey, cfg, fetchFn = fetch) {
  const u = new URL(cfg.lastfm.api);
  u.search = new URLSearchParams({ method, artist, api_key: apiKey, format: 'json', autocorrect: '1', ...(method === 'artist.getsimilar' ? { limit: String(cfg.lastfm.similar_limit) } : {}) }).toString();
  try {
    const j = await getJson(fetchFn, u.toString(), { headers: { 'User-Agent': 'artist_map (github.com/leftbrain847/artist_map)' } }, cfg.lastfm.max_retries);
    if (j.error) return null; // unknown artist: skip it rather than fail the night
    return j;
  } catch (e) {
    // Rebuild the message so the request URL (which holds the key) can never reach a log.
    throw new SourceError(String(e.message).replace(/api_key=[^&\s]+/g, 'api_key=***'));
  }
}

export async function lastfmData(names, apiKey, cfg, fetchFn = fetch, pause = sleep) {
  const similar = {};
  const tags = {};
  for (const { key, name } of names) {
    const s = await lastfm('artist.getsimilar', name, apiKey, cfg, fetchFn);
    similar[key] = [].concat(s?.similarartists?.artist ?? []).map((a) => ({ name: a.name, match: Number(a.match) }));
    const t = await lastfm('artist.gettoptags', name, apiKey, cfg, fetchFn);
    tags[key] = [].concat(t?.toptags?.tag ?? []).slice(0, 5).map((x) => x.name);
    await pause(cfg.lastfm.pause_ms);
  }
  return { similar, tags };
}
