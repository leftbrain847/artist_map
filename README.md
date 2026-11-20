# artist_map

J's saved Spotify artists as a 3D map. Last.fm similarity links them; artists linked to several of his become recommendations.

## Run
```
node src/build.mjs --fixture tests/fixtures/sample.json   # offline preview from invented artists -> dist/
node src/build.mjs                                        # real run; needs the secrets below in env
```
Secrets (GitHub Actions only): `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`,
`SPOTIFY_CONNECTED_AT`, `LASTFM_API_KEY`, `ARTIST_MAP_SECRETS_TOKEN`. Every tunable is in `config/artist_map.json`.

## Test
```
node --test
```

## Deployed
- Live: https://leftbrain847.github.io/artist_map/ (the helix, `graph.layout`)
- Other layouts of the same map: add `?layout=<name>` for any name in `graph.extra_layouts`, e.g.
  https://leftbrain847.github.io/artist_map/?layout=umap. UMAP settings are in `graph.umap`; the build log prints
  each layout's time, share of closest artists kept close, and genre separation (numbers only).
- Day snapshot: `YYYY-MM-DD - Project` (frozen; never edited)

## Ship a sprint day
Set `project` in `sprint.config.json`, then freeze the day's page:
```
node scripts/snapshot.mjs <page.html>            # private
node scripts/snapshot.mjs <page.html> --public   # opts in to the public sprint site
```
Commit `snapshots/` to `main` (via PR). The index's nightly refresh logs the day automatically; public pages still have to pass its UAT and secret scan.
