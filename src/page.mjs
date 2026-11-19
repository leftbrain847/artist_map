// Renders the public pages. Self-contained: no outside scripts, fonts or images, so the index's site check passes.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const jsonForScript = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const BASE_CSS = `
:root{color-scheme:dark;--bg:#0b0d14;--fg:#c0caf5;--dim:#7a82a6;--card:#141826}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 -apple-system,system-ui,sans-serif}
a{color:#7dcfff}header{padding:14px 16px 4px}h1{margin:0;font-size:20px}header p{margin:2px 0 0;color:var(--dim);font-size:13px}
`;

export function renderMap(data, cfg) {
  const pg = cfg.page;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(pg.title)}</title>
<style>${BASE_CSS}
body{background:radial-gradient(120% 80% at 50% 30%,#121626 0%,#0b0d14 60%,#07080d 100%) fixed}
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
</style></head><body>
<header><h1>${esc(pg.title)}</h1><p>${esc(pg.subtitle)}</p></header>
<div id="wrap"><canvas id="c"></canvas><div id="info"></div></div>
<div id="legend"></div>
<section><h2>To try</h2><ol id="recs"></ol></section>
<footer id="foot"></footer>
<script id="data" type="application/json">${jsonForScript(data)}</script>
<script id="cfg" type="application/json">${jsonForScript(pg)}</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById('data').textContent);
  const P = JSON.parse(document.getElementById('cfg').textContent);
  const cv = document.getElementById('c'), cx = cv.getContext('2d'), info = document.getElementById('info');
  const colour = (nd) => nd.r ? P.rec_color : nd.t >= 0 ? P.palette[nd.t % P.palette.length] : P.other_color;
  const nbrs = D.nodes.map(() => []);
  D.edges.forEach(([i, j]) => { nbrs[i].push(j); nbrs[j].push(i); });
  let yaw = 0.6, pitch = -0.25, zoom = 1, sel = -1, drag = null, pinch = null, idle = 0, W = 0, H = 0, dpr = 1;
  const labelled = new Set(D.nodes.map((n, i) => [n.w, i]).sort((a, b) => b[0] - a[0]).slice(0, P.label_top).map(([, i]) => i));

  function size() { dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; }
  function project(p) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
    const y = p[1] * cp - z1 * sp, z = p[1] * sp + z1 * cp;
    const f = 340 / (340 + z) * zoom * Math.min(W, H) / 190;
    return [W / 2 + x * f, H / 2 + y * f, z, f];
  }
  let proj = [];
  // Each genre region is a soft glowing cloud around its artists; edges only show for the tapped artist.
  const regions = D.tags.map((t, k) => {
    const pts = D.nodes.filter((n) => n.t === k && !n.r).map((n) => n.p);
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
    cx.globalCompositeOperation = 'lighter';
    for (const g of regions) {
      const p = project(g.c);
      glow(p[0], p[1], g.spread * p[3] * P.region_scale, P.palette[g.k % P.palette.length], P.region_alpha * faded);
    }
    D.nodes.forEach((n, i) => {
      const p = proj[i], r = (P.point_min + (P.point_max - P.point_min) * n.w) * p[3];
      glow(p[0], p[1], r * P.halo_scale, colour(n), P.halo_alpha * faded);
    });
    cx.globalCompositeOperation = 'source-over';
    if (sel >= 0) {
      cx.lineWidth = 0.8; cx.strokeStyle = 'rgba(255,255,255,.55)';
      for (const j of nbrs[sel]) { cx.beginPath(); cx.moveTo(proj[sel][0], proj[sel][1]); cx.lineTo(proj[j][0], proj[j][1]); cx.stroke(); }
    }
    const order = proj.map((p, i) => [p[2], i]).sort((a, b) => b[0] - a[0]);
    for (const [, i] of order) {
      const n = D.nodes[i], p = proj[i], r = (P.point_min + (P.point_max - P.point_min) * n.w) * p[3] * 0.6;
      const dim = sel >= 0 && i !== sel && !nbrs[sel].includes(i);
      cx.globalAlpha = dim ? 0.2 : 0.95;
      cx.fillStyle = colour(n); cx.beginPath(); cx.arc(p[0], p[1], Math.max(1.2, r), 0, 7); cx.fill();
      if (n.r) { cx.strokeStyle = 'rgba(0,0,0,.6)'; cx.lineWidth = 1; cx.stroke(); }
      const show = sel >= 0 ? (i === sel || nbrs[sel].includes(i)) : labelled.has(i);
      if (show && !dim) { cx.fillStyle = '#e6e9ff'; cx.font = (i === sel ? '600 13px' : '11px') + ' system-ui'; cx.fillText(n.n, p[0] + r + 3, p[1] + 4); }
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
    proj.forEach((p, i) => { const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function show(i) {
    sel = i;
    if (i < 0) { info.style.display = 'none'; return; }
    const n = D.nodes[i], b = D.because.find((x) => x.i === i);
    const tag = n.t >= 0 ? D.tags[n.t] : 'other';
    const near = nbrs[i].slice(0, 6).map((j) => D.nodes[j].n);
    info.textContent = '';
    const h = document.createElement('div'); h.style.fontWeight = '600'; h.textContent = n.n; info.append(h);
    const t = document.createElement('div'); t.style.color = 'var(--dim)';
    t.textContent = b ? 'to try · because of ' + b.from.map((j) => D.nodes[j].n).join(', ') : tag + (near.length ? ' · near ' + near.join(', ') : '');
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
  const ol = document.getElementById('recs');
  D.because.forEach((b) => {
    const li = document.createElement('li'), btn = document.createElement('button'), sm = document.createElement('small');
    btn.textContent = D.nodes[b.i].n; btn.onclick = () => { show(b.i); scrollTo({ top: 0, behavior: 'smooth' }); };
    sm.textContent = 'like ' + b.from.slice(0, 3).map((j) => D.nodes[j].n).join(', ');
    li.append(btn, sm); ol.append(li);
  });
  const lib = D.nodes.filter((n) => !n.r).length;
  document.getElementById('foot').textContent = lib + ' artists  ·  drag to turn, tap to explore  ·  ' + D.built;
  addEventListener('resize', size); size(); draw();
})();
</script></body></html>
`;
}

// Shown before Spotify is connected. The Client ID is public by design; no secret is ever put in a page.
export function renderSetup(clientId, cfg) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(cfg.page.title)}: not connected</title><style>${BASE_CSS} main{padding:16px} .btn{display:inline-block;background:#1db954;color:#000;padding:10px 16px;border-radius:24px;text-decoration:none;font-weight:600}</style></head>
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
    try { sessionStorage.setItem('artist_map_state', state); } catch {}
    const u = new URL(a.base);
    u.search = new URLSearchParams({ client_id: a.client_id, response_type: 'code', redirect_uri: a.redirect_uri, scope: a.scope, state }).toString();
    location.href = u.toString();
  };
})();
</script></body></html>
`;
}

// Spotify sends J back here with a one-time code. The page only shows it; it calls nothing.
export function renderCallback(cfg) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${esc(cfg.page.title)}: connect</title>
<style>${BASE_CSS} main{padding:16px} code{display:block;word-break:break-all;background:#141826;padding:12px;border-radius:8px;margin:8px 0;font-size:13px} button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #3b4261;background:#1a1f33;color:inherit}</style></head>
<body><header><h1>Connect Spotify</h1></header><main id="m"></main>
<script>
(() => {
  const q = new URLSearchParams(location.search), m = document.getElementById('m');
  let want = null; try { want = sessionStorage.getItem('artist_map_state'); } catch {}
  const say = (t) => { const p = document.createElement('p'); p.textContent = t; m.append(p); };
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
