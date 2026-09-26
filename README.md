# Maple Guild Pulse

A tiny, ad-free weekly tracker for MapleStory Idle RPG guild members.

## What it does
- Tracks Guild Conquest and Guild War separately.
- Stores Saturday snapshots in `data/history.json`.
- Compares each member with the previous snapshot.
- Green `↗` when improvement is at least **5%**; red `↘` otherwise.
- Highlights new members / missing baselines.
- Pure HTML/CSS/JS dashboard: no front-end framework and no database required.

## Recommended hosting: Cloudflare Pages

Use **Cloudflare Pages + Git integration** for the website. Connect this GitHub repository to Cloudflare Pages and set:

- Framework preset: **None**
- Build command: `npm run build`
- Build output directory: `site`
- Root directory: `/`

Cloudflare Pages can automatically deploy from GitHub on every push, and static asset requests are free/unlimited on the Pages plans. See the current Cloudflare docs:
- https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/
- https://developers.cloudflare.com/pages/framework-guides/deploy-anything/

The weekly GitHub Action updates `data/history.json` and commits it to `main`. That push causes Cloudflare Pages to rebuild, copying the latest data into `site/`.

## First-time setup

1. Put this repository on GitHub.
2. In Cloudflare: **Workers & Pages → Create application → Pages → Connect to Git**.
3. Select the repository.
4. Use the build settings above.
5. Deploy.
6. In GitHub, edit `data/config.json` and replace the placeholder guild/server values.
7. Test the collector manually from **Actions → Weekly Maple snapshot → Run workflow**.

## Data flow

```text
Maple ranking/profile source
          ↓
  GitHub Actions (Sat)
          ↓
   data/history.json
          ↓
      git push
          ↓
  Cloudflare Pages build
          ↓
     Maple dashboard
```

The collector is intentionally separate from the UI. If the upstream Maplestory ranking source changes, only `scripts/collector.mjs` needs to be adjusted.

## Collector note

The exact undocumented endpoint/collection mechanism behind mapleidle.gg has not been hard-coded. The current collector is fail-safe and will not invent or persist scores it could not confidently extract.

The sample history in this repository is seeded from the screenshot supplied for UI testing. Replace it with real collector output before using it as an authoritative record.
