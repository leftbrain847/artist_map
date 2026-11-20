// The public page may carry only these fields. Anything else (play counts, dates, ids, tokens) fails the build.

export const ALLOWED = {
  top: ['nodes', 'edges', 'tags', 'because', 'built', 'reconnect_by', 'layouts'],
  node: ['n', 'w', 't', 'r', 'p', 's', 'd'],
  because: ['i', 'from'],
};

const TOKENISH = /[A-Za-z0-9_\-]{40,}/;

export function assertPublicSafe(data) {
  const bad = (msg) => { throw new Error(`public data check failed: ${msg}`); };
  for (const k of Object.keys(data)) if (!ALLOWED.top.includes(k)) bad(`unexpected field "${k}"`);
  for (const nd of data.nodes) {
    for (const k of Object.keys(nd)) if (!ALLOWED.node.includes(k)) bad(`unexpected node field "${k}"`);
    if (typeof nd.n !== 'string' || nd.n.length > 120) bad('artist name is not a short string');
    if ('s' in nd && !(Number.isInteger(nd.s) && nd.s >= 0)) bad('song count is not a whole number');
    if ('d' in nd && !(typeof nd.d === 'string' && /^\d{4}-\d{2}$/.test(nd.d))) bad('first-liked is not a month');
  }
  for (const b of data.because) for (const k of Object.keys(b)) if (!ALLOWED.because.includes(k)) bad(`unexpected field "${k}"`);
  for (const b of data.because) if (!Number.isInteger(b.i) || !Array.isArray(b.from) || !b.from.every((x) => Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && typeof x[1] === 'number')) bad('suggestion links are not [artist, match] pairs');
  for (const e of data.edges) if (e.length !== 3 || !e.every((x) => typeof x === 'number')) bad('edge is not [i, j, match]');
  if (data.built && !/^\d{4}-\d{2}-\d{2}$/.test(data.built)) bad('built is not a date');
  if (data.reconnect_by && !/^\d{4}-\d{2}-\d{2}$/.test(data.reconnect_by)) bad('reconnect_by is not a date');
  for (const t of data.tags) if (typeof t !== 'string' || t.length > 40) bad('tag is not a short string');
  // Extra layouts are positions only: a short lowercase name, one [x, y, z] per artist, in the same order as nodes.
  if ('layouts' in data) {
    if (!data.layouts || typeof data.layouts !== 'object' || Array.isArray(data.layouts)) bad('layouts is not an object');
    for (const [name, pos] of Object.entries(data.layouts)) {
      if (!/^[a-z0-9_]{1,24}$/.test(name)) bad('layout name is not a short lowercase word');
      if (!Array.isArray(pos) || pos.length !== data.nodes.length || !pos.every((p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) bad(`layout ${name} is not one [x, y, z] per artist`);
    }
  }
  // Names come from Spotify and tags from Last.fm; everything else is ours, so a token-shaped run there means a leak.
  const { nodes, tags, ...rest } = data;
  if (TOKENISH.test(JSON.stringify(rest)) || nodes.some((nd) => TOKENISH.test(JSON.stringify({ ...nd, n: '' })))) bad('something token-shaped is in the output');
  return data;
}

// Final check on the finished files: no secret value may appear anywhere in them.
export function assertNoSecrets(text, secrets) {
  for (const s of secrets) if (s && s.length >= 8 && text.includes(s)) throw new Error('a secret value reached the output');
  return text;
}
