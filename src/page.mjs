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
#wrap{position:relative;height:66vh;min-height:360px;touch-action:none}canvas{width:100%;height:100%;display:block}
#info{position:absolute;left:50%;transform:translateX(-50%);bottom:14px;width:min(92%,420px);background:rgba(14,17,28,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:12px 14px;font-size:14px;text-align:center;display:none}
#info div:first-child{font-weight:500;letter-spacing:.02em}#info div+div{color:var(--dim);font-size:12.5px;margin-top:3px}
#legend{display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 18px 2px;font-size:11px;letter-spacing:.08em;text-transform:lowercase;color:var(--dim)}
section{max-width:460px;margin:0 auto;padding:18px 22px 8px}h2{font-weight:300;font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--dim);text-align:center;margin:8px 0 12px}
ol{list-style:none;margin:0;padding:0}li{padding:10px 2px;border-top:1px solid rgba(255,255,255,.05);display:flex;flex-direction:column}li:last-child{border-bottom:1px solid rgba(255,255,255,.05)}
li button{font-size:15px;color:#e6e9ff}li small{color:var(--dim);font-size:12px;margin-top:2px}
footer{padding:22px;color:#4a5072;font-size:11px;letter-spacing:.06em;text-align:center}button{font:inherit;color:inherit;background:none;border:0;padding:0;text-align:left;cursor:pointer}
#tools{max-width:360px;margin:14px auto 0;padding:0 22px}#find{width:100%;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:999px;color:var(--fg);padding:9px 16px;font:inherit;font-size:13px;letter-spacing:.03em;text-align:center;outline:none}#find:focus{border-color:rgba(255,255,255,.25)}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(255,255,255,.09);border-radius:999px;padding:5px 11px;font-size:11px;letter-spacing:.06em;color:var(--fg);text-transform:lowercase;transition:opacity .2s}
.chip:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--c);box-shadow:0 0 8px var(--c)}.chip.all:before{display:none}.chip.all{color:var(--dim)}
.acts{display:flex;gap:0;border:1px solid rgba(255,255,255,.14);border-radius:999px;overflow:hidden}
.act{padding:7px 18px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--fg)}.act+.act{border-left:1px solid rgba(255,255,255,.14)}
.act[aria-pressed="true"]{background:rgba(255,255,255,.12);color:#fff}
.chips{display:flex;flex-wrap:wrap;justify-content:center;gap:7px}.chips.tray{padding-top:2px}
.chip.add{opacity:.55;border-style:dashed}.chip.add:before{box-shadow:none}.chip.more{color:var(--dim);border-style:dashed}.chip.more:before{display:none}
#legend .hint{font-size:11px;color:var(--dim);letter-spacing:.06em}
#info .x{position:absolute;top:6px;right:10px;font-size:18px;color:var(--dim);padding:2px 6px}
#view{display:flex;align-items:center;justify-content:center;gap:10px;max-width:380px;margin:4px auto 8px;padding:0 18px}
.vbtn{width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.1);color:var(--fg);text-align:center;font-size:14px;line-height:1;flex:none}
#view .roll{flex:1;-webkit-appearance:none;appearance:none;height:2px;background:rgba(255,255,255,.12);border-radius:2px;outline:none}
#view .roll::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;border-radius:50%;background:#c0caf5;border:0}
#view .roll::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#c0caf5;border:0}
#recs_note{text-align:center;color:var(--dim);font-size:12px;margin:-6px 0 12px;letter-spacing:.03em}
section:has(ol:empty) ol{display:none}
#filters{max-width:360px;margin:6px auto 0;padding:0 22px;display:flex;flex-direction:column;gap:12px}#filters:empty{display:none}
#filters label{display:flex;flex-direction:column;gap:6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);text-align:center}
#filters input{-webkit-appearance:none;appearance:none;width:100%;height:2px;background:rgba(255,255,255,.12);border-radius:2px;outline:none}
#filters input::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#e6e9ff;box-shadow:0 0 12px rgba(160,180,255,.6);border:0}
#filters input::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#e6e9ff;border:0}.yours{text-align:center;margin:0 0 26px;font-size:12px;letter-spacing:.14em;text-transform:uppercase}.yours a{color:var(--dim);text-decoration:none;border-bottom:1px solid #2a3050;padding-bottom:3px}
#status{text-align:center;color:var(--dim);font-size:13px;letter-spacing:.04em;padding:30vh 22px 0;position:absolute;inset:0;pointer-events:none}
.pill{display:inline-block;pointer-events:auto;margin-top:16px;padding:11px 22px;border-radius:999px;border:1px solid rgba(255,255,255,.14);color:#e6e9ff;letter-spacing:.12em;text-transform:uppercase;font-size:12px;background:rgba(255,255,255,.03);cursor:pointer}
`;
const MAP_BODY = `<div id="tools"><input id="find" list="names" placeholder="find an artist" autocomplete="off" enterkeyhint="search"><datalist id="names"></datalist></div>
<div id="legend" aria-label="Genres: tap to show or hide"></div>
<div id="wrap"><canvas id="c"></canvas><div id="info"></div></div>
<div id="view" aria-label="View controls"></div>
<div id="filters"></div>
<section><h2>To try</h2><p id="recs_note"></p><ol id="recs"></ol></section>
<footer id="foot"></footer>`;
const VIEW_JS = `function mountMap(D, P) {
  const cv = document.getElementById('c'), cx = cv.getContext('2d'), info = document.getElementById('info');
  const N = D.nodes, lib = N.map((n, i) => i).filter((i) => !N[i].r);
  const colour = (n) => n.r ? P.rec_color : n.t >= 0 ? P.palette[n.t % P.palette.length] : P.other_color;
  const nbrs = N.map(() => []);
  D.edges.forEach(([i, j, m]) => { nbrs[i].push([j, m]); nbrs[j].push([i, m]); });
  nbrs.forEach((l) => l.sort((a, b) => b[1] - a[1]));
  const fromOf = new Map(D.because.map((b) => [b.i, b.from]));
  const hasOther = lib.some((i) => N[i].t < 0);

  // What is on screen: genres switched on, the two sliders, and the suggestions they lead to.
  const on = new Set(D.tags.map((t, k) => k).concat(hasOther ? [-1] : []));
  let minSongs = 0, sinceYear = null, sel = -1;
  const vis = N.map(() => true);
  let picks = [], labelled = new Set(), regions = [], shown = N.length;
  const libOk = (i) => on.has(N[i].t) && (N[i].s || 0) >= minSongs && (sinceYear === null || (!!N[i].d && +N[i].d.slice(0, 4) >= sinceYear));

  function suggest() {
    if (sel >= 0 && !N[sel].r) {
      return D.because.filter((b) => b.from.some(([j]) => j === sel)).map((b) => [b.i, b.from.find(([j]) => j === sel)[1]])
        .sort((a, b) => b[1] - a[1]).slice(0, P.recommend_count).map(([i]) => i);
    }
    const shownLib = lib.filter((i) => vis[i]).length;
    const need = shownLib < 12 ? 1 : P.recommend_min_links;
    return D.because.map((b) => {
      let score = 0, links = 0;
      for (const [j, m] of b.from) if (vis[j]) { score += m * (0.5 + N[j].w / 2); links++; }
      return [b.i, score, links];
    }).filter(([, s, l]) => l >= need && s > 0).sort((a, b) => b[1] - a[1]).slice(0, P.recommend_count).map(([i]) => i);
  }

  function regionsFor() {
    const out = [];
    D.tags.forEach((t, k) => {
      if (!on.has(k)) return;
      const ids = lib.filter((i) => vis[i] && N[i].t === k).sort((a, b) => N[a].p[1] - N[b].p[1]);
      for (let s = 0; s < ids.length; s += P.region_chunk) {
        const pts = ids.slice(s, s + P.region_chunk).map((i) => N[i].p);
        const c = [0, 1, 2].map((d) => pts.reduce((a, p) => a + p[d], 0) / pts.length);
        const spread = Math.sqrt(pts.reduce((a, p) => a + (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2, 0) / pts.length) || 6;
        out.push({ k, c, spread: Math.max(6, spread), name: s === 0 ? t : '' });
      }
    });
    return out;
  }

  const recsOl = document.getElementById('recs'), recsNote = document.getElementById('recs_note'), foot = document.getElementById('foot');
  function refresh() {
    lib.forEach((i) => { vis[i] = libOk(i); });
    D.because.forEach((b) => { vis[b.i] = false; });
    picks = suggest();
    picks.forEach((i) => { vis[i] = true; });
    if (sel >= 0 && N[sel].r) vis[sel] = true;
    if (sel >= 0 && !vis[sel]) { sel = -1; info.style.display = 'none'; }
    shown = vis.filter(Boolean).length;
    labelled = new Set(lib.filter((i) => vis[i]).sort((a, b) => N[b].w - N[a].w).slice(0, P.label_top));
    picks.slice(0, 6).forEach((i) => labelled.add(i));
    regions = regionsFor();
    recsOl.textContent = '';
    picks.forEach((i) => {
      const li = document.createElement('li'), btn = document.createElement('button'), sm = document.createElement('small');
      btn.textContent = N[i].n; btn.onclick = () => { select(i); scrollTo({ top: 0, behavior: 'smooth' }); };
      const why = (fromOf.get(i) || []).filter(([j]) => vis[j]).slice(0, 3).map(([j]) => N[j].n);
      sm.textContent = why.length ? 'like ' + why.join(', ') : '';
      li.append(btn, sm); recsOl.append(li);
    });
    const genres = [...on].filter((k) => k >= 0).map((k) => D.tags[k]);
    recsNote.textContent = sel >= 0 && !N[sel].r ? 'near ' + N[sel].n
      : on.size === D.tags.length + (hasOther ? 1 : 0) ? 'from everything shown'
      : genres.length ? 'for ' + genres.slice(0, 3).join(', ') + (genres.length > 3 ? ' +' + (genres.length - 3) : '') : 'pick a genre above';
    const n = lib.filter((i) => vis[i]).length;
    foot.textContent = n + ' of ' + lib.length + ' artists  ·  drag to turn  ·  tap a dot or a genre' + (D.built ? '  ·  ' + D.built : '');
    drawLegend();
    if (sel >= 0 && !N[sel].r && !picks.length) recsNote.textContent = 'nothing new close to ' + N[sel].n + ' yet';
    frame();
  }

  // ---------- drawing ----------
  let yaw = 0.4, pitch = -0.12, roll = 0, zoom = 1, spin = true, pan = [0, 0], mid = null, drag = null, pinch = null, twist = null, W = 0, H = 0, dpr = 1, proj = [];
  // The camera eases toward whatever is shown, so a single genre fills the view instead of sitting off to one side.
  const cam = { c: [0, 0, 0], rx: 50, ry: 100 }, camGoal = { c: [0, 0, 0], rx: 50, ry: 100 };
  function frame() {
    pan = [0, 0];
    // With an artist tapped, close in on it and its links; otherwise fit everything shown.
    if (sel >= 0) {
      const ids = [sel].concat(nbrs[sel].filter(([j]) => vis[j]).map(([j]) => j));
      const c = N[sel].p;
      camGoal.c = c.slice();
      camGoal.rx = Math.max(10, ...ids.map((i) => Math.hypot(N[i].p[0] - c[0], N[i].p[2] - c[2])));
      camGoal.ry = Math.max(10, ...ids.map((i) => Math.abs(N[i].p[1] - c[1])));
      zoom = 1; return;
    }
    const ids = lib.filter((i) => vis[i]);
    if (!ids.length) return;
    const c = [0, 1, 2].map((d) => ids.reduce((a, i) => a + N[i].p[d], 0) / ids.length);
    camGoal.c = c;
    camGoal.rx = Math.max(12, ...ids.map((i) => Math.hypot(N[i].p[0] - c[0], N[i].p[2] - c[2])));
    camGoal.ry = Math.max(12, ...ids.map((i) => Math.abs(N[i].p[1] - c[1])));
  }
  function size() { dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; }
  function project(q) {
    const p = [q[0] - cam.c[0], q[1] - cam.c[1], q[2] - cam.c[2]], depth = Math.max(cam.rx, cam.ry);
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    const x0 = p[0] * cy - p[2] * sy, z1 = p[0] * sy + p[2] * cy;
    const y0 = p[1] * cp - z1 * sp, z = p[1] * sp + z1 * cp;
    const x = x0 * cr - y0 * sr, y = x0 * sr + y0 * cr;
    // Fit what is shown: spin happens around the vertical axis, so width fits the radius around it, height the vertical reach.
    const f = 340 / (340 + z * 100 / depth) * zoom * Math.min(W * 0.44 / cam.rx, H * 0.44 / cam.ry);
    return [W / 2 + pan[0] + x * f, H / 2 + pan[1] + y * f, z, f];
  }
  const rgba = (hex, a) => { const v = parseInt(hex.slice(1), 16); return 'rgba(' + (v >> 16) + ',' + ((v >> 8) & 255) + ',' + (v & 255) + ',' + a + ')'; };
  function glow(x, y, r, hex, a) {
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, rgba(hex, a)); g.addColorStop(1, rgba(hex, 0));
    cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill();
  }
  const near = (i) => sel >= 0 && (i === sel || nbrs[sel].some(([j]) => j === i));
  function draw() {
    if (spin && !drag && !pinch && sel < 0) yaw += P.auto_rotate;
    for (let d = 0; d < 3; d++) cam.c[d] += (camGoal.c[d] - cam.c[d]) * 0.08;
    cam.rx += (camGoal.rx - cam.rx) * 0.08; cam.ry += (camGoal.ry - cam.ry) * 0.08;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0); cx.clearRect(0, 0, W, H);
    proj = N.map((n) => project(n.p));
    const faded = sel >= 0 ? 0.3 : 1, crowd = Math.min(1, Math.sqrt(P.crowd_nodes / Math.max(1, shown)));
    cx.globalCompositeOperation = 'screen';
    for (const g of regions) { const p = project(g.c); glow(p[0], p[1], g.spread * p[3] * P.region_scale, P.palette[g.k % P.palette.length], P.region_alpha * faded); }
    cx.globalCompositeOperation = 'source-over';
    if (sel >= 0) {
      cx.lineWidth = 0.7;
      for (const [j, m] of nbrs[sel]) {
        if (!vis[j]) continue;
        cx.strokeStyle = 'rgba(255,255,255,' + (0.2 + m * 0.5) + ')';
        cx.beginPath(); cx.moveTo(proj[sel][0], proj[sel][1]); cx.lineTo(proj[j][0], proj[j][1]); cx.stroke();
      }
    }
    const order = proj.map((p, i) => [p[2], i]).sort((a, b) => b[0] - a[0]);
    const placed = [];
    for (const [, i] of order) {
      if (!vis[i]) continue;
      const n = N[i], p = proj[i], r = Math.max(1, (P.point_min + (P.point_max - P.point_min) * n.w) * Math.sqrt(p[3] * 2.4) * crowd * (n.r ? 1.3 : 1));
      const dim = sel >= 0 && !near(i);
      cx.globalAlpha = dim ? 0.18 : 0.95;
      if (n.r) { cx.strokeStyle = P.rec_color; cx.lineWidth = 1.2; cx.beginPath(); cx.arc(p[0], p[1], r + 1.5, 0, 7); cx.stroke(); }
      else { cx.fillStyle = colour(n); cx.beginPath(); cx.arc(p[0], p[1], r, 0, 7); cx.fill(); }
      const label = sel >= 0 ? near(i) : labelled.has(i);
      if (label && !dim && (i === sel || !placed.some((q) => Math.abs(q[0] - p[0]) < 64 && Math.abs(q[1] - p[1]) < 12))) {
        placed.push(p); cx.fillStyle = n.r ? '#ffffff' : '#dfe3fb'; cx.font = (i === sel ? '600 13px' : n.r ? 'italic 11px' : '11px') + ' system-ui';
        cx.fillText(n.n, p[0] + r + 4, p[1] + 4);
      }
    }
    cx.globalAlpha = 1;
    if (sel < 0) for (const g of regions) {
      if (!g.name) continue;
      const p = project(g.c);
      cx.fillStyle = rgba(P.palette[g.k % P.palette.length], 0.85); cx.font = '600 10px system-ui'; cx.textAlign = 'center';
      cx.fillText(g.name.toUpperCase(), p[0], p[1] - g.spread * p[3] * 1.1); cx.textAlign = 'start';
    }
    requestAnimationFrame(draw);
  }

  // ---------- selecting ----------
  function pick(x, y) {
    let best = -1, bd = 22 * 22;
    proj.forEach((p, i) => { if (!vis[i]) return; const d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; best = i; } });
    return best;
  }
  function select(i) {
    sel = i; refresh();
    if (i < 0 || sel !== i) { info.style.display = 'none'; return; }
    const n = N[i];
    info.textContent = '';
    const h = document.createElement('div'); h.textContent = n.n; info.append(h);
    const t = document.createElement('div');
    if (n.r) {
      const why = (fromOf.get(i) || []).filter(([j]) => vis[j]).slice(0, 4).map(([j]) => N[j].n);
      t.textContent = 'new to you  ·  close to ' + (why.join(', ') || 'your artists');
    } else {
      const liked = n.s ? n.s + (n.s === 1 ? ' liked song' : ' liked songs') + (n.d ? ' since ' + n.d : '') : 'followed';
      const kin = nbrs[i].filter(([j]) => vis[j] && !N[j].r).slice(0, 4).map(([j]) => N[j].n);
      t.textContent = [n.t >= 0 ? D.tags[n.t] : 'other', liked, kin.length ? 'close to ' + kin.join(', ') : ''].filter(Boolean).join('  ·  ');
    }
    info.append(t);
    const close = document.createElement('button'); close.className = 'x'; close.textContent = '×'; close.setAttribute('aria-label', 'Close');
    close.onclick = () => select(-1); info.append(close);
    info.style.display = 'block';
  }
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId }; });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || pinch) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved += Math.abs(dx) + Math.abs(dy);
    yaw += dx * 0.008; pitch = Math.max(-1.4, Math.min(1.4, pitch + dy * 0.008)); drag.x = e.clientX; drag.y = e.clientY;
  });
  cv.addEventListener('pointerup', (e) => {
    if (drag && drag.moved < 6) { const r = cv.getBoundingClientRect(); const i = pick(e.clientX - r.left, e.clientY - r.top); select(i === sel ? -1 : i); }
    drag = null;
  });
  // Zoom about a point on screen (pinch midpoint or cursor), so you can close in on any part of the map.
  function zoomAt(k, mx, my) {
    const nz = Math.max(0.5, Math.min(8, zoom * k)); k = nz / zoom; zoom = nz;
    pan[0] = mx - W / 2 - (mx - W / 2 - pan[0]) * k; pan[1] = my - H / 2 - (my - H / 2 - pan[1]) * k;
  }
  cv.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2) { pinch = null; twist = null; mid = null; return; }
    e.preventDefault();
    const rc = cv.getBoundingClientRect();
    const dx = e.touches[1].clientX - e.touches[0].clientX, dy = e.touches[1].clientY - e.touches[0].clientY;
    const d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const m = [(e.touches[0].clientX + e.touches[1].clientX) / 2 - rc.left, (e.touches[0].clientY + e.touches[1].clientY) / 2 - rc.top];
    if (mid) { pan[0] += m[0] - mid[0]; pan[1] += m[1] - mid[1]; } mid = m;
    if (pinch) zoomAt(d / pinch, m[0], m[1]); pinch = d;
    if (twist !== null) { roll += a - twist; syncRoll(); } twist = a;
  }, { passive: false });
  cv.addEventListener('touchend', () => { pinch = null; twist = null; mid = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const rc = cv.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.001), e.clientX - rc.left, e.clientY - rc.top); }, { passive: false });

  // ---------- controls ----------
  // Genres: the legend shows only the genres switched on. "+ genres" opens the rest; All and Clear are plain buttons.
  const lg = document.getElementById('legend'), chips = new Map();
  const allKeys = D.tags.map((t, k) => k).concat(hasOther ? [-1] : []);
  const nameOf = (k) => (k < 0 ? 'other' : D.tags[k]), colourOf = (k) => (k < 0 ? P.other_color : P.palette[k % P.palette.length]);
  let tray = false;
  const setGenres = (keys) => { on.clear(); keys.forEach((k) => on.add(k)); if (sel >= 0 && !N[sel].r && !on.has(N[sel].t)) sel = -1; if (sel < 0) info.style.display = 'none'; refresh(); };
  const toggle = (k) => { const next = new Set(on); if (next.has(k)) next.delete(k); else next.add(k); setGenres([...next]); };
  function drawLegend() {
    if (!on.size) tray = true;
    lg.textContent = '';
    const row = (cls) => { const d = document.createElement('div'); d.className = cls; lg.append(d); return d; };
    const act = row('acts');
    const actBtn = (label, pressed, fn) => { const b = document.createElement('button'); b.className = 'act'; b.textContent = label; b.setAttribute('aria-pressed', pressed ? 'true' : 'false'); b.onclick = fn; act.append(b); };
    const full = on.size === allKeys.length;
    actBtn('All genres', full, () => { tray = false; setGenres(allKeys); });
    actBtn('Clear', on.size === 0, () => { tray = true; setGenres([]); });
    const chipsRow = row('chips');
    const mk = (k, kind) => {
      const b = document.createElement('button'); b.className = 'chip ' + kind; b.style.setProperty('--c', colourOf(k));
      b.textContent = (kind === 'add' ? '+ ' : '') + nameOf(k) + (kind === 'on' && !full ? '  ×' : '');
      b.setAttribute('aria-label', (kind === 'add' ? 'Show ' : 'Hide ') + nameOf(k));
      b.onclick = () => { if (full && kind === 'on') { setGenres([k]); } else toggle(k); };
      return b;
    };
    if (full) {
      const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = 'tap a genre to focus on it';
      allKeys.forEach((k) => chipsRow.append(mk(k, 'on')));
      lg.append(hint);
      return;
    }
    [...on].sort((a, b) => allKeys.indexOf(a) - allKeys.indexOf(b)).forEach((k) => chipsRow.append(mk(k, 'on')));
    const off = allKeys.filter((k) => !on.has(k));
    if (off.length) {
      const more = document.createElement('button'); more.className = 'chip more';
      more.textContent = tray ? 'done' : '+ genres (' + off.length + ')'; more.onclick = () => { tray = !tray; drawLegend(); };
      if (on.size) chipsRow.append(more);
      if (tray) { const t = row('chips tray'); off.forEach((k) => t.append(mk(k, 'add'))); }
    }
    if (!on.size) { const hint = document.createElement('span'); hint.className = 'hint'; hint.textContent = 'pick one or more genres'; lg.append(hint); }
  }
  allKeys.forEach((k) => chips.set(k, null));

  const find = document.getElementById('find'), list = document.getElementById('names');
  if (find) {
    N.forEach((n) => { const o = document.createElement('option'); o.value = n.n; list.append(o); });
    find.addEventListener('change', () => {
      const q = find.value.trim().toLowerCase(); const i = N.findIndex((n) => n.n.toLowerCase() === q);
      if (i < 0) return;
      if (!N[i].r && !on.has(N[i].t)) on.add(N[i].t);
      minSongs = 0; sinceYear = null; fl.querySelectorAll('input').forEach((r) => { r.value = r.min; r.dispatchEvent(new Event('input')); });
      select(i); find.blur();
    });
  }

  // View controls: zoom, turn on the z axis, pause the spin, reset.
  const vc = document.getElementById('view');
  let syncRoll = () => {};
  if (vc) {
    const btn = (label, aria, fn) => { const b = document.createElement('button'); b.className = 'vbtn'; b.textContent = label; b.setAttribute('aria-label', aria); b.onclick = fn; vc.append(b); return b; };
    btn('−', 'Zoom out', () => zoomAt(1 / 1.3, W / 2, H / 2));
    const z = document.createElement('input'); z.type = 'range'; z.min = -180; z.max = 180; z.step = 1; z.value = 0; z.className = 'roll'; z.setAttribute('aria-label', 'Turn on the z axis');
    z.oninput = () => { roll = (+z.value) * Math.PI / 180; };
    syncRoll = () => { let deg = Math.round(roll * 180 / Math.PI); deg = ((deg + 540) % 360) - 180; z.value = deg; };
    vc.append(z);
    btn('+', 'Zoom in', () => zoomAt(1.3, W / 2, H / 2));
    const sp = btn('❚❚', 'Pause spin', () => { spin = !spin; sp.textContent = spin ? '❚❚' : '▶'; sp.setAttribute('aria-label', spin ? 'Pause spin' : 'Resume spin'); });
    btn('⟲', 'Reset view', () => { yaw = 0.4; pitch = -0.12; roll = 0; zoom = 1; z.value = 0; select(-1); });
  }
  const fl = document.getElementById('filters'), withSongs = lib.filter((i) => 's' in N[i]);
  if (fl && withSongs.length) {
    const slider = (label, min, max, value, fmt, onInput) => {
      const wrap = document.createElement('label'), out = document.createElement('span'), r = document.createElement('input');
      r.type = 'range'; r.min = min; r.max = max; r.step = 1; r.value = value; r.setAttribute('aria-label', label);
      out.textContent = fmt(+r.value); r.oninput = () => { out.textContent = fmt(+r.value); onInput(+r.value); };
      wrap.append(out, r); fl.append(wrap);
    };
    const maxS = Math.min(P.songs_slider_max, Math.max(...withSongs.map((i) => N[i].s)));
    if (maxS > 1) slider('Minimum liked songs', 0, maxS, 0, (v) => v === 0 ? 'every artist' : 'at least ' + v + ' liked song' + (v > 1 ? 's' : ''), (v) => { minSongs = v; if (sel >= 0) select(sel); else refresh(); });
    const years = withSongs.filter((i) => N[i].d).map((i) => +N[i].d.slice(0, 4));
    if (years.length) {
      const y0 = Math.min(...years), y1 = Math.max(...years);
      if (y1 > y0) slider('First liked since', y0, y1, y0, (v) => v === y0 ? 'liked any time' : 'new to you since ' + v, (v) => { sinceYear = v === y0 ? null : v; if (sel >= 0) select(sel); else refresh(); });
    }
  }
  refresh();
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
