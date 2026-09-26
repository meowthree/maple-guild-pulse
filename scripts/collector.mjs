/**
 * Guild score collector.
 *
 * Data source: mapleidle.gg internal API
 *   Endpoint: /api/score-analysis/guild?region=REGION&name=GUILD_NAME
 *   Method:   GET (called from within browser context after passing Vercel JS challenge)
 *   Params:   region — server region slug (e.g. "luna", "bera", "aquila")
 *             name   — exact guild name (case-sensitive, URL-encoded)
 *   Response: { members: [{ name, job, level, cp, spriteUrl,
 *               best: { conquest: { score, cp }, guildWar: { score, cp }, ... } }],
 *               membersCount: N }
 *
 * The roster is pulled directly from the API response — no hardcoded member list needed.
 * Member metadata (level, job, CP) is stored in each snapshot.
 *
 * The site sits behind Vercel's bot-protection JS challenge. Plain HTTP (curl/fetch)
 * gets a 403/429. Playwright with full Chromium solves the challenge automatically.
 *
 * IMPORTANT: GitHub-hosted Actions runners (Azure IPs) are blocked by Vercel regardless
 * of the browser used. The collector must run from a trusted IP — a local machine or a
 * self-hosted Actions runner.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configPath = path.join(ROOT, 'data', 'config.json');
const historyPath = path.join(ROOT, 'data', 'history.json');

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const history = JSON.parse(await fs.readFile(historyPath, 'utf8'));

if (!config.guildName || config.guildName === 'YOUR_GUILD_NAME') {
  console.error('ERROR: Set "guildName" in data/config.json before running the collector.');
  process.exit(1);
}
if (!config.region) {
  console.error('ERROR: Set "region" in data/config.json (e.g. "aquila").');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const TIMEOUT_MS = 60_000;

console.log(`Guild: ${config.guildName} (${config.region})`);
if (DRY_RUN) console.log('DRY RUN — will not write history.json');

// --- Launch browser ---
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const page = await browser.newPage({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
});
page.setDefaultTimeout(TIMEOUT_MS);

// --- Navigate and clear Vercel checkpoint ---
console.log('Navigating to mapleidle.gg...');
await page.goto('https://mapleidle.gg', { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });

const deadline = Date.now() + TIMEOUT_MS;
while (Date.now() < deadline) {
  const title = await page.title().catch(() => '');
  if (!/security checkpoint|just a moment|attention required/i.test(title)) break;
  await page.waitForTimeout(2000);
}

const pageTitle = await page.title().catch(() => '');
if (/security checkpoint|just a moment/i.test(pageTitle)) {
  console.error(`BLOCKED: Vercel challenge did not clear after ${TIMEOUT_MS / 1000}s.`);
  console.error('This typically happens on GitHub-hosted runners (Azure IPs are blocked).');
  console.error('Run the collector from a local machine or self-hosted runner instead.');
  await browser.close();
  process.exit(1);
}
console.log('Vercel challenge cleared.');

// --- Call the guild API from within the browser ---
const apiUrl = `/api/score-analysis/guild?region=${encodeURIComponent(config.region)}&name=${encodeURIComponent(config.guildName)}`;
console.log(`Calling API: ${apiUrl}`);

let guildData;
try {
  guildData = await page.evaluate(async (url) => {
    const r = await fetch(url);
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { _error: true, status: r.status, body: body.slice(0, 500) };
    }
    return r.json();
  }, apiUrl);
} catch (err) {
  console.error('Failed to call guild API:', err.message);
  await browser.close();
  process.exit(1);
}

await browser.close();

if (guildData._error) {
  console.error(`API returned HTTP ${guildData.status}: ${guildData.body}`);
  process.exit(1);
}

if (!Array.isArray(guildData.members)) {
  console.error('Unexpected API response — no members array.');
  console.error('Response keys:', Object.keys(guildData));
  process.exit(1);
}

console.log(`API returned ${guildData.members.length} guild members (reported: ${guildData.membersCount}).`);

// --- Build the snapshot from API response ---
const now = new Date();
const date = now.toISOString().slice(0, 10);
const members = {};
const conquest = {};
const guildWar = {};
const errors = [];

let conquestCount = 0;
let warCount = 0;

for (const m of guildData.members) {
  members[m.name] = {
    level: m.level ?? null,
    job: m.job ?? null,
    cp: m.cp ?? null,
  };

  const cqScore = m.best?.conquest?.score;
  const gwScore = m.best?.guildWar?.score;

  if (Number.isFinite(cqScore) && cqScore > 0) {
    conquest[m.name] = cqScore;
    conquestCount++;
  }

  if (Number.isFinite(gwScore) && gwScore > 0) {
    guildWar[m.name] = gwScore;
    warCount++;
  }

  const lvl = String(m.level ?? '-').padStart(3);
  const cp = m.cp ? fmtNum(m.cp) : '-';
  console.log(`  ${m.name.padEnd(16)} Lv${lvl} CP:${cp.padStart(8)}  cq=${cqScore ?? '-'}  gw=${gwScore ?? '-'}`);
}

function fmtNum(n) {
  return new Intl.NumberFormat('en-US').format(n);
}

const snapshot = {
  date,
  timestamp: now.toISOString(),
  source: 'mapleidle.gg',
  members,
  conquest,
  guildWar,
  errors,
};

console.log(`\nSnapshot ${date}: ${Object.keys(members).length} members, ${conquestCount} conquest, ${warCount} guildWar`);

if (conquestCount === 0 && warCount === 0) {
  console.error('WARNING: No scores retrieved at all. Not writing snapshot to avoid data loss.');
  process.exit(1);
}

if (DRY_RUN) {
  console.log('\nDry run complete. Snapshot NOT saved.');
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(0);
}

// --- Save to history (don't overwrite older snapshots) ---
const existingIdx = history.snapshots.findIndex(s => s.date === date);
if (existingIdx >= 0) {
  console.log(`Updating existing snapshot for ${date}.`);
  history.snapshots[existingIdx] = snapshot;
} else {
  history.snapshots.push(snapshot);
}

history.snapshots.sort((a, b) => a.date.localeCompare(b.date));

await fs.writeFile(historyPath, JSON.stringify(history, null, 2) + '\n');
console.log(`Wrote ${historyPath}`);
