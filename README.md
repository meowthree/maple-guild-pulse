# Maple Guild Pulse

A clean, lightweight weekly performance tracker for MapleStory Idle RPG guilds.

## What it does

- Tracks **Guild Conquest** and **Guild War** scores per member.
- Stores weekly snapshots in `data/history.json` (append-only, never overwritten).
- Compares each member against the previous week.
- **Green ▲** when improvement is ≥ **5%**; **red ▼** otherwise.
- Highlights new members, missing data, and fetch failures clearly.
- Click any member to see their score history with a line chart.
- Pure static HTML/CSS/JS dashboard — no framework, no database.

## Data source

Scores are collected from [mapleidle.gg](https://mapleidle.gg) via its internal API:

| Detail | Value |
|--------|-------|
| **Endpoint** | `/api/score-analysis/guild?region=REGION&name=GUILD_NAME` |
| **Method** | GET (called from within a Playwright browser session) |
| **Auth** | None — the endpoint is public but sits behind Vercel's JS challenge |
| **Response** | `{ members: [{ name, job, level, cp, best: { conquest: { score }, guildWar: { score }, ... } }], membersCount }` |
| **Rate limits** | Unknown; the collector fetches one guild per run with a ~250ms delay |

**Important:** mapleidle.gg uses Vercel bot protection. Plain HTTP requests (curl, Node fetch) get 403/429. Playwright with full Chromium (`channel: 'chromium'`) solves the JS challenge automatically, but **GitHub-hosted Actions runners are blocked** (Azure IP ranges are denied by Vercel). The collector must run from a trusted IP.

## Data flow

```
mapleidle.gg  /api/score-analysis/guild
          ↓
  Playwright (local or self-hosted runner)
          ↓
   data/history.json
          ↓
      git push
          ↓
  Cloudflare Pages build
          ↓
     Maple Guild Pulse dashboard
```

## Schedule

The GitHub Action is configured to run **every Tuesday at 9:00 PM SGT** (UTC+8):

```
cron: 0 13 * * 2
```

A manual `workflow_dispatch` trigger is also available.

Because GitHub-hosted runners are blocked by mapleidle.gg, you have two options:

1. **Self-hosted runner**: Set up a GitHub Actions self-hosted runner on a home/VPS connection. The workflow will work as-is.
2. **Manual collection**: Run the collector locally and push the results.

## Local development

```bash
npm install                   # install Playwright
npm run build                 # build site/ from source files
npx serve site -l 3000        # serve at http://localhost:3000
```

Or serve directly from the project root during development (the app fetches from `data/`).

## Running the collector manually

```bash
# First: set your guild name in data/config.json
# "guildName": "YourGuildName"
# "region": "luna"

# Dry run (prints scores, does not write history)
npm run collect:dry

# Live run (writes to data/history.json)
npm run collect

# Then commit and push
git add data/history.json
git commit -m "weekly guild snapshot $(date +%F)"
git push
```

The collector requires Playwright's Chromium browser. On first run:

```bash
npx playwright install chromium
```

## Cloudflare Pages

Connect this repository to Cloudflare Pages with these settings:

| Setting | Value |
|---------|-------|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `site` |
| Production branch | `main` |

Every push to `main` triggers a rebuild. The build copies `index.html`, `app.js`, `styles.css`, and `data/*.json` into `site/`.

## Configuration

### Guild config (`data/config.json`)

```json
{
  "guildName": "YOUR_GUILD_NAME",
  "region": "luna",
  "worldId": 1,
  "server": "luna-1",
  "timezone": "Asia/Singapore",
  "threshold": 0.05,
  "source": "mapleidle.gg",
  "schedule": "Tuesday 21:00 SGT"
}
```

You **must** set `guildName` to your exact guild name (case-sensitive, as it appears on mapleidle.gg) before the collector will work.

### Guild roster (`data/members.json`)

```json
{
  "guild": "My Guild",
  "world": "luna",
  "members": [
    { "name": "Toeknee1", "joined": true },
    { "name": "中年大叔", "joined": true }
  ]
}
```

Add or remove members by editing this file. Set `"joined": false` to exclude a member from tracking without deleting their entry.

### GitHub Secrets

No secrets are required for the collector. The mapleidle.gg API is public (no auth tokens needed). The collector runs entirely through Playwright browser automation.

## Fail-safe behavior

The collector will **never**:

- Write `0` for a missing score
- Copy a previous score and claim it is current
- Invent data
- Write a snapshot if zero scores were retrieved

When a member cannot be looked up:

- Their name is added to the snapshot's `errors` array
- The dashboard shows them as "FAILED" with a warning icon
- Previous valid data is preserved in earlier snapshots

## Project structure

```
maple-guild-pulse/
├── index.html               # Dashboard source (deployed to site/)
├── app.js                   # Dashboard logic
├── styles.css               # Dashboard styles
├── data/
│   ├── config.json          # Guild/server configuration
│   ├── history.json         # All weekly snapshots (source of truth)
│   └── members.json         # Guild roster
├── scripts/
│   └── collector.mjs        # Playwright-based score collector
├── site/                    # Build output (gitignored, generated by npm run build)
├── .github/workflows/
│   └── weekly.yml           # Tuesday 9 PM SGT collection + commit
├── package.json
└── .gitignore
```
