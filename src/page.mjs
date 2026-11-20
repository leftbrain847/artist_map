import { readFileSync } from 'node:fs';
// Renders the public pages. Self-contained: no outside scripts, fonts or images, so the index's site check passes.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const BASE_CSS = `
:root{color-scheme:dark;--bg:#0b0d14;--fg:#c0caf5;--dim:#7a82a6;--card:#141826}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,system-ui,sans-serif}
a{color:#7dcfff}header{padding:14px 16px 4px}h1{margin:0;font-size:20px}header p{margin:2px 0 0;color:var(--dim);font-size:13px}
`;


// Shared by the nightly map and the visitor map.
const MAP_CSS = `body{background:radial-gradient(120% 80% at 50% 30%,#121626 0%,#0b0d14 60%,#07080d 100%) fixed}
header{padding:22px 22px 0;text-align:center}h1{font-weight:300;font-size:15px;letter-spacing:.32em;text-transform:uppercase;color:#d8dcf5}
header p{font-size:12px;letter-spacing:.04em;margin-top:6px}
#wrap{position:relative;height:72vh;min-height:360px;touch-action:none}canvas{width:100%;height:100%;display:block}
#info{position:absolute;left:50%;transform:translateX(-50%);bottom:14px;width:min(92%,420px);background:rgba(14,17,28,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 14px;font-size:14px;text-align:center;display:none}
#info div:first-child{font-weight:500;letter-spacing:.02em}#info div+div{color:var(--dim);font-size:12.5px;margin-top:3px}
#legend{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 14px;padding:4px 22px 6px;font-size:11px;letter-spacing:.08em;text-transform:lowercase;color:var(--dim)}#legend span:before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;background:var(--c);box-shadow:0 0 8px var(--c)}
section{max-width:460px;margin:0 auto;padding:18px 22px 8px}h2{font-weight:300;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--dim);text-align:center;margin:8px 0 12px}
ol{list-style:none;margin:0;padding:0}li{padding:10px 2px;border-top:1px solid rgba(255,255,255,.05);display:flex;flex-direction:column}li:last-child{border-bottom:1px solid rgba(255,255,255,.05)}
li button{font-size:15px;color:#e6e9ff}li small{color:var(--dim);font-size:12px;margin-top:2px}
footer{padding:22px;color:#4a5072;font-size:11px;letter-spacing:.06em;text-align:center}button{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left;cursor:pointer}
section:has(ol:empty){display:none}
#filters{max-width:360px;margin:6px auto 0;padding:0 22px;display:flex;flex-direction:column;gap:12px}#filters:empty{display:none}
#filters label{display:flex;flex-direction:column;gap:6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);text-align:center}
#filters input{-webkit-appearance:none;appearance:none;width:100%;height:2px;background:rgba(255,255,255,.12);border-radius:2px;outline:none}
#filters input::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#e6e9ff;box-shadow:0 0 12px rgba(160,180,255,.6);border:0}
#filters input::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#e6e9ff;border:0}.yours{text-align:center;margin:0 0 26px;font-size:12px;letter-spacing:.14em;text-transform:uppercase}.yours a{color:var(--dim);text-decoration:none;border-bottom:1px solid #2a3050;padding-bottom:3px}
#status{text-align:center;color:var(--dim);font-size:13px;letter-spacing:.04em;padding:30vh 22px 0;position:absolute;inset:0;pointer-events:none}
.pill{display:inline-block;pointer-events:auto;margin-top:16px;padding:11px 22px;border-radius:999px;border:1px solid rgba(255,255,255,.14);color:#e6e9ff;letter-spacing:.12em;text-transform:uppercase;font-size:12px;background:rgba(255,255,255,.03);cursor:pointer}
`;
const MAP_BODY = `<div id="wrap"><canvas id="c"></canvas><div id="info"></div></div>
<div id="legend"></div>
<div id="filters"></div>
<section><h2>To try</h2><ol id="recs"></ol></section>
<footer id="foot"></footer>`;
const VIEW_JS = `function mountMap(D, P) {
  const cv = document.getElementById('c'), cx = cv.getContext('2d'), info = document.getElementById('info');
  const colour = (nd) => nd.r ? P.rec_color : nd.t >= 0 ? P.palette[nd.t % P.palette.length] : P.other_color;
  const nbrs = D.nodes.map(() => []);
  D.edges.forEach(([i, j]) => { nbrs[i].push(j); nbrs[j].push(i); });
  let yaw = 0.6, pitch = -0.25, zoom = 1, sel = -1, drag = null, pinch = null, idle = 0, W = 0, H = 0, dpr = 1;
  // Filters: which artists are on screen. Recommendations stay while any artist they come from is shown.
  const vis = D.nodes.map(() => true);
  let labelled = new Set(), regions = [], shown = D.nodes.length;

  function size() { dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; }
  function project(p) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
    const y = p[1] * cp - z1 * sp, z = p[1] * sp + z1 * cp;
    const f = 340 / (340 + z) * zoom * Math.min(W, H) / 190;
    return [W / 2 + x * f, H / 2 + y * f, z, f];
  }
  let proj = [];
  // Each genre region is a soft glowing cloud around its shown artists; edges only show for the tapped artist.
  const computeRegions = () => D.tags.map((t, k) => {
    const pts = D.nodes.filter((n, i) => vis[i] && n.t === k && !n.r).map((n) => n.p);
    if (!pts.length) return null;
    const c = [0, 1, 2].map((d) => pts.reduce((a, p) => a + p[d], 0) / pts.length);
    const spread = Math.sqrt(pts.reduce((a, p) => a + (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2, 0) / pts.length) || 10;
    return { k, c, spread, name: t };
  }).filter(Boolean);
  const rgba = (hex, a) => { const v = parseInt(hex.slice(1), 16); return 'rgba(' + (v >> 16) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')'; };
  function glow(x, y, r, hex, a) {
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hex, a)); g.addColorStop(1, rgba(hex, 0));
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
  }
  function draw() {
    if (!drag && !pinch && sel < 0) yaw += P.auto_rotate;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    proj = D.nodes.map((n) => project(n.p));
    const faded = sel >= 0 ? 0.35 : 1;
    const crowd = Math.min(1, Math.sqrt(P.crowd_nodes / Math.max(1, shown)));  // dots shrink as more artists are shown
    cx.globalCompositeOperation = 'lighter';
    for (const g of regions) {
      const p = project(g.c);
      glow(p[0], p[1], g.spread * p[3] * P.region_scale, P.palette[g.k % P.palette.length], P.region_alpha * faded);
    }
    if (shown <= P.halo_max_nodes) D.nodes.forEach((n, i) => {
      if (!vis[i]) return;
      const p = proj[i], r = (P.point_min + (P.point_max - P.point_min) * n.w) * p[3] * crowd;
      glow(p[0], p[1], r * P.halo_scale, colour(n), P.halo_alpha * faded);
    });
    cx.globalCompositeOperation = 'source-over';
    if (sel >= 0) {
      cx.lineWidth = 0.8; cx.strokeStyle = 'rgba(255,255,255,.55)';
      for (const j of nbrs[sel]) { if (!vis[j]) continue; cx.beginPath(); cx.moveTo(proj[sel][0], proj[sel][1]); cx.lineTo(proj[j][0], proj[j][1]); cx.stroke(); }
    }
    const order = proj.map((p, i) => [p[2], i]).sort((a, b) => b[0] - a[0]);
    const placed = [];  // labels that would overlap one already drawn are skipped
    for (const [, i] of order) {
      if (!vis[i]) continue;
      const n = D.nodes[i], p = proj[i], r = (P.point_min + (P.point_max - P.point_min) * n.w) * p[3] * 0.6 * crowd;
      const dim = sel >= 0 && i !== sel && !nbrs[sel].includes(i);
      cx.globalAlpha = dim ? 0.2 : 0.95;
      cx.fillStyle = colour(n); cx.beginPath(); cx.arc(p[0], p[1], Math.max(1.2, r), 0, 7); cx.fill();
      if (n.r) { cx.strokeStyle = 'rgba(0,0,0,.6)'; cx.lineWidth = 1; cx.stroke(); }
      const show = sel >= 0 ? (i === sel || nbrs[sel].includes(i)) : labelled.has(i);
      if (show && !dim && (i === sel || !placed.some((q) => Math.abs(q[0] - p[0]) < 70 && Math.abs(q[1] - p[1]) < 13))) {
        placed.push(p); cx.fillStyle = '#e6e9ff'; cx.font = (i === sel ? '600 13px' : '11px') + ' system-ui'; cx.fillText(n.n, p[0] + r + 3, p[1] + 4);
      }
    }
    cx.globalAlpha = 1;
    if (sel < 0) for (const g of regions) {
      const p = project(g.c);
      cx.fillStyle = rgba(P.palette[g.k % P.palette.length], 0.9); cx.font = '700 12px system-ui'; cx.textAlign = 'center';
      cx.fillText(g.name.toUpperCase(), p[0], p[1] - g.spread * p[3] * 0.9); cx.textAlign = 'start';
    }
    requestAnimationFrame(draw);
  }
  function pick(x, y) {
    let best = -1, bd = 24 * 24;
    proj.forEach((p, i) => { if (!vis[i]) return; const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function show(i) {
    sel = i;
    if (i < 0) { info.style.display = 'none'; return; }
    const n = D.nodes[i], b = D.because.find((x) => x.i === i);
    const tag = n.t >= 0 ? D.tags[n.t] : 'other';
    const near = nbrs[i].filter((j) => vis[j]).slice(0, 6).map((j) => D.nodes[j].n);
    const liked = n.s ? n.s + (n.s === 1 ? ' liked song' : ' liked songs') + (n.d ? ' since ' + n.d : '') : '';
    info.textContent = '';
    const h = document.createElement('div'); h.style.fontWeight = '600'; h.textContent = n.n; info.append(h);
    const t = document.createElement('div'); t.style.color = 'var(--dim)';
    t.textContent = b ? 'to try · because of ' + b.from.map((j) => D.nodes[j].n).join(', ') : [tag, liked, near.length ? 'near ' + near.join(', ') : ''].filter(Boolean).join(' · ');
    info.append(t); info.style.display = 'block';
  }
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || pinch) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy);
    yaw += dx * 0.008; pitch = Math.max(-1.4, Math.min(1.4, pitch + dy * 0.008)); drag.x = e.clientX; drag.y = e.clientY;
  });
  cv.addEventListener('pointerup', (e) => {
    if (drag && drag.moved < 6) { const r = cv.getBoundingClientRect(); const i = pick(e.clientX - r.left, e.clientY - r.top); show(i === sel ? -1 : i); }
    drag = null;
  });
  cv.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) { pinch = null; return; }
    e.preventDefault();
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinch) zoom = Math.max(0.5, Math.min(4, zoom * d / pinch)); pinch = d;
  }, { passive: false });
  cv.addEventListener('touchend', () => { pinch = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); zoom = Math.max(0.5, Math.min(4, zoom * Math.exp(-e.deltaY * 0.001))); }, { passive: false });

  const lg = document.getElementById('legend');
  D.tags.forEach((t, k) => { const s = document.createElement('span'); s.style.setProperty('--c', P.palette[k % P.palette.length]); s.textContent = t; lg.append(s); });
  const o = document.createElement('span'); o.style.setProperty('--c', P.rec_color); o.textContent = 'to try'; lg.append(o);
  const ol = document.getElementById('recs'), recLi = new Map();
  D.because.forEach((b) => {
    const li = document.createElement('li'); recLi.set(b.i, li); const btn = document.createElement('button'), sm = document.createElement('small');
    btn.textContent = D.nodes[b.i].n; btn.onclick = () => { show(b.i); scrollTo({ top: 0, behavior: 'smooth' }); };
    sm.textContent = 'like ' + b.from.slice(0, 3).map((j) => D.nodes[j].n).join(', ');
    li.append(btn, sm); ol.append(li);
  });
  const foot = document.getElementById('foot');
  function refilter(minSongs, sinceYear) {
    D.nodes.forEach((n, i) => { if (!n.r) vis[i] = (n.s || 0) >= minSongs && (sinceYear === null || (!!n.d && +n.d.slice(0, 4) >= sinceYear)); });
    D.because.forEach((b) => { vis[b.i] = b.from.some((j) => vis[j]); recLi.get(b.i).style.display = vis[b.i] ? '' : 'none'; });
    shown = vis.filter(Boolean).length;
    labelled = new Set(D.nodes.map((n, i) => [n.w, i]).filter(([, i]) => vis[i] && !D.nodes[i].r).sort((a, b) => b[0] - a[0]).slice(0, P.label_top).map(([, i]) => i));
    regions = computeRegions();
    if (sel >= 0 && !vis[sel]) show(-1);
    const lib = D.nodes.filter((n, i) => vis[i] && !n.r).length;
    foot.textContent = lib + ' artists  ·  drag to turn, tap to explore' + (D.built ? '  ·  ' + D.built : '');
  }
  // Two quiet sliders: how many of an artist's songs you've liked, and when you first liked them.
  const fl = document.getElementById('filters'), withSongs = D.nodes.filter((n) => !n.r && 'n' in n && 's' in n);
  let minSongs = 0, sinceYear = null;
  if (fl && withSongs.length) {
    const slider = (label, min, max, value, fmt, onInput) => {
      const wrap = document.createElement('label'), out = document.createElement('span'), r = document.createElement('input');
      r.type = 'range'; r.min = min; r.max = max; r.step = 1; r.value = value; r.setAttribute('aria-label', label);
      out.textContent = fmt(+r.value); r.oninput = () => { out.textContent = fmt(+r.value); onInput(+r.value); };
      wrap.append(out, r); fl.append(wrap);
    };
    const maxS = Math.min(P.songs_slider_max, Math.max(...withSongs.map((n) => n.s)));
    if (maxS > 1) slider('Minimum liked songs', 0, maxS, 0, (v) => v === 0 ? 'every artist' : 'at least ' + v + ' liked song' + (v > 1 ? 's' : ''), (v) => { minSongs = v; refilter(minSongs, sinceYear); });
    const years = withSongs.filter((n) => n.d).map((n) => +n.d.slice(0, 4));
    if (years.length) {
      const y0 = Math.min(...years), y1 = Math.max(...years);
      if (y1 > y0) slider('First liked since', y0, y1, y0, (v) => v === y0 ? 'liked any time' : 'new to you since ' + v, (v) => { sinceYear = v === y0 ? null : v; refilter(minSongs, sinceYear); });
    }
  }
  refilter(minSongs, sinceYear);
  addEventListener('resize', size); size(); draw();
}`;
// Pages may run inline code and talk only to the hosts listed; nothing loads from anywhere else.
const CSP = (connect = []) => `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; connect-src ${connect.length ? connect.join(' ') : "'none'"}; base-uri 'none'; form-action 'none'`;

export function renderMap(data, cfg, visitorsOpen = false) {
  const pg = cfg.page;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP()}">
<title>${esc(pg.title)}</title>
<style>${BASE_CSS}${MAP_CSS}</style></head><body>
<header><h1>${esc(pg.title)}</h1><p>${esc(pg.subtitle)}</p></header>
${MAP_BODY}
${cfg.visitor.enabled && visitorsOpen ? `<p class="yours"><a href="${esc(cfg.visitor.url)}">Map your own</a></p>` : ''}
<script id="data" type="application/json">${jsonForScript(data)}</script>
<script id="cfg" type="application/json">${jsonForScript(pg)}</script>
<script>
${VIEW_JS}
mountMap(JSON.parse(document.getElementById('data').textContent), JSON.parse(document.getElementById('cfg').textContent));
</script></body></html>
`;
}

// Shown before Spotify is connected. The Client ID is public by design; no secret is ever put in a page.
export function renderSetup(clientId, cfg) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CSP()}"><title>${esc(cfg.page.title)}: not connected</title><style>${BASE_CSS} main{padding:16px} .btn{display:inline-block;background:#1db954;color:#000;padding:10px 16px;border-radius:24px;text-decoration:none;font-weight:600}</style></head>
<body><header><h1>${esc(cfg.page.title)}</h1><p>Not connected to Spotify yet.</p></header>
<main>${clientId ? `<p><a class="btn" id="go" href="#">Connect Spotify</a></p>` : '<p>Waiting for setup.</p>'}</main>
<script id="auth" type="application/json">${jsonForScript({ base: cfg.spotify.authorize_url, client_id: clientId || '', redirect_uri: cfg.spotify.redirect_uri, scope: cfg.spotify.scopes.join(' ') })}</script>
<script>
(() => {
  const a = JSON.parse(document.getElementById('auth').textContent), go = document.getElementById('go');
  if (!go) return;
  go.onclick = (e) => {
    e.preventDefault();
    const state = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.removeItem('artist_map_pkce'); sessionStorage.setItem('artist_map_state', state); } catch {}
    const u = new URL(a.base);
    u.search = new URLSearchParams({ client_id: a.client_id, response_type: 'code', redirect_uri: a.redirect_uri, scope: a.scope, state }).toString();
    location.href = u.toString();
  };
})();
</script></body></html>
`;
}

// Spotify sends J back here with a one-time code. The page only shows it; it calls nothing.
export function renderCallback(cfg, clientId = '') {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${CSP([new URL(cfg.spotify.token_url).origin])}"><title>${esc(cfg.page.title)}: connect</title>
<style>${BASE_CSS} main{padding:16px} code{display:block;word-break:break-all;background:#141826;padding:12px;border-radius:8px;margin:8px 0;font-size:13px} button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #3b4261;background:#1a1f33;color:inherit}</style></head>
<body><header><h1>Connect Spotify</h1></header><main id="m"></main>
<script id="auth" type="application/json">${jsonForScript({ token: cfg.spotify.token_url, client_id: clientId, redirect_uri: cfg.spotify.redirect_uri })}</script>
<script>
(() => {
  const q = new URLSearchParams(location.search), m = document.getElementById('m');
  const say = (t) => { const p = document.createElement('p'); p.textContent = t; m.append(p); };
  let pk = null; try { pk = JSON.parse(sessionStorage.getItem('artist_map_pkce') || 'null'); sessionStorage.removeItem('artist_map_pkce'); } catch {}
  if (pk) {
    // A visitor signing in from you.html: trade the code in the browser (PKCE, no secret) and go straight back.
    const A = JSON.parse(document.getElementById('auth').textContent);
    if (q.get('error') || !q.get('code') || q.get('state') !== pk.state) { location.replace('you.html#signin_failed'); return; }
    history.replaceState(null, '', location.pathname);
    say('Signing you in…');
    fetch(A.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: A.redirect_uri, client_id: A.client_id, code_verifier: pk.verifier }) })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => { if (!j.access_token || !(j.expires_in > 0)) throw 0; sessionStorage.setItem('artist_map_token', JSON.stringify({ t: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 })); location.replace('you.html'); })
      .catch(() => location.replace('you.html#signin_failed'));
    return;
  }
  let want = null; try { want = sessionStorage.getItem('artist_map_state'); } catch {}
  if (q.get('error')) return say('Spotify said: ' + q.get('error') + '. Nothing was connected.');
  const code = q.get('code');
  if (!code) return say('No code here. Start from the map page.');
  try { sessionStorage.removeItem('artist_map_state'); } catch {}
  if (!want || q.get('state') !== want) return say('This sign-in did not start from the connect page in this browser, so it was ignored. Start again from connect.html.');
  say('Copy this code, then open GitHub: Actions → connect_spotify → Run workflow, and paste it within 10 minutes.');
  const c = document.createElement('code'); c.textContent = code; m.append(c);
  const b = document.createElement('button'); b.textContent = 'Copy code';
  b.onclick = async () => { try { await navigator.clipboard.writeText(code); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy it by hand'; } };
  m.append(b);
  history.replaceState(null, '', location.pathname);
})();
</script></body></html>
`;
}

// The visitor map: an allowlisted listener signs in with Spotify (PKCE, no secret) and their map is built
// entirely in their browser. Their library never leaves it; nothing is stored beyond this tab's session.
const GRAPH_JS = readFileSync(new URL('./graph.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');

export function renderYou(cfg, clientId, pageKey) {
  const pg = cfg.page, v = cfg.visitor;
  const hosts = [new URL(cfg.spotify.api).origin, new URL(cfg.lastfm.api).origin];
  const A = {
    authorize: cfg.spotify.authorize_url, api: cfg.spotify.api, lfm: cfg.lastfm.api, key: pageKey,
    client_id: clientId, redirect_uri: cfg.spotify.redirect_uri, scope: cfg.spotify.scopes.join(' '),
    v, weights: cfg.weights, top_ranges: cfg.spotify.top_ranges, graph: { ...cfg.graph, max_library_nodes: v.artist_limit }, lastfm: cfg.lastfm,
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP(hosts)}"><meta name="referrer" content="no-referrer">
<title>${esc(pg.title)}: yours</title>
<style>${BASE_CSS}${MAP_CSS}</style></head><body>
<header><h1>Your ${esc(pg.title)}</h1><p>${esc(v.subtitle)}</p></header>
${MAP_BODY.replace('<div id="info"></div>', '<div id="info"></div><div id="status"></div>')}
<p class="yours"><a href="./">Back to J's map</a></p>
<script id="auth" type="application/json">${jsonForScript(A)}</script>
<script id="cfg" type="application/json">${jsonForScript(pg)}</script>
<script>
${GRAPH_JS}
${VIEW_JS}
(() => {
  const A = JSON.parse(document.getElementById('auth').textContent), P = JSON.parse(document.getElementById('cfg').textContent);
  const st = document.getElementById('status');
  const say = (t, button) => {
    st.textContent = ''; const p = document.createElement('div'); p.textContent = t; st.append(p);
    if (button) { const b = document.createElement('button'); b.className = 'pill'; b.textContent = button.label; b.onclick = button.go; st.append(b); }
  };
  const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/[+]/g, '-').replace(/[/]/g, '_').replace(/=+$/, '');
  async function signIn() {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
    try { sessionStorage.removeItem('artist_map_state'); sessionStorage.setItem('artist_map_pkce', JSON.stringify({ verifier, state })); }
    catch { return say('This browser blocks the storage sign-in needs. Try another browser.'); }
    const u = new URL(A.authorize);
    u.search = new URLSearchParams({ client_id: A.client_id, response_type: 'code', redirect_uri: A.redirect_uri, scope: A.scope, state, code_challenge_method: 'S256', code_challenge: challenge }).toString();
    location.href = u.toString();
  }
  const signInBtn = { label: 'Sign in with Spotify', go: signIn };
  if (!A.client_id || !A.key) return say('Not open yet.');
  // Read the token once and drop it from storage, so no other page on this origin can pick it up.
  let tok = null; try { tok = JSON.parse(sessionStorage.getItem('artist_map_token') || 'null'); sessionStorage.removeItem('artist_map_token'); } catch {}
  if (!tok || tok.exp < Date.now()) {
    if (location.hash === '#signin_failed') return say('Sign-in did not finish. Try again.', signInBtn);
    return say('Invited listeners: sign in to map your saved artists. Nothing is stored; it all happens in this tab.', signInBtn);
  }
  const sp = async (path, tries = 0) => {
    const r = await fetch(path.startsWith('http') ? path : A.api + path, { headers: { Authorization: 'Bearer ' + tok.t } });
    if (r.status === 403) throw new Error('invite');
    if (r.status === 429) {
      const wait = (Number(r.headers.get('Retry-After')) || 2) * 1000;
      if (tries >= A.v.max_retries || wait > 30000) throw new Error('busy');
      await new Promise((ok) => setTimeout(ok, wait)); return sp(path, tries + 1);
    }
    if (!r.ok) throw new Error('spotify ' + r.status);
    return r.json();
  };
  const lf = async (method, artist) => {
    const u = new URL(A.lfm);
    u.search = new URLSearchParams({ method, artist, api_key: A.key, format: 'json', autocorrect: '1', ...(method === 'artist.getsimilar' ? { limit: String(A.lastfm.similar_limit) } : {}) }).toString();
    try { const r = await fetch(u); if (!r.ok) return null; const j = await r.json(); return j.error ? null : j; } catch { return null; }
  };
  (async () => {
    say('Reading your library…');
    const lib = new Map(), add = (a, w, at) => {
      if (!a || !a.name) return; const k = keyOf(a.name), c = lib.get(k) || { name: a.name, weight: 0, songs: 0, first: null }; c.weight += w;
      if (at) { c.songs++; const m = String(at).slice(0, 7); if (/^[0-9]{4}-[0-9]{2}$/.test(m) && (!c.first || m < c.first)) c.first = m; }
      lib.set(k, c);
    };
    let next = '/me/tracks?limit=50', seen = 0;
    while (next && seen < A.v.track_limit) { const p = await sp(next); (p.items || []).forEach((it) => ((it.track && it.track.artists) || []).forEach((a) => add(a, A.weights.saved_track, it.added_at))); seen += (p.items || []).length; next = p.next; }
    next = '/me/following?type=artist&limit=50';
    while (next) { const p = (await sp(next)).artists || {}; (p.items || []).forEach((a) => add(a, A.weights.followed)); next = p.next; }
    for (const r of A.top_ranges) { const p = await sp('/me/top/artists?time_range=' + r + '&limit=50'); (p.items || []).forEach((a) => add(a, A.weights.top[r] || 1)); }
    const top = [...lib.values()].sort((a, b) => b.weight - a.weight).slice(0, A.v.artist_limit);
    if (!top.length) return say('No saved artists found on this account yet.');
    const similar = {}, tags = {}; let done = 0, failed = 0;
    const list = (x) => [].concat(x == null ? [] : x);
    const queue = top.slice();
    const worker = async () => { for (let a; (a = queue.shift());) {
      const k = keyOf(a.name);
      const s = await lf('artist.getsimilar', a.name); if (!s) failed++;
      similar[k] = list(s && s.similarartists && s.similarartists.artist).map((x) => ({ name: x.name, match: Number(x.match) }));
      const t = await lf('artist.gettoptags', a.name);
      tags[k] = list(t && t.toptags && t.toptags.tag).slice(0, 5).map((x) => x.name);
      await new Promise((ok) => setTimeout(ok, A.lastfm.pause_ms));
      say('Linking artists… ' + (++done) + ' of ' + top.length);
    } };
    await Promise.all(Array.from({ length: A.v.concurrency }, worker));
    if (failed > top.length / 2) return say('Last.fm is busy right now. Try again in a few minutes.', signInBtn);
    say('Arranging the map…');
    await new Promise((ok) => setTimeout(ok, 30));
    const g = buildGraph({ library: top, similar, tags }, { graph: A.graph, lastfm: A.lastfm });
    st.remove();
    mountMap(g, P);
  })().catch((e) => {
    sessionStorage.removeItem('artist_map_token');
    if (e.message === 'invite') say('This map is invite-only for now: your Spotify account is not on the list.');
    else if (e.message === 'busy') say('Spotify is busy right now. Try again in a few minutes.', signInBtn);
    else say('Something went wrong reading your library. Try again.', signInBtn);
  });
})();
</script></body></html>
`;
}
