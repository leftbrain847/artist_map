#!/usr/bin/env node
// One-time Spotify sign-in: trade the code from callback.html for a long-lived token, written to a file (never logged).
//   CODE=... SPOTIFY_CLIENT_ID=... SPOTIFY_CLIENT_SECRET=... OUT_FILE=... node src/connect.mjs
import { writeFileSync } from 'node:fs';
import { exchangeCode } from './sources.mjs';
import { loadConfig } from './build.mjs';

export async function connect(env = process.env, fetchFn = fetch) {
  const code = (env.CODE || '').trim();
  if (!/^[A-Za-z0-9_\-]{20,1024}$/.test(code)) throw new Error('that does not look like a Spotify code; copy it again from the callback page');
  if (!env.OUT_FILE) throw new Error('OUT_FILE is not set');
  const token = await exchangeCode({ clientId: env.SPOTIFY_CLIENT_ID, clientSecret: env.SPOTIFY_CLIENT_SECRET, code }, loadConfig(), fetchFn);
  if (env.GITHUB_ACTIONS) console.log(`::add-mask::${token}`);
  writeFileSync(env.OUT_FILE, token, { mode: 0o600 });
  console.log('connected: token saved for the next step');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  connect().catch((e) => { console.error(`connect failed: ${e.message}`); process.exit(1); });
}
